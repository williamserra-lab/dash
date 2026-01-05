"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type PreorderStatus =
  | "draft"
  | "awaiting_human_confirmation"
  | "confirmed"
  | "cancelled"
  | "expired";

type Preorder = {
  id: string;
  clientId: string;
  contactId: string;
  identifier: string;
  status: PreorderStatus;
  items?: any;
  delivery?: any;
  payment?: any;
  expiresAt?: string | null;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type PreorderEvent = {
  id: string;
  preorderId: string;
  clientId: string;
  action: string;
  actor?: string | null;
  note?: string | null;
  reason?: string | null;
  data?: any;
  createdAt?: string;
};

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

function fmtIso(iso?: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

function statusLabel(s: PreorderStatus): string {
  switch (s) {
    case "draft":
      return "Rascunho";
    case "awaiting_human_confirmation":
      return "Aguardando confirmação humana";
    case "confirmed":
      return "Confirmado";
    case "cancelled":
      return "Cancelado";
    case "expired":
      return "Expirado";
    default:
      return s;
  }
}

export default function PageClient({ preorderId }: { preorderId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = useMemo(() => (searchParams.get("clientId") || "").trim(), [searchParams]);

  const [loading, setLoading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preorder, setPreorder] = useState<Preorder | null>(null);
  const [events, setEvents] = useState<PreorderEvent[]>([]);

  // Edit form (mínimo)
  const [identifier, setIdentifier] = useState("");
  const [note, setNote] = useState("");
  const [itemsJson, setItemsJson] = useState("");
  const [deliveryJson, setDeliveryJson] = useState("");
  const [paymentJson, setPaymentJson] = useState("");

  const canMutate = Boolean(clientId) && Boolean(preorderId);

  async function load() {
    try {
      if (!clientId) {
        setPreorder(null);
        setEvents([]);
        return;
      }

      setLoading(true);
      setError(null);

      const [preRes, evRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/preorders/${encodeURIComponent(preorderId)}`, { cache: "no-store" }),
        fetch(`/api/clients/${clientId}/preorders/${encodeURIComponent(preorderId)}/events`, { cache: "no-store" }),
      ]);

      const preData = await preRes.json().catch(() => ({}));
      if (!preRes.ok) throw new Error(preData?.error || "Falha ao carregar pré-pedido.");

      const evData = await evRes.json().catch(() => ({}));
      if (!evRes.ok) throw new Error(evData?.error || "Falha ao carregar eventos.");

      const p = preData?.preorder || null;
      setPreorder(p);

      const list = Array.isArray(evData?.events) ? evData.events : [];
      setEvents(list);

      if (p) {
        setIdentifier(p.identifier || "");
        setNote(p.note || "");
        setItemsJson(p.items ? JSON.stringify(p.items, null, 2) : "");
        setDeliveryJson(p.delivery ? JSON.stringify(p.delivery, null, 2) : "");
        setPaymentJson(p.payment ? JSON.stringify(p.payment, null, 2) : "");
      }
    } catch (e) {
      setError(getErrorMessage(e) || "Erro ao carregar pré-pedido.");
      setPreorder(null);
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, preorderId]);

  async function setStatus(status: PreorderStatus, noteText: string | null) {
    if (!canMutate) return;
    try {
      setMutating(true);
      setError(null);

      const res = await fetch(
        `/api/clients/${clientId}/preorders/${encodeURIComponent(preorderId)}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            actor: "human",
            note: noteText,
          }),
        }
      );

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Falha ao alterar status.");

      setPreorder(data?.preorder || null);
      await load();
    } catch (e) {
      setError(getErrorMessage(e) || "Erro ao alterar status.");
    } finally {
      setMutating(false);
    }
  }

  async function saveEdits(e: FormEvent) {
    e.preventDefault();
    if (!canMutate) return;

    try {
      setMutating(true);
      setError(null);

      let items: any = undefined;
      let delivery: any = undefined;
      let payment: any = undefined;

      if (itemsJson.trim()) items = JSON.parse(itemsJson);
      if (deliveryJson.trim()) delivery = JSON.parse(deliveryJson);
      if (paymentJson.trim()) payment = JSON.parse(paymentJson);

      const res = await fetch(`/api/clients/${clientId}/preorders/${encodeURIComponent(preorderId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier,
          note,
          items,
          delivery,
          payment,
          actor: "human",
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Falha ao salvar alterações.");

      setPreorder(data?.preorder || null);
      await load();
    } catch (e) {
      const msg = getErrorMessage(e) || "Erro ao salvar alterações.";
      // Ajuda quando JSON é inválido
      setError(msg);
    } finally {
      setMutating(false);
    }
  }

  const status = preorder?.status;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <a
              href={`/pre-pedidos?clientId=${encodeURIComponent(clientId || "")}`}
              className="text-sm font-medium text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100"
            >
              ← Voltar
            </a>
          </div>
          <h1 className="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Pré-pedido {preorderId}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Detalhe, ações humanas e auditoria (eventos).
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void load()}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Atualizar
          </button>
          <button
            onClick={() => router.refresh()}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Recarregar UI
          </button>
        </div>
      </div>

      {!clientId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          clientId ausente. Volte e selecione um cliente no topo.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm text-slate-600 dark:text-slate-300">
              Cliente: <span className="font-mono text-slate-900 dark:text-slate-100">{clientId}</span>
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300">
              Status:{" "}
              <span className="font-medium text-slate-900 dark:text-slate-100">
                {status ? statusLabel(status) : "-"}
              </span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Identificador
              </div>
              <div className="mt-1 text-slate-900 dark:text-slate-100">{preorder?.identifier || "-"}</div>
            </div>
            <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Contato
              </div>
              <div className="mt-1 font-mono text-xs text-slate-900 dark:text-slate-100">
                {preorder?.contactId || "-"}
              </div>
            </div>
            <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Expira em
              </div>
              <div className="mt-1 text-slate-900 dark:text-slate-100">{fmtIso(preorder?.expiresAt)}</div>
            </div>
            <div className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Atualizado em
              </div>
              <div className="mt-1 text-slate-900 dark:text-slate-100">
                {fmtIso(preorder?.updatedAt || preorder?.createdAt)}
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              disabled={mutating || !preorder || preorder.status === "confirmed"}
              onClick={() => void setStatus("confirmed", "Confirmado manualmente")}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Confirmar
            </button>
            <button
              disabled={mutating || !preorder || preorder.status === "cancelled"}
              onClick={() => void setStatus("cancelled", "Cancelado manualmente")}
              className="rounded-md bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              disabled={mutating || !preorder || preorder.status === "awaiting_human_confirmation"}
              onClick={() => void setStatus("awaiting_human_confirmation", "Aguardando confirmação humana")}
              className="rounded-md bg-amber-600 px-3 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Marcar como aguardando humano
            </button>
          </div>

          <div className="mt-6">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Editar (mínimo)</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              Edita identificador, nota e JSONs (itens/entrega/pagamento). Se deixar um campo JSON vazio, não altera.
            </p>

            <form onSubmit={saveEdits} className="mt-3 space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    Identificador
                  </label>
                  <input
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm
                               focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                               dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Nota</label>
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm
                               focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                               dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Itens (JSON)</label>
                  <textarea
                    value={itemsJson}
                    onChange={(e) => setItemsJson(e.target.value)}
                    rows={10}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm
                               focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                               dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Entrega (JSON)</label>
                  <textarea
                    value={deliveryJson}
                    onChange={(e) => setDeliveryJson(e.target.value)}
                    rows={10}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm
                               focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                               dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Pagamento (JSON)</label>
                  <textarea
                    value={paymentJson}
                    onChange={(e) => setPaymentJson(e.target.value)}
                    rows={10}
                    className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-900 shadow-sm
                               focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                               dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={mutating}
                className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {mutating ? "Salvando..." : "Salvar alterações"}
              </button>
            </form>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">Auditoria (eventos)</h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Log best-effort de alterações (26.3).
          </p>

          <div className="mt-3 space-y-3">
            {events.length === 0 ? (
              <div className="text-sm text-slate-600 dark:text-slate-300">Sem eventos.</div>
            ) : (
              events
                .slice()
                .reverse()
                .map((ev) => (
                  <div key={ev.id} className="rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium text-slate-900 dark:text-slate-100">{ev.action}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">{fmtIso(ev.createdAt)}</div>
                    </div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                      Actor: <span className="font-mono">{ev.actor || "-"}</span>
                      {ev.reason ? (
                        <>
                          {" "}
                          • Reason: <span className="font-mono">{ev.reason}</span>
                        </>
                      ) : null}
                    </div>
                    {ev.note ? (
                      <div className="mt-2 rounded bg-slate-50 p-2 text-xs text-slate-700 dark:bg-slate-950 dark:text-slate-200">
                        {ev.note}
                      </div>
                    ) : null}
                    {ev.data ? (
                      <pre className="mt-2 overflow-x-auto rounded bg-slate-950 p-2 text-xs text-slate-100">
                        {JSON.stringify(ev.data, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
