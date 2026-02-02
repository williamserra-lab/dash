"use client";

import { useState } from "react";

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
  const msg =
    data && typeof data === "object" && "error" in data && data.error ? data.error : "";
  return msg || fallback;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatInt(n: number): string {
  try {
    return new Intl.NumberFormat("pt-BR").format(n);
  } catch {
    return String(n);
  }
}

export function LlmBudgetPanel({ clientId }: { clientId: string }) {
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
      const resUsage = await fetch(`/api/admin/llm-usage/${encodeURIComponent(clientId)}`, {
        cache: "no-store",
      });
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
            disabled={saving || !policy}
            className="w-full rounded-md bg-sky-600 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default LlmBudgetPanel;
