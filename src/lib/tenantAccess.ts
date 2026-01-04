// src/lib/tenantAccess.ts
export const runtime = "nodejs";

import { getClientById, type ClientRecord } from "@/lib/clients";

export type ClientAccessErrorCode =
  | "client_not_found"
  | "client_inactive"
  | "client_blocked"
  | "billing_past_due"
  | "billing_suspended";

export class ClientAccessError extends Error {
  status: number;
  code: ClientAccessErrorCode;

  constructor(status: number, code: ClientAccessErrorCode, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function parseIso(iso?: string | null): number | null {
  if (!iso || typeof iso !== "string") return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

function nowMs(): number {
  return Date.now();
}

/**
 * Enforce tenant access rules on the backend.
 * Regras:
 * - client inexistente => 404
 * - status === "inactive" => 403
 * - access.isBlocked === true => 403
 * - billing.status === "suspended" => 403
 * - billing.status === "past_due" => 403 (fora do grace)
 *
 * Obs: durante a migração do modelo (JSON/DB), access/billing podem variar;
 * por isso usamos leitura tolerante (as any) para não quebrar build.
 */
export async function assertClientActive(clientId: string): Promise<ClientRecord> {
  const client = await getClientById(String(clientId || "").trim());

  if (!client) {
    throw new ClientAccessError(404, "client_not_found", "Cliente não encontrado.");
  }

  if (client.status === "inactive") {
    throw new ClientAccessError(403, "client_inactive", "Cliente inativo.");
  }

  const accessAny = (client.access as any) || null;
  if (accessAny?.isBlocked) {
    const reason = accessAny?.blockReason
      ? ` Motivo: ${accessAny.blockReason}.`
      : "";
    throw new ClientAccessError(403, "client_blocked", `Cliente bloqueado.${reason}`);
  }

  const billingAny = (client.billing as any) || null;
  const billingStatus = billingAny?.status;

  if (billingStatus === "suspended") {
    throw new ClientAccessError(403, "billing_suspended", "Cliente suspenso por billing.");
  }

  if (billingStatus === "past_due") {
    const due = parseIso(billingAny?.dueDate);
    const grace = parseIso(billingAny?.graceUntil);
    const now = nowMs();

    const isPastDue = due !== null && due < now;
    const isInGrace = grace !== null && grace >= now;

    if (isPastDue && !isInGrace) {
      throw new ClientAccessError(403, "billing_past_due", "Cliente inadimplente (vencimento expirado).");
    }
  }

  return client;
}
