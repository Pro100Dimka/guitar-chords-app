import {
  chordsAboveLyrics,
  transposeChord,
  transposeSong,
  songContentFromEditor,
  createSongEditorState,
  songChordSequence
} from "../src/screens/song/chords";
import { importedSong } from "../src/components/library-files";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/locales", () => ({ t: String }));

test("malformed short chord notation cannot block the parser process", () => {
  const filename = require("node:path").resolve("src/screens/song/chords.ts");
  const code = `
    const fs=require('fs'),babel=require('@babel/core'),module={exports:{}};
    const source=babel.transformSync(fs.readFileSync(${JSON.stringify(filename)},'utf8'),{
      filename:'chords.ts',configFile:false,babelrc:false,
      presets:[['@babel/preset-env',{targets:{node:'current'}}],'@babel/preset-typescript']
    }).code;
    new Function('module','exports',source)(module,module.exports);
    const inputs=[4,8,12,16].map(n=>'C'+'111/'.repeat(n)+'111X');
    process.stdout.write(JSON.stringify(inputs.map(input=>module.exports.chordsAboveLyrics(input))));
  `;
  const result = require("node:child_process").execFileSync(
    require("node:process").execPath,
    ["-e", code],
    { timeout: 4000, encoding: "utf8" }
  );
  expect(JSON.parse(result)).toEqual(
    [4, 8, 12, 16].map((n) => "C" + "111/".repeat(n) + "111X")
  );
  expect(transposeChord("C6/9", 2)).toBe("D6/9");
  expect(transposeChord("C7/9/13", 2)).toBe("D7/9/13");
  expect(transposeChord("D/F#", 2)).toBe("E/G#");
});

test.each(["[C]a [G]b", "[C/G]a [D/F#]b"])(
  "transposition keeps lyric anchors and round trips dense notation: %s",
  (source) => {
    const original = chordsAboveLyrics(source);
    const shifted = transposeSong(original, 1);
    const visible = chordsAboveLyrics(shifted).split("\n");
    const second = source.includes("D/F#") ? "D#/G" : "G#";
    expect(visible[0].indexOf(second)).toBe(visible[1].indexOf("b"));
    expect(chordsAboveLyrics(transposeSong(shifted, -1))).toBe(original);
  }
);

test("ChordPro capo import and display recover the original word positions", () => {
  const draft = importedSong(
    "{title: Alignment example}\n{capo: 1}\n[C]a [G]b",
    "example.pro"
  );
  expect(chordsAboveLyrics(transposeSong(draft.content, -draft.capo))).toBe(
    "C G\na b"
  );
});

test("unclosed section brackets parse within a bounded process", () => {
  const filename = require("node:path").resolve("src/screens/song/chords.ts");
  const code = `
    const fs=require('fs'),babel=require('@babel/core'),module={exports:{}};
    const source=babel.transformSync(fs.readFileSync(${JSON.stringify(filename)},'utf8'),{
      filename:'chords.ts',configFile:false,babelrc:false,
      presets:[['@babel/preset-env',{targets:{node:'current'}}],'@babel/preset-typescript']
    }).code;
    new Function('module','exports',source)(module,module.exports);
    const input='[intro '.repeat(28000);
    if(module.exports.chordsAboveLyrics(input)!==input) throw Error('Changed text');
    process.stdout.write('ok');
  `;
  expect(
    require("node:child_process").execFileSync(
      require("node:process").execPath,
      ["-e", code],
      { timeout: 4000, encoding: "utf8" }
    )
  ).toBe("ok");
});

test("capo import preserves a word and its internal chord anchors", () => {
  const song = importedSong(
    "{title: Example}\n{capo: 1}\nПо[C]ве[Am]рь",
    "example.pro"
  );
  const played = transposeSong(song.content, -song.capo);
  expect(
    played
      .replace(/\[[^\]]+\]/g, "")
      .split("\n")
      .filter((line) => !/^\s*[A-G]/.test(line))
      .join("\n")
  ).toBe("Поверь");
  expect(chordsAboveLyrics(played).split("\n").at(-1)).toBe("Поверь");
  expect(played).toBe("По[C]ве[Am]рь");
});

