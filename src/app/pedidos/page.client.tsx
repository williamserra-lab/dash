"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function getErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || null;
  if (typeof err === "object") {
    const maybe = err as { message?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
  }
  return null;
}


const DEFAULT_CLIENT_ID = "catia_foods";

type PaymentTiming = "antecipado" | "no_balcao" | null;

type OrderStatus =
  | "novo"
  | "coletando_dados"
  | "aguardando_preparo"
  | "em_preparo"
  | "pronto"
  | "concluido"
  | "cancelado";

type DeliveryMode = "retirada" | "entrega" | null;

type OrderItem = {
  id: string;
  name: string;
  quantity: number;
};

type PaymentMethod =
  | "dinheiro"
  | "pix"
  | "credito"
  | "debito"
  | string
  | null;

type Payment = {
  method?: PaymentMethod;
  changeFor?: number | null;
  paid?: boolean | null;
} | null;

type Delivery = {
  mode?: DeliveryMode;
} | null;

type Order = {
  id: string;
  clientId: string;
  contactId: string;
  identifier: string;
  channel: string;
  items: OrderItem[];
  totalAmount?: number | null;
  paymentTiming?: PaymentTiming | null;
  payment?: Payment;
  delivery?: Delivery;
  lastMessage: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt?: string;
  conversationStep?: string;
};

const STALE_MINUTES = 30;

function labelStatus(status: OrderStatus): string {
  switch (status) {
    case "novo":
      return "Novo";
    case "coletando_dados":
      return "Coletando dados (bot)";
    case "aguardando_preparo":
      return "Aguardando validação";
    case "em_preparo":
      return "Em preparo";
    case "pronto":
      return "Pronto";
    case "concluido":
      return "Concluído";
    case "cancelado":
      return "Cancelado";
    default:
      return status;
  }
}

function labelTiming(timing: PaymentTiming | undefined | null): string {
  if (timing === "antecipado") return "Antecipado";
  if (timing === "no_balcao") return "No balcão/caixa";
  return "-";
}

function labelPaymentMethod(method?: PaymentMethod): string {
  switch (method) {
    case "pix":
      return "PIX";
    case "dinheiro":
      return "Dinheiro";
    case "credito":
      return "Cartão crédito";
    case "debito":
      return "Cartão débito";
    default:
      return "-";
  }
}

function labelDeliveryMode(mode?: DeliveryMode): string {
  if (mode === "retirada") return "Retirada no local";
  if (mode === "entrega") return "Entrega";
  return "-";
}

function isOpenStatus(status: OrderStatus): boolean {
  return status !== "concluido" && status !== "cancelado";
}

function isStaleOrder(order: Order): boolean {
  if (!order.updatedAt && !order.createdAt) return false;
  const ts = new Date(order.updatedAt || order.createdAt).getTime();
  const now = Date.now();
  const diffMinutes = (now - ts) / (1000 * 60);
  return diffMinutes >= STALE_MINUTES && isOpenStatus(order.status);
}

function formatStaleDuration(order: Order): string {
  if (!order.updatedAt && !order.createdAt) return "";
  const ts = new Date(order.updatedAt || order.createdAt).getTime();
  const now = Date.now();
  const diffMinutes = Math.floor((now - ts) / (1000 * 60));
  if (diffMinutes < STALE_MINUTES) return "";
  return `Parado há ~${diffMinutes} min`;
}

