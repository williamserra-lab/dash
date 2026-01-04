// src/lib/whatsapp.ts
// Camada de envio WhatsApp (nesta versão: envio simulado + logs em JSON).
// Importante: a outbox canônica é gerida por lib/whatsappOutboxStore.ts (status pending/sent/failed).
// Operação: manter o schema de campanha consistente com lib/campaigns.ts.

import type { Contact } from "./contacts";
import { recordCampaignSendStatus } from "./campaigns";
import { enqueueWhatsappText } from "./whatsappOutboxStore";

/**
 * Envia (simulado) uma mensagem de campanha para um contato WhatsApp.
 * - Enfileira na outbox canônica (data/whatsapp_outbox.json) com status "pending"
 * - Atualiza o status do envio na trilha de campanhas (data/campaign_sends.json) usando o schema oficial.
 *
 * Observação: nesta versão não existe provedor real de WhatsApp. O fechamento operacional
 * do envio (sent/failed) ocorre via runner operacional (admin/outbox/run) ou similar.
 */
export async function sendWhatsappCampaignMessage(
  clientId: string,
  campaignId: string,
  contact: Contact,
  message: string,
  opts?: {
    notBefore?: string | null;
    idempotencyKey?: string | null;
    allowRetryOnError?: boolean; // compat: usado pelo caller
    runId?: string | null;
  }
): Promise<void> {
  const idempotencyKey =
    opts?.idempotencyKey ?? `cmp:${campaignId}:contact:${contact.id}`;

  // 1) Outbox (auditoria do que teria sido enviado)
  await enqueueWhatsappText({
    clientId,
    to: contact.identifier,
    message,
    contactId: contact.id,
    notBefore: opts?.notBefore ?? null,
    idempotencyKey,
    context: {
      kind: "campaign",
      campaignId,
      contactId: contact.id,
      contactIdentifier: contact.identifier,
      idempotencyKey,
    },
  });

  // 2) Trilha de envios da campanha:
  //    "agendado" aqui; o runner operacional fecha como "enviado/erro".
  await recordCampaignSendStatus({
    campaignId,
    clientId,
    contactId: contact.id,
    identifier: contact.identifier,
    status: "agendado",
  });
}

/**
 * Envia (simulado) mensagem do assistente.
 * - Enfileira na outbox canônica.
 *
 * A lógica de negócio (quando enviar, o que enviar) é definida fora daqui.
 */
export async function sendWhatsappAssistantMessage(input: {
  clientId: string;
  to: string;
  message: string;
  contactId?: string | null;
  orderId?: string | null;
}): Promise<void> {
  await enqueueWhatsappText({
    clientId: input.clientId,
    to: input.to,
    message: input.message,
    contactId: input.contactId ?? null,
    orderId: input.orderId ?? null,
    messageType: "assistant",
    context: {
      kind: "assistant",
    },
  });
}

/**
 * Envia (simulado) mensagem de sistema.
 * - Enfileira na outbox canônica.
 */
export async function sendWhatsappSystemMessage(input: {
  clientId: string;
  to: string;
  message: string;
  contactId?: string | null;
  orderId?: string | null;
  messageType?: string | null;
}): Promise<void> {
  await enqueueWhatsappText({
    clientId: input.clientId,
    to: input.to,
    message: input.message,
    contactId: input.contactId ?? null,
    orderId: input.orderId ?? null,
    messageType: input.messageType ?? "system",
    context: {
      kind: "system",
    },
  });
}
