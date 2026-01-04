"use client";

// src/app/midias/page.tsx
// Página de gerenciamento de arquivos de mídia que o bot pode enviar.
//
// Escopo: manter MÍDIAS separadas das CONFIGURAÇÕES DO ASSISTENTE.
// Configurações do assistente ficam em /assistente?clientId=...

"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { MediaAsset } from "@/lib/mediaAssets";

function getErrorMessage(err: unknown): string | null {
  if (!err) return null;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || null;
  if (typeof err === "object") {
    const maybe = err as { message?: unknown };
    if (typeof maybe.message === "string") return maybe.message;
  }
  return null;
}

void normalizeText;

type UploadState = "idle" | "uploading" | "success" | "error";

type ApiQuota = {
  usedBytes: number;
  maxBytes: number; // total por cliente
  maxFileBytes: number; // limite por arquivo
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export default function MidiasPage() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("clientId") ?? "";

  const [mediaList, setMediaList] = useState<MediaAsset[]>([]);
  const [quota, setQuota] = useState<ApiQuota | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [externalUrl, setExternalUrl] = useState("");
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [sourceType, setSourceType] = useState<"upload" | "external">("upload");

  const [category, setCategory] = useState<string>("cardapio");
  const [enabled, setEnabled] = useState(true);
  const [allowedIntents, setAllowedIntents] = useState<string[]>(["pedir_cardapio"]);
  const [priceTableOfficial, setPriceTableOfficial] = useState(false);

  
  // Delivery pricing (MVP): fixed fee OR by neighborhood.
  type DeliveryMode = "fixed" | "by_neighborhood";
  type DeliveryRow = { neighborhood: string; fee: string; etaMinutes?: string; note?: string };

  const [deliveryMode, setDeliveryMode] = useState<DeliveryMode>("by_neighborhood");
  const [deliveryFixedFee, setDeliveryFixedFee] = useState<string>("");
  const [deliveryRows, setDeliveryRows] = useState<DeliveryRow[]>([
    { neighborhood: "", fee: "" },
  ]);
  const [deliverySaving, setDeliverySaving] = useState(false);
  const [deliveryError, setDeliveryError] = useState<string | null>(null);
  const [deliveryLoaded, setDeliveryLoaded] = useState(false);

  function isPickupNeighborhoodLabel(value: string): boolean {
    const v = value.trim().toLowerCase();
    return v === "retirada" || v === "retirar" || v === "pickup" || v === "coleta";
  }

  function parseMoneyToCentsBr(value: string): number | null {
    const t = value.trim();
    if (!t) return null;
    const normalized = t.replace(/\./g, "").replace(",", ".");
    const num = Number(normalized);
    if (!Number.isFinite(num)) return null;
    const cents = Math.round(num * 100);
    if (cents < 0) return null;
    return cents;
  }

  async function loadDeliveryPricing() {
    if (!clientId) return;
    setDeliveryError(null);

    const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/delivery-pricing`, { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDeliveryError(json?.error || "Falha ao carregar tabela de delivery.");
      setDeliveryLoaded(true);
      return;
    }

    const cfg = json?.config as any;
    if (!cfg) {
      setDeliveryLoaded(true);
      return;
    }

    if (cfg.mode === "fixed") {
      setDeliveryMode("fixed");
      const cents = typeof cfg.fixedFeeCents === "number" ? cfg.fixedFeeCents : 0;
      setDeliveryFixedFee((cents / 100).toFixed(2).replace(".", ","));
      setDeliveryRows([{ neighborhood: "", fee: "" }]);
    } else {
      setDeliveryMode("by_neighborhood");
      const rows = Array.isArray(cfg.byNeighborhood) ? cfg.byNeighborhood : [];
      setDeliveryRows(
        rows.length
          ? rows.map((r: any) => ({
              neighborhood: String(r.neighborhood ?? ""),
              fee: ((Number(r.feeCents ?? 0) as number) / 100).toFixed(2).replace(".", ","),
              etaMinutes: r.etaMinutes !== undefined ? String(r.etaMinutes) : "",
              note: r.note ? String(r.note) : "",
            }))
          : [{ neighborhood: "", fee: "" }]
      );
      setDeliveryFixedFee("");
    }

    setDeliveryLoaded(true);
  }

  async function saveDeliveryPricing() {
    if (!clientId) return;
    setDeliverySaving(true);
    setDeliveryError(null);

    try {
      let payload: any;

      if (deliveryMode === "fixed") {
        const cents = parseMoneyToCentsBr(deliveryFixedFee);
        if (cents === null) throw new Error("Informe uma taxa fixa válida (ex.: 8,00).");
        payload = { mode: "fixed", fixedFeeCents: cents };
      } else {
        const rows = deliveryRows
          .map((r) => ({
            neighborhood: r.neighborhood.trim(),
            feeCents: parseMoneyToCentsBr(r.fee),
            etaMinutes: r.etaMinutes ? Number(r.etaMinutes) : undefined,
            note: r.note?.trim() || undefined,
          }))
          .filter((r) => r.neighborhood || r.feeCents !== null);

        if (!rows.length) throw new Error("Informe pelo menos 1 bairro.");
        for (const r of rows) {
          if (!r.neighborhood) throw new Error("Bairro obrigatório.");
          if (isPickupNeighborhoodLabel(r.neighborhood)) {
            throw new Error('Não use "Retirada" na tabela de delivery. Retirada é outro fluxo.');
          }
          if (r.feeCents === null) throw new Error(`Taxa inválida para o bairro "${r.neighborhood}".`);
          if (r.etaMinutes !== undefined && (!Number.isInteger(r.etaMinutes) || r.etaMinutes < 0)) {
            throw new Error(`Tempo estimado inválido para o bairro "${r.neighborhood}".`);
          }
        }

        payload = { mode: "by_neighborhood", byNeighborhood: rows.map(({ feeCents, ...rest }) => ({ ...rest, feeCents })) };
      }

      const res = await fetch(`/api/clients/${encodeURIComponent(clientId)}/delivery-pricing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.error || "Falha ao salvar tabela de delivery.");

      // reload to ensure canonical formatting
      await loadDeliveryPricing();
    } catch (err: unknown) {
      setDeliveryError(getErrorMessage(err) || "Erro ao salvar.");
    } finally {
      setDeliverySaving(false);
    }
  }
