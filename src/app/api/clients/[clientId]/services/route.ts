// src/app/api/clients/[clientId]/services/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createService, getServicesByClient } from "@/lib/appointments";
import { readJsonObject } from "@/lib/http/body";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

export async function GET(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório." },
        { status: 400 }
      );
    }

    const services = await getServicesByClient(clientId);
    return NextResponse.json({ services }, { status: 200 });
  } catch (error) {
    console.error("Erro ao listar serviços:", error);
    return NextResponse.json(
      { error: "Erro interno ao listar serviços." },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;
    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório." },
        { status: 400 }
      );
    }

    const body = await readJsonObject(req)
    const name = String(body.name || "").trim();
    const description =
      typeof body.description === "string" ? body.description : undefined;
    const durationMinutes = body.durationMinutes
      ? Number(body.durationMinutes)
      : undefined;
    const basePrice =
      typeof body.basePrice === "number" ? body.basePrice : undefined;

    if (!name) {
      return NextResponse.json(
        { error: "Nome do serviço é obrigatório." },
        { status: 400 }
      );
    }

    const service = await createService({
      clientId,
      name,
      description,
      durationMinutes,
      basePrice,
    });

    return NextResponse.json({ service }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar serviço:", error);
    return NextResponse.json(
      { error: "Erro interno ao criar serviço." },
      { status: 500 }
    );
  }
}
