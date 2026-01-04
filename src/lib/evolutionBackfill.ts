// src/lib/evolutionBackfill.ts
// Reconciliação/backfill por conversa (remoteJid).
// Objetivo: tapar buracos quando o NextIA ficou off e voltou.
// Estratégia: ao receber um webhook, puxar os últimos N itens do Evolution
// e persistir no store (DB/JSON) com dedupe pelo keyId.

import { getEvolutionConfig } from "./evolutionConfig";
import { evolutionFindMessages } from "./evolutionApi";
import { appendStoredMessage } from "./nextiaMessageStore";

type CacheEntry = { at: number };
const backfillCache = new Map<string, CacheEntry>();

function nowMs(): number {
  return Date.now();
}

function cacheKey(clientId: string, instance: string, remoteJid: string): string {
  return `${clientId}::${instance}::${remoteJid}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pickText(msg: any): string | null {
  const m = msg?.message;
  if (!m) return null;
  if (typeof m.conversation === "string") return m.conversation;
  if (typeof m.extendedTextMessage?.text === "string") return m.extendedTextMessage.text;
  if (typeof m.imageMessage?.caption === "string") return m.imageMessage.caption;
  if (typeof m.videoMessage?.caption === "string") return m.videoMessage.caption;
  return null;
}

export async function backfillConversationFromEvolution(input: {
  clientId: string;
  instance: string;
  remoteJid: string;
  limit?: number;
}): Promise<{ ok: boolean; fetched: number; stored: number; skipped: number; error?: string }> {
  const cfg = getEvolutionConfig();
  if (!cfg) return { ok: false, fetched: 0, stored: 0, skipped: 0, error: "EVOLUTION_* env vars missing." };

  const limit = Math.max(1, Math.min(500, Number(input.limit || 100)));

  // throttle per conversation (5 minutes)
  const ck = cacheKey(input.clientId, input.instance, input.remoteJid);
  const prev = backfillCache.get(ck);
  if (prev && nowMs() - prev.at < 5 * 60 * 1000) {
    return { ok: true, fetched: 0, stored: 0, skipped: 0 };
  }
  backfillCache.set(ck, { at: nowMs() });

  try {
    const res = await evolutionFindMessages(cfg, { remoteJid: input.remoteJid, limit });
    const records = res?.messages?.records || [];
    let stored = 0;
    let skipped = 0;

    for (const r of records) {
      const key = r?.key || {};
      const keyId = String(key?.id || "").trim();
      if (!keyId) {
        skipped += 1;
        continue;
      }

      const remoteJid = String(key?.remoteJid || input.remoteJid).trim() || input.remoteJid;
      const fromMe = Boolean(key?.fromMe);
      const ts = r?.messageTimestamp;
      const messageTimestamp =
        typeof ts === "number" ? ts : typeof ts === "string" ? Number(ts) : null;

      const text = pickText(r) ?? null;

      await appendStoredMessage({
        clientId: input.clientId,
        instance: input.instance,
        remoteJid,
        keyId,
        fromMe,
        messageTimestamp,
        text,
        raw: r,
      });
      stored += 1;
    }

    return { ok: true, fetched: records.length, stored, skipped };
  } catch (err: any) {
    return { ok: false, fetched: 0, stored: 0, skipped: 0, error: err?.message || String(err) };
  }
}
