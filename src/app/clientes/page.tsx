// src/app/clientes/page.tsx
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
void getReadableError;
void isRecord;


function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}


type ApiError = { error?: string; code?: string } | null;

async function readJsonSafe<T>(res: Response): Promise<T | null> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function getReadableError(data: ApiError, fallback: string) {
  const msg = (data && typeof data === "object" && "error" in data && data.error) ? data.error : "";
  return msg || fallback;
}

type ClientStatus = "active" | "inactive";

type ClientRecord = {
  id: string;
  name: string;
  status: ClientStatus;
  createdAt: string;
  updatedAt: string;
  segment?: string;
  whatsappNumbers?: Array<{
    id: string;
    phoneNumber: string;
    label?: string;
    isDefault?: boolean;
  }>;
};

type LlmBudgetSnapshot = {
  monthKey: string;
  usedTokens: number;
  limitTokens: number;
  remainingTokens: number;
  percentUsed: number;
  overLimitMode: "degrade" | "block";
};

type LlmPolicy = {
  monthlyTokenLimit: number;
  overLimitMode: "degrade" | "block";
};

async function fetchLlmUsage(clientId: string): Promise<{ snapshot: LlmBudgetSnapshot; policy?: LlmPolicy } | null> {
  const res = await fetch(`/api/admin/llm-usage/${encodeURIComponent(clientId)}`, { cache: "no-store" });
  const data = await readJsonSafe<any>(res);
  if (!res.ok) return null;
  const snap = (data as any)?.snapshot;
  if (!snap) return null;

  // policy vem de budget endpoint (separado)
  try {
    const res2 = await fetch(`/api/admin/llm-budget/${encodeURIComponent(clientId)}`, { cache: "no-store" });
    const data2 = await readJsonSafe<any>(res2);
    const policy = res2.ok ? (data2 as any)?.policy : undefined;
    return { snapshot: snap as LlmBudgetSnapshot, policy: policy as LlmPolicy | undefined };
  } catch {
    return { snapshot: snap as LlmBudgetSnapshot };
  }
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}


function pickDefaultWhatsapp(c: ClientRecord): string | null {
  const list = Array.isArray(c.whatsappNumbers) ? c.whatsappNumbers : [];
  if (!list.length) return null;
  const def = list.find((n) => n && n.isDefault && typeof n.phoneNumber === "string");
  const first = list.find((n) => n && typeof n.phoneNumber === "string");
  const raw = (def?.phoneNumber || first?.phoneNumber || "").toString();
  const digits = raw.replace(/\D+/g, "");
  return digits || null;
}

function formatInt(n: number): string {
  try {
    return new Intl.NumberFormat("pt-BR").format(n);
  } catch {
    return String(n);
  }
}

