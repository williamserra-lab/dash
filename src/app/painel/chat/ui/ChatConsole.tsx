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

function fmtTs(ts: number | null | undefined): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

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
  const [err, setErr] = useState<string>("");

  const selectedConv = useMemo(
    () => conversations.find((c) => c.remoteJid === selectedRemoteJid) || null,
    [conversations, selectedRemoteJid]
  );

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
    } catch (e: any) {
      setErr(String(e?.message || e));
    } finally {
      setLoadingMsgs(false);
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