const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const usedBytes = quota?.usedBytes ?? 0;
  const maxBytes = quota?.maxBytes ?? 0;
  const maxFileBytes = quota?.maxFileBytes ?? 0;
  const remainingBytes = Math.max(maxBytes - usedBytes, 0);

  const usedPercent = maxBytes > 0 ? Math.min((usedBytes / maxBytes) * 100, 100) : 0;

  const storageLabel = quota
    ? `${formatBytes(usedBytes)} de ${formatBytes(maxBytes)} utilizados`
    : "Carregando uso de armazenamento...";

  const fileLimitLabel = useMemo(() => {
    if (!quota) return "Limites: carregando...";
    const perFile = quota.maxFileBytes ? formatBytes(quota.maxFileBytes) : "—";
    const total = quota.maxBytes ? formatBytes(quota.maxBytes) : "—";
    return `Limite por arquivo: ${perFile} • Total por cliente: ${total}`;
  }, [quota]);

  const intentsCatalog: { id: string; label: string; hint: string }[] = [
    { id: "pedir_cardapio", label: "Cardápio/serviços", hint: "Quando o cliente pede cardápio/serviços" },
    { id: "pedir_preco", label: "Preços", hint: "Quando o cliente pergunta valores" },
    { id: "pedir_catalogo", label: "Catálogo/produtos", hint: "Quando o cliente pede catálogo" },
    { id: "pedir_institucional", label: "Institucional", hint: "Horários, endereço, políticas, etc." },
  ];

  function toggleIntent(intentId: string) {
    setAllowedIntents((prev) => {
      if (prev.includes(intentId)) return prev.filter((x) => x !== intentId);
      return [...prev, intentId];
    });
  }

  useEffect(() => {
    if (!clientId) return;

    async function loadData() {
      setIsLoading(true);
      setErrorMessage(null);

      try {
        const [mediaRes, quotaRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/media-assets`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          }),
          fetch(`/api/clients/${clientId}/media-quota`, {
            method: "GET",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
          }),
        ]);

        if (!mediaRes.ok) throw new Error("Erro ao carregar arquivos de mídia");
        if (!quotaRes.ok) throw new Error("Erro ao carregar quota de mídia");

        const mediaData = (await mediaRes.json()) as { media?: MediaAsset[]; items?: MediaAsset[] };
        const quotaData = (await quotaRes.json()) as ApiQuota;

        setMediaList(mediaData.items ?? mediaData.media ?? []);
        setQuota(quotaData);
      } catch (error: unknown) {
        console.error(error);
        setErrorMessage(getErrorMessage(error) ?? "Erro inesperado ao carregar dados");
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
    loadDeliveryPricing();
  }, [clientId]);

  function resetForm() {
    setFile(null);
    setExternalUrl("");
    setLabel("");
    setDescription("");
    setCategory("cardapio");
    setEnabled(true);
    setAllowedIntents(["pedir_cardapio"]);
    setPriceTableOfficial(false);
    setUploadState("idle");
    setErrorMessage(null);
  }

  function handleFileChange(next: File | null) {
    setFile(next);
    setUploadState("idle");
    setErrorMessage(null);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!clientId) {
      setErrorMessage("Informe o clientId na URL (?clientId=...)");
      return;
    }

    setUploadState("uploading");
    setErrorMessage(null);

    try {
      // Validação simples de limites, para evitar tentativa inútil
      if (sourceType === "upload") {
        if (!file) throw new Error("Selecione um arquivo para enviar.");
        if (maxFileBytes > 0 && file.size > maxFileBytes) {
          throw new Error(`Arquivo acima do limite por arquivo (${formatBytes(maxFileBytes)}).`);
        }
        if (maxBytes > 0 && file.size > remainingBytes) {
          throw new Error("Sem espaço: esse arquivo excede o limite total do cliente.");
        }
      } else {
        if (!externalUrl) throw new Error("Informe a URL externa.");
      }

      // 1) Upload físico (se aplicável)
      let finalUrl = externalUrl.trim();
      let finalType = "url";

      if (sourceType === "upload" && file) {
        const formData = new FormData();
        formData.append("file", file);

        const uploadRes = await fetch(`/api/clients/${clientId}/media-upload`, {
          method: "POST",
          body: formData,
        });

        if (!uploadRes.ok) {
          const errJson = await uploadRes.json().catch(() => null);
          throw new Error(errJson?.error ?? "Falha ao fazer upload do arquivo.");
        }

        const uploadJson = (await uploadRes.json()) as { url: string; fileName?: string; mimeType?: string };
        finalUrl = uploadJson.url;
        finalType = uploadJson.mimeType ?? "file";
      }

      // 2) Registrar MediaAsset (JSON)
      const payload: Record<string, unknown> = {
        url: finalUrl,
        label: label.trim() || undefined,
        description: description.trim() || undefined,
        category,
        type: finalType,
        enabled,
        allowedIntents,
        meta: {
          priceTableOfficial: priceTableOfficial || undefined,
        },
      };

      const res = await fetch(`/api/clients/${clientId}/media-assets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        const msg = errorJson?.error ?? errorJson?.message ?? "Erro ao cadastrar arquivo de mídia.";
        throw new Error(msg);
      }

      const data = (await res.json()) as { media: MediaAsset };
      setMediaList((prev) => [data.media, ...prev]);
      setUploadState("success");
      resetForm();
    } catch (err: unknown) {
      console.error(err);
      setUploadState("error");
      setErrorMessage(getErrorMessage(err) ?? "Erro ao cadastrar arquivo de mídia.");
    }
  }

  async function handleDelete(id: string) {
    if (!clientId) return;

    try {
      const res = await fetch(`/api/clients/${clientId}/media-assets?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => null);
        throw new Error(errorJson?.error ?? "Erro ao excluir mídia.");
      }

      setMediaList((prev) => prev.filter((m) => m.id !== id));
    } catch (err: unknown) {
      console.error(err);
      setErrorMessage(getErrorMessage(err) ?? "Erro ao excluir mídia.");
    }
  }

  const filteredMedia = mediaList.filter((m) => m.clientId === clientId || !m.clientId);

  return (
    <main className="flex min-h-screen flex-col bg-slate-50">
      <div className="w-full border-b border-slate-200 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              Mídias do assistente (inclui tabela de preços)
            </h1>
            <p className="mt-1 max-w-xl text-xs text-slate-600">
              Cadastre cardápios, catálogos, tabelas de preços e outros arquivos fixos que o assistente usa no WhatsApp.
            </p>
          </div>

          <div className="flex items-end gap-4">
            <div className="text-right">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Armazenamento</p>
              <p className="text-xs text-slate-700">{storageLabel}</p>
              <p className="mt-0.5 text-[11px] text-slate-500">{fileLimitLabel}</p>
              {quota && (
                <div className="mt-1 h-1.5 w-56 rounded-full bg-slate-100">
                  <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${usedPercent.toFixed(0)}%` }} />
                </div>
              )}
            </div>

            <a
              href={`/assistente?clientId=${encodeURIComponent(clientId)}`}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Configurar assistente
            </a>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
        {!clientId && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Abra esta página com <code>?clientId=seu_cliente</code> para gerenciar mídias.
          </div>
        )}

        {errorMessage && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            {errorMessage}
          </div>
        )}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Adicionar mídia</h2>
              <p className="mt-1 text-xs text-slate-600">
                Para preço, marque uma única <strong>tabela oficial</strong>. Para o bot usar a mídia, selecione os intents.
              </p>
            </div>

            {uploadState === "success" && (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                Salvo com sucesso
              </span>
            )}
          </div>

          <form onSubmit={handleSubmit} className="mt-4 space-y-4 border-t border-slate-100 pt-4">
            <div className="grid gap-4 md:grid-cols-[220px,1fr]">
              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Origem</p>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="sourceType"
                    value="upload"
                    checked={sourceType === "upload"}
                    onChange={() => setSourceType("upload")}
                  />
                  Upload do arquivo
                </label>

                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="radio"
                    name="sourceType"
                    value="external"
                    checked={sourceType === "external"}
                    onChange={() => setSourceType("external")}
                  />
                  URL externa
                </label>
              </div>

              <div className="space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                  {sourceType === "upload" ? "Arquivo" : "URL"}
                </p>

                {sourceType === "upload" ? (
                  <div className="flex flex-col gap-2">
                    <input
                      ref={fileInputRef}
                      type="file"
                      className="hidden"
                      onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                      >
                        Escolher arquivo
                      </button>
                      <p className="text-xs text-slate-700">
                        {file ? file.name : "Nenhum arquivo selecionado"}
                      </p>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Dica: arquivos maiores aumentam custo e tempo de envio. Mantenha o essencial.
                    </p>
                  </div>
                ) : (
                  <input
                    type="url"
                    value={externalUrl}
                    onChange={(e) => setExternalUrl(e.target.value)}
                    placeholder="https://exemplo.com/arquivo.pdf"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                  />
                )}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Nome (visível)</p>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Ex: Cardápio Dez/2025"
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                />
              </div>

              <div>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Categoria</p>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
                >
                  <option value="cardapio">Cardápio / serviços</option>
                  <option value="tabela_precos">Tabela de preços</option>
                  <option value="catalogo">Catálogo / produtos</option>
                  <option value="institucional">Institucional</option>
                  <option value="outros">Outros</option>
                </select>
              </div>
            </div>

            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Descrição (interna)</p>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Usar para responder preços de delivery. Atualizado em 02/12/2025."
                className="mt-2 min-h-[70px] w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-slate-400"
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Quando o assistente pode usar</p>
                <div className="mt-3 grid gap-2">
                  {intentsCatalog.map((it) => (
                    <label key={it.id} className="flex items-start gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={allowedIntents.includes(it.id)}
                        onChange={() => toggleIntent(it.id)}
                        className="mt-1"
                      />
                      <span>
                        <span className="font-medium">{it.label}</span>
                        <span className="block text-[11px] text-slate-500">{it.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Controles</p>
                <div className="mt-3 grid gap-3">
                  <label className="flex items-center justify-between gap-3 text-sm text-slate-800">
                    <span>Ativo</span>
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                  </label>

                  <label className="flex items-start justify-between gap-3 text-sm text-slate-800">
                    <span>
                      Tabela oficial de preços
                      <span className="block text-[11px] text-slate-500">
                        Marque apenas uma por cliente (o sistema desmarca as demais).
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={priceTableOfficial}
                      onChange={(e) => setPriceTableOfficial(e.target.checked)}
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                type="submit"
                disabled={!clientId || uploadState === "uploading"}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-60"
              >
                {uploadState === "uploading" ? "Salvando..." : "Salvar mídia"}
              </button>

              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
              >
                Limpar
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Arquivos do cliente</h2>
            {isLoading && <span className="text-xs text-slate-500">Carregando...</span>}
          </div>

          <div className="mt-4 divide-y divide-slate-100">
            {filteredMedia.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-500">Nenhuma mídia cadastrada.</p>
            )}

            {filteredMedia.map((m) => (
              <div key={m.id} className="flex flex-col gap-2 py-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">
                    {m.label ?? m.url}
                    {!m.enabled && (
                      <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        Inativo
                      </span>
                    )}
                    {m.meta?.priceTableOfficial && (
                      <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        Tabela oficial
                      </span>
                    )}
                  </p>
                  <p className="mt-1 truncate text-xs text-slate-500">{m.url}</p>
                  <p className="mt-1 text-[11px] text-slate-500">
                    Categoria: {m.category ?? "—"} • Intents: {(m.allowedIntents ?? []).join(", ") || "—"}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <a
                    href={m.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                  >
                    Abrir
                  </a>
                  <button
                    onClick={() => handleDelete(m.id)}
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                  >
                    Excluir
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    
      <section className="mx-auto w-full max-w-6xl px-4 pb-10">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-slate-900">Tabela de entrega (Delivery)</h2>
            <p className="text-xs text-slate-600">
              Configure a taxa de entrega para o assistente preencher quando o pedido for <span className="font-medium">Entrega</span>. Retirada é outro fluxo (taxa = 0) e <span className="font-medium">não entra</span> nesta tabela.
            </p>
          </div>

          {!clientId && (
            <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Selecione um cliente (clientId) para configurar o delivery.
            </div>
          )}

          {clientId && (
            <div className="mt-4 grid gap-4">
              {!deliveryLoaded && (
                <div className="text-sm text-slate-600">Carregando tabela de delivery...</div>
              )}

              {deliveryError && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  {deliveryError}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-3">
                <label className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="deliveryMode"
                      checked={deliveryMode === "fixed"}
                      onChange={() => setDeliveryMode("fixed")}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-900">Valor único</div>
                      <div className="text-xs text-slate-600">Uma taxa fixa para entrega.</div>
                    </div>
                  </div>
                </label>

                <label className="rounded-xl border border-slate-200 p-3 md:col-span-2">
                  <div className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="deliveryMode"
                      checked={deliveryMode === "by_neighborhood"}
                      onChange={() => setDeliveryMode("by_neighborhood")}
                      className="mt-1"
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-900">Por bairro</div>
                      <div className="text-xs text-slate-600">O assistente pergunta o bairro e aplica a taxa.</div>
                    </div>
                  </div>
                </label>
              </div>

              {deliveryMode === "fixed" && (
                <div className="grid gap-2 md:max-w-sm">
                  <label className="text-sm font-medium text-slate-800">Taxa fixa (R$)</label>
                  <input
                    value={deliveryFixedFee}
                    onChange={(e) => setDeliveryFixedFee(e.target.value)}
                    placeholder="Ex.: 8,00"
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                  <p className="text-[11px] text-slate-500">Dica: use vírgula para centavos (ex.: 8,00).</p>
                </div>
              )}

              {deliveryMode === "by_neighborhood" && (
                <div className="grid gap-3">
                  <div className="grid gap-2">
                    <div className="grid grid-cols-12 gap-2 text-[11px] font-medium uppercase tracking-wide text-slate-500">
                      <div className="col-span-5">Bairro</div>
                      <div className="col-span-3">Taxa (R$)</div>
                      <div className="col-span-2">Tempo (min)</div>
                      <div className="col-span-2">Obs.</div>
                    </div>

                    <div className="grid gap-2">
                      {deliveryRows.map((row, idx) => (
                        <div key={idx} className="grid grid-cols-12 gap-2">
                          <input
                            value={row.neighborhood}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDeliveryRows((prev) => prev.map((r, i) => (i === idx ? { ...r, neighborhood: v } : r)));
                            }}
                            placeholder="Ex.: Bangu Centro"
                            className="col-span-5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                          <input
                            value={row.fee}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDeliveryRows((prev) => prev.map((r, i) => (i === idx ? { ...r, fee: v } : r)));
                            }}
                            placeholder="Ex.: 6,00"
                            className="col-span-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                          <input
                            value={row.etaMinutes || ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDeliveryRows((prev) => prev.map((r, i) => (i === idx ? { ...r, etaMinutes: v } : r)));
                            }}
                            placeholder="45"
                            className="col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                          <input
                            value={row.note || ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setDeliveryRows((prev) => prev.map((r, i) => (i === idx ? { ...r, note: v } : r)));
                            }}
                            placeholder="opcional"
                            className="col-span-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                          />
                        </div>
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => setDeliveryRows((prev) => [...prev, { neighborhood: "", fee: "" }])}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        Adicionar linha
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeliveryRows((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev))}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-800 hover:bg-slate-50"
                      >
                        Remover última
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      Importante: não use "Retirada" como bairro. Retirada é outro fluxo e não depende desta tabela.
                    </p>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={saveDeliveryPricing}
                  disabled={!clientId || deliverySaving}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-60"
                >
                  {deliverySaving ? "Salvando..." : "Salvar tabela de delivery"}
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
</main>
  );
}