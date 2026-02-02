// src/lib/followupV2Config.ts
// Configuração de Follow-up (PASSO 7) por cliente.
//
// Storage: JSON em /data/followup_config.json (modo JSON) ou em DB futuro.
// Neste passo mantemos simples e auditável (arquivo único).

import { getDataPath, readJsonValue, writeJsonValue } from "@/lib/jsonStore";

export type FollowupChannel = "whatsapp";

export type FollowupEntityConfig = {
  enabled: boolean;
  eligibleStatuses: string[];
  startMinutes: number;
  // stopHours: janela absoluta desde createdAt (pré-pedido)
  stopHours?: number;
  // stopBeforeStartMinutes: para agendamento: para de enviar X minutos antes do startAt
  stopBeforeStartMinutes?: number;
  followup1Minutes: number;
  followup2Minutes?: number | null;
};

export type FollowupV2Config = {
  clientId: string;
  enabled: boolean;
  channel: FollowupChannel;

  preorders: FollowupEntityConfig;
  bookings: FollowupEntityConfig;

  conversionWindowHours: number;

  templates: {
    preorder: string;
    booking: string;
    // opcional: template aprovado (pós 24h) — futuro
    approvedAfter24h?: string | null;
  };

  after24hPolicy: "stop" | "template";
};

export type FollowupV2ConfigStore = {
  version: 1;
  byClientId: Record<string, Omit<FollowupV2Config, "clientId">>;
  updatedAt: string;
};

function nowIso() {
  return new Date().toISOString();
}

export function defaultFollowupV2Config(clientId: string): FollowupV2Config {
  return {
    clientId,
    enabled: true,
    channel: "whatsapp",
    preorders: {
      enabled: true,
      eligibleStatuses: ["draft", "awaiting_human_confirmation"],
      startMinutes: 10,
      stopHours: 24,
      followup1Minutes: 10,
      followup2Minutes: 60,
    },
    bookings: {
      enabled: true,
      eligibleStatuses: ["requested", "awaiting_confirmation"],
      startMinutes: 30,
      // Regra padrão: parar 2h antes do startAt OU 24h desde createdAt (ver runner)
      stopHours: 24,
      stopBeforeStartMinutes: 120,
      followup1Minutes: 30,
      followup2Minutes: 120,
    },
    conversionWindowHours: 6,
    templates: {
      preorder: "Oi! Vi que seu pré-pedido ainda não foi confirmado. Posso te ajudar a finalizar? 🙂",
      booking: "Oi! Seu agendamento ainda está pendente. Quer confirmar agora? 🙂",
      approvedAfter24h: null,
    },
    after24hPolicy: "stop",
  };
}

const STORE_FILE = "followup_config.json";

function defaultStore(): FollowupV2ConfigStore {
  return {
    version: 1,
    byClientId: {},
    updatedAt: nowIso(),
  };
}

export async function getFollowupV2Config(clientId: string): Promise<FollowupV2Config> {
  const path = getDataPath(STORE_FILE);
  const store = await readJsonValue<FollowupV2ConfigStore>(path, defaultStore());

  const existing = store.byClientId[clientId];
  if (!existing) return defaultFollowupV2Config(clientId);

  return { ...defaultFollowupV2Config(clientId), ...existing, clientId };
}

export type UpdateFollowupV2ConfigInput = {
  clientId: string;
  patch: Partial<Omit<FollowupV2Config, "clientId">>;
};

function clampInt(n: unknown, def: number, min: number, max: number): number {
  const v = typeof n === "number" ? n : parseInt(String(n || ""), 10);
  if (!Number.isFinite(v)) return def;
  return Math.min(Math.max(v, min), max);
}

function normalizeEntityConfig(base: FollowupEntityConfig, patch?: Partial<FollowupEntityConfig>): FollowupEntityConfig {
  const p = patch ?? {};
  return {
    enabled: typeof p.enabled === "boolean" ? p.enabled : base.enabled,
    eligibleStatuses: Array.isArray(p.eligibleStatuses) ? p.eligibleStatuses.map(String) : base.eligibleStatuses,
    startMinutes: clampInt((p as any).startMinutes, base.startMinutes, 0, 24 * 60),
    stopHours: typeof (p as any).stopHours === "number" ? clampInt((p as any).stopHours, base.stopHours ?? 24, 0, 24 * 7) : base.stopHours,
    stopBeforeStartMinutes:
      typeof (p as any).stopBeforeStartMinutes === "number"
        ? clampInt((p as any).stopBeforeStartMinutes, base.stopBeforeStartMinutes ?? 120, 0, 24 * 60)
        : base.stopBeforeStartMinutes,
    followup1Minutes: clampInt((p as any).followup1Minutes, base.followup1Minutes, 0, 24 * 60),
    followup2Minutes:
      (p as any).followup2Minutes === null
        ? null
        : typeof (p as any).followup2Minutes === "number"
          ? clampInt((p as any).followup2Minutes, base.followup2Minutes ?? 0, 0, 24 * 60)
          : base.followup2Minutes ?? null,
  };
}

export async function updateFollowupV2Config(input: UpdateFollowupV2ConfigInput): Promise<FollowupV2Config> {
  const clientId = String(input.clientId || "").trim();
  if (!clientId) throw new Error("clientId é obrigatório");

  const path = getDataPath(STORE_FILE);
  const store = await readJsonValue<FollowupV2ConfigStore>(path, defaultStore());

  const base = await getFollowupV2Config(clientId);
  const patch = input.patch || {};

  const merged: FollowupV2Config = {
    ...base,
    enabled: typeof (patch as any).enabled === "boolean" ? (patch as any).enabled : base.enabled,
    channel: (patch as any).channel === "whatsapp" ? "whatsapp" : base.channel,
    conversionWindowHours: clampInt((patch as any).conversionWindowHours, base.conversionWindowHours, 1, 24 * 7),
    after24hPolicy: (patch as any).after24hPolicy === "template" ? "template" : "stop",
    templates: {
      preorder: typeof (patch as any).templates?.preorder === "string" ? (patch as any).templates.preorder : base.templates.preorder,
      booking: typeof (patch as any).templates?.booking === "string" ? (patch as any).templates.booking : base.templates.booking,
      approvedAfter24h:
        (patch as any).templates?.approvedAfter24h === null
          ? null
          : typeof (patch as any).templates?.approvedAfter24h === "string"
            ? (patch as any).templates.approvedAfter24h
            : base.templates.approvedAfter24h ?? null,
    },
    preorders: normalizeEntityConfig(base.preorders, (patch as any).preorders),
    bookings: normalizeEntityConfig(base.bookings, (patch as any).bookings),
    clientId,
  };

  const { clientId: _omit, ...rest } = merged;
  store.byClientId[clientId] = rest as Omit<FollowupV2Config, "clientId">;
  store.updatedAt = nowIso();

  await writeJsonValue(path, store);
  return merged;
}
