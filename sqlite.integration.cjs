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
let deletionResult;
const recordingFiles = new Map();
const exportFiles = new Map();
const exportedBackups = [];
const audio = { stop:async()=>{},stopPlayback(){},list:async(id)=>[...recordingFiles.values()].filter(take=>take.path.includes(`song-${id}-`)),remove:async(path)=>recordingFiles.delete(path) };
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
          if (rows.some(row => Object.values(row).reduce((size,value) => size + (typeof value === "string" ? Buffer.byteLength(value) : value == null ? 0 : 8),0) > 2 * 1024 * 1024)) throw new Error("CursorWindow row too large");
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
      if (name === "react-native-file-access") return {Dirs:{CacheDir:process.env.TEMP || process.env.RUNNER_TEMP || "/tmp"},FileSystem:{
        async writeFile(file,text){exportFiles.set(file,text);exportedBackups.push(text);},
        async stat(file){return {size:Buffer.byteLength(exportFiles.get(file))};},
        async unlink(file){exportFiles.delete(file);}
      }};
      if (name === "@react-native-documents/picker") return {saveDocuments:async()=>[{error:null}]};
      if (["../index", "./database", "@/components/database"].includes(name)) return {db};
      if (["react-native", "react-native-file-access", "@react-native-documents/picker", "@bam.tech/react-native-image-resizer"].includes(name)) return name === "react-native" ? {Alert:{alert(...args){alerts.push(args); if(deletionResult) {
        if(args[0] === "DeleteSongError") { deletionResult(false); deletionResult=undefined; }
        else args[2]?.find(button=>button.style === "destructive")?.onPress?.();
      }}}} : {};
      if (name.endsWith("locales")) return {t:key=>key};
      if (name === "./performance-audio") return {performanceAudio:audio};
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
  await assert.rejects(read({tableName:"songs; DROP TABLE bands"}),/Invalid database query/);
  await assert.rejects(update({tableName:"bands",data:{"name = NULL; --":"bad"},filters:"id = ?",parameters:[insertId]}),/Invalid database query/);
  await assert.rejects(remove({tableName:"bands",filters:"id = 1 OR 1 = 1"}),/Invalid database query/);
  await remove({tableName:"bands",filters:"id = ?",parameters:["1 OR 1 = 1"]});
  assert.equal((await read({tableName:"bands"})).length,1);
  console.log("SQL boundary rejects unsafe syntax and binds hostile predicate values without affecting records.");
  const collectionIds=Array.from({length:1001},(_,index)=>index+1);
  const selectedRows=await read({tableName:"bands b",fields:"b.id",ids:collectionIds,filters:"b.name LIKE ?",parameters:["%N' Roses%"]});
  assert.equal(selectedRows.length,1);
  assert.equal(selectedRows[0].id,insertId);
  assert.equal((await read({tableName:"bands b",ids:[]})).length,0);
  await assert.rejects(read({tableName:"bands",ids:JSON.parse('["1) OR 1=1 --"]')}),/Invalid record identifiers/);
  console.log("Large numeric record selections, empty selections and bound text filters passed actual SQLite.");

  assert.equal(rows[0].id, insertId);
  assert.equal(rows[0].name, "Guns N' Roses");
  await update({ tableName: "bands", data: { name: "Updated" }, filters:"id = ?",parameters:[insertId] });
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
  await remove({ tableName: "bands", filters:"id = ?",parameters:[insertId] });
  assert.equal((await read({ tableName: "bands" })).length, 0);
  const preferences = load("src/components/preferences.ts");

  const library=load("src/components/library-files.ts");

  const takeSong=await create({tableName:"songs",data:{title:"Recorded",content:"Am\nWords"}});
  const takePath=`/private/performances/song-${takeSong.insertId}-1.m4a`;
  recordingFiles.set(takePath,{path:takePath,date:1,bytes:100});
  failure="DELETE FROM songs WHERE id = ?";
  const deleted=await new Promise(resolve=>{deletionResult=resolve;library.requestSongDeletion(takeSong.insertId,()=>{deletionResult=undefined;resolve(true);},()=>{});});
  failure=undefined;
  assert.equal(deleted,false);
  assert.equal(recordingFiles.size,1,"Failed SQL deletion must preserve recordings");
  assert.equal((await read({tableName:"songs",filters:"id = ?",parameters:[takeSong.insertId]})).length,1);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'recording-delete:%'").get().n,0,"Failed SQL deletion rolls back the cleanup journal");
  await remove({tableName:"songs",filters:"id = ?",parameters:[takeSong.insertId]});
  sqlite.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run(`recording-delete:${takeSong.insertId}`,JSON.stringify([takePath]));
  await library.finishPendingRecordingDeletions();
  assert.equal(recordingFiles.size,0,"Committed deletion resumes file cleanup after restart");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'recording-delete:%'").get().n,0);

  for (const journalPath of ["/OLD/Documents/performances/song-900003-100.m4a", "song-900003-100.m4a"]) {
    const relocated = "/NEW/Documents/performances/song-900003-100.m4a";
    recordingFiles.set(relocated,{path:relocated,date:100,bytes:100});
    sqlite.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("recording-delete:900003",JSON.stringify([journalPath]));
    await library.finishPendingRecordingDeletions();
    assert.equal(recordingFiles.has(relocated),false,"Relocated iOS recording must be deleted using its current native path");
    assert.equal(sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key = 'recording-delete:900003'").get().n,0);
  }
  const retainedPath="/NEW/Documents/performances/song-900004-100.m4a";
  recordingFiles.set(retainedPath,{path:retainedPath,date:100,bytes:100});
  sqlite.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("recording-delete:900004",JSON.stringify(["song-900004-100.m4a"]));
  const actualRemove=audio.remove;
  audio.remove=async()=>true;
  await assert.rejects(library.finishPendingRecordingDeletions(),/RecordingDeleteFailed/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key = 'recording-delete:900004'").get().n,1,"Cleanup journal must remain while the native list still contains its target");
  audio.remove=actualRemove;
  await library.finishPendingRecordingDeletions();
  assert.equal(recordingFiles.size,0);
  console.log("Relocated recording cleanup passed: legacy paths and relative names resolve through the native list; incomplete deletions keep their journal.");
  let releaseCleanup, cleanupStarted;
  const startedCleanup=new Promise(resolve=>{cleanupStarted=resolve;});
  const firstCleanupPath="/private/performances/song-900001-1.m4a";
  const secondCleanupPath="/private/performances/song-900002-1.m4a";
  recordingFiles.set(firstCleanupPath,{path:firstCleanupPath,date:1,bytes:100});
  sqlite.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("recording-delete:900001",JSON.stringify([firstCleanupPath]));
  const originalRemove=audio.remove;
  audio.remove=async(path)=>{if(path===firstCleanupPath)await new Promise(resolve=>{releaseCleanup=resolve;cleanupStarted();});return originalRemove(path);};
  const firstCleanup=library.finishPendingRecordingDeletions();
  await startedCleanup;
  recordingFiles.set(secondCleanupPath,{path:secondCleanupPath,date:1,bytes:100});
  sqlite.prepare("INSERT INTO settings(key,value) VALUES (?,?)").run("recording-delete:900002",JSON.stringify([secondCleanupPath]));
  const secondCleanup=library.finishPendingRecordingDeletions();
  releaseCleanup();
  await Promise.all([firstCleanup,secondCleanup]);
  audio.remove=originalRemove;
  assert.equal(recordingFiles.size,0,"Concurrent cleanup caller must process its newly committed journal");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'recording-delete:%'").get().n,0);
  console.log("Concurrent recording cleanup passed against actual SQLite: new journals arriving during an active pass are drained before their caller completes.");
  const arrangement=(tempo,capo)=>({title:"Two arrangements",content:"Am\nWords",band_name:"",youtube_music:"",youtobe_lesson:"",preferences:{tempo,capo}});
  const backup=library.parseLibraryBackup(JSON.stringify({format:"freetune-library",version:1,songs:[arrangement(80,0),arrangement(120,2)]}));
  const imported=await library.restoreLibrary(backup);
  assert.equal(imported.added,2,"Distinct arrangements in one backup must both restore");
  const copies=await read({tableName:"songs",filters:"title = ?",parameters:["Two arrangements"]});
  assert.equal(copies.length,2);
  const repeated=await library.restoreLibrary(backup);
  assert.equal(repeated.added,0,"Reimport must not multiply arrangements");
  assert.deepEqual(Array.from(copies,song=>preferences.usePreferences.getState().songs[song.id].tempo),[80,120]);
  preferences.usePreferences.getState().updateSong(copies[1].id,{tempo:95});
  await library.restoreLibrary(backup);
  assert.equal(preferences.usePreferences.getState().songs[copies[1].id].tempo,120,"Restoration applies backup preferences to existing records");

  const identified = backup.map((song,index)=>({...song,preferences:{...song.preferences,backupId:`test-origin-${index}`}}));
  await library.restoreLibrary(identified);
  assert.equal((await library.restoreLibrary([identified[0]])).added,0);
  assert.equal((await library.restoreLibrary([identified[1]])).added,0);
  assert.equal((await read({tableName:"songs",filters:"title = ?",parameters:["Two arrangements"]})).length,2,"Numbered parts retain distinct record identities on reimport");
  for(const row of copies) { await remove({tableName:"songs",filters:"id = ?",parameters:[row.id]}); preferences.usePreferences.getState().removeSong(row.id); }
  await preferences.flushPreferences();
  await new Promise(resolve => db.transaction(()=>{},undefined,resolve));
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
    await remove({tableName:"songs",filters:"id = ?",parameters:[id]});
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
  try {
    const name="x".repeat(1001);
    const backup=library.parseLibraryBackup(JSON.stringify({format:"freetune-library",version:1,songs:[{title:"Restored long performer",content:"Am\nWords",band_name:name,youtube_music:"",youtobe_lesson:""}]}));
    await library.restoreLibrary(backup);
    const row=sqlite.prepare("SELECT s.*, b.name AS band_name FROM songs s LEFT JOIN bands b ON b.id=s.band_id WHERE s.title = ?").get("Restored long performer");
    const original={...row,cover:"",fk_band:{id:String(row.band_id),name:row.band_name,search_text_lower:row.band_name.toLowerCase()}};
    const submit=load("src/screens/create-song-chords/formik/on-sabmit.tsx").default;
    assert.equal(await submit({}, {...original,title:"Renamed restored song"},{replace(){}},undefined,original),true);
    assert.equal(sqlite.prepare("SELECT s.title, b.name FROM songs s JOIN bands b ON b.id=s.band_id WHERE s.id = ?").get(row.id).name,name);
    assert.equal(sqlite.prepare("SELECT title FROM songs WHERE id = ?").get(row.id).title,"Renamed restored song");
  } catch(error) {reviewFailures.push(`legacy field edit: ${error.message}`);}
  assert.deepEqual(reviewFailures,[]);
  console.log("SQLite review regressions passed: real NULL video fields edit successfully; restored/deleted covers and preferences stay deleted after reload.");
  const submit=load("src/screens/create-song-chords/formik/on-sabmit.tsx").default;
  const padded="\n".repeat(2100000)+"Words";
  const rowsBefore=sqlite.prepare("SELECT count(*) AS n FROM songs").get().n;
  const previousError=console.error;
  let paddedSaved;
  try {
    console.error=()=>{};
    paddedSaved=await submit({}, {id:0,title:"Padded",content:padded,youtube_music:"",youtobe_lesson:"",cover:"",fk_band:{id:"",name:"",search_text_lower:""}}, {replace(){}});
  } finally {console.error=previousError;}
  assert.equal(paddedSaved,false,"Raw whitespace must not bypass the save size check");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM songs").get().n,rowsBefore);
  const aligned="\n  C      G\n  Hello  world  \n\n";
  assert.equal(await submit({}, {id:0,title:"Aligned whitespace",content:aligned,youtube_music:"",youtobe_lesson:"",cover:"",fk_band:{id:"",name:"",search_text_lower:""}}, {replace(){}}),true);
  const alignedSaved=sqlite.prepare("SELECT content FROM songs WHERE title = ?").get("Aligned whitespace");
  assert.equal(alignedSaved.content,aligned,"Validation must preserve stored chord indentation and blank lines");
  assert.equal(library.parseLibraryBackup(JSON.stringify({format:"freetune-library",version:2,songs:[{title:"Aligned whitespace",content:alignedSaved.content,band_name:"",youtube_music:"",youtobe_lesson:""}]}))[0].content,aligned);
  console.log("Raw save size and whitespace-preserving backup round trip passed against SQLite.");
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
  sqlite.exec("DELETE FROM settings; DELETE FROM songs; DELETE FROM bands;");
  sqlite.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run("experience",JSON.stringify({songs:{}}));
  await preferences.loadPreferences();
  const concurrentId=(await create({tableName:"songs",data:{title:"Concurrent",content:"Am\nWords"}})).insertId;
  preferences.usePreferences.getState().updateSong(concurrentId,{favorite:false});
  await preferences.flushPreferences();
  const originalTransaction=db.transaction;
  db.transaction=function(body,error,success){
    return originalTransaction.call(db,body,error,()=>{
      db.transaction=originalTransaction;
      preferences.usePreferences.getState().updateSong(concurrentId,{favorite:true,tempo:140,transpose:3});
      success?.();
    });
  };
  await submit({}, {id:concurrentId,tempo:100,title:"Concurrent edited",content:"Am\nWords",youtube_music:"",youtobe_lesson:"",cover:"",fk_band:{id:"",name:"",search_text_lower:""}}, {replace(){}});
  await preferences.flushPreferences();
  assert.equal(preferences.usePreferences.getState().songs[concurrentId].favorite,true,"Editor commit must preserve the later favorite change");
  preferences.usePreferences.setState({songs:{}});await preferences.loadPreferences();
  assert.equal(preferences.usePreferences.getState().songs[concurrentId].favorite,true,"Later favorite change must persist in SQLite");
  assert.equal(preferences.usePreferences.getState().songs[concurrentId].tempo,140);
  assert.equal(preferences.usePreferences.getState().songs[concurrentId].transpose,3);
  console.log("Concurrent editor favorite, tempo and transpose regression passed in state and actual SQLite.");
  const restoreSettings = library.parseLibraryBackup(JSON.stringify({format:"freetune-library",version:2,songs:[{title:"Concurrent edited",content:"Am\nWords",band_name:"",youtube_music:"",youtobe_lesson:"",preferences:{tempo:90,favorite:false,capo:2}}]}));
  db.transaction=function(body,error,success){
    return originalTransaction.call(db,body,error,()=>{
      db.transaction=originalTransaction;
      preferences.usePreferences.getState().updateSong(concurrentId,{favorite:false,tempo:155,transpose:4});
      success?.();
    });
  };
  const restoredSettings=await library.restoreLibrary(restoreSettings);
  assert.equal(restoredSettings.added,0);
  assert.equal(restoredSettings.skipped,1);
  await preferences.flushPreferences();
  for (const reload of [false,true]) {
    if(reload){preferences.usePreferences.setState({songs:{}});await preferences.loadPreferences();}
    const current=preferences.usePreferences.getState().songs[concurrentId];
    assert.equal(current.tempo,155,"Restore must retain tempo changed after its write");
    assert.equal(current.favorite,false);
    assert.equal(current.transpose,4);
    assert.equal(current.capo,2,"Unchanged fields still restore from backup");
  }
  console.log("Concurrent backup restore preserves newer settings in state and actual SQLite after reload.");
  const staleId=(await create({tableName:"songs",data:{title:"Deleted",content:"Am\nWords"}})).insertId;
  await remove({tableName:"songs",filters:"id = ?",parameters:[staleId]});
  alerts.length=0;let staleClosed=false;
  const staleSaved=await submit({}, {id:staleId,title:"Draft after deletion",content:"Am\nNew words",youtube_music:"",youtobe_lesson:"",cover:"",fk_band:{id:"",name:"Missing-row artist",search_text_lower:"missing-row artist"}}, {replace(){}},()=>{staleClosed=true;});
  assert.equal(staleSaved,false,"Updating a missing song must not report success");
  assert.equal(staleClosed,false,"Missing-row save must keep the draft open");
  assert.ok(!alerts.some(args=>args[0]==="ElementChanged"));
  assert.equal((await read({tableName:"bands"})).length,0,"Missing-row save must roll back artist insertion");
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE ?").get(`song:${staleId}:%`).n,0);
  console.log("Missing-row save regression passed: real SQLite zero-row update rejects and preserves the editor without orphan metadata.");
  sqlite.exec("DELETE FROM settings; DELETE FROM songs; DELETE FROM bands;");
  preferences.usePreferences.setState({songs:{}});
  const largeTitle="界".repeat(399000);
  const legacyExport=library.parseLibraryBackup(JSON.stringify({format:"freetune-library",version:1,songs:[{title:largeTitle,content:"Am\nWords",band_name:"",youtube_music:"",youtobe_lesson:""}]}));
  await library.restoreLibrary(legacyExport);
  await library.exportLibrary();
  assert.equal(exportedBackups.length,1,"Legacy export must produce one valid backup");
  assert.equal(library.parseLibraryBackup(exportedBackups[0])[0].title.length,399000);
  assert.equal(exportFiles.size,0,"Export must clean its temporary file");
  console.log("Legacy CJK export passed under the aggregate 2 MiB row budget; backup round trip preserves the title.");
  await preferences.flushPreferences();
  sqlite.exec("DELETE FROM settings; DELETE FROM songs; DELETE FROM bands;");
  sqlite.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run("experience",JSON.stringify({songs:{}}));
  await preferences.loadPreferences();
  const tabs = load("src/components/tablature-library.ts");
  const tabModel = load("src/components/tablature.ts");
  const practice = {...load("src/components/tablature-practice.ts").defaultTabPractice(),metronome:true,countInBars:2,trainer:{enabled:true,startBpm:55,targetBpm:90,stepBpm:5,repeats:4}};
  const legacyTab = {version:1,tempo:90,beatsPerBar:4,notes:[{string:0,fret:0,tick:0},{string:5,fret:7,tick:24}]};
  const tab = tabModel.normalizeTablature(legacyTab);
  failure="INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)";
  await assert.rejects(tabs.saveTablature({title:"Riff",tablature:tab}),/Injected failure/);
  failure=undefined;
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM songs").get().n,0,"Failed tablature metadata must roll back the song insertion");
  assert.equal(Object.keys(preferences.usePreferences.getState().songs).length,0);
  const tabId=await tabs.saveTablature({title:"100%_! Riff",tablature:legacyTab,practice});
  assert.equal(sqlite.prepare("SELECT content FROM songs WHERE id = ?").get(tabId).content,tabModel.tablatureText(tab));
  preferences.usePreferences.setState({songs:{}});await preferences.loadPreferences();
  assert.equal(JSON.stringify((await tabs.getTablatureSong(tabId)).tablature),JSON.stringify(tab));
  assert.equal(JSON.stringify((await tabs.getTablatureSong(tabId)).practice),JSON.stringify(practice),"Practice count-in and trainer settings survive SQLite reload");
  assert.equal((await tabs.listTablatureSongs("100%_! Riff"))[0].id,tabId,"Literal wildcard characters must stay searchable");
  assert.equal((await tabs.listTablatureSongs("100%_! Riff",true,30)).length,0);
  const nextTab=tabModel.normalizeTablature({version:2,tempo:90,beatsPerBar:6,beatUnit:8,barCount:3,notes:[{string:2,fret:5,tick:0,duration:18},{string:5,fret:7,tick:36,duration:8}],rests:[{tick:24,duration:12}]});
  sqlite.prepare("UPDATE songs SET content = ? WHERE id = ?").run(tabModel.legacyTablatureText(tab),tabId);
  await tabs.saveTablature({id:tabId,title:"Edited riff",tablature:nextTab});
  assert.equal(sqlite.prepare("SELECT content FROM songs WHERE id = ?").get(tabId).content,tabModel.tablatureText(nextTab));
  const artistId=(await create({tableName:"bands",data:{name:"Tab artist",search_text_lower:"tab artist"}})).insertId;
  const lyricId=(await create({tableName:"songs",data:{title:"Song with lyrics",content:"Am\nKeep my lyrics",band_id:artistId,youtube_music:"https://youtube.com/watch?v=AbCdEfGhI12",search_text_lower:"song with lyrics"}})).insertId;
  preferences.usePreferences.getState().updateSong(lyricId,{capo:3,favorite:true,shapes:{Am:2}});
  await preferences.flushPreferences();
  await tabs.saveTablature({id:lyricId,title:"Song with lyrics",tablature:tab});
  const lyricRow=sqlite.prepare("SELECT * FROM songs WHERE id = ?").get(lyricId);
  assert.equal(lyricRow.content,"Am\nKeep my lyrics");
  assert.equal(lyricRow.band_id,artistId);
  assert.equal(lyricRow.youtube_music,"https://youtube.com/watch?v=AbCdEfGhI12");
  assert.equal(preferences.usePreferences.getState().songs[lyricId].capo,3);
  assert.equal(preferences.usePreferences.getState().songs[lyricId].favorite,true);
  failure="END;";
  await assert.rejects(tabs.saveTablature({id:lyricId,title:"Must roll back",tablature:nextTab}),/Injected failure/);
  failure=undefined;
  assert.equal(sqlite.prepare("SELECT title FROM songs WHERE id = ?").get(lyricId).title,"Song with lyrics");
  assert.equal(JSON.stringify(preferences.usePreferences.getState().songs[lyricId].tablature),JSON.stringify(tab));
  const restTab=tabModel.normalizeTablature({...tabModel.emptyTablature(),barCount:2,rests:[{tick:0,duration:96}]});
  const restId=await tabs.saveTablature({title:"Tacit intro",tablature:restTab});
  assert.ok((await tabs.listTablatureSongs()).some(song=>song.id===restId),"A part made of rests remains discoverable");
  exportedBackups.length=0;
  await library.exportLibrary();
  const tabBackup=library.parseLibraryBackup(exportedBackups[0]);
  assert.equal(tabBackup.length,3);
  assert.ok(tabBackup.every(song=>song.preferences.tablature?.notes.length||song.preferences.tablature?.rests.length));
  sqlite.exec("DELETE FROM settings; DELETE FROM songs; DELETE FROM bands;");
  sqlite.prepare("INSERT INTO settings (key,value) VALUES (?,?)").run("experience",JSON.stringify({songs:{}}));
  await preferences.loadPreferences();
  assert.equal((await library.restoreLibrary(tabBackup)).added,3);
  preferences.usePreferences.setState({songs:{}});await preferences.loadPreferences();
  const restoredTabs=await tabs.listTablatureSongs();
  assert.equal(restoredTabs.length,3);
  assert.equal(JSON.stringify((await tabs.getTablatureSong(restoredTabs.find(song=>song.title==="Song with lyrics").id)).tablature),JSON.stringify(tab));
  assert.equal(JSON.stringify((await tabs.getTablatureSong(restoredTabs.find(song=>song.title==="Edited riff").id)).tablature),JSON.stringify(nextTab),"Backup restoration preserves durations, rests, 6/8 meter and trailing bars");
  assert.equal(JSON.stringify((await tabs.getTablatureSong(restoredTabs.find(song=>song.title==="Edited riff").id)).practice),JSON.stringify(practice),"Score-only edits and backup restoration preserve per-song practice settings");
  assert.equal(JSON.stringify((await tabs.getTablatureSong(restoredTabs.find(song=>song.title==="Tacit intro").id)).tablature),JSON.stringify(restTab));
  await assert.rejects(tabs.saveTablature({id:999999,title:"Deleted",tablature:tab}),/SongMissing/);
  assert.equal((await tabs.listTablatureSongs()).length,3);
  console.log("Tablature SQLite checks passed: atomic create/update rollback, lyrics and metadata preservation, literal search, pagination, reload and backup round trip.");
  const drafts=load("src/components/tablature-draft.ts");
  const draft={version:1,tab:nextTab,savedTab:tab,song:{id:restoredTabs.find(song=>song.title==="Edited riff").id,title:"Edited riff"},practice};
  assert.equal(await drafts.readTablatureDraft(),null);
  await drafts.writeTablatureDraft(draft);
  assert.equal(JSON.stringify(await drafts.readTablatureDraft()),JSON.stringify(draft));
  const maximumTab=tabModel.normalizeTablature({...tabModel.emptyTablature(),barCount:128,notes:Array.from({length:2048},(_,index)=>({string:index%6,fret:index%25,tick:index*6,duration:6}))});
  const largeDraft={...draft,tab:maximumTab,savedTab:maximumTab,song:{...draft.song,title:"🎸".repeat(500)}};
  await drafts.writeTablatureDraft(largeDraft);
  assert.equal(JSON.stringify(await drafts.readTablatureDraft()),JSON.stringify(largeDraft));
  const draftChunks=sqlite.prepare("SELECT key,value FROM settings WHERE key GLOB 'tablature-draft:[0-9]*'").all();
  assert.ok(draftChunks.length>1,"A full composition is persisted across bounded chunks");
  assert.ok(draftChunks.every(row=>row.value.length<=65536&&!/[\uD800-\uDBFF]$/.test(row.value)));
  failure="INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)";
  await assert.rejects(drafts.writeTablatureDraft(draft),/Injected failure/);
  failure=undefined;
  assert.equal(JSON.stringify(await drafts.readTablatureDraft()),JSON.stringify(largeDraft),"Failed autosave keeps the previous complete recoverable draft");
  failure="END;";
  await assert.rejects(drafts.writeTablatureDraft(null),/Injected failure/);
  failure=undefined;
  assert.equal(JSON.stringify(await drafts.readTablatureDraft()),JSON.stringify(largeDraft),"Failed clearing rolls back atomically");
  await drafts.writeTablatureDraft(draft);
  sqlite.prepare("DELETE FROM settings WHERE key = ?").run("tablature-draft:0");
  await assert.rejects(drafts.readTablatureDraft(),/TabDraftInvalid/);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM settings WHERE key LIKE 'tablature-draft:%'").get().n,1,"Corrupt drafts are reported, not silently discarded");
  await Promise.all([drafts.writeTablatureDraft(largeDraft),drafts.writeTablatureDraft(draft),drafts.writeTablatureDraft(null)]);
  assert.equal(await drafts.readTablatureDraft(),null);
  assert.equal((await tabs.listTablatureSongs()).length,3,"Draft cleanup leaves library songs untouched");
  console.log("Tablature draft SQLite checks passed: canonical restore, bounded Unicode chunks, atomic rollback, corrupt-data rejection and ordered save/clear.");
  sqlite.exec("PRAGMA user_version = 99");
  await assert.rejects(migrate(db), /newer application version/);
  assert.equal(sqlite.prepare("PRAGMA user_version").get().user_version, 99);
  console.log("SQLite integration passed: CRUD, bound search, rollback, legacy adoption, repeat migration, newer-version rejection.");
}
const deadline = setTimeout(() => {
  console.error("SQLite integration did not complete within 30 seconds");
  process.exitCode = 1;
}, 30000);
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => {
  clearTimeout(deadline);
  sqlite.close();
});
