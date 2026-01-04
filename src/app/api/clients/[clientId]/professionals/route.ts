// src/app/api/clients/[clientId]/professionals/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http/body";
import {
  createProfessional,
  getProfessionalsByClient,
} from "@/lib/appointments";

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

    const professionals = await getProfessionalsByClient(clientId);
    return NextResponse.json({ professionals }, { status: 200 });
  } catch (error) {
    console.error("Erro ao listar profissionais:", error);
    return NextResponse.json(
      { error: "Erro interno ao listar profissionais." },
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

    const body = await readJsonObject(req);
    const name = String(body.name || "").trim();

    if (!name) {
      return NextResponse.json(
        { error: "Nome do profissional é obrigatório." },
        { status: 400 }
      );
    }

    const professional = await createProfessional({
      clientId,
      name,
    });

    return NextResponse.json({ professional }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar profissional:", error);
    return NextResponse.json(
      { error: "Erro interno ao criar profissional." },
      { status: 500 }
    );
  }
}
