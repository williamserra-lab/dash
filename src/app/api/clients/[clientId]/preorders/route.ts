// src/app/api/clients/[clientId]/preorders/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import { createPreorder, getPreordersByClient, type PreorderStatus } from "@/lib/preorders";
import { getClientById } from "@/lib/clients";

type RouteContext = { params: Promise<{ clientId: string }> };

function parseStatus(raw: string): PreorderStatus | null {
  const s = (raw || "").trim();
  return s === "draft" ||
    s === "awaiting_human_confirmation" ||
    s === "confirmed" ||
    s === "cancelled" ||
    s === "expired"
    ? (s as PreorderStatus)
    : null;
}

export async function GET(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });

    const url = new URL(req.url);
    const statusRaw = url.searchParams.get("status") || "";
    const status = statusRaw ? parseStatus(statusRaw) : null;
    if (statusRaw && !status) {
      return NextResponse.json({ error: "Status inválido." }, { status: 400 });
    }

    const preorders = await getPreordersByClient(clientId, status);
    return NextResponse.json({ preorders }, { status: 200 });
  } catch (error) {
    console.error("Erro ao listar pré-pedidos:", error);
    return NextResponse.json({ error: "Erro interno ao listar pré-pedidos." }, { status: 500 });
  }
}

export async function POST(req: NextRequest, context: RouteContext): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) return NextResponse.json({ error: "clientId é obrigatório." }, { status: 400 });

    const body = await readJsonObject(req);
    const contactId = typeof (body as any).contactId === "string" ? (body as any).contactId : "";
    const identifier = typeof (body as any).identifier === "string" ? (body as any).identifier : "";

    if (!contactId || !identifier) {
      return NextResponse.json({ error: "contactId e identifier são obrigatórios." }, { status: 400 });
    }

// Expiração: prioridade é expiresAt explícito no body.
// Se não vier, permite override por cliente via client.profile.preorderExpiresHours (number ou string numérica).
let expiresAt: string | null = null;
const rawExpiresAt = (body as any).expiresAt;
if (rawExpiresAt !== undefined) {
  expiresAt = rawExpiresAt ?? null;
} else {
  const client = await getClientById(clientId);
  const hoursRaw = (client as any)?.profile?.preorderExpiresHours;
  const hours = typeof hoursRaw === "number" ? hoursRaw : Number(hoursRaw);
  if (Number.isFinite(hours) && hours > 0) {
    const d = new Date();
    d.setHours(d.getHours() + hours);
    expiresAt = d.toISOString();
  }
}


    const preorder = await createPreorder({
      clientId,
      contactId,
      identifier,
      items: (body as any).items,
      delivery: (body as any).delivery,
      payment: (body as any).payment,
      expiresAt: expiresAt,
      actor: (body as any).actor,
    });

    return NextResponse.json({ preorder }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar pré-pedido:", error);
    return NextResponse.json({ error: "Erro interno ao criar pré-pedido." }, { status: 500 });
  }
}
