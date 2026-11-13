import bundledService from "../../config/analysis-service.json";
import { db } from "../database";
import { getAllItems } from "../database/crud";

export type AnalysisMode = "shared" | "private";
export interface AnalysisSettings {
  // Omitted by older callers: a supplied private address keeps its old meaning.
  mode?: AnalysisMode;
  url: string;
  token: string;
  language: "auto" | "uk" | "ru" | "en";
}
export const defaultAnalysisSettings: AnalysisSettings = {
  mode: "shared",
  url: "",
  token: "",
  language: "auto"
};
export const analysisMode = (settings: AnalysisSettings): AnalysisMode =>
  settings.mode ?? (settings.url.trim() ? "private" : "shared");

/** Private connections may use a local HTTP address; releases require HTTPS. */
export function analysisServerUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("AnalysisInvalidServer");
  }
  const host = url.hostname.toLowerCase();
  const local =
    host === "localhost" ||
    host === "[::1]" ||
    host.endsWith(".local") ||
    /^(127|10)\.(\d{1,3}\.){2}\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("AnalysisInvalidServer");
  return url.toString().replace(/\/+$/, "");
}

export function analysisDestination(settings: AnalysisSettings): string {
  if (analysisMode(settings) === "private")
    return analysisServerUrl(settings.url);
  if (!bundledService.url.trim()) throw new Error("AnalysisServiceUnavailable");
  const url = analysisServerUrl(bundledService.url);
  if (!url.startsWith("https://"))
    throw new Error("AnalysisServiceUnavailable");
  return url;
}

function parse(value: string | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
const language = (value: unknown): AnalysisSettings["language"] =>
  value === "uk" || value === "ru" || value === "en" ? value : "auto";

export async function loadAnalysisSettings(): Promise<AnalysisSettings> {
  const rows = await getAllItems<{ key: string; value: string }>({
    tableName: "settings",
    filters: "key IN (?, ?)",
    parameters: ["audio_analysis_server", "audio_analysis_service_preferences"]
  });
  const legacy = parse(
    rows.find((row) => row.key === "audio_analysis_server")?.value
  );
  const prefs = parse(
    rows.find((row) => row.key === "audio_analysis_service_preferences")?.value
  );
  const url = typeof legacy.url === "string" ? legacy.url : "";
  return {
    mode:
      prefs.mode === "shared" || prefs.mode === "private"
        ? prefs.mode
        : url.trim()
          ? "private"
          : "shared",
    url,
    token: typeof legacy.token === "string" ? legacy.token : "",
    language: language(prefs.language ?? legacy.language)
  };
}

export async function saveAnalysisSettings(settings: AnalysisSettings) {
  const mode = analysisMode(settings);
  const normalized = {
    ...settings,
    mode,
    ...(mode === "private" ? { url: analysisServerUrl(settings.url) } : {})
  };
  await new Promise<void>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
          [
            "audio_analysis_service_preferences",
            JSON.stringify({ mode, language: normalized.language })
          ]
        );
        // Switching to the shared service must not erase an existing private URL/token.
        if (mode === "private")
          tx.executeSql(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            [
              "audio_analysis_server",
              JSON.stringify({
                url: normalized.url,
                token: normalized.token,
                language: normalized.language
              })
            ]
          );
      },
      reject,
      resolve
    );
  });
  return normalized;
}

export async function saveAnalysisPreferences(settings: AnalysisSettings) {
  await new Promise<void>((resolve, reject) => {
    db.transaction(
      (tx) =>
        tx.executeSql(
          "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
          [
            "audio_analysis_service_preferences",
            JSON.stringify({
              mode: analysisMode(settings),
              language: settings.language
            })
          ]
        ),
      reject,
      resolve
    );
  });
}

export interface ServiceLimits {
  uploadBytes: number;
  durationSeconds: number;
  activeJobsPerInstallation: number;
  jobsPerDay: number;
}
export interface ServiceHealth {
  ready: boolean;
  serviceMode?: "shared" | "private";
  authentication?: "installation" | "bearer" | "none";
  limits?: ServiceLimits;
  privacy?: { audioDeletion: "after_processing"; resultRetentionHours: number };
}
export function validateServiceHealth(
  value: unknown,
  shared: boolean
): ServiceHealth {
  if (!value || typeof value !== "object")
    throw new Error("AnalysisInvalidResponse");
  const health = value as ServiceHealth;
  if (typeof health.ready !== "boolean")
    throw new Error("AnalysisInvalidResponse");
  if (shared) {
    const limits = health.limits;
    if (
      health.serviceMode !== "shared" ||
      health.authentication !== "installation" ||
      !limits ||
      ![
        limits.uploadBytes,
        limits.durationSeconds,
        limits.activeJobsPerInstallation,
        limits.jobsPerDay
      ].every((number) => Number.isSafeInteger(number) && number > 0) ||
      health.privacy?.audioDeletion !== "after_processing" ||
      health.privacy.resultRetentionHours !== 24
    )
      throw new Error("AnalysisInvalidResponse");
  }
  return health;
}

export interface AnalysisInstallation {
  installationId: string;
  token: string;
  expiresAt: number;
}
export function validInstallation(
  value: unknown
): value is AnalysisInstallation {
  if (!value || typeof value !== "object") return false;
  const identity = value as AnalysisInstallation;
  return (
    typeof identity.installationId === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(identity.installationId) &&
    typeof identity.token === "string" &&
    /^ft1_[0-9a-f]{64}$/.test(identity.token) &&
    Number.isSafeInteger(identity.expiresAt) &&
    identity.expiresAt > 0
  );
}
const installationKey = "audio_analysis_installation";
function installations(
  value: string | undefined
): Record<string, AnalysisInstallation> {
  const parsed = parse(value);
  const entries = parsed.installations;
  if (
    parsed.version !== 1 ||
    !entries ||
    typeof entries !== "object" ||
    Array.isArray(entries)
  )
    return {};
  return Object.fromEntries(
    Object.entries(entries).filter(([, identity]) =>
      validInstallation(identity)
    )
  );
}
export async function loadAnalysisInstallation(url: string) {
  const [row] = await getAllItems<{ value: string }>({
    tableName: "settings",
    filters: "key = ?",
    parameters: [installationKey]
  });
  return installations(row?.value)[url];
}
function updateInstallation(
  url: string,
  update: (previous?: AnalysisInstallation) => AnalysisInstallation | undefined
) {
  // SQLite serializes the read and replacement, including concurrent different URLs.
  return new Promise<void>((resolve, reject) => {
    db.transaction(
      (tx) => {
        tx.executeSql(
          "SELECT value FROM settings WHERE key = ?",
          [installationKey],
          (_, result) => {
            const current = installations(
              result.rows.length ? result.rows.item(0).value : undefined
            );
            const next = update(current[url]);
            if (next) current[url] = next;
            else delete current[url];
            tx.executeSql(
              "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
              [
                installationKey,
                JSON.stringify({ version: 1, installations: current })
              ]
            );
          }
        );
      },
      reject,
      resolve
    );
  });
}
export const saveAnalysisInstallation = (
  url: string,
  identity: AnalysisInstallation
) => updateInstallation(url, () => identity);
export const forgetAnalysisInstallation = (url: string, token: string) =>
  updateInstallation(url, (current) =>
    current?.token === token ? undefined : current
  );
