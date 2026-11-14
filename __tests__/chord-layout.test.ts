import {
  chordsAboveLyrics,
  transposeChord,
  transposeSong
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
