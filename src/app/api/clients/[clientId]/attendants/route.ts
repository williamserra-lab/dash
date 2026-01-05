// src/app/api/clients/[clientId]/attendants/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { createAttendant, listAttendantsByClient, type AttendantRole } from "@/lib/attendants";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });

    const items = await listAttendantsByClient(clientId);
    return NextResponse.json({ ok: true, items }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });

    const body = await readJsonObject(req);
    const name = typeof (body as any).name === "string" ? (body as any).name.trim() : "";
    const roleRaw = typeof (body as any).role === "string" ? String((body as any).role) : "";
    const role: AttendantRole = roleRaw === "admin" ? "admin" : "agent";
    const active = typeof (body as any).active === "boolean" ? (body as any).active : true;

    if (!name) return NextResponse.json({ error: "name é obrigatório." }, { status: 400 });

    const created = await createAttendant({ clientId, name, role, active });
    return NextResponse.json({ ok: true, item: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}
