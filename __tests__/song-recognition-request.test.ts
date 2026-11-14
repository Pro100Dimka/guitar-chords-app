const { recognitionRequest } = require("../scripts/verify-shazam.cjs");

test.each([
  [64000, 2000],
  [384000, 12000],
  [416000, 12000]
])(
  "recognition request reports bounded duration for %s PCM bytes",
  (bytes, duration) => {
    const uri = "data:audio/vnd.shazam.sig;base64,AAAA";
    const body = recognitionRequest(uri, bytes, 123456);
    expect(body).toEqual({
      timezone: "Europe/Paris",
      timestamp: 123456,
      context: {},
      geolocation: {},
      signature: { uri, samplems: duration }
    });
    expect(JSON.stringify(body)).not.toContain("pcm");
  }
);
test.each([1, 63998, 416002])(
  "rejects malformed or out-of-bounds PCM length %s",
  (bytes) => {
    expect(() =>
      recognitionRequest("data:audio/vnd.shazam.sig;base64,AAAA", bytes)
    ).toThrow("Invalid fingerprint input");
  }
);

test("every declared Android ABI has a matching native fingerprint binary", () => {
  const { readFileSync } = require("node:fs");
  const config = readFileSync("android/gradle.properties", "utf8");
  const abis = config
    .match(/^reactNativeArchitectures=(.+)$/m)[1]
    .trim()
    .split(",");
  expect(abis).not.toContain("x86");
  const machines: Record<string, number> = {
    "arm64-v8a": 183,
    "armeabi-v7a": 40,
    x86_64: 62
  };
  const gradle = readFileSync("android/app/build.gradle", "utf8");
  for (const abi of abis) {
    const binary = readFileSync(
      `android/app/src/main/jniLibs/${abi}/libfreetune_song_fingerprint.so`
    );
    expect(binary.subarray(0, 4).toString("hex")).toBe("7f454c46");
    expect(binary.readUInt16LE(18)).toBe(machines[abi]);
    expect(gradle).toContain(`"-t", "${abi}"`);
  }
});
