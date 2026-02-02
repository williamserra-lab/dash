// src/lib/entitlements.ts
// Helpers to read plan entitlements safely.

export function getEntitlementNumber(entitlements: any, key: string, fallback: number): number {
  const v = entitlements && typeof entitlements === 'object' ? (entitlements as any)[key] : undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

export function getEntitlementBoolean(entitlements: any, key: string, fallback: boolean): boolean {
  const v = entitlements && typeof entitlements === 'object' ? (entitlements as any)[key] : undefined;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === '1' || s === 'yes' || s === 'y') return true;
    if (s === 'false' || s === '0' || s === 'no' || s === 'n') return false;
  }
  if (typeof v === 'number') return v !== 0;
  return fallback;
}