test("blank-line runs in ChordPro directives cannot block the import process", () => {
  const root = require("node:path").resolve("src");
  const code = `
 const fs=require('fs'),babel=require('@babel/core'),root=${JSON.stringify(root)};
 function load(file){const module={exports:{}};const source=babel.transformSync(fs.readFileSync(file,'utf8'),{filename:file,configFile:false,babelrc:false,presets:[['@babel/preset-env',{targets:{node:'current'}}],'@babel/preset-typescript']}).code;
 new Function('require','module','exports',source)(name=>(name.endsWith('/song/chords')||name==='./chords')?load(root+'/screens/song/chords.ts'):name.endsWith('/song/rhythms')?load(root+'/screens/song/rhythms.ts'):name==='@/@interfaces'?{songFieldLimits:{title:1000,content:200000,band_name:1000,youtube_music:4000,youtobe_lesson:4000}}:{},module,module.exports);return module.exports;}
 const {importedSong}=load(root+'/components/library-files.ts');
 for(const separator of ['\\n','\\u2028','\\u2029'])for(let i=0;i<3;i++){const result=importedSong('First line\\n'+separator.repeat(40000)+'[Am]Valid words','example.txt');if(!result.content.includes('Valid words'))throw Error('Lost words');}
 process.stdout.write('ok');`;
  expect(
    require("node:child_process").execFileSync(
      require("node:process").execPath,
      ["-e", code],
      { timeout: 4000, encoding: "utf8" }
    )
  ).toBe("ok");
});

test.each(["По[C]ве[Am]рь", "🎵По[C]ве[Am]рь", "[C]а[Am]б[Dm]в"])(
  "internal anchors survive repeated transposition and editor round trips: %s",
  (source) => {
    const shifted = transposeSong(source, 1);
    expect(transposeSong(shifted, -1)).toBe(source);
    const display = chordsAboveLyrics(shifted);
    expect(display).not.toMatch(/\[[A-G]/);
    expect(songContentFromEditor(shifted, display)).toBe(shifted);
    const changed = display.replace(/([^\n]+)$/, "$1!");
    expect(songContentFromEditor(shifted, changed)).toBe(shifted + "!");
    expect(transposeSong(songContentFromEditor(shifted, changed), -1)).toBe(
      source + "!"
    );
  }
);

test("extremely dense internal anchors keep the presentation bounded", () => {
  const source = "я".repeat(150000) + "[C]".repeat(10000) + "я";
  const canonical = transposeSong(source, 0);
  expect(canonical).toBe(source);
  expect(chordsAboveLyrics(canonical).length).toBeLessThanOrEqual(200000);
});

test("many dense lines share a document-wide display budget", () => {
  const source = ("x".repeat(750) + "[C]".repeat(260) + "y\n").repeat(130);
  expect(source.length).toBeLessThanOrEqual(200000);
  const state = createSongEditorState(source);
  expect(chordsAboveLyrics(source).length).toBeLessThanOrEqual(200000);
  expect(state.text.length).toBeLessThanOrEqual(200000);
  expect(songContentFromEditor(source, state.text, state)).toBe(source);
});

test("editing accepted maximum-size text does not expand it past the save limit", () => {
  const source = "C D\nHello\n".repeat(20000);
  const state = createSongEditorState(source);
  const edited = state.text.replace("Hello", "World");
  const saved = songContentFromEditor(source, edited, state);
  expect(saved.length).toBe(edited.length);
  expect(saved === edited).toBe(true);
});

test.each(["import", "editor"])(
  "tab stops preserve word-aligned chords through %s",
  (path) => {
    const source = "C\tG\nHello\tworld";
    const state = createSongEditorState(source);
    const content =
      path === "import"
        ? importedSong(source, "song.txt").content
        : songContentFromEditor(source, state.text + "!", state);
    const visible = chordsAboveLyrics(content).split("\n");
    expect(visible[1]).toBe(path === "import" ? "Hello world" : "Hello world!");
    expect(visible[0].indexOf("G")).toBe(visible[1].indexOf("world"));
    expect(songChordSequence(content)).toEqual(["C", "G"]);
  }
);

test.each(["2", "2 ", "2\t", " 2\t "])(
  "capo directive accepts surrounding whitespace: %j",
  (value) => {
    const song = importedSong(`{capo: ${value}}\n[Am]Words`, "song.pro");
    expect(song.capo).toBe(2);
    expect(songChordSequence(song.content)).toEqual(["Bm"]);
    expect(transposeSong(song.content, -song.capo)).toBe("[Am]Words");
  }
);

test("an unparsed capo directive stays in the imported text", () => {
  const song = importedSong("{capo: two }\n[Am]Words", "song.pro");
  expect(song.capo).toBe(0);
  expect(song.content).toContain("{capo: two }");
});
