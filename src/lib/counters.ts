// src/lib/counters.ts
// Simple per-client sequential counters.
// Primary: Postgres (when NEXTIA_DB_URL is enabled). Fallback: JSON store in /data.
//
// Use cases:
// - Human-friendly identifiers (e.g., PD-000123, AG-000045)

import { dbQuery, isDbEnabled } from "@/lib/db";
import { getDataPath, readJsonValue, writeJsonValue } from "@/lib/jsonStore";

type CounterState = Record<string, number>;

function requireClientId(clientId: string): void {
  if (!clientId || typeof clientId !== "string") throw new Error("clientId inválido");
}

function requireName(name: string): void {
  const n = (name || "").trim();
  if (!n) throw new Error("counter name inválido");
  if (n.length > 80) throw new Error("counter name muito longo");
}

function countersJsonPath(clientId: string): string {
  return getDataPath(`counters_${clientId}.json`);
}

/**
 * Atomically gets the next integer for a (clientId, name) counter.
 *
 * Postgres path uses an UPSERT with RETURNING for concurrency-safety.
 * JSON fallback is best-effort and intended for local dev / no-DB mode.
 */
export async function nextCounter(clientId: string, name: string): Promise<number> {
  requireClientId(clientId);
  requireName(name);

  if (isDbEnabled()) {
    const r = await dbQuery<{ seq: string | number }>(
      `
      INSERT INTO nextia_counters (client_id, name, seq)
      VALUES ($1, $2, 1)
      ON CONFLICT (client_id, name)
      DO UPDATE SET
        seq = nextia_counters.seq + 1,
        updated_at = NOW()
      RETURNING seq;
      `,
      [clientId, name.trim()]
    );

    const raw = r.rows?.[0]?.seq;
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n <= 0) throw new Error("Falha ao gerar sequência.");
    return Math.floor(n);
  }

  const path = countersJsonPath(clientId);
  const state = (await readJsonValue<CounterState>(path, {})) ?? {};
  const current = Number(state[name] ?? 0);
  const next = (Number.isFinite(current) && current > 0 ? current : 0) + 1;
  state[name] = next;
  await writeJsonValue(path, state);
  return next;
}

export function formatPublicId(prefix: string, seq: number, width = 6): string {
  const p = (prefix || "").trim();
  const n = Math.max(0, Math.floor(Number(seq)));
  const w = Number.isFinite(width) ? Math.max(3, Math.min(12, Math.floor(width))) : 6;
  if (!p) return String(n).padStart(w, "0");
  return `${p}-${String(n).padStart(w, "0")}`;
}
