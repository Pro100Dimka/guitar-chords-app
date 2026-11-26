import {
  chordsAboveLyrics,
  transposeChord,
  transposeSong,
  songContentFromEditor,
  createSongEditorState,
  hasSongChordsAsync,
  songChordSequence,
  chordShapes
} from "../src/screens/song/chords";
import { importedSong } from "../src/components/library-files";

jest.mock("../src/components/database", () => ({
  db: { transaction: jest.fn() }
}));
jest.mock("../src/locales", () => ({ t: String }));

test.each([
  { chord: "D5(9)", frets: [null, null, 0, 2, 3, 0] },
  { chord: "A5(9)", frets: [null, 0, 2, 2, 0, 0] }
])("provides the published open voicing for $chord", ({ chord, frets }) => {
  expect(chordShapes(chord)).toContainEqual(frets);
});

test.each([
  ["[Am]Original words [G]with chords", true],
  ["Am    G\nOriginal words with chords", true],
  ["[Припев]\n[Am]Приклад тексту пісні", true],
  ["Only example lyrics", false],
  ["[Intro]\nAm G F C", false],
  ["Вступление: см. табы и ноты\nAm G F C", false],
  ["Verse:\n[Am] [G]\n{tempo: 100}\nCapo: 2", false],
  ["[Am] [G]\ne|--0--2--3--|", false],
  [
    "Song: Example\nArtist: Example performer\nTabbed by: Example author\nAm C\ne|--0--1--|",
    false
  ],
  [
    "Song: Example\nArtist: Example performer\nTabbed by: Example author\nAm C\ne|--0--1--|\nOriginal words beside the river",
    true
  ]
])(
  "a playable recognition result requires lyrics and chords: %s",
  async (content, expected) => {
    await expect(
      hasSongChordsAsync(content as string, undefined, true)
    ).resolves.toBe(expected);
  }
);

test("the existing chord-only parser still accepts an instrumental progression", async () => {
  await expect(hasSongChordsAsync("Am G C F")).resolves.toBe(true);
});

test.each([
  "Бой: шестёрка",
  "Бій — шістка з приглушенням",
  "Рекомендуемый Бой: Восьмерка",
  "Рекомендую бой восьмерка",
  "Бой:\nшестёрка с глушением",
  "Бой:\n\nшестёрка",
  "Strumming pattern:\nD D U U D U",
  "Strum pattern\nD-DU-UDU",
  "Batida: ↓ ↓ ↑ ↑ ↓ ↑",
  "Ritmo:\nfour",
  "Перебор:\nБ 3 2 1 2 3",
  "Арпеджио: B3231323",
  "Арпеджіо:\nБ₂ 3 Б 2 Б₂ 3 Б 2",
  "Fingerpicking pattern:\n6-3-2-1-2-3 (6/8)",
  "Picking pattern:\nB32123 (waltz)",
  "Arpeggio: B32123 (3/4)",
  "120 BPM",
  "120–140 BPM",
  "120 ударов в минуту",
  "BPM:\n120 ударов в минуту",
  "Темп\n120 уд/мин",
  "Andamento 120",
  "[Tempo = 120]",
  "[Бой: шестёрка]",
  "Темп: 120 неизвестных единиц",
  "Темп:\n120 неизвестных единиц",
  "Tempo:\n120 seconds",
  "Бой: неизвестный рисунок"
])(
  "tempo and playing instructions cannot establish lyrics: %s",
  async (instruction) => {
    const content = `Am C\n${instruction}`;
    await expect(hasSongChordsAsync(content, undefined, true)).resolves.toBe(
      false
    );
    await expect(hasSongChordsAsync(content)).resolves.toBe(true);
    await expect(
      hasSongChordsAsync(
        `${content}\nНастоящая строка песни продолжается дальше`,
        undefined,
        true
      )
    ).resolves.toBe(true);
  }
);

test.each([
  "Бой продолжается до утра",
  "Бій триває до ранку",
  "Strumming softly in the darkness",
  "Strum my memories into song",
  "Batida do coração me leva",
  "Ritmo da vida me chama",
  "Перебор случайностей привёл меня домой",
  "Arpeggio of the morning settles",
  "Tempo changes as we walk",
  "BPM means nothing when you leave",
  "120 BPM and the city comes alive",
  "Бой:\nСолнце обещает новый день",
  "Strumming pattern:\nOur story starts again",
  "Strumming pattern:\n[Verse]\nfour",
  "Tempo:\nRivers carry every memory"
])("playing terms in actual lyrics remain valid: %s", async (line) => {
  await expect(
    hasSongChordsAsync(`Am C\n${line}`, undefined, true)
  ).resolves.toBe(true);
});

test("strict lyric validation leaves instruction display and transposition intact", async () => {
  const content = "Бой: шестёрка\n[Am]Настоящая строка песни [C]продолжается";
  await expect(hasSongChordsAsync(content, undefined, true)).resolves.toBe(
    true
  );
  expect(transposeSong(content, 2)).toBe(
    "Бой: шестёрка\n[Bm]Настоящая строка песни [D]продолжается"
  );
});

