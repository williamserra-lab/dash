// src/app/api/clients/[clientId]/attendants/[attendantId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { deleteAttendant, getAttendantById, updateAttendant, type AttendantRole } from "@/lib/attendants";

type RouteContext = { params: Promise<{ clientId: string; attendantId: string }> };

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, attendantId } = await context.params;
    if (!clientId || !attendantId) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });

    const item = await getAttendantById(clientId, attendantId);
    if (!item) return NextResponse.json({ error: "Atendente não encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true, item }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, attendantId } = await context.params;
    if (!clientId || !attendantId) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });

    const body = await readJsonObject(req);
    const patch: any = {};
    if (typeof (body as any).name === "string") patch.name = String((body as any).name);
    if (typeof (body as any).active === "boolean") patch.active = (body as any).active;
    if (typeof (body as any).role === "string") {
      const r = String((body as any).role);
      patch.role = (r === "admin" ? "admin" : "agent") as AttendantRole;
    }

    const updated = await updateAttendant(clientId, attendantId, patch);
    if (!updated) return NextResponse.json({ error: "Atendente não encontrado." }, { status: 404 });

    return NextResponse.json({ ok: true, item: updated }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId, attendantId } = await context.params;
    if (!clientId || !attendantId) return NextResponse.json({ error: "Parâmetros inválidos." }, { status: 400 });

    const ok = await deleteAttendant(clientId, attendantId);
    if (!ok) return NextResponse.json({ error: "Atendente não encontrado." }, { status: 404 });

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}
