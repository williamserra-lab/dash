// src/lib/nextiaMessageStore.ts
// Runtime message store used for "chat do lojista" and for reconciliação/backfill.
// Primary: Postgres (when NEXTIA_DB_URL is set). Fallback: JSON file (data/messages.json).

import { getDataPath, readJsonArray, writeJsonArray } from "./jsonStore";
import { dbQuery, isDbEnabled } from "./db";

export type StoredMessage = {
  clientId: string;
  instance: string;
  remoteJid: string;
  keyId: string;
  fromMe: boolean;
  messageTimestamp: number | null;
  text: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw: any;
  createdAt: string;
};

function nowIso(): string {
  return new Date().toISOString();
}

// Returns true if inserted (new message), false if it already existed.
export async function appendStoredMessage(msg: Omit<StoredMessage, "createdAt">): Promise<boolean> {
  const createdAt = nowIso();

  if (isDbEnabled()) {
    const res = await dbQuery<{ id: number }>(
      `
      INSERT INTO nextia_messages
        (client_id, instance, remote_jid, key_id, from_me, message_ts, text, raw, created_at)
      VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (client_id, instance, key_id) DO NOTHING
      RETURNING id;
      `,
      [
        msg.clientId,
        msg.instance,
        msg.remoteJid,
        msg.keyId,
        msg.fromMe,
        msg.messageTimestamp,
        msg.text,
        msg.raw ?? null,
        createdAt,
      ]
    );
    return res.rowCount === 1;
  }

  // JSON fallback
  const file = getDataPath("messages.json");
  const list = await readJsonArray<StoredMessage>(file);
  const exists = list.some(
    (x) => x.clientId === msg.clientId && x.instance === msg.instance && x.keyId === msg.keyId
  );
  if (exists) return false;

  list.push({ ...msg, createdAt });
  await writeJsonArray(file, list);
  return true;
}

export async function listStoredMessages(input: {
  clientId: string;
  instance: string;
  remoteJid: string;
  limit?: number;
}): Promise<StoredMessage[]> {
  const limit = Math.max(1, Math.min(500, Number(input.limit || 50)));

  if (isDbEnabled()) {
    const res = await dbQuery<{
      client_id: string;
      instance: string;
      remote_jid: string;
      key_id: string;
      from_me: boolean;
      message_ts: number | null;
      text: string | null;
      raw: unknown;
      created_at: string;
    }>(
      `
      SELECT client_id, instance, remote_jid, key_id, from_me, message_ts, text, raw, created_at
      FROM nextia_messages
      WHERE client_id=$1 AND instance=$2 AND remote_jid=$3
      ORDER BY COALESCE(message_ts, 0) DESC, created_at DESC
      LIMIT $4;
      `,
      [input.clientId, input.instance, input.remoteJid, limit]
    );

    return res.rows.map((r) => ({
      clientId: r.client_id,
      instance: r.instance,
      remoteJid: r.remote_jid,
      keyId: r.key_id,
      fromMe: r.from_me,
      messageTimestamp: r.message_ts,
      text: r.text,
      raw: r.raw,
      createdAt: r.created_at,
    }));
  }

  const file = getDataPath("messages.json");
  const list = await readJsonArray<StoredMessage>(file);
  return list
    .filter(
      (x) => x.clientId === input.clientId && x.instance === input.instance && x.remoteJid === input.remoteJid
    )
    .sort((a, b) => (b.messageTimestamp || 0) - (a.messageTimestamp || 0))
    .slice(0, limit);
}
