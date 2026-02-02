"use client";

import { useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Controles simples de sessão para facilitar debug em ambiente interno:
 * - mostra rota atual (path + query)
 * - permite deslogar rapidamente (limpa cookie httpOnly via endpoint)
 */
export function SessionControls() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentRoute = useMemo(() => {
    const qs = searchParams?.toString() || "";
    return qs ? `${pathname}?${qs}` : pathname;
  }, [pathname, searchParams]);

  async function onLogout() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/auth/logout", {
        method: "POST",
        credentials: "include",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.message || data?.error || "Falha ao sair.");
      }

      // Força recarregar no fluxo canônico (e permite observar o caminho).
      window.location.href = "/login";
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className="hidden max-w-[360px] truncate rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600 md:block"
        title={currentRoute}
        aria-label="Rota atual"
      >
        {currentRoute}
      </div>
      <button
        type="button"
        onClick={onLogout}
        disabled={loading}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
      >
        {loading ? "Saindo..." : "Sair"}
      </button>
      {error ? (
        <span className="max-w-[220px] truncate text-xs text-red-600" title={error}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

export default SessionControls;
