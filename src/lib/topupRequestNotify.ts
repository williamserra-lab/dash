export const runtime = "nodejs";

import { sendWhatsappSystemMessage } from "@/lib/whatsapp";
import { getEvolutionTenantClientId } from "@/lib/evolutionConfig";

function trim(v: string | undefined | null): string {
  return (v || "").trim();
}

function getAdminWhatsApp(): string | null {
  const v = trim(process.env.NEXTIA_ADMIN_WHATSAPP);
  return v ? v : null;
}

function getAdminNotifyWebhookUrl(): string | null {
  // Use any webhook provider to deliver email (Make/Zapier/n8n). Payload includes adminEmail as hint.
  const v = trim(process.env.NEXTIA_ADMIN_NOTIFY_WEBHOOK_URL);
  return v ? v : null;
}

function getAdminEmailHint(): string | null {
  const v = trim(process.env.NEXTIA_ADMIN_EMAIL);
  return v ? v : null;
}

export async function notifyAdminTopupRequested(input: {
  clientId: string;
  requestId: string;
  usagePercent: number;
  creditsUsed: number;
  monthlyLimit: number;
}): Promise<void> {
  const adminEmail = getAdminEmailHint();
  const webhook = getAdminNotifyWebhookUrl();

  const payload = {
    event: "credit_topup_requested",
    clientId: input.clientId,
    requestId: input.requestId,
    usagePercent: input.usagePercent,
    creditsUsed: input.creditsUsed,
    monthlyLimit: input.monthlyLimit,
    adminEmail,
    createdAt: new Date().toISOString(),
  };

  // 1) Webhook (recommended for email delivery)
  if (webhook) {
    try {
      await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {
      // ignore
    }
  }

  // 2) WhatsApp notify (optional)
  const wa = getAdminWhatsApp();
  if (wa) {
    const notifyClientId = getEvolutionTenantClientId() || input.clientId;
    const msg = [
      "🔔 Solicitação de recarga",
      "",
      `Cliente: ${input.clientId}`,
      `Pedido: ${input.requestId}`,
      input.usagePercent ? `Uso: ${input.usagePercent}%` : null,
      input.monthlyLimit ? `Limite mensal: ${input.monthlyLimit}` : null,
      "",
      "Acesse o painel Admin para aprovar e liberar.",
    ].filter(Boolean).join("\n");

    try {
      await sendWhatsappSystemMessage({
        clientId: notifyClientId,
        to: wa,
        message: msg,
        messageType: "admin_notify",
      });
    } catch {
      // ignore
    }
  }
}
