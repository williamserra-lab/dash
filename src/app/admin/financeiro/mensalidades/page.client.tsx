"use client";

import React, { useEffect, useMemo, useState } from "react";

type Item = any;

async function apiGet(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

async function apiPost(url: string, body: any): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
  return json;
}

function formatMoneyCents(amountCents: any, currency: string): string {
  const n = Number(amountCents || 0);
  const c = (currency || "BRL").toUpperCase();
  if (c === "BRL") {
    return `R$ ${(n / 100).toFixed(2)}`.replace(".", ",");
  }
  return `${c} ${(n / 100).toFixed(2)}`;
}

export default function AdminMensalidadesClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<string>("open,overdue");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const baseUrl = useMemo(() => {
    const b = (process.env.NEXT_PUBLIC_BASE_URL || "").trim();
    return b || "";
  }, []);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiGet(`${baseUrl}/api/admin/billing/invoices?status=${encodeURIComponent(status)}&limit=200`);
      setItems(data?.items || []);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function markPaid(it: Item) {
    if (!confirm(`Marcar invoice ${it.id} como PAGA?`)) return;
    setLoading(true);
    setErr(null);
    try {
      await apiPost(`${baseUrl}/api/admin/billing/invoices/${encodeURIComponent(it.id)}/pay`, {});
      await refresh();
      alert("Mensalidade marcada como paga.");
    } catch (e: any) {
      setErr(String(e?.message || e));
      alert(`Erro: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Mensalidades (Invoices)</h1>
      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        Lista de invoices do ciclo atual. Ao marcar como pago, o cliente volta para <b>active</b> (remove grace/suspended).
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <label style={{ opacity: 0.8 }}>Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: 6, borderRadius: 6 }}>
          <option value="open,overdue">open + overdue</option>
          <option value="open">open</option>
          <option value="overdue">overdue</option>
          <option value="paid">paid</option>
          <option value="all">all</option>
        </select>
        <button onClick={refresh} style={{ padding: "6px 10px", borderRadius: 6 }} disabled={loading}>
          Recarregar
        </button>
        {loading ? <span style={{ opacity: 0.7 }}>Carregando...</span> : null}
      </div>

      {err ? (
        <div style={{ padding: 10, background: "#2a0000", border: "1px solid #550000", borderRadius: 8, marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Erro</div>
          <div style={{ fontFamily: "monospace", whiteSpace: "pre-wrap" }}>{err}</div>
        </div>
      ) : null}

      <div style={{ border: "1px solid #333", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "220px 260px 140px 160px 220px", gap: 0, padding: 10, fontWeight: 700, borderBottom: "1px solid #333" }}>
          <div>Vencimento</div>
          <div>Cliente</div>
          <div>Status</div>
          <div>Valor</div>
          <div>Ação</div>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Nenhuma invoice.</div>
        ) : (
          items.map((it) => (
            <div key={it.id} style={{ display: "grid", gridTemplateColumns: "220px 260px 140px 160px 220px", padding: 10, borderBottom: "1px solid #222", alignItems: "center" }}>
              <div>{String(it.due_date || "").replace("T", " ").slice(0, 19)}</div>
              <div style={{ fontFamily: "monospace" }}>{it.client_id}</div>
              <div>{it.status}</div>
              <div>{formatMoneyCents(it.amount_cents, it.currency)}</div>
              <div>
                {it.status !== "paid" ? (
                  <button onClick={() => markPaid(it)} disabled={loading} style={{ padding: "6px 10px", borderRadius: 6 }}>
                    Marcar pago
                  </button>
                ) : (
                  <span style={{ opacity: 0.7 }}>Pago em {String(it.paid_at || "").replace("T", " ").slice(0, 19)}</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
