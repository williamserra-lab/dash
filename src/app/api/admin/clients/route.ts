export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { createClient, listClients } from "@/lib/clients";

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Erro desconhecido";
  }
}

export async function GET(_req: NextRequest) {
  const denied = await requireAdmin(_req);
  if (denied) return denied;

  const clients = await listClients();
  return NextResponse.json({ clients }, { status: 200 });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const body = await req.json();
    const client = await createClient(
      {
        id: body?.id,
        name: body?.name,
        status: body?.status,
        segment: body?.segment,
        whatsappNumbers: body?.whatsappNumbers,
        billing: body?.billing,
        access: body?.access,
        plan: body?.plan,
        profile: body?.profile,
      },
      "operator_generic"
    );

    return NextResponse.json({ client }, { status: 201 });
  } catch (err: unknown) {
    const msg = getErrorMessage(err) || "Erro ao criar cliente.";
    const status =
      msg.includes("Já existe") ||
      msg.includes("inválido") ||
      msg.includes("obrigatório") ||
      msg.includes("Documento")
        ? 400
        : 500;

    return NextResponse.json({ error: msg }, { status });
  }
}
