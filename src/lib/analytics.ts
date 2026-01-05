// src/lib/analytics.ts
import { promises as fs } from "fs";
import path from "path";

const dataDir = path.join(process.cwd(), "data");
const analyticsFile = path.join(dataDir, "analytics_events.json");

export type AnalyticsEventType =
  | "order_created"
  | "order_status_changed"
  | "order_confirmed_by_human"
  | "order_cancelled"
  | "whatsapp_outbound_text"
  | "whatsapp_outbound_media"
  | "whatsapp_inbound_message"
  | "campaign_simulated"
  | "campaign_sent";

export type AnalyticsEvent = {
  id: string;
  type: AnalyticsEventType | string;
  clientId: string;
  contactId?: string | null;
  identifier?: string | null;
  correlationId?: string | null;
  payload?: Record<string, unknown>;
  createdAt: string;
};

async function ensureFile(): Promise<void> {
  try {
    await fs.access(analyticsFile);
  } catch {
    await fs.writeFile(analyticsFile, "[]", "utf-8");
  }
}

async function readAllEvents(): Promise<AnalyticsEvent[]> {
  await ensureFile();
  const raw = await fs.readFile(analyticsFile, "utf-8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AnalyticsEvent[]) : [];
  } catch {
    return [];
  }
}

async function writeAllEvents(list: AnalyticsEvent[]): Promise<void> {
  await fs.writeFile(analyticsFile, JSON.stringify(list, null, 2), "utf-8");
}

