// src/app/api/clients/[clientId]/bookings/[bookingId]/status/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { setBookingStatus, type BookingStatus } from "@/lib/bookings";

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
const status = body.status as BookingStatus | undefined;
    if (!status) return NextResponse.json({ error: "status é obrigatório" }, { status: 400 });

    const booking = await setBookingStatus(clientId, bookingId, status);
    return NextResponse.json({ booking });
  } catch (error) {
    console.error("Erro ao atualizar status do booking:", error);
    return NextResponse.json({ error: "Erro ao atualizar status do booking." }, { status: 500 });
  }
}