export default function PedidosPage() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") || DEFAULT_CLIENT_ID;

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<"abertos" | "todos">(
    "abertos"
  );

  const [mutatingId, setMutatingId] = useState<string | null>(null);

  async function loadOrders() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch(`/api/clients/${clientId}/orders`, {
        method: "GET",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao carregar pedidos.");
      }

      const data = await res.json();
      const list: Order[] = Array.isArray(data.orders) ? data.orders : [];
      setOrders(list);
    } catch (err: unknown) {
      console.error("Erro ao carregar pedidos:", err);
      setError(getErrorMessage(err) || "Erro ao carregar pedidos.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function updateOrderStatus(
    order: Order,
    newStatus: OrderStatus,
    notifyCustomer: boolean
  ) {
    try {
      setMutatingId(order.id);
      setError(null);

      const res = await fetch(
        `/api/clients/${clientId}/orders/${encodeURIComponent(order.id)}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            status: newStatus,
            notifyCustomer,
          }),
        }
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Falha ao atualizar pedido.");
      }

      const data = await res.json();
      const updated: Order | undefined = data.order;

      if (updated) {
        setOrders((prev) =>
          prev.map((o) => (o.id === updated.id ? updated : o))
        );
      }
    } catch (err: unknown) {
      console.error("Erro ao atualizar pedido:", err);
      setError(getErrorMessage(err) || "Erro ao atualizar pedido.");
    } finally {
      setMutatingId(null);
    }
  }

  const filteredOrders = useMemo(() => {
    const base =
      statusFilter === "abertos"
        ? orders.filter((o) => isOpenStatus(o.status))
        : orders;

    const copy = [...base];
    copy.sort((a, b) => {
      const aStale = isStaleOrder(a) ? 1 : 0;
      const bStale = isStaleOrder(b) ? 1 : 0;
      if (aStale !== bStale) return bStale - aStale;

      const aCreated = new Date(a.createdAt).getTime();
      const bCreated = new Date(b.createdAt).getTime();
      return bCreated - aCreated;
    });

    return copy;
  }, [orders, statusFilter]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">
              Pedidos / Pré-pedidos
            </h1>
            <p className="mt-1 text-xs text-slate-600">
              Visualize os pré-pedidos gerados pelo bot e acompanhe a
              validação manual, preparo e conclusão.
            </p>
            <p className="mt-1 text-[11px] text-amber-700">
              Pedidos em amarelo estão parados há mais de {STALE_MINUTES}{" "}
              minutos.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadOrders}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50"
              disabled={loading}
            >
              {loading ? "Atualizando..." : "Atualizar"}
            </button>
          </div>
        </header>

        <section className="rounded-lg bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
              <span className="font-semibold text-slate-600">Filtro:</span>
              <button
                type="button"
                onClick={() => setStatusFilter("abertos")}
                className={`rounded-full px-3 py-1 ${
                  statusFilter === "abertos"
                    ? "bg-sky-100 text-sky-800"
                    : "border border-slate-300 text-slate-700"
                }`}
              >
                Apenas abertos
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("todos")}
                className={`rounded-full px-3 py-1 ${
                  statusFilter === "todos"
                    ? "bg-sky-100 text-sky-800"
                    : "border border-slate-300 text-slate-700"
                }`}
              >
                Todos
              </button>
            </div>

            <div className="text-[11px] text-slate-500">
              Pré-pedidos na situação{" "}
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                Aguardando validação
              </span>{" "}
              dependem de análise humana.
            </div>
          </div>

          {error && (
            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="overflow-x-auto rounded-md border border-slate-200">
            {filteredOrders.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs text-slate-500">
                Nenhum pedido encontrado.
              </div>
            ) : (
              <table className="min-w-full border-collapse text-xs">
                <thead className="bg-slate-100 text-[11px] uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="px-3 py-2 text-left">ID</th>
                    <th className="px-3 py-2 text-left">Contato</th>
                    <th className="px-3 py-2 text-left">Pedido / Status</th>
                    <th className="px-3 py-2 text-left">Entrega</th>
                    <th className="px-3 py-2 text-left">Pagamento</th>
                    <th className="px-3 py-2 text-left">Última mensagem</th>
                    <th className="px-3 py-2 text-left">Criado / Atualizado</th>
                    <th className="px-3 py-2 text-left">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o) => {
                    const stale = isStaleOrder(o);
                    const staleHint = formatStaleDuration(o);

                    const itensResumo =
                      Array.isArray(o.items) && o.items.length > 0
                        ? o.items
                            .slice(0, 2)
                            .map((i) => `${i.quantity ?? 1}x ${i.name}`)
                            .join(", ") +
                          (o.items.length > 2
                            ? ` (+${o.items.length - 2})`
                            : "")
                        : "Sem itens estruturados";

                    const paymentTimingLabel = labelTiming(o.paymentTiming);
                    const paymentMethodLabel = labelPaymentMethod(
                      o.payment?.method ?? null
                    );
                    const deliveryLabel = labelDeliveryMode(o.delivery?.mode);

                    const created = o.createdAt
                      ? new Date(o.createdAt)
                      : null;
                    const updated = o.updatedAt
                      ? new Date(o.updatedAt)
                      : null;

                    const isBusy = mutatingId === o.id;

                    const isAguardandoValidacao =
                      o.status === "aguardando_preparo";

                    return (
                      <tr
                        key={o.id}
                        className={`border-b border-slate-100 ${
                          stale ? "bg-amber-50" : "bg-white"
                        }`}
                      >
                        <td className="px-3 py-2 text-[11px] text-slate-600">
                          {o.id}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          <div>{o.identifier}</div>
                          <div className="text-[11px] text-slate-500">
                            {o.channel}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          <div className="mb-1">
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-800">
                              {labelStatus(o.status)}
                            </span>
                            {isAguardandoValidacao && (
                              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                                A validar
                              </span>
                            )}
                          </div>
                          {stale && (
                            <div className="text-[11px] font-semibold text-amber-700">
                              {staleHint}
                            </div>
                          )}
                          <div className="mt-1 text-[11px] text-slate-700">
                            {itensResumo}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          {deliveryLabel}
                        </td>
                        <td className="px-3 py-2 text-xs text-slate-700">
                          <div>{paymentTimingLabel}</div>
                          <div className="text-[11px] text-slate-500">
                            {paymentMethodLabel}
                          </div>
                          {o.payment?.changeFor != null && (
                            <div className="text-[11px] text-slate-500">
                              Troco para{" "}
                              {o.payment.changeFor.toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-700">
                          <div className="line-clamp-3 max-w-xs">
                            {o.lastMessage || "-"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-600">
                          <div>
                            Criado:{" "}
                            {created
                              ? created.toLocaleString("pt-BR")
                              : "-"}
                          </div>
                          <div>
                            Atualizado:{" "}
                            {updated
                              ? updated.toLocaleString("pt-BR")
                              : "-"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[11px] text-slate-700">
                          <div className="flex flex-col gap-1">
                            {o.status === "aguardando_preparo" && (
                              <>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    updateOrderStatus(
                                      o,
                                      "em_preparo",
                                      true
                                    )
                                  }
                                  className="rounded-md bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                                >
                                  {isBusy
                                    ? "Confirmando..."
                                    : "Confirmar pedido"}
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    updateOrderStatus(
                                      o,
                                      "cancelado",
                                      false
                                    )
                                  }
                                  className="rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50"
                                >
                                  {isBusy
                                    ? "Cancelando..."
                                    : "Cancelar"}
                                </button>
                              </>
                            )}

                            {o.status === "em_preparo" && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  updateOrderStatus(
                                    o,
                                    "pronto",
                                    false
                                  )
                                }
                                className="rounded-md bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                              >
                                {isBusy
                                  ? "Atualizando..."
                                  : "Marcar como pronto"}
                              </button>
                            )}

                            {o.status === "pronto" && (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  updateOrderStatus(
                                    o,
                                    "concluido",
                                    false
                                  )
                                }
                                className="rounded-md bg-slate-700 px-2 py-1 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                              >
                                {isBusy
                                  ? "Concluindo..."
                                  : "Marcar como concluído"}
                              </button>
                            )}

                            {o.status === "concluido" && (
                              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">
                                Finalizado
                              </span>
                            )}

                            {o.status === "cancelado" && (
                              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                                Cancelado
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}