import {
  chordNotationPattern,
  createSongEditorState,
  hasSongChordsAsync,
  songChords,
  songContentFromEditor,
  transposeSong,
  transposeSongAsync
} from "../src/screens/song/chords";

test.each([false, true])(
  "typing in one lyric line reuses equivalent rows and unchanged groups (cached: %s)",
  (cached) => {
    const original = Array.from(
      { length: 2500 },
      (_, index) => `По[C]ве[Am]рь мне 🎵 дорога далека ${index}`
    ).join("\n");
    const state = createSongEditorState(original);
    const previous = cached
      ? songContentFromEditor(original, state.text, state)
      : original;
    const parse = jest.spyOn(chordNotationPattern, "test");
    try {
      expect(songContentFromEditor(previous, state.text + "!", state)).toBe(
        original + "!"
      );
      expect(parse.mock.calls.length).toBeLessThan(100);
    } finally {
      parse.mockRestore();
    }
  }
);

test("typing in aligned chord and lyric rows reuses unchanged reflow blocks", () => {
  const original = Array.from(
    { length: 2500 },
    (_, index) => `C     G\nHello world, the road is long ${index}`
  ).join("\n");
  const state = createSongEditorState(original);
  const previous = songContentFromEditor(original, state.text, state);
  const parse = jest.spyOn(chordNotationPattern, "test");
  try {
    expect(songContentFromEditor(previous, state.text + "!", state)).toBe(
      original + "!"
    );
    expect(parse.mock.calls.length).toBeLessThan(100);
  } finally {
    parse.mockRestore();
  }
});

test("normal row caching preserves repeated carriage-return normalization", () => {
  const original =
    "C Am\n\nC  G\n\ntart_ofchorus}\r\r\n\n\n] [C]     G\n]o   \t";
  const state = { text: original, groups: [] };
  expect(songContentFromEditor(original, original, state)).toBe(
    "C Am\n\nC  G\n\ntart_ofchorus}\n\n\n] [C]     G\n]o      "
  );
});

test.each([
  "По[C]ве[Am]рь\n🎵[Dm]До́рога [G]домой",
  "[C/G]a [D/F#]b\n[C]a[Am]b[Dm]c",
  "[Verse] C  G (x2)\nHello words\n{start_of_chorus}\n[Am]Back home",
  "C Dm\n Am\nабв\n[[C]] and [G[Am]] nested brackets",
  "C\tG\nHello\tworld\n[C]Tabs\t[Am]inside"
])("editor caches follow line, chord and Unicode edits: %s", (original) => {
  const state = createSongEditorState(original);
  let previous = songContentFromEditor(original, state.text, state);
  let seed = 217;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed;
  };
  const insertions = ["!", "\n", "\n\n", "[C]", "#", "🎵", "\t", "é", ""];
  for (let edit = 0; edit < 80; edit++) {
    const offset = random() % (state.text.length + 1);
    const removed = random() % 5;
    const inserted = insertions[random() % insertions.length];
    const edited =
      state.text.slice(0, offset) +
      inserted +
      state.text.slice(offset + removed);
    const uncached = {
      text: state.text,
      groups: state.groups.map((group) => ({ ...group }))
    };
    const expected = songContentFromEditor(previous, edited, uncached);
    previous = songContentFromEditor(previous, edited, state);
    expect(previous).toBe(expected);
    expect(state).toEqual(uncached);
  }
});

test("cache reuse retains the whole-document expansion limit and tab fallback", () => {
  for (const original of [
    "C D\nHello\n".repeat(20000),
    ("x".repeat(750) + "[C]".repeat(260) + "y\n").repeat(130),
    "C\tG\n" + "words\t".repeat(27000)
  ]) {
    const state = createSongEditorState(original);
    let previous = songContentFromEditor(original, state.text, state);
    for (const inserted of ["!", "\t", "[C]", "\n[Verse]"]) {
      const edited = state.text + inserted;
      const uncached = {
        text: state.text,
        groups: state.groups.map((group) => ({ ...group }))
      };
      const expected = songContentFromEditor(previous, edited, uncached);
      previous = songContentFromEditor(previous, edited, state);
      expect(previous).toBe(expected);
      if (edited.length <= 200000)
        expect(previous.length).toBeLessThanOrEqual(200000);
      expect(state).toEqual(uncached);
    }
  }
});

