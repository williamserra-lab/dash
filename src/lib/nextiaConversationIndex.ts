// src/lib/nextiaConversationIndex.ts
// Builds a conversation list for the "chat do lojista".
// Primary: Postgres (NEXTIA_DB_URL). Fallback: JSON messages store.

import { dbQuery, isDbEnabled } from "./db";
import { getDataPath, readJsonArray } from "./jsonStore";
import type { StoredMessage } from "./nextiaMessageStore";

export type ConversationListItem = {
  clientId: string;
  instance: string;
  remoteJid: string;
  lastText: string | null;
  lastTs: number | null;
  lastFromMe: boolean | null;
};

export async function listConversations(input: {
  clientId: string;
  instance: string;
  limit?: number;
}): Promise<ConversationListItem[]> {
  const limit = Math.max(1, Math.min(500, Number(input.limit || 100)));

  if (isDbEnabled()) {
    const res = await dbQuery<{
      client_id: string;
      instance: string;
      remote_jid: string;
      last_text: string | null;
      last_ts: number | null;
      last_from_me: boolean | null;
    }>(
      `
      WITH latest AS (
        SELECT
          client_id,
          instance,
          remote_jid,
          MAX(COALESCE(message_ts, 0)) AS max_ts
        FROM nextia_messages
        WHERE client_id = $1 AND instance = $2
        GROUP BY client_id, instance, remote_jid
      )
      SELECT
        m.client_id,
        m.instance,
        m.remote_jid,
        m.text AS last_text,
        m.message_ts AS last_ts,
        m.from_me AS last_from_me
      FROM latest l
      JOIN LATERAL (
        SELECT *
        FROM nextia_messages m
        WHERE m.client_id = l.client_id
          AND m.instance = l.instance
          AND m.remote_jid = l.remote_jid
        ORDER BY COALESCE(m.message_ts, 0) DESC, m.created_at DESC
        LIMIT 1
      ) m ON true
      ORDER BY COALESCE(m.message_ts, 0) DESC, m.created_at DESC
      LIMIT $3;
      `,
      [input.clientId, input.instance, limit]
    );

    return res.rows.map((r) => ({
      clientId: r.client_id,
      instance: r.instance,
      remoteJid: r.remote_jid,
      lastText: r.last_text ?? null,
      lastTs: r.last_ts ?? null,
      lastFromMe: typeof r.last_from_me === "boolean" ? r.last_from_me : null,
    }));
  }

  const file = getDataPath("messages.json");
  const list = await readJsonArray<StoredMessage>(file);
  const filtered = list.filter((x) => x.clientId === input.clientId && x.instance === input.instance);

  const byJid = new Map<string, StoredMessage>();
  for (const m of filtered) {
    const prev = byJid.get(m.remoteJid);
    const ts = m.messageTimestamp || 0;
    const prevTs = prev?.messageTimestamp || 0;
    if (!prev || ts > prevTs) byJid.set(m.remoteJid, m);
  }

  return Array.from(byJid.values())
    .sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0))
    .slice(0, limit)
    .map((m) => ({
      clientId: m.clientId,
      instance: m.instance,
      remoteJid: m.remoteJid,
      lastText: m.text,
      lastTs: m.messageTimestamp,
      lastFromMe: m.fromMe,
    }));
}
