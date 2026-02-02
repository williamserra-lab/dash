// src/app/painel/chat/ui/ChatConsole.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Conversation = {
  clientId: string;
  instance: string;
  remoteJid: string;
  lastText: string | null;
  lastTs: number | null;
  lastFromMe: boolean | null;
};

type StoredMessage = {
  clientId: string;
  instance: string;
  remoteJid: string;
  keyId: string;
  fromMe: boolean;
  ts: number;
  text: string | null;
};

type Attendant = { id: string; name: string; role: string; active: boolean };
type WhatsappInstance = { id: string; label: string; instanceName: string; active: boolean };

type ChatSummaryPurpose = "handoff" | "review_chat";

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}


type BudgetDecision = {
  action: "allow" | "degrade" | "block";
  usagePct: number;
  severity: "none" | "warn" | "error";
  message: string;
  snapshot: { usedTokens: number; limitTokens: number; remainingTokens: number; monthKey: string };
};

export default function ChatConsole(props: { clientId: string; instance: string; attendantId?: string }) {
  const { clientId } = props;

  const [instances, setInstances] = useState<WhatsappInstance[]>([]);
  const [attendants, setAttendants] = useState<Attendant[]>([]);

  const [instance, setInstance] = useState<string>(props.instance || "NextIA");
  const [attendantId, setAttendantId] = useState<string>(props.attendantId || "");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedRemoteJid, setSelectedRemoteJid] = useState<string>("");
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [draft, setDraft] = useState<string>("");
  const [loadingConvs, setLoadingConvs] = useState<boolean>(false);
  const [loadingMsgs, setLoadingMsgs] = useState<boolean>(false);
  const [summaryPurpose, setSummaryPurpose] = useState<ChatSummaryPurpose>("handoff");
  const [summaryText, setSummaryText] = useState<string>("");
  const [loadingSummary, setLoadingSummary] = useState<boolean>(false);
  const [err, setErr] = useState<string>("");
  const [budgetDecision, setBudgetDecision] = useState<BudgetDecision | null>(null);
  const [loadingBudget, setLoadingBudget] = useState<boolean>(false);

  const selectedConv = useMemo(
    () => conversations.find((c) => c.remoteJid === selectedRemoteJid) || null,
    [conversations, selectedRemoteJid]
  );

  async function loadBudgetDecision() {
    if (!clientId) {
      setBudgetDecision(null);
      return;
    }
    setLoadingBudget(true);
    try {
      const res = await fetch(`/api/admin/llm-budget-status?clientId=${encodeURIComponent(clientId)}&context=inbound`, {
        cache: "no-store",
      });
      const j = (await res.json()) as any;
      if (j?.ok && j.decision) setBudgetDecision(j.decision as BudgetDecision);
      else setBudgetDecision(null);
    } catch {
      setBudgetDecision(null);
    } finally {
      setLoadingBudget(false);
    }
  }

  useEffect(() => {
    loadBudgetDecision();
    const t = window.setInterval(loadBudgetDecision, 30_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Keep URL in sync (so refresh preserves selections)
  function pushUrl(next: { instance?: string; attendantId?: string }) {
    try {
      const u = new URL(window.location.href);
      if (clientId) u.searchParams.set("clientId", clientId);
      const inst = typeof next.instance === "string" ? next.instance : instance;
      if (inst) u.searchParams.set("instance", inst);
      const at = typeof next.attendantId === "string" ? next.attendantId : attendantId;
      if (at) u.searchParams.set("attendantId", at);
      else u.searchParams.delete("attendantId");
      window.history.replaceState({}, "", u.toString());
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    pushUrl({ instance, attendantId });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, attendantId]);

  // Load attendants + whatsapp instances for the client (for selectors)
  useEffect(() => {
    if (!clientId) return;

    (async () => {
      try {
        const [aRes, iRes] = await Promise.all([
          fetch(`/api/clients/${encodeURIComponent(clientId)}/attendants`, { cache: "no-store" }),
          fetch(`/api/clients/${encodeURIComponent(clientId)}/whatsapp-instances`, { cache: "no-store" }),
        ]);

        if (aRes.ok) {
          const data = await aRes.json().catch(() => ({}));
          const items = Array.isArray((data as any).items) ? (data as any).items : [];
          setAttendants(items.filter((x: any) => x && x.active !== false));
          if (!attendantId && items.length > 0) {
            setAttendantId(String(items[0].id || ""));
          }
        }

        if (iRes.ok) {
          const data = await iRes.json().catch(() => ({}));
          const items = Array.isArray((data as any).items) ? (data as any).items : [];
          const normalized = items
            .filter((x: any) => x && x.active !== false)
            .map((x: any) => ({ id: String(x.id), label: String(x.label || x.instanceName || x.id), instanceName: String(x.instanceName || ""), active: x.active !== false }));
          setInstances(normalized);
          if (normalized.length > 0) {
            // If current instance is not one of known, keep it; otherwise prefer first when empty.
            const known = normalized.some((x: { instanceName: string }) => x.instanceName === instance);
            if (!known && !instance) setInstance(normalized[0].instanceName);
          }
        }
      } catch {
        // best-effort
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  async function loadConversations() {
    if (!clientId) return;
    setLoadingConvs(true);
    setErr("");
    try {
      const url = `/api/admin/chat/conversations?clientId=${encodeURIComponent(clientId)}&instance=${encodeURIComponent(instance)}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(String((data as any).error || "Falha ao carregar conversas"));
        setConversations([]);
        return;
      }
      const items = Array.isArray((data as any).items) ? (data as any).items : [];
      setConversations(items);
      if (!selectedRemoteJid && items.length > 0) {
        setSelectedRemoteJid(String(items[0].remoteJid || ""));
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingConvs(false);
    }
  }

  async function loadMessages(remoteJid: string) {
    if (!clientId || !remoteJid) return;
    setLoadingMsgs(true);
    setErr("");
    try {
      const url = `/api/admin/chat/messages?clientId=${encodeURIComponent(clientId)}&instance=${encodeURIComponent(instance)}&remoteJid=${encodeURIComponent(remoteJid)}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(String((data as any).error || "Falha ao carregar mensagens"));
        setMessages([]);
        return;
      }
      const items = Array.isArray((data as any).items) ? (data as any).items : [];
      setMessages(items);
      // reset summary when switching conversations (summary is per remoteJid)
      setSummaryText("");
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingMsgs(false);
    }
  }

  async function loadSummaryStatus(remoteJid: string) {
    if (!clientId || !remoteJid) return;
    try {
      const url = `/api/admin/chat/summary?clientId=${encodeURIComponent(clientId)}&instance=${encodeURIComponent(instance)}&remoteJid=${encodeURIComponent(remoteJid)}&purpose=${encodeURIComponent(summaryPurpose)}`;
      const res = await fetch(url, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof (data as any)?.summary === "string") {
        setSummaryText(String((data as any).summary));
      } else {
        setSummaryText("");
      }
    } catch {
      // ignore
    }
  }

  async function generateSummary() {
    if (!clientId || !selectedConv) return;
    setLoadingSummary(true);
    setErr("");
    try {
      const url = `/api/admin/chat/summary?clientId=${encodeURIComponent(clientId)}&instance=${encodeURIComponent(instance)}&remoteJid=${encodeURIComponent(selectedConv.remoteJid)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: summaryPurpose }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        setErr("Acesso admin necessário. Faça login em /login.");
        return;
      }
      if (res.status === 404 && (data as any)?.error === "feature_disabled") {
        setErr("Resumo de chat desativado. Habilite NEXTIA_FEATURE_CHAT_SUMMARY=1.");
        return;
      }
      if (!res.ok) {
        setErr(String((data as any)?.error || "Falha ao gerar resumo"));
        return;
      }
      setSummaryText(String((data as any)?.summary || ""));
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingSummary(false);
    }
  }

  async function loadOrGenerateSummary(opts?: { force?: boolean }) {
    if (!clientId || !selectedRemoteJid) return;
    setLoadingSummary(true);
    setErr("");
    try {
      const q = new URLSearchParams({
        clientId,
        instance,
        remoteJid: selectedRemoteJid,
        purpose: summaryPurpose,
      });

      // 1) status/cache
      const stRes = await fetch(`/api/admin/chat/summary?${q.toString()}`, { cache: "no-store" });
      const st = await stRes.json().catch(() => ({}));

      if (stRes.status === 401) {
        setErr("Acesso admin necessário. Faça login em /login.");
        return;
      }

      if (stRes.status === 404 && (st as any)?.error === "feature_disabled") {
        setErr("Resumo de chat desativado. Habilite NEXTIA_FEATURE_CHAT_SUMMARY=1.");
        return;
      }

      if (stRes.ok && typeof (st as any)?.summary === "string") {
        setSummaryText(String((st as any).summary));
        return;
      }

      // 2) generate on demand
      const genRes = await fetch(`/api/admin/chat/summary?${q.toString()}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ force: opts?.force === true, purpose: summaryPurpose }),
      });
      const gen = await genRes.json().catch(() => ({}));

      if (!genRes.ok) {
        setErr(String((gen as any)?.error || "Falha ao gerar resumo."));
        return;
      }

      if (typeof (gen as any).summary === "string") {
        setSummaryText(String((gen as any).summary));
      } else {
        setSummaryText("Resumo não retornado.");
      }
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingSummary(false);
    }
  }

  useEffect(() => {
    loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, instance]);

  useEffect(() => {
    if (selectedRemoteJid) loadMessages(selectedRemoteJid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRemoteJid, clientId, instance]);

  useEffect(() => {
    if (selectedRemoteJid) loadSummaryStatus(selectedRemoteJid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRemoteJid, clientId, instance, summaryPurpose]);

  async function send() {
    if (!clientId || !selectedConv) return;
    const text = draft.trim();
    if (!text) return;

    try {
      const res = await fetch("/api/admin/outbox/enqueue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          to: selectedConv.remoteJid,
          message: text,
          messageType: "lojista_reply",
          context: {
            kind: "lojista_reply",
            source: "painel_chat",
            instance,
            attendantId: attendantId || null,
            conversation: { from: "lojista", to: selectedConv.remoteJid },
          },
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setErr(String((data as any).error || "Falha ao enfileirar"));
        return;
      }

      setDraft("");
      // Best-effort refresh
      await loadMessages(selectedConv.remoteJid);
      await loadConversations();
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 12, height: "78vh" }}>
      {budgetDecision && budgetDecision.severity !== "none" ? (
        <div
          data-testid="llm-budget-banner"
          className={`sticky top-0 z-20 mb-3 rounded-md border px-4 py-3 text-sm ${
            budgetDecision.severity === "error"
              ? "bg-red-50 border-red-200 text-red-900"
              : "bg-yellow-50 border-yellow-200 text-yellow-900"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold">
                {budgetDecision.severity === "error" ? "Limite de IA atingido" : "Limite de IA quase no fim"}
              </div>
              <div className="mt-1 break-words">{budgetDecision.message}</div>
              <div className="mt-1 text-xs opacity-80">
                {Math.floor(budgetDecision.usagePct)}% usado · mês {budgetDecision.snapshot.monthKey}
              </div>
            </div>
            <div className="text-xs opacity-70">{loadingBudget ? "Atualizando..." : "Custa tokens"}</div>
          </div>
        </div>
      ) : null}

      <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, overflow: "auto" }}>
        <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
          <label style={{ fontSize: 12, color: "#444" }}>
            Instância WhatsApp
            <select
              value={instance}
              onChange={(e) => setInstance(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            >
              {instances.length === 0 ? (
                <option value={instance}>{instance || "NextIA"}</option>
              ) : (
                instances.map((i) => (
                  <option key={i.id} value={i.instanceName}>
                    {i.label} ({i.instanceName})
                  </option>
                ))
              )}
            </select>
          </label>

          <label style={{ fontSize: 12, color: "#444" }}>
            Atendente
            <select
              value={attendantId}
              onChange={(e) => setAttendantId(e.target.value)}
              style={{ width: "100%", marginTop: 4, padding: 8, borderRadius: 8, border: "1px solid #ddd" }}
            >
              {attendants.length === 0 ? (
                <option value="">(sem atendentes cadastrados)</option>
              ) : (
                attendants.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.role})
                  </option>
                ))
              )}
            </select>
          </label>

          <button
            onClick={loadConversations}
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
          >
            {loadingConvs ? "Atualizando..." : "Atualizar conversas"}
          </button>
          {err ? <div style={{ color: "#b00020", fontSize: 12 }}>{err}</div> : null}
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {conversations.map((c) => (
            <div
              key={c.remoteJid}
              onClick={() => setSelectedRemoteJid(c.remoteJid)}
              style={{
                padding: 10,
                borderRadius: 10,
                border: c.remoteJid === selectedRemoteJid ? "2px solid #111" : "1px solid #e5e5e5",
                cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 13 }}>{c.remoteJid}</div>
              <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>{c.lastText || "(sem texto)"}</div>
              <div style={{ fontSize: 11, color: "#888", marginTop: 6 }}>{fmtTs(c.lastTs || null)}</div>
            </div>
          ))}
          {conversations.length === 0 && !loadingConvs ? (
            <div style={{ fontSize: 12, color: "#666" }}>Sem conversas para esta instância.</div>
          ) : null}
        </div>
      </div>

      <div style={{ border: "1px solid #e5e5e5", borderRadius: 12, padding: 12, display: "grid", gridTemplateRows: "1fr auto", overflow: "hidden" }}>
        <div style={{ overflow: "auto", paddingRight: 6 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>
            {selectedConv ? selectedConv.remoteJid : "Selecione uma conversa"}
          </div>

          {selectedConv ? (
            <div
              style={{
                border: "1px solid #e5e5e5",
                borderRadius: 12,
                padding: 10,
                marginBottom: 10,
                background: "#fff",
              }}
            >
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: "#444" }}>
                  Resumo:&nbsp;
                  <select
                    value={summaryPurpose}
                    onChange={(e) => setSummaryPurpose(e.target.value as ChatSummaryPurpose)}
                    style={{ padding: 6, borderRadius: 8, border: "1px solid #ddd" }}
                  >
                    <option value="handoff">Handoff</option>
                    <option value="review_chat">Revisão rápida</option>
                  </select>
                </label>

                <button
                  onClick={generateSummary}
                  disabled={loadingSummary}
                  style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
                >
                  {loadingSummary ? "Gerando..." : "Gerar resumo (custa tokens)"}
                </button>

                <span style={{ fontSize: 12, color: "#666" }}>
                  O resumo só é gerado quando você clicar.
                </span>
              </div>

              {summaryText ? (
                <div style={{ marginTop: 8, fontSize: 13, whiteSpace: "pre-wrap", background: "#fafafa", border: "1px solid #eee", borderRadius: 10, padding: 10 }}>
                  {summaryText}
                </div>
              ) : (
                <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>Nenhum resumo gerado para esta conversa.</div>
              )}
            </div>
          ) : null}

          {loadingMsgs ? <div style={{ fontSize: 12, color: "#666" }}>Carregando mensagens...</div> : null}

          <div style={{ display: "grid", gap: 8 }}>
            {messages.map((m) => (
              <div
                key={m.keyId}
                style={{
                  justifySelf: m.fromMe ? "end" : "start",
                  maxWidth: "85%",
                  background: m.fromMe ? "#111" : "#f3f3f3",
                  color: m.fromMe ? "white" : "#111",
                  padding: "10px 12px",
                  borderRadius: 12,
                }}
              >
                <div style={{ fontSize: 13, whiteSpace: "pre-wrap" }}>{m.text || "(sem texto)"}</div>
                <div style={{ fontSize: 10, opacity: 0.8, marginTop: 6 }}>{fmtTs(m.ts)}</div>
              </div>
            ))}
            {selectedConv && messages.length === 0 && !loadingMsgs ? (
              <div style={{ fontSize: 12, color: "#666" }}>Sem mensagens armazenadas ainda.</div>
            ) : null}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, marginTop: 10 }}>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={2}
            placeholder="Digite a mensagem do atendente..."
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <button
            onClick={send}
            disabled={!selectedConv || !draft.trim()}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid #111",
              background: "#111",
              color: "white",
              cursor: "pointer",
            }}
          >
            Enfileirar
          </button>
        </div>
      </div>
    </div>
  );
}
