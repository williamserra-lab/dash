// src/app/api/clients/[clientId]/whatsapp-instances/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { createWhatsappInstance, listWhatsappInstancesByClient } from "@/lib/whatsappInstances";

type RouteContext = { params: Promise<{ clientId: string }> };

export async function GET(_req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });

    const items = await listWhatsappInstancesByClient(clientId);
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
    const label = typeof (body as any).label === "string" ? (body as any).label.trim() : "";
    const instanceName = typeof (body as any).instanceName === "string" ? (body as any).instanceName.trim() : "";
    const baseUrl = typeof (body as any).baseUrl === "string" ? (body as any).baseUrl.trim() : "";
    const apiKey = typeof (body as any).apiKey === "string" ? (body as any).apiKey.trim() : "";
    const active = typeof (body as any).active === "boolean" ? (body as any).active : true;

    if (!label || !instanceName || !baseUrl || !apiKey) {
      return NextResponse.json(
        { error: "label, instanceName, baseUrl e apiKey são obrigatórios." },
        { status: 400 }
      );
    }

    const created = await createWhatsappInstance({ clientId, label, instanceName, baseUrl, apiKey, active });
    return NextResponse.json({ ok: true, item: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: "Erro interno.", details: String(err?.message || err) }, { status: 500 });
  }
}
