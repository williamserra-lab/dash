// src/lib/telemetry.ts
// Minimal structured telemetry for server-side observability.
// Design goals:
// - zero external dependencies
// - no PII by default (callers must redact where appropriate)
// - safe in edge/node runtimes (we only target nodejs runtimes in routes that use this)

export type TelemetryLevel = "debug" | "info" | "warn" | "error";

export type TelemetryRecord = {
  ts: string; // ISO
  level: TelemetryLevel;
  event: string;
  clientId?: string;
  requestId?: string;
  payload?: Record<string, unknown>;
};

function isDisabled() {
  return process.env.NEXTIA_TELEMETRY_DISABLE === "1";
}

function shouldLog(level: TelemetryLevel) {
  const cfg = (process.env.NEXTIA_TELEMETRY_LEVEL || "info").toLowerCase();
  const rank: Record<TelemetryLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  const min = (cfg === "debug" || cfg === "info" || cfg === "warn" || cfg === "error") ? (cfg as TelemetryLevel) : "info";
  return rank[level] >= rank[min];
}

export function logTelemetry(record: TelemetryRecord) {
  if (isDisabled()) return;
  if (!shouldLog(record.level)) return;

  // Console JSON lines: easy to ship to any log collector.
  // Never stringify errors directly (can be circular).
  try {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(record));
  } catch {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ ts: new Date().toISOString(), level: "warn", event: "telemetry_stringify_failed" }));
  }
}

export function nowIso() {
  return new Date().toISOString();
}
