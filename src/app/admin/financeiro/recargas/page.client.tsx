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

export default function AdminRecargasClient() {
  const [items, setItems] = useState<Item[]>([]);
  const [status, setStatus] = useState<string>("pending");
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
      const data = await apiGet(`${baseUrl}/api/admin/billing/topup-requests?status=${encodeURIComponent(status)}&limit=100`);
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

  async function processTopup(it: Item) {
    const credits = prompt("Quantos creditos conceder para esta recarga?", "200000");
    if (!credits) return;
    const creditsGranted = Math.trunc(Number(credits));
    if (!Number.isFinite(creditsGranted) || creditsGranted <= 0) {
      alert("Valor invalido");
      return;
    }

    const amount = prompt("Valor pago (R$) - opcional", "");
    let amountCents: number | null = null;
    if (amount && amount.trim()) {
      const n = Number(String(amount).replace(",", "."));
      if (Number.isFinite(n) && n >= 0) amountCents = Math.trunc(n * 100);
    }

    const notes = prompt("Observacao/Referencia (PIX, invoice, etc) - opcional", "") || "";

    setLoading(true);
    setErr(null);
    try {
      await apiPost(`${baseUrl}/api/admin/billing/topup-requests/${encodeURIComponent(it.id)}/approve`, {
        creditsGranted,
        amountCents,
        currency: "BRL",
        notes: notes || null,
      });
      await refresh();
      alert("Recarga aplicada com sucesso.");
    } catch (e: any) {
      setErr(String(e?.message || e));
      alert(`Erro: ${String(e?.message || e)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Solicitacoes de recarga</h1>
      <p style={{ marginBottom: 16, opacity: 0.8 }}>
        Aqui voce processa pagamento e concede creditos. Isso libera imediatamente o uso do assistente (evita bloqueio/degrade por limite).
      </p>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <label style={{ opacity: 0.8 }}>Status</label>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: 6, borderRadius: 6 }}>
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
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
        <div style={{ display: "grid", gridTemplateColumns: "220px 280px 160px 220px", gap: 0, padding: 10, fontWeight: 700, borderBottom: "1px solid #333" }}>
          <div>Quando</div>
          <div>Cliente</div>
          <div>Status</div>
          <div>Acao</div>
        </div>

        {items.length === 0 ? (
          <div style={{ padding: 12, opacity: 0.8 }}>Nenhuma solicitacao.</div>
        ) : (
          items.map((it) => (
            <div key={it.id} style={{ display: "grid", gridTemplateColumns: "220px 280px 160px 220px", padding: 10, borderBottom: "1px solid #222", alignItems: "center" }}>
              <div>{String(it.requested_at || "").replace("T", " ").slice(0, 19)}</div>
              <div style={{ fontFamily: "monospace" }}>{it.client_id}</div>
              <div>{it.status}</div>
              <div>
                {it.status === "pending" ? (
                  <button onClick={() => processTopup(it)} disabled={loading} style={{ padding: "6px 10px", borderRadius: 6 }}>
                    Conceder creditos
                  </button>
                ) : (
                  <span style={{ opacity: 0.7 }}>-</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
