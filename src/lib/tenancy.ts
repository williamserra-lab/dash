// src/lib/tenancy.ts
// Compat shim: some routes import from "@/lib/tenancy".
// The canonical implementation lives in tenantAccess.ts.

export { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
export type { ClientAccessErrorCode } from "@/lib/tenantAccess";
