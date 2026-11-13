#!/usr/bin/env node
// Release-only configuration: never ship a guessed endpoint or a private token.
const fs = require("node:fs/promises");
const path = require("node:path");
const defaultConfig = path.resolve(
  __dirname,
  "../src/config/analysis-service.json"
);

function serviceUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("A real HTTPS service URL is required.");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "The release service must use HTTPS with no credentials, query or fragment."
    );
  return parsed.toString().replace(/\/+$/, "");
}
function validateHealth(health) {
  if (
    !health ||
    typeof health !== "object" ||
    health.ready !== true ||
    health.serviceMode !== "shared" ||
    health.authentication !== "installation"
  )
    throw new Error(
      "The service must be ready in shared installation-authenticated mode."
    );
  const limits = health.limits;
  if (
    !limits ||
    ![
      limits.uploadBytes,
      limits.durationSeconds,
      limits.activeJobsPerInstallation,
      limits.jobsPerDay
    ].every((value) => Number.isSafeInteger(value) && value > 0)
  )
    throw new Error(
      "The service must publish positive upload, duration, active-job and daily limits."
    );
  if (
    health.privacy?.audioDeletion !== "after_processing" ||
    health.privacy.resultRetentionHours !== 24
  )
    throw new Error(
      "The service must delete audio after processing and retain results for at most 24 hours (contract: 24)."
    );
  return health;
}
async function checkService(url, fetcher = fetch) {
  const normalized = serviceUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    // Redirects must not silently change the destination shown for user consent.
    const response = await fetcher(`${normalized}/health`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok)
      throw new Error(`Health request failed with HTTP ${response.status}.`);
    validateHealth(await response.json());
    return normalized;
  } finally {
    clearTimeout(timeout);
  }
}
async function configure(args, options = {}) {
  const configPath = options.configPath ?? defaultConfig;
  const fetcher = options.fetcher ?? fetch;
  let nextUrl;
  if (args.length === 1 && args[0] === "--clear") {
    nextUrl = "";
  } else if (args.length === 1 && args[0] === "--check") {
    const saved = JSON.parse(await fs.readFile(configPath, "utf8"));
    if (!saved.url?.trim())
      throw new Error(
        "Release blocked: the developer service URL is empty; ordinary analysis is unavailable."
      );
    await checkService(saved.url, fetcher);
    return "Shared HTTPS analysis service is ready; release configuration is valid.";
  } else if (args.length === 2 && args[0] === "--url") {
    nextUrl = await checkService(args[1], fetcher);
  } else {
    throw new Error(
      "Usage: node scripts/configure_analysis_service.cjs --url https://REAL-SERVICE | --check | --clear"
    );
  }
  // Validate first, then atomically replace only this developer-controlled file.
  const temporary = `${configPath}.tmp-${process.pid}`;
  try {
    await fs.writeFile(
      temporary,
      `${JSON.stringify({ url: nextUrl }, null, 2)}\n`,
      { flag: "wx" }
    );
    await fs.rename(temporary, configPath);
  } finally {
    await fs.unlink(temporary).catch(() => {});
  }
  return nextUrl
    ? `Verified shared HTTPS service configured: ${nextUrl}`
    : "Shared service configuration cleared; ordinary analysis is explicitly unavailable.";
}
if (require.main === module) {
  configure(process.argv.slice(2)).then(
    (message) => console.log(message),
    (error) => {
      console.error(error.message);
      process.exitCode = 1;
    }
  );
}
module.exports = { serviceUrl, validateHealth, checkService, configure };
