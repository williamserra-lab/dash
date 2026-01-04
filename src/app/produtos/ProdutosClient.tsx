"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Product = {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  currency: string;
  active: boolean;
  imageUrl?: string;
  updatedAt: string;
};

type CatalogStatus = {
  ready: boolean;
  activeProducts: number;
  issues: Array<{ code: string; message: string; count: number }>;
};

function formatBRL(priceCents: number) {
  const n = Number(priceCents || 0) / 100;
  return `R$ ${n.toFixed(2)}`.replace(".", ",");
}

export default function ProdutosClient() {
  const sp = useSearchParams();
  const clientId = (sp.get("clientId") || "").trim();

  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<CatalogStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<Product | null>(null);
  const [draft, setDraft] = useState<any>({});
  const isNew = useMemo(() => Boolean(editing && editing.id === "__new__"), [editing]);

  async function loadAll() {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const [pRes, sRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/products`, { cache: "no-store" }),
        fetch(`/api/clients/${clientId}/catalog-status`, { cache: "no-store" }),
      ]);
      const pj = await pRes.json();
      const sj = await sRes.json();
      setProducts((pj.products || []) as Product[]);
      setStatus((sj.status || null) as CatalogStatus | null);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  function openNew() {
    setEditing({
      id: "__new__",
      name: "",
      description: "",
      priceCents: 0,
      currency: "BRL",
      active: true,
      updatedAt: new Date().toISOString(),
    });
    setDraft({ name: "", description: "", price: "", active: true });
  }

  function openEdit(p: Product) {
    setEditing(p);
    setDraft({
      name: p.name,
      description: p.description,
      price: p.priceCents ? String((p.priceCents / 100).toFixed(2)).replace(".", ",") : "",
      active: p.active !== false,
      imageUrl: p.imageUrl || "",
    });
  }

  async function saveDraft() {
    if (!clientId || !editing) return;
    setError(null);
    const body: any = {
      name: String(draft.name || "").trim(),
      description: String(draft.description || ""),
      price: String(draft.price || "").trim(),
      active: draft.active !== false,
      imageUrl: String(draft.imageUrl || "").trim() || undefined,
    };

    try {
      let res: Response;
      if (isNew) {
        res = await fetch(`/api/clients/${clientId}/products`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`/api/clients/${clientId}/products/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setEditing(null);
      setDraft({});
      await loadAll();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  async function removeProduct(p: Product) {
    if (!clientId) return;
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/products/${p.id}`, { method: "DELETE" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      await loadAll();
    } catch (e: any) {
      setError(String(e?.message || e));
    }
  }

  if (!clientId) {
    return (
      <div className="p-6 max-w-3xl">
        <h1 className="text-xl font-semibold">Produtos</h1>
        <p className="mt-2 text-sm text-gray-600">Abra por um cliente: <code className="px-1">/produtos?clientId=...</code></p>
        <p className="mt-2 text-sm">
          <Link className="underline" href="/clientes">Voltar para clientes</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Catálogo de produtos</h1>
          <p className="text-sm text-gray-600">Cliente: <span className="font-mono">{clientId}</span></p>
        </div>
        <div className="flex gap-3">
          <Link className="px-3 py-2 rounded border" href={`/assistente?clientId=${encodeURIComponent(clientId)}`}>Assistente</Link>
          <Link className="px-3 py-2 rounded border" href="/clientes">Clientes</Link>
        </div>
      </div>

      <div className="mt-4 p-4 rounded border bg-white">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-medium">Status do catálogo</div>
            {status ? (
              <div className="mt-1 text-sm">
                <div>
                  Pré-pedido: {status.ready ? (
                    <span className="font-semibold text-green-700">LIBERADO</span>
                  ) : (
                    <span className="font-semibold text-red-700">BLOQUEADO</span>
                  )}
                </div>
                {!status.ready && status.issues.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-gray-700">
                    {status.issues.map((it, idx) => (
                      <li key={idx}>{it.message}{typeof it.count === "number" && it.count ? ` (${it.count})` : ""}</li>
                    ))}
                  </ul>
                )}
                <p className="mt-2 text-gray-600">
                  Regra: para reduzir risco, o bot só pode transformar conversa em pré-pedido quando cada produto ativo tiver <b>descrição</b> e <b>preço</b>.
                </p>
              </div>
            ) : (
              <div className="mt-1 text-sm text-gray-600">Carregando...</div>
            )}
          </div>
          <button onClick={openNew} className="px-3 py-2 rounded bg-black text-white">Novo produto</button>
        </div>
      </div>

      {error && (
        <div className="mt-4 p-3 rounded border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>
      )}

      <div className="mt-4 rounded border bg-white overflow-hidden">
        <div className="grid grid-cols-12 gap-3 p-3 bg-gray-50 text-xs font-semibold text-gray-600">
          <div className="col-span-4">Produto</div>
          <div className="col-span-4">Descrição</div>
          <div className="col-span-2">Preço</div>
          <div className="col-span-1">Ativo</div>
          <div className="col-span-1 text-right">Ações</div>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-gray-600">Carregando...</div>
        ) : products.length === 0 ? (
          <div className="p-4 text-sm text-gray-600">Nenhum produto cadastrado.</div>
        ) : (
          products.map((p) => (
            <div key={p.id} className="grid grid-cols-12 gap-3 p-3 border-t">
              <div className="col-span-4">
                <div className="font-medium">{p.name}</div>
                <div className="text-xs text-gray-500 font-mono">{p.id}</div>
              </div>
              <div className="col-span-4 text-sm text-gray-700 whitespace-pre-wrap">{(p.description || "").slice(0, 160)}{(p.description || "").length > 160 ? "…" : ""}</div>
              <div className="col-span-2 text-sm">{p.priceCents ? formatBRL(p.priceCents) : <span className="text-red-700">(sem preço)</span>}</div>
              <div className="col-span-1 text-sm">{p.active !== false ? "Sim" : "Não"}</div>
              <div className="col-span-1 text-right">
                <button className="text-sm underline" onClick={() => openEdit(p)}>Editar</button>
              </div>
            </div>
          ))
        )}
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded border shadow">
            <div className="p-4 border-b flex items-center justify-between">
              <div className="font-semibold">{isNew ? "Novo produto" : "Editar produto"}</div>
              <button className="text-sm underline" onClick={() => setEditing(null)}>Fechar</button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-sm font-medium">Nome *</label>
                <input className="mt-1 w-full p-2 border rounded" value={draft.name || ""} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              </div>
              <div>
                <label className="text-sm font-medium">Descrição *</label>
                <textarea className="mt-1 w-full p-2 border rounded min-h-[110px]" value={draft.description || ""} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                <p className="mt-1 text-xs text-gray-600">Obrigatório: ingredientes, tamanho/gramatura, o que acompanha, variações, restrições (ex.: sem glúten), etc.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm font-medium">Preço (R$) *</label>
                  <input className="mt-1 w-full p-2 border rounded" placeholder="Ex.: 12,90" value={draft.price || ""} onChange={(e) => setDraft({ ...draft, price: e.target.value })} />
                </div>
                <div className="flex items-end gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={draft.active !== false} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
                    Ativo
                  </label>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">Imagem (opcional)</label>
                <input className="mt-1 w-full p-2 border rounded" placeholder="URL" value={draft.imageUrl || ""} onChange={(e) => setDraft({ ...draft, imageUrl: e.target.value })} />
              </div>
            </div>
            <div className="p-4 border-t flex items-center justify-between">
              {!isNew && (
                <button className="px-3 py-2 rounded border border-red-300 text-red-700" onClick={() => removeProduct(editing)}>Excluir</button>
              )}
              <div className="ml-auto flex gap-2">
                <button className="px-3 py-2 rounded border" onClick={() => setEditing(null)}>Cancelar</button>
                <button className="px-3 py-2 rounded bg-black text-white" onClick={saveDraft}>Salvar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