describe("cooperative song transposition", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test.each([
    "C     G\nHello world, the road is long\n".repeat(2500),
    "По[C]ве[Am]рь\n🎵До́[C]рога [G]домой\n".repeat(2500),
    "C\tG\nHello\tworld\n[Verse] C  G (x2)\n".repeat(1000),
    "C D\nHello\n".repeat(20000),
    "я".repeat(150000) + "[C]".repeat(10000) + "я",
    "C Am\n\nC G\nWords\r\r\n\n] [C] G\n]o   \t"
  ])("async output exactly matches synchronous output: %$", async (content) => {
    const expected = transposeSong(content, 0);
    const pending = transposeSongAsync(content, 0);
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toBe(expected);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("large chart parsing yields again after starting and aborts without partial output", async () => {
    const controller = new AbortController();
    let settled = false;
    const pending = transposeSongAsync(
      "C     G\nHello world, the road is long\n".repeat(2500),
      0,
      controller.signal
    ).finally(() => {
      settled = true;
    });
    const aborted = expect(pending).rejects.toMatchObject({
      name: "AbortError"
    });
    await jest.advanceTimersToNextTimerAsync();
    expect(settled).toBe(false);
    expect(jest.getTimerCount()).toBe(1);
    controller.abort();
    await aborted;
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a cancelled parser never begins work or retains a scheduled yield", async () => {
    const controller = new AbortController();
    controller.abort();
    const parse = jest.spyOn(chordNotationPattern, "test");
    try {
      await expect(
        transposeSongAsync("[C]Words", 0, controller.signal)
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(parse).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      parse.mockRestore();
    }
  });

  test("interleaved parses keep their normalization and cancellation independent", async () => {
    const controller = new AbortController();
    const cancelled = transposeSongAsync(
      "[Verse] C D\nHello words\n".repeat(2500),
      -3,
      controller.signal
    );
    const rejected = expect(cancelled).rejects.toMatchObject({
      name: "AbortError"
    });
    const content = "[Chorus]\n🎵По[C]ве[Am]рь\nC\tG\nHello\tworld\n".repeat(
      500
    );
    const pending = transposeSongAsync(content, 2);
    await jest.advanceTimersToNextTimerAsync();
    controller.abort();
    await rejected;
    await jest.runAllTimersAsync();
    await expect(pending).resolves.toBe(transposeSong(content, 2));
    expect(jest.getTimerCount()).toBe(0);
  });

  test.each([
    "C lyrics without bracket chords",
    "[Verse] C   G (x2)",
    "words ".repeat(33000) + "[Am]",
    "words ".repeat(33000) + "[no chord]",
    "[broken[Dm]]",
    "\n🎵По[C]ве[Am]рь\n"
  ])(
    "async chord existence preserves whole-line interpretation: %$",
    async (content) => {
      const expected = songChords(content).length > 0;
      const pending = hasSongChordsAsync(content);
      await jest.runAllTimersAsync();
      await expect(pending).resolves.toBe(expected);
      expect(jest.getTimerCount()).toBe(0);
    }
  );

  test("chord detection can abort during one maximum-size lyric line", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 0);
    const pending = hasSongChordsAsync(
      "words ".repeat(33000) + "[Am]",
      controller.signal
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError"
    });
    expect(jest.getTimerCount()).toBe(2);
    await jest.advanceTimersToNextTimerAsync();
    await rejected;
    expect(jest.getTimerCount()).toBe(0);
  });
});
