// src/lib/billingCore.ts
export const runtime = "nodejs";

import { dbQuery, ensureDbSchema } from "@/lib/db";
import { dbGetClientById } from "@/lib/clientsDb";
import { randomUUID } from "crypto";

export type BillingStatus = "active" | "grace" | "suspended";

export type PlanRow = {
  id: string;
  name: string;
  status: string;
  price_cents: number;
  currency: string;
  entitlements: any;
  payment_instructions: any;
};

export type ClientBillingRow = {
  client_id: string;
  plan_id: string;
  billing_status: BillingStatus;
  contract_started_at: string;
  grace_days: number;
  grace_until: string | null;
  suspended_reason: string | null;
  updated_at: string;
};

export type InvoiceStatus = "open" | "paid" | "overdue" | "canceled";

export type InvoiceRow = {
  id: string;
  client_id: string;
  cycle_start: string;
  cycle_end: string;
  amount_cents: number;
  currency: string;
  due_date: string;
  status: InvoiceStatus;
  paid_at: string | null;
  payment_meta: any;
  created_at: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

function toUtcDate(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

function addMonthsUtc(date: Date, months: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth();
  const day = date.getUTCDate();
  const next = new Date(Date.UTC(y, m + months, 1, date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()));
  // Clamp day to month length
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

export function resolveMonthlyCycle(args: { contractStartedAt: string; now?: Date }): { cycleStart: string; cycleEnd: string } {
  const now = args.now ? toUtcDate(args.now) : toUtcDate(new Date());
  const start0 = toUtcDate(new Date(args.contractStartedAt));

  // Find latest monthly anniversary <= now
  let cursor = start0;
  if (cursor > now) {
    // Future start: just use the contract start as cycle start.
    const end = addMonthsUtc(cursor, 1);
    return { cycleStart: cursor.toISOString(), cycleEnd: end.toISOString() };
  }

  // Jump close by months diff
  const monthsDiff = (now.getUTCFullYear() - start0.getUTCFullYear()) * 12 + (now.getUTCMonth() - start0.getUTCMonth());
  cursor = addMonthsUtc(start0, Math.max(0, monthsDiff));
  if (cursor > now) cursor = addMonthsUtc(cursor, -1);
  // Ensure <= now
  while (addMonthsUtc(cursor, 1) <= now) cursor = addMonthsUtc(cursor, 1);
  while (cursor > now) cursor = addMonthsUtc(cursor, -1);

  const end = addMonthsUtc(cursor, 1);
  return { cycleStart: cursor.toISOString(), cycleEnd: end.toISOString() };
}

function getDefaultGraceDays(): number {
  const n = Number((process.env.NEXTIA_BILLING_GRACE_DAYS || "").trim());
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 5;
}

export async function ensureBillingForClient(clientId: string): Promise<ClientBillingRow> {
  await ensureDbSchema();

  const res = await dbQuery<ClientBillingRow>(`SELECT * FROM nextia_client_billing WHERE client_id=$1`, [clientId]);
  const existing = res.rows?.[0] as any;
  if (existing) return existing;

  const client = await dbGetClientById(clientId);
  if (!client) throw new Error(`client_not_found:${clientId}`);

  const contractStartedAt = String((client as any).created_at || nowIso());
  const graceDays = getDefaultGraceDays();

  const inserted = await dbQuery<ClientBillingRow>(
    `INSERT INTO nextia_client_billing (
      client_id, plan_id, billing_status, contract_started_at, grace_days, grace_until, suspended_reason, updated_at
    ) VALUES ($1,$2,$3,$4,$5,NULL,NULL,$6)
    RETURNING *`,
    [clientId, "default", "active", contractStartedAt, graceDays, nowIso()]
  );

  return (inserted.rows?.[0] as any) as ClientBillingRow;
}

export async function getPlan(planId: string): Promise<PlanRow | null> {
  await ensureDbSchema();
  const res = await dbQuery<PlanRow>(`SELECT * FROM nextia_plans WHERE id=$1`, [planId]);
  return (res.rows?.[0] as any) || null;
}

export async function getClientBilling(clientId: string): Promise<{ billing: ClientBillingRow; plan: PlanRow | null }>{
  const billing = await ensureBillingForClient(clientId);
  const plan = await getPlan(billing.plan_id);
  return { billing, plan };
}

export async function ensureInvoiceForCurrentCycle(clientId: string): Promise<InvoiceRow> {
  const { billing, plan } = await getClientBilling(clientId);
  const cycle = resolveMonthlyCycle({ contractStartedAt: billing.contract_started_at });

  // Find invoice for this cycle
  const existing = await dbQuery<InvoiceRow>(
    `SELECT * FROM nextia_invoices WHERE client_id=$1 AND cycle_start=$2 AND cycle_end=$3 ORDER BY created_at DESC LIMIT 1`,
    [clientId, cycle.cycleStart, cycle.cycleEnd]
  );
  const inv = (existing.rows?.[0] as any) as InvoiceRow | undefined;
  if (inv) return inv;

  const amount = plan ? Number((plan as any).price_cents || 0) : 0;
  const currency = plan ? String((plan as any).currency || "BRL") : "BRL";
  const dueDate = cycle.cycleStart; // due at cycle start (anniversary)
  const planId = billing.plan_id || (plan ? plan.id : null);
  const paymentInstructions = plan ? JSON.stringify((plan as any).payment_instructions || null) : null;

  const created = await dbQuery<InvoiceRow>(
    `INSERT INTO nextia_invoices (id, client_id, plan_id, cycle_start, cycle_end, amount_cents, currency, due_date, status, payment_instructions)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'open',$9)
     RETURNING *`,
    [randomUUID(), clientId, planId, cycle.cycleStart, cycle.cycleEnd, amount, currency, dueDate, paymentInstructions]
  );
  return (created.rows?.[0] as any) as InvoiceRow;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

export async function syncInvoiceAndBillingStatusForClient(clientId: string): Promise<{ billing: ClientBillingRow; invoice: InvoiceRow }>{
  const { billing } = await getClientBilling(clientId);
  const invoice0 = await ensureInvoiceForCurrentCycle(clientId);

  const now = new Date();
  let invoice = invoice0;

  // Mark overdue if past due and not paid/canceled.
  if ((invoice.status === "open" || invoice.status === "overdue") && !invoice.paid_at) {
    const due = new Date(invoice.due_date);
    const shouldBeOverdue = now.getTime() > due.getTime();
    if (shouldBeOverdue && invoice.status !== "overdue") {
      const upd = await dbQuery<InvoiceRow>(
        `UPDATE nextia_invoices SET status='overdue', updated_at=NOW() WHERE id=$1 RETURNING *`,
        [invoice.id]
      );
      invoice = (upd.rows?.[0] as any) || invoice;
    }
  }

  // Grace/suspension based on overdue + grace days
  let nextStatus: BillingStatus = (billing.billing_status as BillingStatus) || "active";
  let graceUntil: string | null = billing.grace_until;
  let suspendedReason: string | null = billing.suspended_reason;

  if (invoice.status === "paid") {
    nextStatus = "active";
    graceUntil = null;
    suspendedReason = null;
  } else if (invoice.status === "overdue") {
    graceUntil = graceUntil || addDaysIso(invoice.due_date, Math.max(0, Number(billing.grace_days || 0)));
    const graceUntilDate = new Date(graceUntil);
    if (now.getTime() > graceUntilDate.getTime()) {
      nextStatus = "suspended";
      suspendedReason = suspendedReason || "invoice_overdue";
    } else {
      nextStatus = "grace";
      suspendedReason = null;
    }
  } else {
    // open
    nextStatus = "active";
    graceUntil = null;
    suspendedReason = null;
  }

  if (nextStatus !== billing.billing_status || graceUntil !== billing.grace_until || suspendedReason !== billing.suspended_reason) {
    const upd = await dbQuery<ClientBillingRow>(
      `UPDATE nextia_client_billing
       SET billing_status=$2, grace_until=$3, suspended_reason=$4, updated_at=NOW()
       WHERE client_id=$1
       RETURNING *`,
      [clientId, nextStatus, graceUntil, suspendedReason]
    );
    return { billing: (upd.rows?.[0] as any) as ClientBillingRow, invoice };
  }

  return { billing, invoice };
}

export async function getBillingSummaryForClient(clientId: string): Promise<any> {
  const { billing: b0, plan } = await getClientBilling(clientId);
  const { billing, invoice } = await syncInvoiceAndBillingStatusForClient(clientId);
  return {
    clientId,
    billing: {
      planId: billing.plan_id,
      status: billing.billing_status,
      contractStartedAt: billing.contract_started_at,
      graceDays: billing.grace_days,
      graceUntil: billing.grace_until,
      suspendedReason: billing.suspended_reason,
    },
    plan: plan
      ? {
          id: plan.id,
          name: plan.name,
          priceCents: Number((plan as any).price_cents || 0),
          currency: plan.currency,
          entitlements: (plan as any).entitlements || {},
          paymentInstructions: (plan as any).payment_instructions || null,
        }
      : null,
    invoice: {
      id: invoice.id,
      status: invoice.status,
      amountCents: Number(invoice.amount_cents || 0),
      currency: invoice.currency,
      dueDate: invoice.due_date,
      cycleStart: invoice.cycle_start,
      cycleEnd: invoice.cycle_end,
      paidAt: invoice.paid_at,
    },
  };
}
