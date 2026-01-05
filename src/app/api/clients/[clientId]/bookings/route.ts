// src/app/api/clients/[clientId]/bookings/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import {
  createBooking,
  listBookingsByClient,
  type BookingStatus,
  type ServiceSnapshot,
  type CollectedFields,
} from "@/lib/bookings";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { clientId } = await ctx.params;
  try {
    const bookings = await listBookingsByClient(clientId);
    return NextResponse.json({ bookings });
  } catch (error) {
    console.error("Erro ao listar bookings:", error);
    return NextResponse.json({ error: "Erro ao listar bookings." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { clientId } = await ctx.params;
  try {
    const body: any = await readJsonObject(req);
const contactId = String(body.contactId ?? "").trim();
    const service = body.service as ServiceSnapshot | undefined;
    const startAt = String(body.startAt ?? "").trim();
    const endAt = String(body.endAt ?? "").trim();
    const status = body.status as BookingStatus | undefined;
    const collected = body.collected as CollectedFields | undefined;

    const booking = await createBooking({
      clientId,
      contactId,
      service: service ?? { name: "" },
      startAt,
      endAt,
      status,
      collected,
    });

    return NextResponse.json({ booking }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar booking:", error);
    return NextResponse.json({ error: "Erro ao criar booking." }, { status: 500 });
  }
}
