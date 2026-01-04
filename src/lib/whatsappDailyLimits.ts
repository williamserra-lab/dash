// src/lib/whatsappDailyLimits.ts
// Limite diário "PARCIAL": permite enfileirar até o restante do dia.
import { getDataPath, readJsonValue, writeJsonValue } from "./jsonStore";
import { getWhatsAppOperationalPolicy } from "./whatsappOperationalPolicy";

type DailyState = Record<string, Record<string, number>>;
// state[yyyy-mm-dd][clientId] = usedCount

const filePath = getDataPath("whatsapp_daily_limits.json");

function yyyyMmDd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function readState(): Promise<DailyState> {
  return (await readJsonValue<DailyState>(filePath, {})) || {};
}

export async function getDailyRemaining(clientId: string, when?: Date): Promise<{ date: string; limit: number; used: number; remaining: number; }> {
  const policy = getWhatsAppOperationalPolicy();
  const date = yyyyMmDd(when ?? new Date());
  const state = await readState();
  const used = state?.[date]?.[clientId] ?? 0;
  const limit = policy.dailyLimitPerClient;
  const remaining = Math.max(0, limit - used);
  return { date, limit, used, remaining };
}

export async function reserveDailyQuota(params: { clientId: string; desired: number; when?: Date; }): Promise<{ date: string; desired: number; allowed: number; remainingAfter: number; usedAfter: number; limit: number; }> {
  const policy = getWhatsAppOperationalPolicy();
  const date = yyyyMmDd(params.when ?? new Date());
  const desired = Math.max(0, Math.floor(params.desired || 0));
  const state = await readState();

  const used = state?.[date]?.[params.clientId] ?? 0;
  const limit = policy.dailyLimitPerClient;
  const remaining = Math.max(0, limit - used);

  const allowed = Math.max(0, Math.min(desired, remaining));

  const usedAfter = used + allowed;
  const remainingAfter = Math.max(0, limit - usedAfter);

  const next: DailyState = { ...(state || {}) };
  next[date] = { ...(next[date] || {}) };
  next[date][params.clientId] = usedAfter;

  await writeJsonValue(filePath, next);

  return { date, desired, allowed, remainingAfter, usedAfter, limit };
}
