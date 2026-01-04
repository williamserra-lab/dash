// src/app/api/clients/[clientId]/orders/[orderId]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { assertClientActive, ClientAccessError } from "@/lib/tenantAccess";
import { getOrderById, patchOrder } from "@/lib/orders";
import { readJsonObject } from "@/lib/http/body";

type RouteContext = {
  params: Promise<{
    clientId: string;
    orderId: string;
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
    const { clientId, orderId } = await context.params;

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório na rota." },
        { status: 400 }
      );
    }
    await assertClientActive(clientId);

    if (!orderId) {
      return NextResponse.json(
        { error: "orderId é obrigatório na rota." },
        { status: 400 }
      );
    }

    const order = await getOrderById(clientId, orderId);
    if (!order) {
      return NextResponse.json(
        { error: "Pedido não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json({ order });
  } catch (error) {
    if (error instanceof ClientAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    console.error("Erro ao buscar pedido:", error);
    return NextResponse.json(
      { error: getErrorMessage(error) || "Erro interno ao buscar pedido." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  context: RouteContext
): Promise<NextResponse> {
  try {
    const { clientId, orderId } = await context.params;

    if (!clientId) {
      return NextResponse.json(
        { error: "clientId é obrigatório na rota." },
        { status: 400 }
      );
    }
    await assertClientActive(clientId);

    if (!orderId) {
      return NextResponse.json(
        { error: "orderId é obrigatório na rota." },
        { status: 400 }
      );
    }

    const body = await readJsonObject(req);

    const updated = await patchOrder(clientId, orderId, body as any);
    if (!updated) {
      return NextResponse.json(
        { error: "Pedido não encontrado." },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, order: updated });
  } catch (error) {
    if (error instanceof ClientAccessError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.status }
      );
    }

    const msg = getErrorMessage(error);
    if (msg.includes("Body inválido: esperado um objeto JSON.")) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    console.error("Erro ao atualizar pedido:", error);
    return NextResponse.json(
      { error: msg || "Erro interno ao atualizar pedido." },
      { status: 500 }
    );
  }
}
