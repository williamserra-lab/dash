// src/lib/validation.ts
// Minimal validation helpers used by API routes. Keep lightweight and dependency-free.

export function optString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length ? s : undefined;
}
