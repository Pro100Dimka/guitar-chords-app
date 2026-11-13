const releaseFs = require("node:fs");
const releaseOs = require("node:os");
const releasePath = require("node:path");
const { configure } = require("../scripts/configure_analysis_service.cjs");
const readyHealth = {
  ready: true,
  serviceMode: "shared",
  authentication: "installation",
  limits: {
    uploadBytes: 268435456,
    durationSeconds: 1800,
    activeJobsPerInstallation: 2,
    jobsPerDay: 20
  },
  privacy: { audioDeletion: "after_processing", resultRetentionHours: 24 }
};
let temporary: string;
let configPath: string;
let fetcher: jest.Mock;
beforeEach(() => {
  temporary = releaseFs.mkdtempSync(
    releasePath.join(releaseOs.tmpdir(), "freetune-service-")
  );
  configPath = releasePath.join(temporary, "analysis-service.json");
  releaseFs.writeFileSync(configPath, JSON.stringify({ url: "" }));
  fetcher = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => readyHealth
  }));
});
afterEach(() => releaseFs.rmSync(temporary, { recursive: true, force: true }));

test("release check rejects an empty endpoint without inventing or contacting one", async () => {
  await expect(configure(["--check"], { configPath, fetcher })).rejects.toThrow(
    "Release blocked"
  );
  expect(fetcher).not.toHaveBeenCalled();
});

test.each([
  "http://localhost:8765",
  "https://user:secret@freetune.test",
  "https://freetune.test?token=secret",
  "https://freetune.test#fragment"
])("release configuration refuses unsafe endpoint %s", async (url) => {
  await expect(
    configure(["--url", url], { configPath, fetcher })
  ).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
  expect(JSON.parse(releaseFs.readFileSync(configPath, "utf8")).url).toBe("");
});

test.each([
  { ready: false },
  { serviceMode: "private" },
  { authentication: "none" },
  { limits: { ...readyHealth.limits, jobsPerDay: 0 } },
  { privacy: { audioDeletion: "after_processing", resultRetentionHours: 72 } },
  { privacy: { audioDeletion: "never", resultRetentionHours: 24 } }
])(
  "a failed readiness, limits or privacy gate leaves release configuration untouched",
  async (patch) => {
    fetcher.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...readyHealth, ...patch })
    });
    await expect(
      configure(["--url", "https://freetune.test"], { configPath, fetcher })
    ).rejects.toThrow();
    expect(JSON.parse(releaseFs.readFileSync(configPath, "utf8")).url).toBe("");
  }
);

test("only an actual successful HTTPS health request permits writing the service destination", async () => {
  await configure(["--url", "https://freetune.test/"], { configPath, fetcher });
  expect(fetcher).toHaveBeenCalledWith(
    "https://freetune.test/health",
    expect.objectContaining({
      method: "GET",
      redirect: "error",
      headers: { Accept: "application/json" }
    })
  );
  expect(JSON.parse(releaseFs.readFileSync(configPath, "utf8"))).toEqual({
    url: "https://freetune.test"
  });
  await configure(["--check"], { configPath, fetcher });
  expect(fetcher).toHaveBeenCalledTimes(2);
  await configure(["--clear"], { configPath, fetcher });
  expect(JSON.parse(releaseFs.readFileSync(configPath, "utf8"))).toEqual({
    url: ""
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

test("an unreachable endpoint cannot replace the saved release configuration", async () => {
  const original = JSON.stringify({ url: "https://previous.test" });
  releaseFs.writeFileSync(configPath, original);
  fetcher.mockRejectedValue(new Error("unreachable"));
  await expect(
    configure(["--url", "https://freetune.test"], { configPath, fetcher })
  ).rejects.toThrow("unreachable");
  expect(releaseFs.readFileSync(configPath, "utf8")).toBe(original);
});
