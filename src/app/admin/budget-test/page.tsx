"use client";

import React, { useEffect, useMemo, useState } from "react";

type BudgetStatus = {
  ok?: boolean;
  error?: string;
  message?: string;
  snapshot?: {
    clientId: string;
    monthKey: string;
    monthlyTokenLimit: number | null;
    usedTotalTokens: number;
    ratioUsed: number;
    decision: "allow" | "degrade" | "block";
    thresholdDegrade: number;
    thresholdBlock: number;
    context?: string;
  };
  usage?: any;
  contextTotals?: any;
  breakdown?: any;
};

type ClientItem = { id: string; name?: string };

function pct(n: number | null | undefined) {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  return `${Math.round(n * 100)}%`;
}

function prettyJson(obj: any) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return String(obj);
  }
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    ...init,
    // make cookie behavior explicit; avoids SSR/edge confusion and proxies
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export default function BudgetTestPage() {
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [clientId, setClientId] = useState<string>("loja_teste");
  const [context, setContext] = useState<"inbound" | "campaign">("inbound");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusUrl = useMemo(() => {
    const qs = new URLSearchParams({ clientId, context });
    return `/api/admin/llm-budget-status?${qs.toString()}`;
  }, [clientId, context]);

  async function loadClients() {
    // This endpoint already exists in the app and is protected by admin.
    // If it fails, we still allow manual clientId input.
    const { res, data } = await fetchJson("/api/clients");
    if (!res.ok) return;
    const items = Array.isArray(data) ? data : data?.clients;
    if (Array.isArray(items)) {
      const mapped = items
        .map((c: any) => ({ id: String(c.id || c.clientId || "").trim(), name: c.name }))
        .filter((c: any) => c.id);
      setClients(mapped);
      if (mapped.find((c) => c.id === clientId) == null && mapped.length > 0) {
        setClientId(mapped[0].id);
      }
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const { res, data } = await fetchJson(statusUrl);
      if (!res.ok) {
        const msg =
          typeof data?.message === "string"
            ? data.message
            : `Falha ao carregar status (${res.status}).`;
        setStatus(data);
        setError(msg);
        return;
      }
      setStatus(data);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function resetMonth() {
    setLoading(true);
    setError(null);
    try {
      const { res, data } = await fetchJson(`/api/admin/llm-usage/${encodeURIComponent(clientId)}`, {
        method: "POST",
        body: JSON.stringify({ resetMonth: true }),
      });
      if (!res.ok) {
        const msg = typeof data?.message === "string" ? data.message : `Reset falhou (${res.status}).`;
        setStatus(data);
        setError(msg);
        return;
      }
      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function simulate(targetPct: 79 | 84 | 104) {
    setLoading(true);
    setError(null);
    try {
      // Step 1: read current status to compute delta safely
      const { res: sRes, data: sData } = await fetchJson(statusUrl);
      if (!sRes.ok) {
        const msg = typeof sData?.message === "string" ? sData.message : `Falha ao ler status (${sRes.status}).`;
        setStatus(sData);
        setError(msg);
        return;
      }
      const snap = sData?.snapshot;
      const limit = snap?.monthlyTokenLimit;
      const used = snap?.usedTotalTokens;

      if (typeof limit !== "number" || !isFinite(limit) || limit <= 0) {
        setStatus(sData);
        setError("monthlyTokenLimit não configurado para este cliente.");
        return;
      }
      const currentUsed = typeof used === "number" && isFinite(used) ? used : 0;
      const targetUsed = Math.round((targetPct / 100) * limit);
      const delta = Math.max(0, targetUsed - currentUsed);

      // Step 2: add usage delta
      const { res, data } = await fetchJson(`/api/admin/llm-usage/${encodeURIComponent(clientId)}`, {
        method: "POST",
        body: JSON.stringify({
          context,
          add: { totalTokens: delta, provider: "sim", model: "sim" },
        }),
      });

      if (!res.ok) {
        const msg = typeof data?.message === "string" ? data.message : `Simulação falhou (${res.status}).`;
        setStatus(data);
        setError(msg);
        return;
      }

      await refresh();
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // client-only: avoids SSR calling admin APIs without cookies.
    loadClients().finally(() => refresh());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snap = status?.snapshot;

  const banner =
    error ||
    (status?.error === "admin_unauthorized"
      ? status.message || "Acesso negado."
      : null);

  const decision = snap?.decision || "-";
  const ratio = snap?.ratioUsed;

  return (
    <main style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Admin • Budget Test (UI básica)</h1>
          <p style={{ marginTop: 6, color: "#555" }}>
            Tela descartável para simular consumo de tokens e validar thresholds (80% / 100%) via navegador.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <a href="/admin-login" style={{ padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, textDecoration: "none" }}>
            Admin Login
          </a>
          <a href="/clientes" style={{ padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, textDecoration: "none" }}>
            Clientes (limite/política)
          </a>
        </div>
      </div>

      {banner && (
        <div style={{ marginTop: 14, border: "1px solid #f3b4b4", background: "#fff1f1", padding: 12, borderRadius: 8, color: "#b00020" }}>
          <strong>Erro</strong>
          <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{banner}</div>
          {String(status?.error || "") === "admin_unauthorized" && (
            <div style={{ marginTop: 6 }}>
              Se você acabou de logar, clique em <a href="/admin-login">/admin-login</a> e volte para esta página.
            </div>
          )}
        </div>
      )}

      <section style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 12, alignItems: "end" }}>
          <div>
            <label style={{ display: "block", fontSize: 12, color: "#555" }}>Client</label>
            {clients.length > 0 ? (
              <select value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "100%", padding: "8px" }}>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name ? `${c.name} (${c.id})` : c.id}
                  </option>
                ))}
              </select>
            ) : (
              <input value={clientId} onChange={(e) => setClientId(e.target.value)} style={{ width: "100%", padding: "8px" }} />
            )}
            <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>{clients.length} cliente(s)</div>
          </div>

          <div>
            <label style={{ display: "block", fontSize: 12, color: "#555" }}>Contexto de decisão</label>
            <select value={context} onChange={(e) => setContext(e.target.value as any)} style={{ width: "100%", padding: "8px" }}>
              <option value="inbound">inbound (degrade em 80%)</option>
              <option value="campaign">campaign (block em 100%)</option>
            </select>
            <div style={{ marginTop: 6, fontSize: 12, color: "#777" }}>
              Contexto afeta a decisão (ex.: campaign não degrada em 80%).
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={refresh} disabled={loading} style={{ padding: "8px 12px" }}>
              Atualizar status
            </button>
            <button onClick={resetMonth} disabled={loading} style={{ padding: "8px 12px" }}>
              Reset mês
            </button>
          </div>
        </div>

        <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => simulate(79)} disabled={loading} style={{ padding: "8px 12px" }}>
            Simular 79%
          </button>
          <button onClick={() => simulate(84)} disabled={loading} style={{ padding: "8px 12px" }}>
            Simular 84%
          </button>
          <button onClick={() => simulate(104)} disabled={loading} style={{ padding: "8px 12px" }}>
            Simular 104%
          </button>
        </div>
      </section>

      <section style={{ marginTop: 16, border: "1px solid #ddd", borderRadius: 10, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Status (policy engine)</h2>
          <div style={{ fontSize: 12, color: "#777" }}>Fonte: {statusUrl}</div>
        </div>

        <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(4, minmax(160px, 1fr))", gap: 10 }}>
          <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12, color: "#777" }}>Decisão</div>
            <div style={{ fontSize: 22, fontWeight: 700 }}>{decision}</div>
          </div>
          <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12, color: "#777" }}>Uso</div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {typeof snap?.usedTotalTokens === "number" ? snap.usedTotalTokens : "-"} /{" "}
              {typeof snap?.monthlyTokenLimit === "number" ? snap.monthlyTokenLimit : "-"}
            </div>
            <div style={{ fontSize: 12, color: "#777" }}>{pct(ratio)}</div>
          </div>
          <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12, color: "#777" }}>Thresholds</div>
            <div style={{ fontSize: 14 }}>
              degrade: {snap?.thresholdDegrade ?? "-"} | block: {snap?.thresholdBlock ?? "-"}
            </div>
          </div>
          <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10 }}>
            <div style={{ fontSize: 12, color: "#777" }}>Mês</div>
            <div style={{ fontSize: 14 }}>{snap?.monthKey ?? "-"}</div>
          </div>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary>JSON bruto</summary>
          <pre style={{ marginTop: 8, background: "#f7f7f7", padding: 12, borderRadius: 8, overflow: "auto" }}>
            {prettyJson(status)}
          </pre>
        </details>
      </section>
    </main>
  );
}