// src/lib/http/validate.ts
import type { JsonRecord } from "./body";

export function optString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function reqString(v: unknown, fieldLabel: string): string {
  const s = optString(v);
  if (!s || !s.trim()) throw new Error(`${fieldLabel} é obrigatório.`);
  return s.trim();
}

export function optBoolean(v: unknown): boolean | undefined {
  return typeof v === "boolean" ? v : undefined;
}

export function optNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function pickOptionalStrings<T extends string>(
  body: JsonRecord,
  fields: T[]
): Partial<Record<T, string>> {
  const out: Partial<Record<T, string>> = {};
  for (const f of fields) {
    const v = body[f];
    if (typeof v === "string") out[f] = v;
  }
  return out;
}
