// src/components/ClientSelector.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}


type ClientConfig = {
  id: string;
  name: string;
  segment?: string;
  status?: "active" | "inactive";
};

export function ClientSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [clients, setClients] = useState<ClientConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentClientId = (searchParams.get("clientId") || "").trim();

  const activeClients = useMemo(
    () => clients.filter((c) => (c.status || "active") === "active"),
    [clients]
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/clients", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Erro ao carregar clientes.");
        setClients(data.clients || []);
      } catch (e: unknown) {
        setError(getErrorMessage(e) || "Erro ao carregar clientes.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // Se não houver clientId no URL, tentamos selecionar o primeiro cliente ativo.
  useEffect(() => {
    if (!loading && !currentClientId && activeClients.length > 0) {
      const params = new URLSearchParams(searchParams.toString());
      params.set("clientId", activeClients[0].id);
      router.replace(`${pathname}?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, currentClientId, activeClients.length]);

  function handleChange(nextId: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("clientId", nextId);
    router.push(`${pathname}?${params.toString()}`);
  }

  if (loading) {
    return <div className="text-xs text-slate-500 dark:text-slate-400">Carregando clientes...</div>;
  }

  if (error) {
    // Em produção para lojistas, não exponha detalhe de erro (pode revelar que existe endpoint interno)
    return (
      <div className="text-xs text-slate-600 dark:text-slate-300">
        Cliente não disponível.
      </div>
    );
  }

  if (activeClients.length === 0) {
    return (
      <div className="text-xs text-slate-600 dark:text-slate-300">
        Nenhum cliente disponível.
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs font-medium text-slate-600 dark:text-slate-300">Cliente</label>
      <select
        value={currentClientId || activeClients[0].id}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900
                   focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500
                   dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
      >
        {activeClients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name} ({c.id})
          </option>
        ))}
      </select>
    </div>
  );
}

export default ClientSelector;
