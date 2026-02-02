// src/app/api/clients/[clientId]/service-calendar-config/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { getServiceCalendarConfig, upsertServiceCalendarConfig } from "@/lib/bookings";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { clientId } = await ctx.params;
  try {
    const config = await getServiceCalendarConfig(clientId);
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Erro ao obter ServiceCalendarConfig:", error);
    return NextResponse.json({ error: "Erro ao obter configuração." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, ctx: RouteContext) {
  const { clientId } = await ctx.params;
  try {
    const body: any = await readJsonObject(req);
    const config = await upsertServiceCalendarConfig(clientId, {
      workingHours: body.workingHours,
      defaultDurationMinutes: body.defaultDurationMinutes,
      bufferMinutes: body.bufferMinutes,
      simultaneousCapacity: body.simultaneousCapacity,
      bookingConfirmedMessageTemplate: body.bookingConfirmedMessageTemplate,
      bookingReminderMessageTemplate: body.bookingReminderMessageTemplate,
      bookingReminderConfirmLeadHours: body.bookingReminderConfirmLeadHours,
      bookingNoShowGraceMinutes: body.bookingNoShowGraceMinutes,
    });
    return NextResponse.json({ config });
  } catch (error) {
    console.error("Erro ao salvar ServiceCalendarConfig:", error);
    return NextResponse.json({ error: "Erro ao salvar configuração." }, { status: 500 });
  }
}
