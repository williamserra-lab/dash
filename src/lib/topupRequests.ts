export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { dbQuery, ensureDbSchema } from "@/lib/db";
import { getBillingSummaryForClient } from "@/lib/billingCore";
import { notifyAdminTopupRequested } from "@/lib/topupRequestNotify";

export type TopupRequestStatus = "pending" | "approved" | "rejected";

export type TopupRequestRow = {
  id: string;
  client_id: string;
  requested_at: string;
  usage_percent: number;
  credits_used: number;
  monthly_limit: number;
  status: TopupRequestStatus;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  meta: any;
};

export async function createTopupRequest(clientId: string, meta?: any): Promise<TopupRequestRow> {
  await ensureDbSchema();

  // Derive usage % from billing summary when available.
  // Note: credits used/monthly limit may also be tracked elsewhere; we keep this payload lightweight.
  let usagePercent = 0;
  let creditsUsed = 0;
  let monthlyLimit = 0;

  try {
    const summary = await getBillingSummaryForClient(clientId);
    // If the project already stores LLM usage elsewhere, you can enrich later.
    const planEnt = summary?.plan?.entitlements || {};
    monthlyLimit = Number(planEnt?.monthlyCredits || planEnt?.monthlyTokens || 0) || 0;
  } catch {
    // ignore
  }

  const inserted = await dbQuery<TopupRequestRow>(
    `INSERT INTO nextia_credit_topup_requests (id, client_id, usage_percent, credits_used, monthly_limit, status, meta)
     VALUES ($1,$2,$3,$4,$5,'pending',$6)
     RETURNING *`,
    [randomUUID(), clientId, usagePercent, creditsUsed, monthlyLimit, meta ? JSON.stringify(meta) : null]
  );

  const row = (inserted.rows?.[0] as any) as TopupRequestRow;

  // Fire-and-forget notifications (do not break request if notify fails)
  notifyAdminTopupRequested({
    clientId,
    requestId: row.id,
    usagePercent,
    creditsUsed,
    monthlyLimit,
  }).catch(() => null);

  return row;
}

export async function listTopupRequests(opts?: { status?: TopupRequestStatus | "all"; limit?: number }): Promise<TopupRequestRow[]> {
  await ensureDbSchema();
  const status = opts?.status || "pending";
  const limit = Math.min(200, Math.max(1, Number(opts?.limit || 50)));

  const where = status === "all" ? "" : "WHERE status=$1";
  const params = status === "all" ? [] : [status];

  const res = await dbQuery<TopupRequestRow>(
    `SELECT * FROM nextia_credit_topup_requests ${where} ORDER BY requested_at DESC LIMIT ${limit}`,
    params
  );
  return (res.rows as any) || [];
}
