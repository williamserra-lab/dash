// src/lib/evolutionApi.ts
// Minimal Evolution API client (only endpoints used by NextIA).
// Uses fetch (node runtime).

import { EvolutionConfig } from "./evolutionConfig";

export type EvolutionSendTextResponse = {
  key?: { id?: string; remoteJid?: string; fromMe?: boolean };
  status?: string;
  messageTimestamp?: number | string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [k: string]: any;
};

export async function evolutionSendText(cfg: EvolutionConfig, input: { number: string; text: string }) {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/message/sendText/${encodeURIComponent(cfg.instance)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.apiKey,
    },
    body: JSON.stringify({ number: input.number, text: input.text }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Evolution sendText failed: HTTP ${res.status} ${t}`);
  }

  return (await res.json()) as EvolutionSendTextResponse;
}

export type EvolutionFindMessagesResponse = {
  messages?: {
    total?: number;
    pages?: number;
    currentPage?: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    records?: any[];
  };
};

export async function evolutionFindMessages(cfg: EvolutionConfig, input: { remoteJid: string; limit?: number }) {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/findMessages/${encodeURIComponent(cfg.instance)}`;

  const body = {
    where: { key: { remoteJid: input.remoteJid } },
    limit: Math.max(1, Math.min(500, Number(input.limit || 50))),
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: cfg.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Evolution findMessages failed: HTTP ${res.status} ${t}`);
  }

  return (await res.json()) as EvolutionFindMessagesResponse;
}
