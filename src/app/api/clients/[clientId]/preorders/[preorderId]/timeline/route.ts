import { NextResponse } from "next/server";
import { listTimelineEvents, recordTimelineEvent } from "@/lib/timeline";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ clientId: string; preorderId: string }> }
) {
  const { clientId, preorderId } = await ctx.params;

  // Best-effort seed para dados antigos que não têm timeline.
  const existing = await listTimelineEvents(clientId, "preorder", preorderId);
  if (existing.length === 0) {
    await recordTimelineEvent({
      clientId,
      entityType: "preorder",
      entityId: preorderId,
      status: "created",
      statusGroup: "criado",
      actor: "system",
    });
  }

  const events = await listTimelineEvents(clientId, "preorder", preorderId);
  return NextResponse.json({ ok: true, clientId, preorderId, events });
}
