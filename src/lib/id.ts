/**
 * Shared ID helper.
 * Pattern matches existing createId implementations across the codebase.
 */
export function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r1}_${r2}`;
}
