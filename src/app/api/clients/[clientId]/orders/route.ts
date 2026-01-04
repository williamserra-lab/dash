// src/app/api/clients/[clientId]/orders/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { readOrdersByClient } from "@/lib/orders";

type RouteContext = {
  params: Promise<{
    clientId: string;
  }>;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function GET(
  _req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId } = await context.params;

    if (!clientId || typeof clientId !== "string") {
      return NextResponse.json(
        { error: "clientId é obrigatório na rota." },
        { status: 400 }
      );
    }

    await assertClientActive(clientId);

    const orders = await readOrdersByClient(clientId);
    return NextResponse.json({ orders }, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof ClientAccessError) {
      const e = error as ClientAccessError;
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status }
      );
    }

    console.error("Erro ao listar pedidos:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Erro interno ao listar pedidos." },
      { status: 500 }
    );
  }
}
