import {
  lookupLyrics,
  lookupSongTempo
} from "../src/components/song-autofill/lyrics";

test("tempo lookup falls back from an unrelated Shazam page to the verified recording", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = jest
    .fn()
    .mockImplementation(
      async (url) =>
        new Response(
          String(url).includes("shazam.com")
            ? '<script type="application/ld+json">{"@type":"MusicRecording","name":"Another song","byArtist":"Another artist"}</script><div><span>BPM</span><span>113</span></div>'
            : '<a href="/@o-torvald/lishe-u-moih-snah-mi0gn"><p>O.Torvald</p><p>Лише у моїх снах</p><div><span>BPM</span><span>188</span></div></a>'
        )
    ) as typeof fetch;
  try {
    await expect(
      lookupSongTempo(
        "Лише у моїх снах",
        "O.Torvald",
        "https://www.shazam.com/track/103026355/song"
      )
    ).resolves.toBe(188);
  } finally {
    globalThis.fetch = original;
  }
});

describe("verified tempo sources", () => {
  const original = globalThis.fetch;
  const card = (artist: string, title: string, bpm: number) =>
    `<a href="/@artist/track"><p>${artist}</p><p>${title}</p><div><span>BPM</span><span>${bpm}</span></div></a>`;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it.each([
    card("Different performer", "Лише у моїх снах", 188),
    card("O.Torvald", "Different song", 188),
    card("O.Torvald", "Лише у моїх снах", 188) +
      card("O.Torvald", "Лише у моїх снах", 94),
    card("O.Torvald", "Лише у моїх снах", 999)
  ])(
    "rejects unrelated, conflicting or invalid tempo metadata: %s",
    async (html) => {
      globalThis.fetch = jest
        .fn()
        .mockResolvedValue(new Response(html)) as typeof fetch;
      await expect(
        lookupSongTempo("Лише у моїх снах", "O.Torvald", "")
      ).resolves.toBeUndefined();
    }
  );

  it("uses verified Shazam metadata without requesting another service", async () => {
    const request = jest
      .fn()
      .mockResolvedValue(
        new Response(
          '<script type="application/ld+json">{"@type":"MusicRecording","name":"Example","byArtist":"Performer"}</script><div><span>BPM</span><span>123</span></div>'
        )
      );
    globalThis.fetch = request as typeof fetch;
    await expect(
      lookupSongTempo(
        "Example",
        "Performer",
        "https://www.shazam.com/track/1/example"
      )
    ).resolves.toBe(123);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not send a fallback request after cancellation", async () => {
    const controller = new AbortController();
    controller.abort();
    const request = jest.fn();
    globalThis.fetch = request as typeof fetch;
    await expect(
      lookupSongTempo("Example", "Performer", "", controller.signal)
    ).rejects.toThrow("Cancelled");
    expect(request).not.toHaveBeenCalled();
  });
});

describe("LRCLIB selection metadata", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });

  it("keeps studio and live versions independently, with album and duration", async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          id: 1,
          trackName: "Весна",
          artistName: "Скрябін",
          albumName: "Studio",
          duration: 180,
          plainLyrics: "one"
        },
        {
          id: 2,
          trackName: "Весна",
          artistName: "Скрябін",
          albumName: "Live",
          duration: 220,
          plainLyrics: "two"
        }
      ]
    }) as typeof fetch;
    const results = await lookupLyrics("Весна", "Скрябін");
    expect(results.map((item) => item.album)).toEqual(["Studio", "Live"]);
    expect(results.map((item) => item.duration)).toEqual([180, 220]);
    expect(results.map((item) => item.content)).toEqual(["one", "two"]);
  });
  it("cancels before requesting network data", async () => {
    const abort = new AbortController();
    abort.abort();
    const mocked = jest.fn();
    globalThis.fetch = mocked as typeof fetch;
    await expect(
      lookupLyrics("Весна", "Скрябін", abort.signal)
    ).rejects.toThrow("Cancelled");
    expect(mocked).not.toHaveBeenCalled();
  });
});
