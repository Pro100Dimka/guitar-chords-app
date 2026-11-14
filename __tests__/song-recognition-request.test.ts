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
