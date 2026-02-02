// src/app/api/clients/[clientId]/bookings/[bookingId]/reject/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { setBookingStatus } from "@/lib/bookings";

type RouteContext = {
  params: Promise<{
    clientId: string;
    bookingId: string;
  }>;
};

export async function POST(_req: NextRequest, ctx: RouteContext) {
  const { clientId, bookingId } = await ctx.params;
  try {
    const updated = await setBookingStatus(clientId, bookingId, "cancelled");
    return NextResponse.json({ ok: true, booking: updated });
  } catch (err: any) {
    const msg = String(err?.message || err);
    const status = msg.includes("não encontrado") ? 404 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
