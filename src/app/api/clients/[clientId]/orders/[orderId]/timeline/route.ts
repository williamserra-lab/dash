import { NextResponse } from "next/server";
import { listTimelineEvents, recordTimelineEvent } from "@/lib/timeline";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ clientId: string; orderId: string }> }
) {
  const { clientId, orderId } = await ctx.params;

  // Seed "criado" se ainda não existir histórico (dados antigos/seed).
  const existing = await listTimelineEvents(clientId, "order", orderId);
  if (existing.length === 0) {
    await recordTimelineEvent({
      clientId,
      entityType: "order",
      entityId: orderId,
      status: "created",
      statusGroup: "criado",
      actor: "system",
    });
  }

  const events = await listTimelineEvents(clientId, "order", orderId);
  return NextResponse.json({ ok: true, clientId, orderId, events });
}
