// src/lib/clientDashboard.ts
// Analytics básicos por cliente para o painel /painel/[clientId]
//
// Esta função lê diretamente os arquivos JSON da pasta /data
// e monta um resumo simples para o painel.

import { getDataPath, readJsonArray } from "./jsonStore";
import { getMediaConfigStatus, type MediaConfigStatus } from "./mediaAssets";

type AnyRecord = Record<string, unknown>;

export type ClientDashboardSummary = {
  clientId: string;

  totalContacts: number;
  activeContactsLast30d: number;

  totalOrders: number;
  openOrders: number;
  finishedOrders: number;
  cancelledOrders: number;

  // Faturamento em centavos, somando totalAmountCents dos pedidos
  // (ou convertendo de reais quando necessário).
  totalRevenueCents: number;

  // Faturamento em reais (totalRevenueCents / 100), usado apenas para exibição.
  totalRevenue: number;

  // Estado mínimo de configuração do cliente (para UX e para evitar “painel cego”)
  config: {
    ok: boolean;
    issues: string[];
    media: MediaConfigStatus;
  };

  lastOrders: {
    id: string;
    createdAt: string;
    status: string;

    // Valor em reais para exibição no painel.
    totalAmount?: number | null;

    // Valor em centavos, se disponível na origem.
    totalAmountCents?: number | null;

    identifier?: string;
  }[];

  lastMessages: {
    id: string;
    createdAt: string;
    type: string;
    to?: string;
    channel?: string;
    label?: string;
  }[];
};

function safeNumber(value: unknown, defaultValue = 0): number {
  if (value == null) return defaultValue;
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n) || !Number.isFinite(n)) return defaultValue;
  return n;
}

