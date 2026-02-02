// src/app/api/admin/bookings/confirmations/run/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/adminAuth";
import { readJsonObject } from "@/lib/http/body";
import { runBookingConfirmationCycle, listBookingsByClient, getServiceCalendarConfig, computeConfirmByAt } from "@/lib/bookings";
import { getContactById } from "@/lib/contacts";
import { getAttendantById } from "@/lib/attendants";
import { enqueueWhatsappText } from "@/lib/whatsappOutboxStore";

const BodySchema = z.object({
  clientId: z.string().min(1),
  limit: z.number().int().min(1).max(500).optional(),
  dryRun: z.boolean().optional(),
});

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

function renderTemplate(tpl: string, vars: Record<string, string>): string {
  let out = tpl;
  for (const [k, v] of Object.entries(vars)) {
    out = out.split(`{${k}}`).join(v);
  }
  return out;
}

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAdmin(req);
    if (denied) return denied;

    const body = await readJsonObject(req);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Payload inválido.", details: parsed.error.flatten() }, { status: 400 });
    }

    const { clientId, limit, dryRun } = parsed.data;

    const results = await runBookingConfirmationCycle({ clientId, limit, dryRun });
    const result = results[0];

    // Disparar mensagens de lembrete para os bookings que entraram em awaiting_confirmation
    if (!dryRun && result?.reminderBookingIds?.length) {
      const all = await listBookingsByClient(clientId);
      const config = (await getServiceCalendarConfig(clientId)) ?? { clientId, updatedAt: new Date().toISOString() } as any;
      const leadHours = Number((config as any).bookingReminderConfirmLeadHours ?? 2) || 2;

      const tpl =
        String((config as any).bookingReminderMessageTemplate || "").trim() ||
        "Seu agendamento precisa ser confirmado com antecedência de {confirmLeadHours}h.\n\nServiço: {service}\nProfissional: {professional}\nData: {date} {time}\nEndereço: {address}\n\nResponda: SIM para confirmar ou NÃO para cancelar.";

      for (const bookingId of result.reminderBookingIds) {
        const b = all.find((x) => x.id === bookingId);
        if (!b) continue;

        const contact = await getContactById(clientId, b.contactId);
        if (!contact?.identifier) continue;

        const attendant = await getAttendantById(clientId, b.attendantId);

        const vars = {
          service: String(b.service?.name || ""),
          professional: attendant ? `${attendant.name}${attendant.specialty ? ` (${attendant.specialty})` : ""}` : "Padrão",
          date: formatDate(b.startAt),
          time: formatTime(b.startAt),
          address: String((b.collected as any)?.address || ""),
          confirmLeadHours: String(leadHours),
          confirmBy: formatTime(computeConfirmByAt(b.startAt, leadHours)),
        };

        const message = renderTemplate(tpl, vars);

        await enqueueWhatsappText({
          clientId,
          to: contact.identifier,
          message,
          context: { kind: "booking_reminder", bookingId },
        });
      }
    }

    return NextResponse.json({ ok: true, result });
  } catch (err: any) {
    console.error("Erro ao rodar confirmações de agendamento:", err);
    return NextResponse.json({ ok: false, error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}
