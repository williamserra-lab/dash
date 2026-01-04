// src/lib/nextiaConversationStateStore.ts
// Per-conversation state machine storage for deterministic pre-order flow.
// Primary: Postgres (when NEXTIA_DB_URL is set). Fallback: JSON file.

import { getDataPath, readJsonValue, writeJsonValue } from "./jsonStore";
import { dbQuery, isDbEnabled } from "./db";

export type ConversationKey = {
  clientId: string;
  instance: string;
  remoteJid: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ConversationState = Record<string, any>;

type StoreShape = Record<string, ConversationState>;

function makeKey(k: ConversationKey): string {
  return `${k.clientId}::${k.instance}::${k.remoteJid}`;
}

const FILE = getDataPath("conversation_state.json");

export async function getConversationState(key: ConversationKey): Promise<ConversationState | null> {
  if (isDbEnabled()) {
    const res = await dbQuery<{ state: ConversationState }>(
      `
      SELECT state
      FROM nextia_conversation_state
      WHERE client_id=$1 AND instance=$2 AND remote_jid=$3
      LIMIT 1;
      `,
      [key.clientId, key.instance, key.remoteJid]
    );
    return res.rows[0]?.state ?? null;
  }

  const store = (await readJsonValue<StoreShape>(FILE, {})) || {};
  return store[makeKey(key)] ?? null;
}

export async function setConversationState(key: ConversationKey, state: ConversationState): Promise<void> {
  if (isDbEnabled()) {
    await dbQuery(
      `
      INSERT INTO nextia_conversation_state (client_id, instance, remote_jid, state, updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (client_id, instance, remote_jid)
      DO UPDATE SET state=EXCLUDED.state, updated_at=NOW();
      `,
      [key.clientId, key.instance, key.remoteJid, state]
    );
    return;
  }

  const store = (await readJsonValue<StoreShape>(FILE, {})) || {};
  store[makeKey(key)] = state;
  await writeJsonValue(FILE, store);
}
