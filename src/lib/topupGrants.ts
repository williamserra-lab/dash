export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { ensureDbSchema, dbQuery } from "@/lib/db";

export type CreateTopupGrantInput = {
  clientId: string;
  monthKey: string;
  requestId?: string | null;
  creditsGranted: number;
  amountCents?: number | null;
  currency?: string;
  notes?: string | null;
  expiresAt?: string | null;
  createdBy?: string | null;
  meta?: any;
};

export async function createTopupGrant(input: CreateTopupGrantInput): Promise<{ id: string }>{
  await ensureDbSchema();

  const id = randomUUID();
  const currency = (input.currency || "BRL").trim() || "BRL";
  const notes = input.notes ?? null;
  const expiresAt = input.expiresAt ?? null;
  const createdBy = input.createdBy ?? null;
  const metaJson = input.meta ? JSON.stringify(input.meta) : null;

  await dbQuery(
    `INSERT INTO nextia_topup_grants (
      id, client_id, month_key, request_id, credits_granted, amount_cents, currency, notes, expires_at, created_by, meta
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      id,
      input.clientId,
      input.monthKey,
      input.requestId || null,
      Math.trunc(input.creditsGranted),
      input.amountCents ?? null,
      currency,
      notes,
      expiresAt,
      createdBy,
      metaJson,
    ]
  );

  return { id };
}

export async function sumTopupCreditsForMonth(clientId: string, monthKey: string): Promise<number> {
  await ensureDbSchema();
  const res = await dbQuery<{ total: any }>(
    "SELECT COALESCE(SUM(credits_granted),0) AS total FROM nextia_topup_grants WHERE client_id=$1 AND month_key=$2",
    [clientId, monthKey]
  );
  const raw = (res.rows?.[0] as any)?.total;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : 0;
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
