// src/app/clientes/[clientId]/budget/page.tsx
// Canonical V1: /clientes/[clientId]/budget
// Operational UI around LLM budget (policy + current status).

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type OverLimitMode = "degrade" | "block";

type BudgetPolicy = {
  monthlyTokenLimit: number;
  overLimitMode: OverLimitMode;
};

type BudgetStatus = {
  ok?: boolean;
  error?: string;
  message?: string;
  decision?: {
    action?: "allow" | "degrade" | "block";
    overLimit?: boolean;
    usagePct?: number;
    severity?: "none" | "warn" | "error";
    message?: string;
    thresholds?: { warnPct: number; blockPct: number };
    snapshot?: { usedTokens: number; limitTokens: number; remainingTokens: number; monthKey: string };
    policy?: BudgetPolicy;
  };
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

function pct(n: number | null | undefined) {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  return `${Math.round(n)}%`;
}

function fmtInt(n: number | null | undefined) {
  if (typeof n !== "number" || !isFinite(n)) return "-";
  try {
    return new Intl.NumberFormat("pt-BR").format(Math.trunc(n));
  } catch {
    return String(Math.trunc(n));
  }
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
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export default function ClientBudgetPage() {
  const params = useParams<{ clientId: string }>();
  const clientId = decodeURIComponent(params?.clientId || "");

  const [context, setContext] = useState<"inbound" | "campaign">("inbound");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<BudgetStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Policy editor state
  const [policy, setPolicy] = useState<BudgetPolicy | null>(null);
  const [policyDirty, setPolicyDirty] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [policyMsg, setPolicyMsg] = useState<string | null>(null);

  const statusUrl = useMemo(() => {
    const qs = new URLSearchParams({ clientId, context });
    return `/api/admin/llm-budget-status?${qs.toString()}`;
  }, [clientId, context]);

  const policyUrl = useMemo(() => {
    return `/api/admin/llm-budget/${encodeURIComponent(clientId)}`;
  }, [clientId]);

  async function refreshStatus() {
    setLoading(true);
    setError(null);
    try {
      const { res, data } = await fetchJson(statusUrl);
      setStatus(data);
      if (!res.ok) {
        const msg =
          typeof data?.message === "string"
            ? data.message
            : `Falha ao carregar status (${res.status}).`;
        setError(msg);
      }
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  async function loadPolicy() {
    setPolicyMsg(null);
    try {
      const { res, data } = await fetchJson(policyUrl);
      if (!res.ok) return;
      const p = data?.policy;
      if (p && typeof p === "object") {
        const monthlyTokenLimit = Number((p as any).monthlyTokenLimit);
        const overLimitModeRaw = String((p as any).overLimitMode || "degrade").trim();
        const overLimitMode: OverLimitMode = overLimitModeRaw === "block" ? "block" : "degrade";
        if (isFinite(monthlyTokenLimit) && monthlyTokenLimit > 0) {
          setPolicy({ monthlyTokenLimit: Math.trunc(monthlyTokenLimit), overLimitMode });
          setPolicyDirty(false);
        }
      }
    } catch {
      // ignore
    }
  }

  async function savePolicy() {
    if (!policy) return;
    setPolicySaving(true);
    setPolicyMsg(null);
    try {
      const payload = {
        monthlyTokenLimit: Math.max(1, Math.trunc(policy.monthlyTokenLimit || 0)),
        overLimitMode: policy.overLimitMode,
      };
      const { res, data } = await fetchJson(policyUrl, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg =
          typeof data?.error === "string"
            ? data.error
            : `Falha ao salvar política (${res.status}).`;
        setPolicyMsg(msg);
        return;
      }
      setPolicyDirty(false);
      setPolicyMsg("Política salva.");
      // re-sync status immediately
      await refreshStatus();
      await loadPolicy();
    } catch (e: any) {
      setPolicyMsg(String(e?.message || e));
    } finally {
      setPolicySaving(false);
    }
  }

  useEffect(() => {
    // client-only: avoids SSR calling admin APIs without cookies.
    loadPolicy().finally(() => refreshStatus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    refreshStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusUrl]);

  const snap = status?.snapshot;
  const banner =
    error ||
    (status?.error === "admin_unauthorized"
      ? status.message || "Acesso negado."
      : null);

  const used = typeof snap?.usedTotalTokens === "number" ? snap.usedTotalTokens : null;
  const limit = typeof snap?.monthlyTokenLimit === "number" ? snap.monthlyTokenLimit : null;
  const remain =
    typeof used === "number" && typeof limit === "number" ? Math.max(-999999999, limit - used) : null;

  return (
    <main style={{ padding: "24px", maxWidth: 1100, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: "1.5rem" }}>Budget • {clientId}</h1>
          <p style={{ marginTop: 6, color: "#555" }}>
            Governança de consumo de IA por clientId (política + status do mês).
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <a
            href={`/clientes/${encodeURIComponent(clientId)}/painel`}
            style={{ padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, textDecoration: "none" }}
          >
            Painel
          </a>
          <a
            href={`/clientes/${encodeURIComponent(clientId)}/chat`}
            style={{ padding: "8px 10px", border: "1px solid #ccc", borderRadius: 6, textDecoration: "none" }}
          >
            Chat
          </a>
        </div>
      </div>

      {banner && (
        <div
          style={{
            marginTop: 14,
            border: "1px solid #f3b4b4",
            background: "#fff1f1",
            padding: 12,
            borderRadius: 8,
            color: "#b00020",
          }}
        >
          <strong>Erro</strong>
          <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{banner}</div>
          {String(status?.error || "") === "admin_unauthorized" && (
            <div style={{ marginTop: 6 }}>
              Faça login como admin em <a href="/login">/login</a>.
            </div>
          )}
        </div>
      )}

      {/* Policy editor */}
      <div
        style={{
          marginTop: 16,
          border: "1px solid #e5e5e5",
          borderRadius: 8,
          padding: 12,
          background: "#fff",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Política</h2>
        <p style={{ marginTop: 6, color: "#555" }}>
          Define o limite mensal (tokens = créditos) e o que acontece ao chegar em 100%.
        </p>

        <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ fontWeight: 600 }}>Limite mensal (tokens)</label>
          <input
            type="number"
            value={policy?.monthlyTokenLimit ?? ""}
            onChange={(e) => {
              const v = Number(e.target.value);
              setPolicy((p) => ({
                monthlyTokenLimit: isFinite(v) ? Math.max(1, Math.trunc(v)) : 1,
                overLimitMode: (p?.overLimitMode || "degrade") as OverLimitMode,
              }));
              setPolicyDirty(true);
            }}
            style={{ padding: "8px 10px", width: 220 }}
            min={1}
          />

          <label style={{ fontWeight: 600 }}>Ao atingir 100%</label>
          <select
            value={policy?.overLimitMode ?? "degrade"}
            onChange={(e) => {
              const v = (e.target.value === "block" ? "block" : "degrade") as OverLimitMode;
              setPolicy((p) => ({
                monthlyTokenLimit: p?.monthlyTokenLimit || 250000,
                overLimitMode: v,
              }));
              setPolicyDirty(true);
            }}
            style={{ padding: "8px 10px" }}
          >
            <option value="degrade">Degradar (sem LLM)</option>
            <option value="block">Bloquear automação</option>
          </select>

          <button
            onClick={savePolicy}
            disabled={!policy || !policyDirty || policySaving}
            style={{ padding: "8px 10px" }}
          >
            {policySaving ? "Salvando..." : "Salvar"}
          </button>

          <button
            onClick={() => {
              setPolicyMsg(null);
              loadPolicy();
            }}
            disabled={policySaving}
            style={{ padding: "8px 10px" }}
          >
            Recarregar
          </button>
        </div>

        {policyMsg && (
          <div style={{ marginTop: 10, color: policyMsg === "Política salva." ? "#0b6b2e" : "#b00020" }}>
            {policyMsg}
          </div>
        )}
      </div>

      {/* Status */}
      <div style={{ marginTop: 16, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ fontWeight: 600 }}>Contexto</label>
        <select value={context} onChange={(e) => setContext(e.target.value as any)} style={{ padding: "8px 10px" }}>
          <option value="inbound">inbound</option>
          <option value="campaign">campaign</option>
        </select>
        <button onClick={refreshStatus} disabled={loading} style={{ padding: "8px 10px" }}>
          {loading ? "Atualizando..." : "Atualizar"}
        </button>
      </div>

      <div style={{ marginTop: 16, border: "1px solid #e5e5e5", borderRadius: 8, padding: 12, background: "#fff" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>Status do mês</h2>

        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 16 }}>
          <div>
            <strong>Mês</strong>
            <div>{snap?.monthKey || "-"}</div>
          </div>
          <div>
            <strong>Limite</strong>
            <div>{typeof snap?.monthlyTokenLimit === "number" ? fmtInt(snap.monthlyTokenLimit) : "-"}</div>
          </div>
          <div>
            <strong>Usado</strong>
            <div>{typeof snap?.usedTotalTokens === "number" ? fmtInt(snap.usedTotalTokens) : "-"}</div>
          </div>
          <div>
            <strong>Restante</strong>
            <div>{typeof remain === "number" ? fmtInt(remain) : "-"}</div>
          </div>
          <div>
            <strong>%</strong>
            <div>{pct(typeof snap?.ratioUsed === "number" ? snap.ratioUsed * 100 : null)}</div>
          </div>
          <div>
            <strong>Decisão</strong>
            <div>{snap?.decision || "-"}</div>
          </div>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer" }}>Detalhes (JSON)</summary>
          <pre style={{ whiteSpace: "pre-wrap", marginTop: 10 }}>{prettyJson(status)}</pre>
        </details>
      </div>
    </main>
  );
}
