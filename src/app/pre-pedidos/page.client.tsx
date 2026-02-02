"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

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
  publicId?: string | null;
  status: PreorderStatus;
  createdAt?: string;
  updatedAt?: string;
  expiresAt?: string | null;
  note?: string | null;
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

function safeLower(s: unknown): string {
  return typeof s === "string" ? s.toLowerCase() : "";
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

export default function PageClient() {
  const searchParams = useSearchParams();
  const clientId = useMemo(() => (searchParams.get("clientId") || "").trim(), [searchParams]);

  const [statusFilter, setStatusFilter] = useState<"open" | "all" | PreorderStatus>("open");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [preorders, setPreorders] = useState<Preorder[]>([]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return preorders;
    if (statusFilter === "open") {
      return preorders.filter(
        (p) => p.status === "draft" || p.status === "awaiting_human_confirmation"
      );
    }
    return preorders.filter((p) => p.status === statusFilter);
  }, [preorders, statusFilter]);

  async function load() {
    try {
      if (!clientId) {
        setPreorders([]);
        return;
      }
      setLoading(true);
      setError(null);

      const url = new URL(`/api/clients/${clientId}/preorders`, window.location.origin);
      // Quando filtro for um status específico, usa a API já otimizada por status
      if (statusFilter !== "open" && statusFilter !== "all") {
        url.searchParams.set("status", statusFilter);
      }

      const res = await fetch(url.toString(), { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Falha ao carregar pré-pedidos.");

      const list = Array.isArray(data?.preorders) ? data.preorders : [];
      setPreorders(list);
    } catch (e) {
      setError(getErrorMessage(e) || "Erro ao carregar pré-pedidos.");
      setPreorders([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Recarrega quando o filtro usa o endpoint por status.
  useEffect(() => {
    if (!clientId) return;
    if (statusFilter === "open" || statusFilter === "all") return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            Pré-pedidos
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Lista e triagem de pré-pedidos por cliente.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label className="text-sm text-slate-700 dark:text-slate-200">Filtro</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm text-slate-800 shadow-sm
                       focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                       dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
          >
            <option value="open">Abertos (rascunho/aguardando)</option>
            <option value="all">Todos</option>
            <option value="draft">Rascunho</option>
            <option value="awaiting_human_confirmation">Aguardando confirmação humana</option>
            <option value="confirmed">Confirmado</option>
            <option value="cancelled">Cancelado</option>
            <option value="expired">Expirado</option>
          </select>

          <button
            onClick={() => void load()}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm
                       hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Atualizar
          </button>
        </div>
      </div>

      {!clientId ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
          Selecione um cliente no topo (ClientSelector) para ver os pré-pedidos.
        </div>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
            <div className="text-sm text-slate-600 dark:text-slate-300">
              Cliente: <span className="font-mono text-slate-900 dark:text-slate-100">{clientId}</span>
            </div>
            <div className="text-sm text-slate-600 dark:text-slate-300">
              {loading ? "Carregando..." : `${filtered.length} item(ns)`}
            </div>
          </div>

          {error ? (
            <div className="px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600 dark:bg-slate-950 dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3">Pedido</th>
                  <th className="px-4 py-3">Contato</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expira</th>
                  <th className="px-4 py-3">Atualizado</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {p.publicId || "-"}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        {p.identifier || "-"}
                      </div>
                      <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{p.id}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 dark:text-slate-200">
                      {p.contactId}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          "inline-flex rounded-full px-2 py-0.5 text-xs font-medium " +
                          (p.status === "confirmed"
                            ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
                            : p.status === "cancelled" || p.status === "expired"
                            ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200"
                            : "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200")
                        }
                      >
                        {statusLabel(p.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">{fmtIso(p.expiresAt)}</td>
                    <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                      {fmtIso(p.updatedAt || p.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/pre-pedidos/${encodeURIComponent(p.id)}?clientId=${encodeURIComponent(
                          clientId
                        )}`}
                        className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50
                                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                      >
                        Abrir
                      </a>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-sm text-slate-600 dark:text-slate-300">
                      Nenhum pré-pedido encontrado para este filtro.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
