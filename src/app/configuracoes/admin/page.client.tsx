"use client";

import { FormEvent, useEffect, useState } from "react";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type State = {
  hasCredentials: boolean;
  username: string | null;
  sessionVersion: number;
};

export default function AdminCredentialsPage() {
  const [state, setState] = useState<State | null>(null);
  const [loading, setLoading] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");

  const [saving, setSaving] = useState(false);
  const [rotating, setRotating] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/credentials", { cache: "no-store", credentials: "include" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as any)?.message || (data as any)?.error || "Acesso negado.";
        throw new Error(msg);
      }
      setState({
        hasCredentials: Boolean((data as any)?.hasCredentials),
        username: (data as any)?.username ?? null,
        sessionVersion: Number((data as any)?.sessionVersion ?? 0),
      });
      setUsername(((data as any)?.username ?? "admin") as string);
    } catch (err) {
      setError(getErrorMessage(err));
      setState(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOkMsg(null);

    if (!username.trim()) {
      setError("Usuário é obrigatório.");
      return;
    }
    if (!password.trim() || password.trim().length < 6) {
      setError("Senha deve ter pelo menos 6 caracteres.");
      return;
    }
    if (password !== password2) {
      setError("As senhas não conferem.");
      return;
    }

    try {
      setSaving(true);
      const res = await fetch("/api/admin/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: username.trim(), password: password.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as any)?.message || (data as any)?.error || "Falha ao salvar.";
        throw new Error(msg);
      }

      setPassword("");
      setPassword2("");
      setOkMsg("Credenciais salvas. Todas as sessões antigas foram invalidadas.");
      await load();
      setTimeout(() => setOkMsg(null), 2000);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function onInvalidateSessions() {
    setError(null);
    setOkMsg(null);
    const confirm = window.confirm(
      "Isso vai deslogar todas as sessões admin atuais (inclusive a sua). Você terá que logar novamente. Confirmar?"
    );
    if (!confirm) return;

    try {
      setRotating(true);
      const res = await fetch("/api/admin/credentials/invalidate", {
        method: "POST",
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as any)?.message || (data as any)?.error || "Falha ao invalidar sessões.";
        throw new Error(msg);
      }

      setOkMsg("Sessões invalidadas. Faça login novamente se necessário.");
      await load();
      setTimeout(() => setOkMsg(null), 2000);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRotating(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4">
      <div className="rounded-lg border bg-white p-4">
        <h1 className="text-lg font-semibold">Configurações → Admin</h1>
        <p className="mt-1 text-sm text-gray-600">
          Defina usuário/senha do painel admin armazenados no Postgres (hash). O <code>NEXTIA_ADMIN_KEY</code> continua como bootstrap/recovery.
        </p>
      </div>

      {loading ? (
        <div className="rounded-lg border bg-white p-4 text-sm text-gray-600">Carregando...</div>
      ) : null}

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      ) : null}

      {okMsg ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{okMsg}</div>
      ) : null}

      {state ? (
        <div className="rounded-lg border bg-white p-4">
          <div className="grid gap-2 text-sm text-gray-700 sm:grid-cols-2">
            <div>
              <span className="font-medium">Credencial persistida:</span>{" "}
              {state.hasCredentials ? <span className="text-emerald-700">SIM</span> : <span className="text-amber-700">NÃO</span>}
            </div>
            <div>
              <span className="font-medium">Usuário atual:</span> {state.username ?? "—"}
            </div>
            <div>
              <span className="font-medium">Session version:</span> {state.sessionVersion}
            </div>
            <div className="text-xs text-gray-500">
              Dica: depois de salvar credenciais aqui, você pode remover <code>NEXTIA_ADMIN_PASS</code> do .env (opcional).
            </div>
          </div>

          <hr className="my-4" />

          <form onSubmit={onSave} className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Usuário</span>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                />
              </label>

              <div className="hidden sm:block" />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium text-gray-700">Nova senha</span>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-gray-700">Confirmar senha</span>
                <input
                  className="mt-1 w-full rounded-md border px-3 py-2 text-sm"
                  type="password"
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar credenciais (e invalidar sessões)"}
              </button>

              <button
                type="button"
                disabled={rotating}
                onClick={onInvalidateSessions}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 disabled:opacity-60"
              >
                {rotating ? "Invalidando..." : "Invalidar sessões (sem trocar senha)"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {!state && !loading ? (
        <div className="rounded-lg border bg-white p-4 text-sm text-gray-700">
          Você não está autenticado como admin, ou a API retornou 401. Faça login em <code>/admin-login</code> e recarregue.
        </div>
      ) : null}
    </div>
  );
}