test.each([
  "Song: Example",
  "Title = Example",
  "Artist - Example performer",
  "Album: Example album",
  "Tabbed by: Example author",
  "Transcribed by = Example author",
  "Arranged by: Example author",
  "Tabbed by Example author",
  "Transcribed by Example author",
  "Arranged by Example author"
])("explicit chart metadata is not a lyric line: %s", async (header) => {
  const content = `${header}\nAm C\ne|--0--1--|`;
  await expect(hasSongChordsAsync(content, undefined, true)).resolves.toBe(
    false
  );
  await expect(hasSongChordsAsync(content)).resolves.toBe(true);
});

test.each([
  "Song birds wake before the dawn",
  "Title my dreams with the morning light",
  "Artist of my heart, come home",
  "Album pages carry all the years",
  "Our melody was tabbed by the candlelight",
  "Our story was transcribed by the rain",
  "The stars were arranged by the wind"
])("metadata words in ordinary lyrics remain valid: %s", async (line) => {
  await expect(
    hasSongChordsAsync(`Am C\n${line}`, undefined, true)
  ).resolves.toBe(true);
});

test.each(["C x2", "C (x3)", "|: C :|", "[Verse] C"])(
  "editor round trip retains annotated chord row %s",
  (row) => {
    const original = "[C]Hello";
    const state = createSongEditorState(original);
    const saved = songContentFromEditor(original, `${row}\nHello`, state);
    const reopened = createSongEditorState(saved);
    expect(reopened.text).toContain("Hello");
    for (const marker of row.includes("Verse")
      ? ["[Verse]"]
      : row.includes("|")
        ? ["|:", ":|"]
        : [row.split(" ").slice(1).join(" ")])
      expect(reopened.text).toContain(marker);
    expect(saved).not.toMatch(/Hel\[C\]lo|Hello\[C\]/);
    expect(
      songContentFromEditor(saved, reopened.text + "!", reopened)
    ).toContain("Hello!");
  }
);

test.each(["[Verse]", "Verse:", "{start_of_chorus}"])(
  "chord rows preserve structural heading %s through import and editing",
  (heading) => {
    const source = `C   G\n${heading}\nHello words`;
    const imported = importedSong(source, "example.txt").content;
    expect(imported).toContain(`\n${heading}\n`);
    const state = createSongEditorState(imported);
    const saved = songContentFromEditor(imported, state.text + "!", state);
    expect(saved).toContain(`\n${heading}\n`);
    expect(
      require("../src/screens/song/chords")
        .songSections(saved)
        .some((section: { id: string }) => section.id)
    ).toBe(true);
  }
);

test.each(["C    | G", "C      G (x2)", "C/G  | Bb"])(
  "annotated chord rows preserve word anchors when chord widths change: %s",
  (row) => {
    const second = row.includes("Bb") ? "Bb" : "G";
    const position = row.lastIndexOf(second);
    const source = `${row}\n${"Hello".padEnd(position)}world`;
    const shifted = chordsAboveLyrics(transposeSong(source, 1)).split("\n");
    expect(shifted[0].indexOf(transposeChord(second, 1))).toBe(
      shifted[1].indexOf("world")
    );
    if (row.includes("|")) expect(shifted[0]).toContain("|");
    if (row.includes("(x2)")) expect(shifted[0]).toContain("(x2)");
  }
);

test("dense inline chords stay within the expansion budget in bounded time", () => {
  const input = "[C]".repeat(66665) + "words";
  const start = Date.now();
  expect(chordsAboveLyrics(input)).toBe(input);
  expect(Date.now() - start).toBeLessThan(1500);
});

test.each(["{tempo: 128}", "{meta: tempo 128}"])(
  "ChordPro imports tempo metadata from %s",
  (directive) => {
    const song = importedSong(
      `{title: Example}\n${directive}\n[Am]Original words`,
      "example.cho"
    );
    expect(song.tempo).toBe(128);
    expect(song.content).not.toContain(directive);
    expect(song.content).toContain("Original words");
  }
);

test("tempo-only ChordPro is not imported as song lyrics", () => {
  expect(() =>
    importedSong("{title: Example}\n{tempo: 128}", "empty.cho")
  ).toThrow("FileFormatError");
});

test.each(["{tempo: 0}", "{tempo: 999}", "{tempo: 80}\n{tempo: 120}"])(
  "ambiguous or unsupported ChordPro tempos are retained without selecting a misleading tempo: %s",
  (directives) => {
    const song = importedSong(
      `${directives}\n[Am]Original words`,
      "example.cho"
    );
    expect(song.tempo).toBeUndefined();
    expect(song.content).toContain(directives);
  }
);

test("metadata-only ChordPro does not produce an empty draft", () => {
  expect(() =>
    importedSong("{title: No lyrics}\n{artist: Performer}", "song.cho")
  ).toThrow("FileFormatError");
});

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