function LlmBudgetPanel({ clientId }: { clientId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LlmBudgetSnapshot | null>(null);
  const [policy, setPolicy] = useState<LlmPolicy | null>(null);

  const [editLimit, setEditLimit] = useState<string>("");
  const [editMode, setEditMode] = useState<"degrade" | "block">("degrade");
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const resUsage = await fetch(`/api/admin/llm-usage/${encodeURIComponent(clientId)}`, { cache: "no-store" });
      const usageData = await readJsonSafe<{ ok?: boolean; snapshot?: LlmBudgetSnapshot; error?: string }>(resUsage);
      if (!resUsage.ok) throw new Error(getReadableError(usageData as any, "Falha ao carregar uso de tokens."));

      const resPol = await fetch(`/api/admin/llm-budget/${encodeURIComponent(clientId)}`, { cache: "no-store" });
      const polData = await readJsonSafe<{ ok?: boolean; policy?: LlmPolicy; error?: string }>(resPol);
      if (!resPol.ok) throw new Error(getReadableError(polData as any, "Falha ao carregar política de tokens."));

      const snap = (usageData?.snapshot || null) as any;
      const pol = (polData?.policy || null) as any;
      setSnapshot(snap);
      setPolicy(pol);
      setEditLimit(pol?.monthlyTokenLimit ? String(pol.monthlyTokenLimit) : "");
      setEditMode((pol?.overLimitMode === "block" ? "block" : "degrade") as any);
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao carregar orçamento.");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!policy) return;
    setSaving(true);
    setError(null);
    try {
      const limitN = Number(editLimit);
      const payload: any = {
        overLimitMode: editMode,
      };
      if (Number.isFinite(limitN) && limitN > 0) payload.monthlyTokenLimit = Math.floor(limitN);

      const res = await fetch(`/api/admin/llm-budget/${encodeURIComponent(clientId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await readJsonSafe<{ ok?: boolean; policy?: LlmPolicy; error?: string }>(res);
      if (!res.ok) throw new Error(getReadableError(data as any, "Falha ao salvar política."));
      setPolicy((data?.policy || null) as any);
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-800 dark:bg-slate-900/30">
      <div className="flex items-center justify-between gap-3">
        <div className="font-medium text-slate-800 dark:text-slate-100">Orçamento LLM (tokens)</div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
        >
          {loading ? "Carregando..." : "Atualizar"}
        </button>
      </div>

      {error ? (
        <div className="mt-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {snapshot ? (
        <div className="mt-3">
          <div className="flex items-center justify-between">
            <div className="text-xs text-slate-600 dark:text-slate-300">
              {snapshot.monthKey}: {formatInt(snapshot.usedTokens)} / {formatInt(snapshot.limitTokens)} tokens
            </div>
            <div className="text-xs font-medium text-slate-700 dark:text-slate-200">{snapshot.percentUsed}%</div>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
            <div
              className="h-2 rounded-full bg-sky-600"
              style={{ width: `${Math.min(100, Math.max(0, snapshot.percentUsed))}%` }}
            />
          </div>
          <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
            Modo ao estourar: <span className="font-medium">{snapshot.overLimitMode}</span>
          </div>
        </div>
      ) : (
        <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
          Clique em <span className="font-medium">Atualizar</span> para ver o consumo deste mês.
        </div>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-200">Limite mensal (tokens)</label>
          <input
            value={editLimit}
            onChange={(e) => setEditLimit(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
            placeholder="250000"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-700 dark:text-slate-200">Over-limit mode</label>
          <select
            value={editMode}
            onChange={(e) => setEditMode(e.target.value as any)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-100"
          >
            <option value="degrade">degrade (atendimento continua)</option>
            <option value="block">block</option>
          </select>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full rounded-md bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ClientesPage() {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");

  const canCreate = useMemo(() => {
    return name.trim().length > 1 && clientId.trim().length > 1;
  }, [name, clientId]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      const data = await readJsonSafe<{ clients?: ClientRecord[]; error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || "Erro ao carregar clientes.");
      setClients(data?.clients || []);
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao carregar clientes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!clientId.trim() && name.trim()) {
      setClientId(slugify(name));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!canCreate) {
      setError("Preencha nome e clientId.");
      return;
    }

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: clientId.trim(),
          name: name.trim(),
          whatsappNumber: whatsappNumber.trim() || undefined,
        }),
      });

      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || "Erro ao criar cliente.");

      setName("");
      setClientId("");
      setWhatsappNumber("");
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao criar cliente.");
    }
  }

  async function toggleStatus(id: string, next: ClientStatus) {
    setError(null);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || "Erro ao atualizar status.");
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao atualizar status.");
    }
  }

  async function rename(id: string, newName: string) {
    setError(null);
    try {
      const res = await fetch(`/api/clients/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName }),
      });
      const data = await readJsonSafe<{ error?: string }>(res);
      if (!res.ok) throw new Error(data?.error || "Erro ao renomear.");
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e) || "Erro ao renomear.");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Clientes</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          Cadastro mínimo para evitar tenant “solto”. Sem cliente válido, o app não deveria operar.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-950"
      >
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Nome</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:placeholder:text-slate-500 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="Ex.: Cátia Foods"
            />
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">clientId</label>
            <input
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:placeholder:text-slate-500 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="ex.: catia_foods"
            />
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">
              Letras/números/underscore/hífen. É o identificador usado no URL e nos dados.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              WhatsApp (opcional)
            </label>
            <input
              value={whatsappNumber}
              onChange={(e) => setWhatsappNumber(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:placeholder:text-slate-500 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
              placeholder="5511999999999"
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            type="submit"
            disabled={!canCreate}
            className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Criar cliente
          </button>
          <button
            type="button"
            onClick={load}
            className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            Recarregar
          </button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <div className="border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Lista</h2>
        </div>

        {loading ? (
          <div className="p-4 text-sm text-slate-600 dark:text-slate-300">Carregando...</div>
        ) : clients.length === 0 ? (
          <div className="p-4 text-sm text-slate-600 dark:text-slate-300">
            Nenhum cliente cadastrado.
          </div>
        ) : (
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {clients.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      {c.name}
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                      {c.id}
                    </span>
                    <span
                      className={
                        c.status === "active"
                          ? "rounded-md bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200"
                          : "rounded-md bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
                      }
                    >
                      {c.status === "active" ? "ativo" : "inativo"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    Atualizado: {new Date(c.updatedAt).toLocaleString("pt-BR")}
                  </div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300">
                    WhatsApp: {pickDefaultWhatsapp(c) ? pickDefaultWhatsapp(c) : "não configurado"}
                  </div>

                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <a
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    href={`/midias?clientId=${encodeURIComponent(c.id)}`}
                  >
                    Mídias
                  </a>
                  <a
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    href={`/assistente?clientId=${encodeURIComponent(c.id)}`}
                  >
                    Assistente
                  </a>
                  <a
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    href={`/campanhas?clientId=${encodeURIComponent(c.id)}`}
                  >
                    Campanhas
                  </a>
                  <a
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    href={`/campanhas-grupos?clientId=${encodeURIComponent(c.id)}`}
                  >
                    Campanhas (Grupos)
                  </a>


                  <button
                    className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                    onClick={() => {
                      const newName = prompt("Novo nome do cliente:", c.name);
                      if (newName && newName.trim() && newName.trim() !== c.name) {
                        rename(c.id, newName.trim());
                      }
                    }}
                  >
                    Renomear
                  </button>

                  {c.status === "active" ? (
                    <button
                      className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                      onClick={() => toggleStatus(c.id, "inactive")}
                    >
                      Desativar
                    </button>
                  ) : (
                    <button
                      className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                      onClick={() => toggleStatus(c.id, "active")}
                    >
                      Ativar
                    </button>
                  )}
                </div>

                <div className="w-full md:col-span-2">
                  <details className="mt-2 rounded-lg">
                    <summary className="cursor-pointer select-none text-xs font-medium text-slate-700 dark:text-slate-200">
                      Orçamento LLM (tokens)
                    </summary>
                    <LlmBudgetPanel clientId={c.id} />
                  </details>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
