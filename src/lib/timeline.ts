// src/lib/timeline.ts
// Timeline (linha do tempo) para entidades operacionais (pedido/agendamento).
//
// Requisitos (PASSO 5):
// - Registrar eventos de mudança de status (e seed do "criado").
// - Persistir em Postgres quando NEXTIA_DB_URL estiver setado; caso contrário, fallback em JSON.

import { isDbEnabled, dbQuery } from "@/lib/db";
import { createId } from "@/lib/id";
import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";

export type TimelineEntityType = "order" | "booking" | "preorder";
export type TimelineActor = "system" | "merchant" | "customer" | "support";

export type TimelineEvent = {
  id: string;
  clientId: string;
  entityType: TimelineEntityType;
  entityId: string;
  /** status original da entidade (ex.: booking.confirmed, order.em_preparo) */
  status: string;
  /** status agrupado (obrigatório no roadmap) */
  statusGroup: string;
  at: string; // ISO
  actor: TimelineActor;
  note?: string | null;
};

function eventsJsonPath(clientId: string): string {
  return getDataPath(`timeline_events_${clientId}.json`);
}

export function groupOrderStatus(status: string): string {
  // Status "obrigatórios" definidos pelo William:
  // criado, confirmado, preparo, entrega/retirada, concluido, cancelado
  switch (status) {
    case "novo":
    case "coletando_dados":
    case "em_andamento":
    case "aguardando_pagamento":
    case "aguardando_preparo":
      return "criado";
    case "em_preparo":
      return "preparo";
    case "pronto":
      return "entrega/retirada";
    case "concluido":
      return "concluido";
    case "cancelado":
      return "cancelado";
    default:
      return "criado";
  }
}

export function groupBookingStatus(status: string): string {
  // Status "obrigatórios" definidos pelo William:
  // criado, confirmado, concluido, cancelado, nao_compareceu
  switch (status) {
    case "requested":
    case "awaiting_confirmation":
      return "criado";
    case "confirmed":
      return "confirmado";
    case "cancelled":
      return "cancelado";
    case "no_show":
      return "nao_compareceu";
    default:
      return "criado";
  }
}

export function computeStatusGroup(entityType: TimelineEntityType, status: string): string {
  if (entityType === "order") return groupOrderStatus(status);
  if (entityType === "booking") return groupBookingStatus(status);
  return groupPreorderStatus(status);
}

export type RecordTimelineEventInput = {
  clientId: string;
  entityType: TimelineEntityType;
  entityId: string;
  status: string;
  statusGroup?: string;
  actor: TimelineActor;
  note?: string | null;
  at?: string; // ISO
};

export async function recordTimelineEvent(input: RecordTimelineEventInput): Promise<TimelineEvent> {
  const at = input.at ?? new Date().toISOString();
  const ev: TimelineEvent = {
    id: createId("tle"),
    clientId: input.clientId,
    entityType: input.entityType,
    entityId: input.entityId,
    status: input.status,
    statusGroup: input.statusGroup ?? computeStatusGroup(input.entityType, input.status),
    at,
    actor: input.actor,
    note: input.note ?? null,
  };

  if (isDbEnabled()) {
    await dbQuery(
      `INSERT INTO nextia_timeline_events (id, client_id, entity_type, entity_id, status, status_group, at, actor, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9)`,
      [
        ev.id,
        ev.clientId,
        ev.entityType,
        ev.entityId,
        ev.status,
        ev.statusGroup,
        ev.at,
        ev.actor,
        ev.note,
      ],
    );
    return ev;
  }

  const all = await readJsonArray<TimelineEvent>(eventsJsonPath(ev.clientId));
  all.push(ev);
  all.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  await writeJsonArray(eventsJsonPath(ev.clientId), all);
  return ev;
}

export async function listTimelineEvents(
  clientId: string,
  entityType: TimelineEntityType,
  entityId: string,
): Promise<TimelineEvent[]> {
  if (isDbEnabled()) {
    const r = await dbQuery<any>(
      `SELECT id, client_id, entity_type, entity_id, status, status_group, at, actor, note
         FROM nextia_timeline_events
        WHERE client_id = $1 AND entity_type = $2 AND entity_id = $3
        ORDER BY at ASC`,
      [clientId, entityType, entityId],
    );
    return r.rows.map((row) => ({
      id: String(row.id),
      clientId: String(row.client_id),
      entityType: row.entity_type as TimelineEntityType,
      entityId: String(row.entity_id),
      status: String(row.status),
      statusGroup: String(row.status_group ?? computeStatusGroup(entityType, String(row.status))),
      at: new Date(row.at).toISOString(),
      actor: row.actor as TimelineActor,
      note: row.note ?? null,
    }));
  }

  const all = await readJsonArray<TimelineEvent>(eventsJsonPath(clientId));
  return all
    .filter((e) => e.clientId === clientId && e.entityType === entityType && e.entityId === entityId)
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
export function groupPreorderStatus(status: string): string {
  // Status canônicos de pré-pedido:
  // draft | awaiting_human_confirmation | confirmed | cancelled | expired
  // Follow-up (PASSO 7): followup_sent_1, followup_send_failed_1, followup_converted, etc.
  if (status.startsWith("followup_")) return "followup";
  switch (status) {
    case "draft":
    case "awaiting_human_confirmation":
      return "criado";
    case "confirmed":
      return "confirmado";
    case "cancelled":
      return "cancelado";
    case "expired":
      return "expirado";
    default:
      return "criado";
  }
}