function generateId(prefix = "evt"): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${r1}_${r2}`;
}

export async function logAnalyticsEvent(
  event: Omit<AnalyticsEvent, "id">
): Promise<AnalyticsEvent> {
  const all = await readAllEvents();
  const entry: AnalyticsEvent = {
    ...event,
    id: generateId("evt"),
  };
  all.push(entry);
  await writeAllEvents(all);

  return entry;
}

export type ClientSummary = {
  clientId: string;
  totalOrdersCreated: number;
  totalOrdersConfirmedByHuman: number;
  totalOrdersCancelled: number;
  totalWhatsappOutboundText: number;
  totalWhatsappOutboundMedia: number;
  totalCampaignSimulated: number;
  totalCampaignSent: number;
};

/**
 * Resumo de um único cliente, usando todos os eventos gravados.
 */
export async function getClientSummary(
  clientId: string
): Promise<ClientSummary> {
  const all = await readAllEvents();
  const events = all.filter((e) => e.clientId === clientId);

  const summary: ClientSummary = {
    clientId,
    totalOrdersCreated: 0,
    totalOrdersConfirmedByHuman: 0,
    totalOrdersCancelled: 0,
    totalWhatsappOutboundText: 0,
    totalWhatsappOutboundMedia: 0,
    totalCampaignSimulated: 0,
    totalCampaignSent: 0,
  };

  for (const e of events) {
    switch (e.type) {
      case "order_created":
        summary.totalOrdersCreated++;
        break;
      case "order_status_changed":
        if (e.payload?.newStatus === "concluido") {
          summary.totalOrdersConfirmedByHuman++;
        }
        if (e.payload?.newStatus === "cancelado") {
          summary.totalOrdersCancelled++;
        }
        break;
      case "order_confirmed_by_human":
        summary.totalOrdersConfirmedByHuman++;
        break;
      case "order_cancelled":
        summary.totalOrdersCancelled++;
        break;
      case "whatsapp_outbound_text":
        summary.totalWhatsappOutboundText++;
        break;
      case "whatsapp_outbound_media":
        summary.totalWhatsappOutboundMedia++;
        break;
      case "campaign_simulated":
        summary.totalCampaignSimulated++;
        break;
      case "campaign_sent":
        summary.totalCampaignSent++;
        break;
      default:
        break;
    }
  }

  return summary;
}

/**
 * Resumo de TODOS os clientes que já geraram algum evento.
 */
export async function getAllClientsSummary(): Promise<ClientSummary[]> {
  const all = await readAllEvents();
  const byClient: Record<string, ClientSummary> = {};

  for (const e of all) {
    if (!e.clientId) continue;
    if (!byClient[e.clientId]) {
      byClient[e.clientId] = {
        clientId: e.clientId,
        totalOrdersCreated: 0,
        totalOrdersConfirmedByHuman: 0,
        totalOrdersCancelled: 0,
        totalWhatsappOutboundText: 0,
        totalWhatsappOutboundMedia: 0,
        totalCampaignSimulated: 0,
        totalCampaignSent: 0,
      };
    }
    const summary = byClient[e.clientId];

    switch (e.type) {
      case "order_created":
        summary.totalOrdersCreated++;
        break;
      case "order_status_changed":
        if (e.payload?.newStatus === "concluido") {
          summary.totalOrdersConfirmedByHuman++;
        }
        if (e.payload?.newStatus === "cancelado") {
          summary.totalOrdersCancelled++;
        }
        break;
      case "order_confirmed_by_human":
        summary.totalOrdersConfirmedByHuman++;
        break;
      case "order_cancelled":
        summary.totalOrdersCancelled++;
        break;
      case "whatsapp_outbound_text":
        summary.totalWhatsappOutboundText++;
        break;
      case "whatsapp_outbound_media":
        summary.totalWhatsappOutboundMedia++;
        break;
      case "campaign_simulated":
        summary.totalCampaignSimulated++;
        break;
      case "campaign_sent":
        summary.totalCampaignSent++;
        break;
      default:
        break;
    }
  }

  return Object.values(byClient).sort((a, b) =>
    a.clientId.localeCompare(b.clientId)
  );
}

export type GlobalSummary = {
  totalClients: number;
  totalOrdersCreated: number;
  totalOrdersConfirmedByHuman: number;
  totalOrdersCancelled: number;
  totalWhatsappOutboundText: number;
  totalWhatsappOutboundMedia: number;
  totalCampaignSimulated: number;
  totalCampaignSent: number;
};

/**
 * Agrega um array de ClientSummary em um número único global.
 */
export function getGlobalSummary(clients: ClientSummary[]): GlobalSummary {
  const base: GlobalSummary = {
    totalClients: clients.length,
  totalOrdersCreated: 0,
  totalOrdersConfirmedByHuman: 0,
  totalOrdersCancelled: 0,
  totalWhatsappOutboundText: 0,
  totalWhatsappOutboundMedia: 0,
  totalCampaignSimulated: 0,
  totalCampaignSent: 0,
  };

  for (const c of clients) {
    base.totalOrdersCreated += c.totalOrdersCreated;
    base.totalOrdersConfirmedByHuman += c.totalOrdersConfirmedByHuman;
    base.totalOrdersCancelled += c.totalOrdersCancelled;
    base.totalWhatsappOutboundText += c.totalWhatsappOutboundText;
    base.totalWhatsappOutboundMedia += c.totalWhatsappOutboundMedia;
    base.totalCampaignSimulated += c.totalCampaignSimulated;
    base.totalCampaignSent += c.totalCampaignSent;
  }

  return base;
}

/**
 * Métricas diárias por cliente, para alimentar painel detalhado.
 */
export type DailyClientMetrics = {
  date: string; // YYYY-MM-DD
  ordersCreated: number;
  ordersConfirmed: number;
  ordersCancelled: number;
  whatsappOutbound: number;
  campaignsSent: number;
};

export async function getClientDailyMetrics(
  clientId: string
): Promise<DailyClientMetrics[]> {
  const all = await readAllEvents();
  const events = all.filter((e) => e.clientId === clientId);

  const byDay: Record<string, DailyClientMetrics> = {};

  const ensureDay = (day: string): DailyClientMetrics => {
    if (!byDay[day]) {
      byDay[day] = {
        date: day,
        ordersCreated: 0,
        ordersConfirmed: 0,
        ordersCancelled: 0,
        whatsappOutbound: 0,
        campaignsSent: 0,
      };
    }
    return byDay[day];
  };

  for (const e of events) {
    if (!e.createdAt) continue;
    const day = e.createdAt.slice(0, 10); // YYYY-MM-DD
    const d = ensureDay(day);

    switch (e.type) {
      case "order_created":
        d.ordersCreated++;
        break;
      case "order_status_changed":
        if (e.payload?.newStatus === "concluido") {
          d.ordersConfirmed++;
        }
        if (e.payload?.newStatus === "cancelado") {
          d.ordersCancelled++;
        }
        break;
      case "order_confirmed_by_human":
        d.ordersConfirmed++;
        break;
      case "order_cancelled":
        d.ordersCancelled++;
        break;
      case "whatsapp_outbound_text":
      case "whatsapp_outbound_media":
        d.whatsappOutbound++;
        break;
      case "campaign_sent":
        d.campaignsSent++;
        break;
      default:
        break;
    }
  }

  return Object.values(byDay).sort((a, b) =>
    a.date > b.date ? 1 : a.date < b.date ? -1 : 0
  );
}
