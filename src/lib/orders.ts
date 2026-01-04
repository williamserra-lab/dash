// src/lib/orders.ts
// Tipos e helper para leitura dos pedidos em /data/orders.json

import { getDataPath, readJsonArray, writeJsonArray } from "./jsonStore";

export type OrderStatus =
  | "novo"
  | "coletando_dados"
  | "em_andamento"
  | "aguardando_pagamento"
  | "aguardando_preparo"
  | "em_preparo"
  | "pronto"
  | "concluido"
  | "cancelado";

export type OrderItem = {
  id: string;
  sku?: string;
  name: string;
  quantity: number;

  // Preço unitário em centavos (ex.: R$ 25,90 => 2590).
  unitPriceCents?: number | null;

  // Campo legado em reais, mantido para compatibilidade (ex.: 25.9).
  unitPrice?: number;
};

export type DeliveryInfo = {
  method?: string; // entrega_retirada, retirada, balcão, etc.
  address?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  reference?: string;
  complement?: string;
  fee?: number | null; // taxa de entrega em reais (legacy)
  feeCents?: number | null; // taxa de entrega em centavos
  estimatedTimeMinutes?: number | null;
};

export type PaymentTiming = "antecipado" | "na_entrega";

export type PaymentInfo = {
  method?: string; // pix, crédito, débito, dinheiro, etc.
  status?: string; // pendente, pago, etc.
  // Valores em reais (legacy) ou centavos
  amount?: number | null; // em reais (legacy)
  amountCents?: number | null; // em centavos
  changeFor?: number | null; // troco, em reais (legacy)
  changeForCents?: number | null; // troco, em centavos
};

export type Order = {
  id: string;
  clientId: string;
  contactId: string;
  identifier: string; // telefone do cliente
  channel: string; // whatsapp etc.
  campaignId?: string;
  items: OrderItem[];

  // Total do pedido em centavos (ex.: R$ 100,00 => 10000).
  totalAmountCents?: number | null;

  // Campo legado em reais, mantido para compatibilidade.
  totalAmount?: number | null;

  delivery?: DeliveryInfo | null;
  paymentTiming?: PaymentTiming | null;
  payment?: PaymentInfo | null;
  lastMessage: string;
  status: OrderStatus;
  conversationStep?: string | null;
  createdAt: string;
  updatedAt: string;
};

const ordersFile = getDataPath("orders.json");

async function writeAllOrders(all: Order[]): Promise<void> {
  await writeJsonArray<Order>(ordersFile, all);
}


/**
 * Lê todos os pedidos do arquivo JSON.
 *
 * Esta função não faz nenhum tipo de agregação, apenas retorna a lista
 * original, tipada como Order.
 */
export async function readAllOrders(): Promise<Order[]> {
  const raw = await readJsonArray(ordersFile);

  return raw.map((o: any): Order => {
    return {
      id: String(o.id ?? ""),
      clientId: String(o.clientId ?? ""),
      contactId: String(o.contactId ?? ""),
      identifier: String(o.identifier ?? ""),
      channel: String(o.channel ?? "whatsapp"),
      campaignId: o.campaignId ? String(o.campaignId) : undefined,
      items: Array.isArray(o.items)
        ? o.items.map((it: any): OrderItem => ({
            id: String(it.id ?? ""),
            sku: it.sku ? String(it.sku) : undefined,
            name: String(it.name ?? ""),
            quantity: Number(it.quantity ?? 0),

            // Centavos, se vierem na origem
            unitPriceCents:
              typeof it.unitPriceCents === "number"
                ? it.unitPriceCents
                : it.unitPriceCents == null
                ? null
                : Number(it.unitPriceCents),

            // Legado em reais
            unitPrice:
              typeof it.unitPrice === "number"
                ? it.unitPrice
                : it.unitPrice == null
                ? undefined
                : Number(it.unitPrice),
          }))
        : [],
      totalAmountCents:
        typeof o.totalAmountCents === "number"
          ? o.totalAmountCents
          : o.totalAmountCents == null
          ? null
          : Number(o.totalAmountCents),
      totalAmount:
        typeof o.totalAmount === "number"
          ? o.totalAmount
          : o.totalAmount == null
          ? null
          : Number(o.totalAmount),
      delivery: o.delivery ?? null,
      paymentTiming: o.paymentTiming ?? null,
      payment: o.payment ?? null,
      lastMessage: String(o.lastMessage ?? ""),
      status: (o.status as OrderStatus) ?? "novo",
      conversationStep:
        o.conversationStep !== undefined ? String(o.conversationStep) : null,
      createdAt: String(o.createdAt ?? ""),
      updatedAt: String(o.updatedAt ?? ""),
    };
  });
}

/**
 * Lê pedidos filtrando por clientId.
 */
export async function readOrdersByClient(
  clientId: string
): Promise<Order[]> {
  const all = await readAllOrders();
  return all.filter((o) => o.clientId === clientId);
}

// ---------------------- COMPAT: endpoints importing legacy names ----------------------

export async function getOrderById(
  clientId: string,
  orderId: string
): Promise<Order | null> {
  const all = await readAllOrders();
  const found = all.find((o) => o.clientId === clientId && o.id === orderId);
  return found || null;
}

export async function patchOrder(
  clientId: string,
  orderId: string,
  patch: Partial<Order>
): Promise<Order | null> {
  const all = await readAllOrders();
  const idx = all.findIndex((o) => o.clientId === clientId && o.id === orderId);
  if (idx < 0) return null;

  const now = new Date().toISOString();
  const current = all[idx];

  // Keep id/clientId immutable.
  const { id: _ignoreId, clientId: _ignoreClientId, ...rest } = patch as any;

  const updated: Order = {
    ...current,
    ...rest,
    updatedAt: now,
  };

  all[idx] = updated;
  await writeAllOrders(all);
  return updated;
}
