// src/app/api/clients/[clientId]/bookings/[bookingId]/accept/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getContactById } from "@/lib/contacts";
import { getAttendantById } from "@/lib/attendants";
import { getServiceCalendarConfig, setBookingStatus } from "@/lib/bookings";
import { enqueueWhatsappText } from "@/lib/whatsappOutboxStore";
import { listTimelineEvents, recordTimelineEvent } from "@/lib/timeline";

type RouteContext = {
  params: Promise<{
    clientId: string;
    bookingId: string;
  }>;
};

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

function buildConfirmLink(origin: string, clientId: string, bookingId: string): string {
  const qs = new URLSearchParams({ clientId, bookingId }).toString();
  return `${origin}/confirmar-agendamento?${qs}`;
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { clientId, bookingId } = await ctx.params;
  try {
    const updated = await setBookingStatus(clientId, bookingId, "confirmed");

    // Timeline best-effort: registra que um humano confirmou no painel
    try {
      const existing = await listTimelineEvents(clientId, "booking", bookingId);
      const hasConfirmed = existing.some((e) => e.status === "confirmed");
      if (!hasConfirmed) {
        await recordTimelineEvent({
          clientId,
          entityType: "booking",
          entityId: bookingId,
          status: "confirmed",
          // group padrão do booking: "confirmado" (deixa o lib resolver se preferir)
          actor: "merchant",
          note: "confirmed via admin console",
        });
      }
    } catch {
      // best-effort, não derruba o fluxo principal
    }

    const contact = await getContactById(clientId, updated.contactId);
    if (!contact) {
      return NextResponse.json({ ok: true, booking: updated, warning: "Contato não encontrado para envio." });
    }

    const attendant = updated.attendantId ? await getAttendantById(clientId, updated.attendantId) : null;

    const start = new Date(updated.startAt);
    const date = start.toLocaleDateString("pt-BR");
    const time = start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    const config = (await getServiceCalendarConfig(clientId)) ?? null;

    const defaultTpl =
      "Seu horário foi agendado! serviço {service}, profissional {professional}, hora e data {time} {date}, endereço {address}.";
    const tpl = (config?.bookingConfirmedMessageTemplate || "").trim() || defaultTpl;

    const baseMsg = renderTemplate(tpl, {
      service: updated.service?.name || "",
      professional: attendant ? (attendant.specialty ? `${attendant.name} (${attendant.specialty})` : attendant.name) : "Padrão",
      date,
      time,
      address: (updated.collected?.address || "").trim(),
    });

    // Link público para o cliente confirmar que visualizou (registro em timeline)
    const confirmLink = buildConfirmLink(req.nextUrl.origin, clientId, bookingId);

    const msg = `${baseMsg}\n\nConfirme que você viu este agendamento: ${confirmLink}`;

    await enqueueWhatsappText({
      clientId,
      to: contact.identifier,
      message: msg,
      contactId: contact.id,
      idempotencyKey: `booking:${bookingId}:confirmed`,
      context: {
        kind: "booking",
        bookingId,
        contactId: contact.id,
        action: "confirmed",
      },
    });

    return NextResponse.json({ ok: true, booking: updated, confirmLink });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const status = msg.includes("não encontrado") ? 404 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