function safeDate(value: unknown): Date | null {
  if (!value) return null;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function isWithinLastDays(date: Date, days: number): boolean {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= days;
}

/**
 * Carrega o resumo do painel para um determinado clientId.
 *
 * Importante:
 * - Usa apenas arquivos locais em /data (contacts.json, orders.json, messages.json)
 * - Não faz consultas externas
 */
export async function getClientDashboard(
  clientId: string
): Promise<ClientDashboardSummary> {
  const contactsFile = getDataPath("contacts.json");
  const ordersFile = getDataPath("orders.json");
  const messagesFile = getDataPath("messages.json");
  const outboxFile = getDataPath("whatsapp_outbox.json");

  const [contacts, orders, messages, outbox, mediaConfig] = await Promise.all([
    readJsonArray(contactsFile),
    readJsonArray(ordersFile),
    readJsonArray(messagesFile),
    readJsonArray(outboxFile),
    getMediaConfigStatus(clientId),
  ]);

  // Filtra por clientId
  const clientContacts = (contacts as AnyRecord[]).filter(
    (c) => c.clientId === clientId
  );
  const clientOrders = (orders as AnyRecord[]).filter(
    (o) => o.clientId === clientId
  );
  const clientMessages = (messages as AnyRecord[]).filter(
    (m) => m.clientId === clientId
  );

  const clientOutboxSent = (outbox as AnyRecord[])
    .filter((it) => it.clientId === clientId)
    .filter((it) => String(it.status || "").toLowerCase() === "sent");

  // Contatos
  const totalContacts = clientContacts.length;

  const activeContactsLast30d = clientContacts.filter((c) => {
    const lastContactDate =
      safeDate(c.lastInteractionAt) ?? safeDate(c.updatedAt);
    if (!lastContactDate) return false;
    return isWithinLastDays(lastContactDate, 30);
  }).length;

  // Pedidos
  const totalOrders = clientOrders.length;

  let openOrders = 0;
  let finishedOrders = 0;
  let cancelledOrders = 0;
  let totalRevenueCents = 0;

  const openStatusSet = new Set<string>([
    "novo",
    "coletando_dados",
    "em_andamento",
    "aguardando_pagamento",
    "aguardando_preparo",
    "em_preparo",
    "pronto",
  ]);

  for (const raw of clientOrders) {
    const status = String(raw.status || "").toLowerCase();

    if (openStatusSet.has(status)) {
      openOrders += 1;
    }

    if (status === "concluido") {
      finishedOrders += 1;
    }

    if (status === "cancelado") {
      cancelledOrders += 1;
    }

    // Valor total do pedido: prioriza campos em centavos.
    const centsFromField =
      typeof raw.totalAmountCents === "number" ? raw.totalAmountCents : null;

    const totalFieldReais =
      raw.totalAmount ??
      raw.total ??
      (raw.payment && typeof raw.payment === "object"
        ? ((raw.payment as Record<string, unknown>).total ??
          (raw.payment as Record<string, unknown>).amount)
        : null);

    let amountCents = 0;

    if (typeof centsFromField === "number" && centsFromField > 0) {
      amountCents = Math.round(centsFromField);
    } else if (totalFieldReais != null) {
      const amountReais = safeNumber(totalFieldReais, 0);
      if (amountReais > 0) {
        amountCents = Math.round(amountReais * 100);
      }
    }

    if (amountCents > 0 && status !== "cancelado") {
      totalRevenueCents += amountCents;
    }
  }

  // Últimos pedidos (para a lista da direita)
  const lastOrders = clientOrders
    .slice()
    .sort((a, b) => {
      const da = safeDate(a.createdAt)?.getTime() ?? 0;
      const db = safeDate(b.createdAt)?.getTime() ?? 0;
      return db - da;
    })
    .slice(0, 10)
    .map((o) => {
      const createdAt =
        safeDate(o.createdAt)?.toISOString() ??
        safeDate(o.updatedAt)?.toISOString() ??
        new Date().toISOString();

      const centsFromField =
        typeof o.totalAmountCents === "number" ? o.totalAmountCents : null;

      const totalFieldReais =
        o.totalAmount ??
        o.total ??
        (o.payment && typeof o.payment === "object"
          ? ((o.payment as Record<string, unknown>).total ??
            (o.payment as Record<string, unknown>).amount)
          : null);

      let totalAmountCents: number | null = null;
      let totalAmount: number | null = null;

      if (typeof centsFromField === "number" && centsFromField > 0) {
        totalAmountCents = Math.round(centsFromField);
        totalAmount = totalAmountCents / 100;
      } else if (totalFieldReais != null) {
        const amountReais = safeNumber(totalFieldReais, 0);
        if (amountReais > 0) {
          totalAmount = amountReais;
          totalAmountCents = Math.round(amountReais * 100);
        }
      }

      return {
        id: String(o.id || ""),
        createdAt,
        status: String(o.status || ""),
        totalAmount,
        totalAmountCents,
        identifier: o.identifier ? String(o.identifier) : undefined,
      };
    });

  // Últimas mensagens (saída): combina messages.json + whatsapp_outbox.json (status=sent)
  const lastMessages = (() => {
    const fromMessages = clientMessages.map((m) => {
      const createdAt =
        safeDate(m.createdAt)?.toISOString() ??
        safeDate(m.updatedAt)?.toISOString() ??
        new Date().toISOString();

      return {
        id: String(m.id || ""),
        createdAt,
        type: String(m.type || "MESSAGE"),
        to: m.to ? String(m.to) : undefined,
        channel: m.channel ? String(m.channel) : undefined,
        label: m.label ? String(m.label) : undefined,
      };
    });

    const fromOutbox = clientOutboxSent.map((it) => {
      const createdAt =
        safeDate(it.sentAt)?.toISOString() ??
        safeDate(it.createdAt)?.toISOString() ??
        new Date().toISOString();

      const type = String(it.type || it.kind || (it.mediaId ? "media" : "outbox")).toUpperCase();
      const label =
        it.messageType
          ? String(it.messageType)
          : it.label
          ? String(it.label)
          : it.mediaId
          ? String(it.mediaId)
          : undefined;

      return {
        id: String(it.id || ""),
        createdAt,
        type,
        to: it.to ? String(it.to) : undefined,
        channel: it.channel ? String(it.channel) : "whatsapp",
        label,
      };
    });

    return [...fromMessages, ...fromOutbox]
      .sort((a, b) => {
        const da = safeDate(a.createdAt)?.getTime() ?? 0;
        const db = safeDate(b.createdAt)?.getTime() ?? 0;
        return db - da;
      })
      .slice(0, 10);
  })();

  const totalRevenue = totalRevenueCents / 100;

  // Config OK quando tem tabela oficial ativa (mínimo viável)
  const issues = [...(mediaConfig.issues || [])];
  const ok = issues.length === 0;

  return {
    clientId,
    totalContacts,
    activeContactsLast30d,
    totalOrders,
    openOrders,
    finishedOrders,
    cancelledOrders,
    totalRevenueCents,
    totalRevenue,
    config: {
      ok,
      issues,
      media: mediaConfig,
    },
    lastOrders,
    lastMessages,
  };
}
