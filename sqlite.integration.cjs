// Run with Node 22.13+ to exercise the application against SQLite in memory.
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");
const babel = require("@babel/core");
const WebSQLDatabase = require("websql/lib/websql/WebSQLDatabase");
const root = __dirname;
const alerts=[];
const sqlite = new DatabaseSync(":memory:");
let failure;
const adapter = {
  exec(queries, readOnly, callback) {
    if (queries.some(({ sql }) => sql === failure)) {
      callback(new Error(`Injected failure: ${failure}`));
      return;
    }
    const results = queries.map(({ sql, args }) => {
      try {
        const statement = sqlite.prepare(sql);
        if (statement.columns().length) {
          const rows = statement.all(...args);
          if (rows.some(row => Object.values(row).some(value => typeof value === "string" && Buffer.byteLength(value) > 2 * 1024 * 1024))) throw new Error("CursorWindow row too large");
          return {rows, rowsAffected:0};
        }
        const result = statement.run(...args);
        return { rows: [], rowsAffected: Number(result.changes), insertId: Number(result.lastInsertRowid) };
      } catch (error) {
        return { error };
      }
    });
    callback(null, results);
  }
};
const db = new WebSQLDatabase("1", adapter);
const modules = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename);
  const code = babel.transformFileSync(filename, {
    configFile: false, babelrc: false,
    presets: [require.resolve("@babel/preset-typescript")],
    plugins: [require.resolve("@babel/plugin-transform-modules-commonjs")]
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, {
    module, exports: module.exports, console,
    setTimeout, clearTimeout,
    require: (name) => {
      if (["../index", "./database", "@/components/database"].includes(name)) return {db};
      if (["react-native", "react-native-file-access", "@react-native-documents/picker", "@bam.tech/react-native-image-resizer"].includes(name)) return name === "react-native" ? {Alert:{alert(...args){alerts.push(args);}}} : {};
      if (name.endsWith("locales")) return {t:key=>key};
      if (name === "./performance-audio") return {performanceAudio:{}};
      if (name.startsWith("@/")) { const target=path.join(root,"src",name.slice(2)); return load(fs.existsSync(target+".ts")?target+".ts":path.join(target,"index.ts")); }
      if (!name.startsWith(".")) return require(name);
      const target = path.resolve(path.dirname(filename), name);
      return load(fs.existsSync(`${target}.ts`) ? `${target}.ts` : fs.existsSync(`${target}.tsx`) ? `${target}.tsx` : path.join(target,"index.ts"));
    }
  });
  modules.set(filename, module.exports);
  return module.exports;
}
async function main() {
  const migrate = load("src/components/database/initTables.ts").default;
  const create = load("src/components/database/crud/create-item.ts").default;
  const read = load("src/components/database/crud/get-all-items.ts").default;
  const update = load("src/components/database/crud/update-item.ts").default;
  const remove = load("src/components/database/crud/delete-item.ts").default;
  failure = "END;";
  await assert.rejects(migrate(db), /Injected failure/);
  assert.equal(sqlite.prepare("PRAGMA user_version").get().user_version, 0);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'songs'").get().n, 0);
  failure = undefined;
  await migrate(db);
  const { insertId } = await create({ tableName: "bands", data: { name: "Guns N' Roses", search_text_lower: "guns n' roses" } });
  const rows = await read({ tableName: "bands", filters: "name LIKE ?", parameters: ["%N' Roses%"] });
  assert.equal(rows[0].id, insertId);
  assert.equal(rows[0].name, "Guns N' Roses");
  await update({ tableName: "bands", data: { name: "Updated" }, filters: `id = ${insertId}` });
  assert.equal((await read({ tableName: "bands" }))[0].name, "Updated");
  sqlite.exec("PRAGMA user_version = 0");
  await migrate(db);
  assert.equal((await read({ tableName: "bands" })).length, 1);
  await migrate(db);
  assert.equal(sqlite.prepare("PRAGMA user_version").get().user_version, 1);
  for (const stage of ["BEGIN;", "END;"]) {
    failure = stage;
    await assert.rejects(create({ tableName: "bands", data: { name: "Must not persist" } }), /Injected failure/);
    failure = undefined;
    assert.equal((await read({ tableName: "bands" })).length, 1);
  }
  await remove({ tableName: "bands", filters: `id = ${insertId}` });
  assert.equal((await read({ tableName: "bands" })).length, 0);
  const preferences = load("src/components/preferences.ts");
  const legacy = JSON.stringify({instrument:"chromatic",songs:Object.fromEntries(Array.from({length:144},(_,i)=>[i+1,{cover:"data:image/jpeg;base64,"+"a".repeat(15000),favorite:true,capo:2}]))});
  sqlite.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)").run("experience",legacy);
  await assert.rejects(read({tableName:"settings",filters:"key = ?",parameters:["experience"]}), /CursorWindow/);
  failure="END;";
  await assert.rejects(preferences.loadPreferences(), /Injected failure/);
  failure=undefined;
  assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key = 'experience'").get().value,legacy);
  assert.equal(Object.keys(preferences.usePreferences.getState().songs).length,0);
  await preferences.loadPreferences();
  assert.equal(Object.keys(preferences.usePreferences.getState().songs).length,144);
  assert.equal(preferences.usePreferences.getState().songs[144].capo,2);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'song:%'").get().n,144);
  assert.ok(sqlite.prepare("SELECT length(value) AS n FROM settings WHERE key = 'experience'").get().n < 4096);
  preferences.usePreferences.getState().updateSong(144,{cover:"data:image/jpeg;base64,"+"z".repeat(290000)});
  preferences.flushPreferences();
  await new Promise((resolve,reject)=>db.transaction(()=>{},reject,resolve));
  preferences.usePreferences.setState({songs:{}});
  await preferences.loadPreferences();
  assert.equal(preferences.usePreferences.getState().songs[144].cover.length,290023);
  assert.equal(preferences.usePreferences.getState().songs[1].favorite,true);
  console.log("SQLite preference migration passed: oversized legacy read reproduced, rollback preserved legacy data, chunked migration and multi-part cover reload passed.");
  const reviewFailures=[];
  try {
    sqlite.exec("DELETE FROM settings; DELETE FROM songs;");
    sqlite.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run("experience",JSON.stringify({songs:{}}));
    await preferences.loadPreferences();
    const library=load("src/components/library-files.ts");
    const imported=library.parseLibraryBackup(JSON.stringify({format:"freetune-library",version:1,songs:[{title:"Restored",content:"Am\nWords",band_name:"",youtube_music:"",youtobe_lesson:"",preferences:{cover:"data:image/jpeg;base64,/9j/2Q=="}}]}));
    await library.restoreLibrary(imported);
    const id=(await read({tableName:"songs"}))[0].id;
    await remove({tableName:"songs",filters:`id = ${id}`});
    preferences.usePreferences.getState().removeSong(id);
    preferences.flushPreferences();
    await new Promise((resolve,reject)=>db.transaction(()=>{},reject,resolve));
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE ?").get(`song:${id}:%`).n,0);
    await preferences.loadPreferences();
    assert.equal(preferences.usePreferences.getState().songs[id],undefined);
  } catch(error) {reviewFailures.push(`restore/delete: ${error.message}`);}
  try {
    const saved=await create({tableName:"songs",data:{title:"Legacy",content:"Am\nWords",youtube_music:null,youtobe_lesson:null,search_text_lower:"legacy"}});
    const legacy=(await read({tableName:"songs",filters:"id = ?",parameters:[saved.insertId]}))[0];
    assert.equal(legacy.youtube_music,null);assert.equal(legacy.youtobe_lesson,null);
    const submit=load("src/screens/create-song-chords/formik/on-sabmit.tsx").default;
    await submit({}, {...legacy,title:"Edited legacy",fk_band:{id:"",name:"",search_text_lower:""},cover:""},{replace(){}});
    const edited=(await read({tableName:"songs",filters:"id = ?",parameters:[saved.insertId]}))[0];
    assert.equal(edited.title,"Edited legacy");assert.equal(edited.youtube_music,"");assert.equal(edited.youtobe_lesson,"");
  } catch(error) {reviewFailures.push(`nullable edit: ${error.message}`);}
  assert.deepEqual(reviewFailures,[]);
  console.log("SQLite review regressions passed: real NULL video fields edit successfully; restored/deleted covers and preferences stay deleted after reload.");
  const submit=load("src/screens/create-song-chords/formik/on-sabmit.tsx").default;
  for (const editing of [false,true]) {
    sqlite.exec("DELETE FROM settings; DELETE FROM songs; DELETE FROM bands;");
    sqlite.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run("experience",JSON.stringify({songs:{}}));
    await preferences.loadPreferences();preferences.usePreferences.setState({saveError:false});
    let id=0;
    if(editing) id=(await create({tableName:"songs",data:{title:"Before",content:"Am\nOriginal",youtube_music:"",youtobe_lesson:""}})).insertId;
    const values={id,title:"Atomic",content:"F#m\nWords",youtube_music:"",youtobe_lesson:"",cover:"data:image/jpeg;base64,/9j/2Q==",capo:2,sourceTuning:"D A D G B E",contentSource:{name:"Shazam",url:"https://www.shazam.com/track/123",credit:"Attribution"},fk_band:{id:"",name:"Atomic artist",search_text_lower:"atomic artist"}};
    let navigated=false,closed=false;alerts.length=0;
    failure="INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)";
    await submit({},values,{replace(){navigated=true;}},()=>{closed=true;});
    preferences.flushPreferences();await new Promise((resolve,reject)=>db.transaction(()=>{},reject,resolve));
    failure=undefined;
    assert.equal(navigated,false);assert.equal(closed,false);
    assert.ok(!alerts.some(args=>["ElementAdded","ElementChanged"].includes(args[0])));
    const rows=await read({tableName:"songs"});
    assert.equal(rows.length,editing?1:0);if(editing)assert.equal(rows[0].title,"Before");
    assert.equal((await read({tableName:"bands"})).length,0);
    assert.equal(preferences.usePreferences.getState().songs[id]?.capo,undefined);
    await submit({},values,{replace(){navigated=true;}},()=>{closed=true;});
    const savedRows=await read({tableName:"songs"});assert.equal(savedRows.length,1);assert.equal(savedRows[0].title,"Atomic");
    preferences.usePreferences.setState({songs:{}});await preferences.loadPreferences();
    assert.equal(preferences.usePreferences.getState().songs[savedRows[0].id].capo,2);
    assert.equal(preferences.usePreferences.getState().songs[savedRows[0].id].contentSource.credit,"Attribution");
  }
  console.log("Atomic song saves passed: settings failures roll back song, artist and metadata; retry commits both create and edit completely.");
  sqlite.exec("PRAGMA user_version = 99");
  await assert.rejects(migrate(db), /newer application version/);
  assert.equal(sqlite.prepare("PRAGMA user_version").get().user_version, 99);
  console.log("SQLite integration passed: CRUD, bound search, rollback, legacy adoption, repeat migration, newer-version rejection.");
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => sqlite.close());
