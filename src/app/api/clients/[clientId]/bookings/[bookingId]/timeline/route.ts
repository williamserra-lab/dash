import { NextResponse } from "next/server";
import { listTimelineEvents, recordTimelineEvent } from "@/lib/timeline";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ clientId: string; bookingId: string }> }
) {
  const { clientId, bookingId } = await ctx.params;

  // Se não houver nenhum evento ainda, criamos um "criado" best-effort
  // (para dados antigos/seed sem histórico).
  const existing = await listTimelineEvents(clientId, "booking", bookingId);
  if (existing.length === 0) {
    await recordTimelineEvent({
      clientId,
      entityType: "booking",
      entityId: bookingId,
      status: "created",
      statusGroup: "criado",
      actor: "system",
    });
  }

  const events = await listTimelineEvents(clientId, "booking", bookingId);
  return NextResponse.json({ ok: true, clientId, bookingId, events });
}
