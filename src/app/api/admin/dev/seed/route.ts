import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getClientById, createClient } from "@/lib/clients";
import { upsertContactFromInbound } from "@/lib/contacts";
import { createBooking } from "@/lib/bookings";
import { createId } from "@/lib/id";
import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";

export const runtime = "nodejs";

// NOTE: This endpoint exists ONLY to speed up manual testing.
// It creates:
// - 1 Booking (requested) in Postgres (or JSON fallback)
// - 1 Order in /data/orders.json (JSON store) so you can test PD generation in the Orders UI
//
// We intentionally DO NOT create Preorders here because the Postgres preorders payload path
// may be under repair. This avoids blocking the whole seed flow and saves time.

type SeedResponse = {
  ok: boolean;
  clientId: string;
  created?: {
    contactId: string;
    orderId: string;
    bookingId: string;
  };
  warnings?: { code: string; message: string }[];
  errorCode?: string;
  message?: string;
  details?: any;
};

function json(res: SeedResponse, status = 200): NextResponse {
  return NextResponse.json(res, { status });
}

type SeedOrder = {
  id: string;
  publicId?: string | null;
  clientId: string;
  contactId: string;
  identifier: string;
  channel: string;
  items: Array<{
    id: string;
    sku?: string;
    name: string;
    quantity: number;
    unitPriceCents?: number | null;
    unitPrice?: number;
  }>;
  totalAmountCents?: number | null;
  totalAmount?: number | null;
  delivery?: any | null;
  paymentTiming?: any | null;
  payment?: any | null;
  lastMessage: string;
  status: string;
  conversationStep?: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deny = await requireAdmin(req);
  if (deny) return deny;

  const url = new URL(req.url);
  const clientId = (url.searchParams.get("clientId") || "").trim() || "loja_teste";

  try {
    // Ensure client exists
    const existing = await getClientById(clientId);
    if (!existing) {
      await createClient({ id: clientId, name: clientId }, "admin_seed");
    }

    // Ensure a contact exists (contacts store is JSON-based today)
    const contact = await upsertContactFromInbound({
      clientId,
      channel: "whatsapp",
      identifier: "+55 11 99999-0000",
      name: "Contato Seed",
      lastMessage: "seed",
      interactionDate: new Date().toISOString(),
    });

    // Create booking (requested) - this is the AG flow test
    const start = new Date(Date.now() + 60 * 60 * 1000);
    const end = new Date(start.getTime() + 30 * 60 * 1000);

    const booking = await createBooking({
      clientId,
      contactId: contact.id,
      attendantId: "default",
      service: { name: "Serviço Seed", durationMinutes: 30, price: 49.9 },
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      status: "requested",
      collected: { name: "Contato Seed" },
    });

    // Create order (JSON store) - this is the PD flow test (generated when you click "Confirmar pedido" -> em_preparo)
    const now = new Date().toISOString();
    const orderId = createId("order");

    const order: SeedOrder = {
      id: orderId,
      publicId: null,
      clientId,
      contactId: contact.id,
      identifier: contact.identifier,
      channel: "whatsapp",
      items: [
        {
          id: "seed_item_1",
          name: "Produto Seed",
          quantity: 1,
          unitPrice: 49.9,
          unitPriceCents: 4990,
        },
      ],
      totalAmount: 49.9,
      totalAmountCents: 4990,
      delivery: { method: "retirada", fee: 0, feeCents: 0, estimatedTimeMinutes: 10 },
      paymentTiming: "na_entrega",
      payment: { method: "pix", status: "pendente", amount: 49.9, amountCents: 4990 },
      lastMessage: "Pedido seed para teste de PD-######",
      status: "aguardando_preparo",
      conversationStep: null,
      createdAt: now,
      updatedAt: now,
    };

    const ordersPath = getDataPath("orders.json");
    const list = await readJsonArray<SeedOrder>(ordersPath);
    list.push(order);
    await writeJsonArray(ordersPath, list);

    return json({
      ok: true,
      clientId,
      created: {
        contactId: contact.id,
        orderId: order.id,
        bookingId: booking.id,
      },
      warnings: [
        {
          code: "NX-ADM-SEED-PREORDER-SKIPPED",
          message:
            "Seed rápido: este gerador cria PEDIDO (orders.json) + AGENDAMENTO (bookings). Pré-pedido foi propositalmente omitido para não bloquear os testes.",
        },
      ],
    });
  } catch (err: any) {
    console.error("[admin-seed] error:", err);

    return json(
      {
        ok: false,
        clientId,
        errorCode: "NX-ADM-SEED-FAILED",
        message: "Falha ao gerar dados de teste.",
        details:
          process.env.NODE_ENV === "production"
            ? undefined
            : {
                name: err?.name,
                message: err?.message,
                code: err?.code,
                detail: err?.detail,
                where: err?.where,
                stack: err?.stack,
              },
      },
      500
    );
  }
}
