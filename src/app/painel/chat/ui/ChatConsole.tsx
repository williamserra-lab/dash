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
  messageTimestamp: number | null;
  text: string | null;
  createdAt: string;
};

export default function ChatConsole({ clientId, instance }: { clientId: string; instance: string }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [messages, setMessages] = useState<StoredMessage[]>([]);
  const [draft, setDraft] = useState<string>("");
  const canLoad = Boolean(clientId && instance);

  const selectedConv = useMemo(() => conversations.find((c) => c.remoteJid === selected) || null, [conversations, selected]);

  useEffect(() => {
    if (!canLoad) return;
    const url = `/api/admin/chat/conversations?clientId=${encodeURIComponent(clientId)}&instance=${encodeURIComponent(instance)}`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setConversations(j.items || []);
      })
      .catch(() => {});
  }, [clientId, instance, canLoad]);

  useEffect(() => {
    if (!canLoad || !selected) return;
    const url = `/api/admin/chat/messages?clientId=${encodeURIComponent(clientId)}&instance=${encodeURIComponent(instance)}&remoteJid=${encodeURIComponent(selected)}&limit=200`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) setMessages(j.items || []);
      })
      .catch(() => {});
  }, [clientId, instance, selected, canLoad]);

  async function send() {
    const text = draft.trim();
    if (!text || !selectedConv) return;
    setDraft("");

    // Enqueue only (core decision). Outbox runner is responsible for sending.
    const res = await fetch("/api/admin/outbox/enqueue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        clientId,
        to: selectedConv.remoteJid,
        message: text,
        messageType: "lojista_reply",
        context: { kind: "lojista_reply", source: "painel_chat", conversation: { from: "lojista", to: selectedConv.remoteJid } },
      }),
    });

    // Best-effort refresh messages
    if (res.ok) {
      const url = `/api/admin/chat/messages?clientId=${encodeURIComponent(clientId)}&instance=${encodeURIComponent(instance)}&remoteJid=${encodeURIComponent(selectedConv.remoteJid)}&limit=200`;
      fetch(url)
        .then((r) => r.json())
        .then((j) => {
          if (j?.ok) setMessages(j.items || []);
        })
        .catch(() => {});
    }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 12, height: "78vh" }}>
      <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 10, borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 12, color: "#666" }}>clientId</div>
          <div style={{ fontWeight: 600 }}>{clientId || "(informe ?clientId=...)"}</div>
          <div style={{ fontSize: 12, color: "#666", marginTop: 8 }}>instance</div>
          <div style={{ fontWeight: 600 }}>{instance}</div>
        </div>

        <div style={{ overflow: "auto" }}>
          {conversations.map((c) => {
            const active = c.remoteJid === selected;
            return (
              <button
                key={c.remoteJid}
                onClick={() => setSelected(c.remoteJid)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: 10,
                  border: "none",
                  borderBottom: "1px solid #f0f0f0",
                  background: active ? "#f5f5f5" : "white",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 13 }}>{c.remoteJid}</div>
                <div style={{ fontSize: 12, color: "#444", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {c.lastText || ""}
                </div>
              </button>
            );
          })}
          {conversations.length === 0 && (
            <div style={{ padding: 10, fontSize: 13, color: "#666" }}>
              Nenhuma conversa encontrada. Verifique se há mensagens (DB ou data/messages.json).
            </div>
          )}
        </div>
      </div>

      <div style={{ border: "1px solid #ddd", borderRadius: 8, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 10, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>{selectedConv ? selectedConv.remoteJid : "Selecione uma conversa"}</div>
          <div style={{ fontSize: 12, color: "#666" }}>Envio é via outbox (não envia direto).</div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", flexDirection: "column-reverse", gap: 10 }}>
          {messages.map((m) => (
            <div key={m.keyId} style={{ alignSelf: m.fromMe ? "flex-end" : "flex-start", maxWidth: "78%" }}>
              <div
                style={{
                  padding: 10,
                  borderRadius: 10,
                  background: m.fromMe ? "#e9f5ff" : "#f3f3f3",
                  whiteSpace: "pre-wrap",
                  fontSize: 13,
                }}
              >
                {m.text || ""}
              </div>
              <div style={{ fontSize: 11, color: "#777", marginTop: 4 }}>
                {m.fromMe ? "Você" : "Cliente"} · {m.messageTimestamp ? new Date(m.messageTimestamp * 1000).toLocaleString() : m.createdAt}
              </div>
            </div>
          ))}
          {selectedConv && messages.length === 0 && (
            <div style={{ fontSize: 13, color: "#666" }}>Sem mensagens armazenadas ainda.</div>
          )}
        </div>

        <div style={{ padding: 10, borderTop: "1px solid #eee", display: "flex", gap: 8 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={selectedConv ? "Digite sua mensagem…" : "Selecione uma conversa"}
            disabled={!selectedConv}
            style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid #ddd" }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button
            onClick={send}
            disabled={!selectedConv || !draft.trim()}
            style={{ padding: "10px 14px", borderRadius: 8, border: "1px solid #111", background: "#111", color: "white", cursor: "pointer" }}
          >
            Enfileirar
          </button>
        </div>
      </div>
    </div>
  );
}
