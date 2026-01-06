"use client";

import { useEffect, useMemo, useState } from "react";

type CorrelationItem = {
  correlationId: string;
  clientId?: string | null;
  lastSeenAt?: string | null;
  count?: number | null;
};

type EventItem = {
  id: string;
  type: string;
  occurredAt: string;
  clientId?: string | null;
  correlationId?: string | null;
  actor?: any;
  data?: any;
};

function safeString(v: unknown): string {
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export default function AuditPageClient() {
  const [clientId, setClientId] = useState<string>("");
  const [limit, setLimit] = useState<number>(50);
  const [correlations, setCorrelations] = useState<CorrelationItem[]>([]);
  const [selectedCorrelationId, setSelectedCorrelationId] = useState<string>("");
  const [timeline, setTimeline] = useState<EventItem[]>([]);
  const [loadingCorr, setLoadingCorr] = useState<boolean>(false);
  const [loadingTl, setLoadingTl] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  // Read defaults from URL on client only (avoids SSR window usage)
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const qClientId = url.searchParams.get("clientId") || "";
      const qCorrelationId = url.searchParams.get("correlationId") || "";
      if (qClientId) setClientId(qClientId);
      if (qCorrelationId) setSelectedCorrelationId(qCorrelationId);
    } catch {
      // ignore
    }
  }, []);

  const correlationsUrl = useMemo(() => {
    const qs = new URLSearchParams();
    if (clientId) qs.set("clientId", clientId);
    qs.set("limit", String(limit));
    return `/api/admin/audit/correlations?${qs.toString()}`;
  }, [clientId, limit]);

  const timelineUrl = useMemo(() => {
    if (!selectedCorrelationId) return "";
    const qs = new URLSearchParams();
    qs.set("correlationId", selectedCorrelationId);
    if (clientId) qs.set("clientId", clientId);
    qs.set("limit", "200");
    return `/api/admin/audit/timeline?${qs.toString()}`;
  }, [clientId, selectedCorrelationId]);

  async function loadCorrelations() {
    setError("");
    setLoadingCorr(true);
    try {
      const r = await fetch(correlationsUrl, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setCorrelations(Array.isArray(j) ? j : (j?.items ?? []));
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar correlações.");
      setCorrelations([]);
    } finally {
      setLoadingCorr(false);
    }
  }

  async function loadTimeline() {
    if (!timelineUrl) return;
    setError("");
    setLoadingTl(true);
    try {
      const r = await fetch(timelineUrl, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      setTimeline(Array.isArray(j) ? j : (j?.items ?? []));
    } catch (e: any) {
      setError(e?.message || "Falha ao carregar timeline.");
      setTimeline([]);
    } finally {
      setLoadingTl(false);
    }
  }

  useEffect(() => {
    loadCorrelations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [correlationsUrl]);

  useEffect(() => {
    if (selectedCorrelationId) loadTimeline();
    else setTimeline([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelineUrl]);

  return (
    <div style={{ padding: 24 }}>
      <h1>Admin · Auditoria</h1>

      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          clientId (opcional):{" "}
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="ex: nextia"
            style={{ padding: 6, width: 240 }}
          />
        </label>

        <label>
          limitar:{" "}
          <input
            type="number"
            value={limit}
            min={10}
            max={200}
            onChange={(e) => setLimit(Number(e.target.value || 50))}
            style={{ padding: 6, width: 90 }}
          />
        </label>

        <label style={{ flex: "1 1 auto", minWidth: 320 }}>
          correlationId:{" "}
          <input
            value={selectedCorrelationId}
            onChange={(e) => setSelectedCorrelationId(e.target.value)}
            placeholder="ex: campaign:abc123"
            style={{ padding: 6, width: "100%" }}
          />
        </label>

        <button onClick={loadCorrelations} style={{ padding: "8px 12px" }} disabled={loadingCorr}>
          {loadingCorr ? "Carregando..." : "Recarregar"}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f0b4b4", background: "#fff5f5" }}>
          {error}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "380px 1fr", gap: 16, marginTop: 16 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #ddd", fontWeight: 600 }}>correlationIds recentes</div>
          <div style={{ maxHeight: 520, overflow: "auto" }}>
            {correlations.length === 0 && (
              <div style={{ padding: 12, opacity: 0.75 }}>Nenhum item (ou sem eventos ainda).</div>
            )}
            {correlations.map((c) => {
              const active = c.correlationId === selectedCorrelationId;
              return (
                <button
                  key={c.correlationId}
                  onClick={() => setSelectedCorrelationId(c.correlationId)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: 12,
                    border: "none",
                    borderBottom: "1px solid #eee",
                    background: active ? "#f5f7ff" : "white",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontWeight: 600, wordBreak: "break-all" }}>{c.correlationId}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>
                    {c.clientId ? `clientId: ${c.clientId} · ` : ""}
                    {c.count != null ? `eventos: ${c.count} · ` : ""}
                    {c.lastSeenAt ? `último: ${c.lastSeenAt}` : ""}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #ddd", fontWeight: 600 }}>
            timeline {selectedCorrelationId ? `· ${selectedCorrelationId}` : ""}
          </div>
          <div style={{ padding: 12, maxHeight: 520, overflow: "auto" }}>
            {!selectedCorrelationId && <div style={{ opacity: 0.75 }}>Selecione um correlationId à esquerda.</div>}
            {selectedCorrelationId && loadingTl && <div>Carregando timeline…</div>}
            {selectedCorrelationId && !loadingTl && timeline.length === 0 && (
              <div style={{ opacity: 0.75 }}>Sem eventos para este correlationId.</div>
            )}
            {timeline.map((e) => (
              <div key={e.id} style={{ padding: 12, border: "1px solid #eee", borderRadius: 8, marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 600 }}>{e.type}</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>{e.occurredAt}</div>
                </div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 6 }}>
                  {e.clientId ? `clientId: ${e.clientId} · ` : ""}
                  {e.correlationId ? `correlationId: ${e.correlationId}` : ""}
                </div>
                {e.actor != null && (
                  <pre style={{ marginTop: 8, padding: 10, background: "#fafafa", borderRadius: 8, overflowX: "auto" }}>
{safeString(e.actor)}
                  </pre>
                )}
                {e.data != null && (
                  <pre style={{ marginTop: 8, padding: 10, background: "#fafafa", borderRadius: 8, overflowX: "auto" }}>
{safeString(e.data)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
