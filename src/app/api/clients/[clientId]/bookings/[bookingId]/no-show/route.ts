// src/app/api/clients/[clientId]/bookings/[bookingId]/no-show/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { markBookingNoShowManual } from "@/lib/bookings";

type RouteContext = {
  params: Promise<{
    clientId: string;
    bookingId: string;
  }>;
};

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { clientId, bookingId } = await ctx.params;
  try {
    const body: any = await readJsonObject(req);
    const reason = typeof body?.reason === "string" ? body.reason : undefined;

    const booking = await markBookingNoShowManual(clientId, bookingId, reason);
    return NextResponse.json({ ok: true, booking }, { status: 200 });
  } catch (error: any) {
    console.error("Erro ao marcar no-show:", error);
    return NextResponse.json(
      { ok: false, error: "Erro ao marcar no-show.", details: String(error?.message || error) },
      { status: 500 },
    );
  }
}
