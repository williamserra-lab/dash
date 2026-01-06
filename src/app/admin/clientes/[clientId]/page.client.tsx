"use client";

import { useMemo, useState } from "react";

type ClientStatus = "active" | "inactive";

type ClientRecord = {
  id: string;
  name: string;
  status: ClientStatus;
  profile?: Record<string, any> | null;
  plan?: Record<string, any> | null;
  access?: Record<string, any> | null;
  billing?: Record<string, any> | null;
  whatsappNumbers?: Array<any> | null;
  segment?: string | null;
};

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export default function AdminClienteEditor({ initialClient }: { initialClient: ClientRecord }) {
  const [client, setClient] = useState<ClientRecord>(initialClient);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const preorderExpiresHours = useMemo(() => {
    const v = (client.profile || {})["preorderExpiresHours"];
    return v === undefined || v === null ? "" : String(v);
  }, [client.profile]);

  async function savePatch(patch: Partial<ClientRecord>) {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/admin/clients/${encodeURIComponent(client.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.message || json?.error || `HTTP ${res.status}`);
      }
      setClient(json.client || client);
      setMsg("Salvo.");
    } catch (e) {
      setMsg(`Erro: ${getErrorMessage(e)}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded border p-4 space-y-4">
      <h2 className="font-semibold">Configuração</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="space-y-1">
          <div className="text-sm opacity-80">Nome</div>
          <input
            className="w-full border rounded px-3 py-2"
            value={client.name}
            onChange={(e) => setClient({ ...client, name: e.target.value })}
            placeholder="Nome do cliente"
          />
        </label>

        <label className="space-y-1">
          <div className="text-sm opacity-80">Status</div>
          <select
            className="w-full border rounded px-3 py-2"
            value={client.status}
            onChange={(e) => setClient({ ...client, status: e.target.value as ClientStatus })}
          >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </label>

        <label className="space-y-1">
          <div className="text-sm opacity-80">Pré-pedido expira (horas)</div>
          <input
            className="w-full border rounded px-3 py-2 font-mono"
            value={preorderExpiresHours}
            onChange={(e) => {
              const v = e.target.value;
              const profile = { ...(client.profile || {}) };
              if (!v) delete profile.preorderExpiresHours;
              else profile.preorderExpiresHours = v;
              setClient({ ...client, profile });
            }}
            placeholder="ex: 24"
          />
          <div className="text-xs opacity-70">
            Se vazio, usa NEXTIA_PREORDER_EXPIRES_HOURS (env). Guard-rails: 1h..720h.
          </div>
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          disabled={saving}
          className="px-3 py-2 rounded border hover:bg-black/5 text-sm disabled:opacity-60"
          onClick={() =>
            savePatch({
              name: client.name,
              status: client.status,
              profile: client.profile || undefined,
            })
          }
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>

      {msg ? <div className="text-sm">{msg}</div> : null}

      <details className="rounded border p-3">
        <summary className="cursor-pointer text-sm">Ver JSON do cliente (debug)</summary>
        <pre className="mt-2 text-xs overflow-auto">{JSON.stringify(client, null, 2)}</pre>
      </details>
    </section>
  );
}
