// src/app/api/clients/[clientId]/bookings/[bookingId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { getBookingById, updateBooking } from "@/lib/bookings";

type RouteContext = {
  params: Promise<{
    clientId: string;
    bookingId: string;
  }>;
};

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { clientId, bookingId } = await ctx.params;
  try {
    const booking = await getBookingById(clientId, bookingId);
    if (!booking) return NextResponse.json({ error: "Booking não encontrado." }, { status: 404 });
    return NextResponse.json({ booking });
  } catch (error) {
    console.error("Erro ao obter booking:", error);
    return NextResponse.json({ error: "Erro ao obter booking." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { clientId, bookingId } = await ctx.params;
  try {
    const body: any = await readJsonObject(req);
const booking = await updateBooking(clientId, bookingId, {
      service: body.service,
      startAt: body.startAt,
      endAt: body.endAt,
      collected: body.collected,
    });
    return NextResponse.json({ booking });
  } catch (error) {
    console.error("Erro ao atualizar booking:", error);
    return NextResponse.json({ error: "Erro ao atualizar booking." }, { status: 500 });
  }
}
