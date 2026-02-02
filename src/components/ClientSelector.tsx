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

function extractClientIdFromPath(pathname: string): string {
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length === 0) return "";

  // Canonical V1: /clientes/[clientId]/...
  if (segs[0] === "clientes" && segs[1]) return segs[1];

  // Legacy: /painel/[clientId]
  if (segs[0] === "painel" && segs[1] && segs[1] !== "chat") return segs[1];

  // Admin ops: /admin/clientes/[clientId]
  if (segs[0] === "admin" && segs[1] === "clientes" && segs[2]) return segs[2];

  return "";
}

export function ClientSelector() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [clients, setClients] = useState<ClientConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const currentClientId = (
    extractClientIdFromPath(pathname) ||
    (searchParams.get("clientId") || "")
  ).trim();

  const activeClients = useMemo(
    () => clients.filter((c) => (c.status || "active") === "active"),
    [clients]
  );

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/clients", { cache: "no-store", credentials: "include" });
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

  // If clientId is missing, set default selection WITHOUT navigating away from /clientes.
  useEffect(() => {
    if (!loading && !currentClientId && activeClients.length > 0) {
      const first = activeClients[0].id;

      // /clientes is the registry (create/edit/list). Never auto-navigate away.
      if (pathname === "/clientes") return;

      // Legacy: /painel -> /painel/{id}
      if (pathname === "/painel") {
        router.replace(`/painel/${encodeURIComponent(first)}`);
        return;
      }

      // Fallback: keep legacy query param behavior for non-canonical pages.
      const params = new URLSearchParams(searchParams.toString());
      params.set("clientId", first);
      router.replace(`${pathname}?${params.toString()}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, currentClientId, activeClients.length, pathname]);

  function handleChange(nextId: string) {
    const segs = pathname.split("/").filter(Boolean);

    // Canonical: /clientes and /clientes/[clientId]/...
    if (segs[0] === "clientes") {
      if (segs.length === 1) {
        router.push(`/clientes/${encodeURIComponent(nextId)}/painel`);
        return;
      }
      const nextSegs = [...segs];
      nextSegs[1] = nextId;
      router.push(`/${nextSegs.map((s, i) => (i === 1 ? encodeURIComponent(s) : s)).join("/")}`);
      return;
    }

    // Legacy: /painel/[clientId]/...
    if (segs[0] === "painel") {
      if (segs.length === 1) {
        router.push(`/painel/${encodeURIComponent(nextId)}`);
        return;
      }
      if (segs[1] && segs[1] !== "chat") {
        const nextSegs = [...segs];
        nextSegs[1] = nextId;
        router.push(`/${nextSegs.map((s, i) => (i === 1 ? encodeURIComponent(s) : s)).join("/")}`);
        return;
      }
    }

    // Admin: /admin/clientes/[clientId]
    if (segs[0] === "admin" && segs[1] === "clientes") {
      const nextSegs = [...segs];
      if (nextSegs.length >= 3) nextSegs[2] = nextId;
      router.push(`/${nextSegs.map((s, i) => (i === 2 ? encodeURIComponent(s) : s)).join("/")}`);
      return;
    }

    // Fallback: keep legacy query param behavior.
    const params = new URLSearchParams(searchParams.toString());
    params.set("clientId", nextId);
    router.push(`${pathname}?${params.toString()}`);
  }

  if (loading) {
    return <div className="text-xs text-slate-500 dark:text-slate-400">Carregando clientes...</div>;
  }

  if (error) {
    return <div className="text-xs text-slate-600 dark:text-slate-300">Cliente não disponível.</div>;
  }

  if (activeClients.length === 0) {
    return <div className="text-xs text-slate-600 dark:text-slate-300">Nenhum cliente disponível.</div>;
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
