// src/app/clientes/[clientId]/chat/ui/ChatV1.tsx
"use client";

import { useEffect, useMemo, useState } from "react";

type Thread = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  contactId?: string;
  lastMessagePreview?: string;
};

type Contact = {
  id: string;
  name: string;
  whatsapp?: string;
  email?: string;
  active: boolean;
};

type Attachment = {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  path: string;
  createdAt: string;
};

type Usage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cached: boolean;
  isEstimated?: boolean;
  estimatedTotalTokens?: number;
};

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  contactId?: string;
  attachments?: Attachment[];
  usage?: Usage;
};

function formatTs(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("pt-BR");
  } catch {
    return iso;
  }
}

function bytes(n: number) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default function ChatV1({ clientId }: { clientId: string }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string>("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeContactId, setActiveContactId] = useState<string>("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>("");
  const [authChecked, setAuthChecked] = useState(false);
  const [authorized, setAuthorized] = useState(false);

  async function checkAdminAuth(): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/auth/me", { cache: "no-store", credentials: "same-origin" });
      const ok = res.ok;
      setAuthorized(ok);
      return ok;
    } catch {
      setAuthorized(false);
      return false;
    } finally {
      setAuthChecked(true);
    }
  }

  async function fetchJson<T = any>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, { cache: "no-store", credentials: "same-origin", ...(init || {}) });
    let data: any = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 401) {
      throw new Error("Acesso negado. Fa\u00e7a login em /admin-login (ou /login).");
    }
    if (!res.ok) {
      throw new Error((data && (data.message || data.error)) || "Falha na requisição.");
    }
    return data as T;
  }

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) || null,
    [threads, activeThreadId]
  );

  const creditTotals = useMemo(() => {
    let prompt = 0, completion = 0, total = 0, cached = 0;
    for (const m of messages) {
      if (m.usage) {
        prompt += m.usage.promptTokens || 0;
        completion += m.usage.completionTokens || 0;
        total += m.usage.totalTokens || 0;
        if (m.usage.cached) cached += 1;
      }
    }
    return { prompt, completion, total, cachedMsgs: cached };
  }, [messages]);

  async function loadThreads() {
    const res = await fetch(`/api/chat/threads?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || "Falha ao carregar conversas.");
    setThreads(data.threads || []);
    return data.threads || [];
  }

  async function loadContacts() {
    const res = await fetch(`/api/chat/contacts?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || data?.error || "Falha ao carregar contatos.");
    setContacts((data.contacts || []).filter((c: Contact) => c.active !== false));
  }

  async function loadMessages(threadId: string) {
    const data = await fetchJson<{ messages: Message[] }>(
      `/api/chat/messages?clientId=${encodeURIComponent(clientId)}&threadId=${encodeURIComponent(threadId)}`
    );
    setMessages(data.messages || []);
  }

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ok = await checkAdminAuth();
        if (!ok) {
          setError("Acesso negado. Faça login em /admin-login (ou /login).");
          return;
        }

        setError("");
        await loadContacts();
        const t = await loadThreads();
        if (!mounted) return;
        if (t.length > 0) {
          setActiveThreadId(t[0].id);
        } else {
          // create a first thread
          const res = await fetch("/api/chat/threads", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ clientId, title: "Conversa 1" }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data?.message || data?.error || "Falha ao criar conversa.");
          setThreads([data.thread]);
          setActiveThreadId(data.thread.id);
        }
      } catch (e: any) {
        setError(e?.message || "Falha ao inicializar chat.");
      }
    })();
    return () => { mounted = false; };
  }, [clientId]);

  useEffect(() => {
    if (!activeThreadId) return;
    (async () => {
      try {
        setError("");
        await loadMessages(activeThreadId);
      } catch (e: any) {
        setError(e?.message || "Falha ao carregar mensagens.");
      }
    })();
  }, [activeThreadId]);

  async function createContactInline() {
    const name = prompt("Nome do contato:");
    if (!name) return;
    const whatsapp = prompt("WhatsApp (somente dígitos, DDI+DDD+número). Opcional:") || "";
    const email = prompt("Email (opcional):") || "";
    const res = await fetch("/api/chat/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId, name, whatsapp, email }),
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data?.message || data?.error || "Falha ao criar contato.");
      return;
    }
    await loadContacts();
    setActiveContactId(data.contact.id);
  }

  async function uploadFiles(files: FileList | null): Promise<Attachment[]> {
    if (!files || files.length === 0) return [];
    const uploaded: Attachment[] = [];
    for (const f of Array.from(files)) {
      const form = new FormData();
      form.set("clientId", clientId);
      form.set("threadId", activeThreadId);
      form.set("file", f);
      const res = await fetch("/api/chat/upload", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || data?.error || `Falha ao enviar arquivo: ${f.name}`);
      }
      uploaded.push(data.attachment);
    }
    return uploaded;
  }

  async function sendMessage(files: FileList | null) {
    if (!activeThreadId) return;
    const content = input.trim();
    if (!content) return;

    setSending(true);
    setError("");
    try {
      const attachments = await uploadFiles(files);

      const res = await fetch("/api/chat/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId,
          threadId: activeThreadId,
          contactId: activeContactId || undefined,
          content,
          attachments,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.message || data?.error || "Falha ao enviar mensagem.");
      setInput("");
      await loadMessages(activeThreadId);
      await loadThreads();
    } catch (e: any) {
      setError(e?.message || "Falha ao enviar.");
    } finally {
      setSending(false);
      // reset file input
      const el = document.getElementById("chatFileInput") as HTMLInputElement | null;
      if (el) el.value = "";
    }
  }

  if (authChecked && !authorized) {
    const next = typeof window !== "undefined" ? window.location.pathname + window.location.search : "";
    return (
      <div className="rounded border border-rose-200 bg-rose-50 p-4 text-rose-800">
        <div className="font-semibold">Acesso negado</div>
        <div className="mt-1 text-sm">
          Faça login em <a className="underline" href={`/admin-login?next=${encodeURIComponent(next)}`}>/admin-login</a> (ou em <a className="underline" href={`/login?next=${encodeURIComponent(next)}`}>/login</a>) e volte para esta tela.
        </div>
      </div>
    );
  }

  if (!authChecked) {
    return <div className="text-sm text-slate-500">Verificando sessão...</div>;
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-slate-800">Chat operacional</h2>
          <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-700">clientId: {clientId}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={activeThreadId}
            onChange={(e) => setActiveThreadId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
          >
            {threads.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>

          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={async () => {
              const title = prompt("Título da conversa:", `Conversa ${threads.length + 1}`) || "";
              if (!title.trim()) return;
              const res = await fetch("/api/chat/threads", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ clientId, title }),
              });
              const data = await res.json();
              if (!res.ok) {
                alert(data?.message || data?.error || "Falha ao criar conversa.");
                return;
              }
              const next = await loadThreads();
              setActiveThreadId(data.thread.id);
              setThreads(next);
            }}
          >
            Nova conversa
          </button>

          <select
            value={activeContactId}
            onChange={(e) => setActiveContactId(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            title="Contato vinculado"
          >
            <option value="">Sem contato</option>
            {contacts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.whatsapp ? ` (${c.whatsapp})` : ""}
              </option>
            ))}
          </select>

          <button
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            onClick={createContactInline}
          >
            Novo contato
          </button>

          <div className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700" title="Créditos = tokens efetivamente cobrados. Cache não cobra.">
            Créditos: <span className="font-semibold">{creditTotals.total}</span>{" "}
            <span className="text-slate-500">(cache: {creditTotals.cachedMsgs} msgs)</span>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {messages.map((m) => (
          <div key={m.id} className={`rounded-md border p-3 ${m.role === "user" ? "border-sky-200 bg-sky-50" : "border-slate-200 bg-white"}`}>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-slate-700">
                {m.role === "user" ? "Você" : m.role === "assistant" ? "Assistente" : "Sistema"}
              </div>
              <div className="text-xs text-slate-500 flex items-center gap-2">
                {m.usage ? (
                  <span className={`rounded px-2 py-1 ${m.usage.cached ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-700"}`}>
                    {m.usage.cached ? "cache" : m.usage.isEstimated ? "estimado" : "real"} · {m.usage.totalTokens} cr
                    {m.usage.cached && typeof m.usage.estimatedTotalTokens === "number" ? (
                      <span className="ml-2 opacity-70" title="Estimativa do custo evitado pelo cache">
                        (evitou ~{m.usage.estimatedTotalTokens})
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span>{formatTs(m.createdAt)}</span>
              </div>
            </div>

            <div className="mt-2 whitespace-pre-wrap text-sm text-slate-900">{m.content}</div>

            {m.attachments && m.attachments.length ? (
              <div className="mt-2 space-y-1">
                <div className="text-xs font-medium text-slate-600">Anexos</div>
                <ul className="list-disc pl-5 text-xs text-slate-700">
                  {m.attachments.map((a) => (
                    <li key={a.id}>
                      {a.filename} <span className="text-slate-500">({bytes(a.size)})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3">
        <div className="flex flex-col gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="min-h-[90px] w-full rounded-md border border-slate-300 bg-white p-3 text-sm text-slate-900"
            placeholder="Digite sua mensagem…"
          />
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2">
              <input id="chatFileInput" type="file" multiple className="text-sm" />
              <span className="text-xs text-slate-600">Anexe arquivos (opcional)</span>
            </div>
            <button
              disabled={sending || !input.trim() || !activeThreadId}
              onClick={() => {
                const el = document.getElementById("chatFileInput") as HTMLInputElement | null;
                void sendMessage(el?.files || null);
              }}
              className="rounded-md bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {sending ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </div>
      </div>

      {activeThread ? (
        <div className="mt-3 text-xs text-slate-500">
          Conversa: <span className="font-medium">{activeThread.title}</span>
          {activeThread.lastMessagePreview ? (
            <span> · Último: {activeThread.lastMessagePreview}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}