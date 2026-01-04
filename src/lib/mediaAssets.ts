// src/lib/mediaAssets.ts
// Camada de acesso a arquivos de mídia (cardápios, PDFs, imagens etc.)
// usados pelo bot para responder no WhatsApp.

import { getDataPath, readJsonArray, writeJsonArray } from "./jsonStore";

export type MediaCategory =
  | "menu"            // cardápio, lista de serviços, tabela de preços
  | "produto"         // catálogos, folders de produto
  | "institucional"   // apresentação da empresa, regulamentos
  | "outro"
  | string;

export type MediaType =
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "document"
  | string;

export type MediaAsset = {
  id: string;
  clientId: string;

  // Ex.: "menu", "produto", "institucional"
  category: MediaCategory;

  // Descrição amigável para aparecer no painel
  label: string;

  // Tipo técnico do arquivo (imagem, pdf, etc.)
  type: MediaType;

  // URL pública ou interna (no futuro pode ser storage/PSP/whatever)
  url: string;

  // Se false, o bot ignora esse asset
  enabled: boolean;

  // Lista de intents em que esse asset pode ser usado
  // Ex.: ["pedir_cardapio", "duvida_preco"]
  allowedIntents?: string[];

  // Controle de versão simples, opcional
  version?: number;

  createdAt: string;
  updatedAt: string;

  // Campo livre para metadados adicionais

  // Texto extraído (opcional) para PDFs/imagens já processados
  extractedText?: string | null;
  meta?: Record<string, any>;
};

const mediaFile = getDataPath("media_assets.json");

async function readAllMedia(): Promise<MediaAsset[]> {
  try {
    const list = await readJsonArray<MediaAsset>(mediaFile);
    if (!Array.isArray(list)) return [];
    return list;
  } catch {
    return [];
  }
}

async function writeAllMedia(list: MediaAsset[]): Promise<void> {
  await writeJsonArray<MediaAsset>(mediaFile, list);
}

/**
 * Retorna todos os assets habilitados para um determinado cliente,
 * filtrando opcionalmente por intent e categoria.
 *
 * Regras:
 * - Sempre filtra por clientId e enabled = true;
 * - Se category for informado, só retorna daquela categoria;
 * - Se intent for informado:
 *    - se allowedIntents estiver vazio/undefined, o asset é considerado genérico e pode ser usado;
 *    - se allowedIntents tiver itens, o intent precisa estar presente no array.
 * - Ordena por updatedAt desc (mais recente primeiro), depois por version desc.
 */
export async function getEnabledMediaForIntent(params: {
  clientId: string;
  intent?: string;
  category?: MediaCategory;
}): Promise<MediaAsset[]> {
  const { clientId, intent, category } = params;
  const all = await readAllMedia();

  const filtered = all.filter((asset) => {
    if (asset.clientId !== clientId) return false;
    if (!asset.enabled) return false;

    if (category && asset.category !== category) return false;

    if (intent) {
      const intents = asset.allowedIntents;
      // Sem intents definidas: asset genérico, pode ser usado em qualquer intent
      if (!intents || intents.length === 0) return true;
      // Com intents definidas: precisa bater
      if (!intents.includes(intent)) return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    const aDate = a.updatedAt || a.createdAt || "";
    const bDate = b.updatedAt || b.createdAt || "";
    if (aDate !== bDate) return aDate > bDate ? -1 : 1;

    const aVer = a.version ?? 0;
    const bVer = b.version ?? 0;
    if (aVer !== bVer) return aVer > bVer ? -1 : 1;

    return a.id.localeCompare(b.id);
  });
}

/**
 * Funções auxiliares para o futuro painel de gestão de mídia.
 * Por enquanto não são usadas, mas já ficam prontas.
 */

export async function listMediaByClient(
  clientId: string
): Promise<MediaAsset[]> {
  const all = await readAllMedia();
  return all
    .filter((a) => a.clientId === clientId)
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1));
}

export async function upsertMediaAsset(
  asset: MediaAsset
): Promise<MediaAsset> {
  const all = await readAllMedia();
  const idx = all.findIndex((a) => a.id === asset.id);
  if (idx >= 0) {
    all[idx] = asset;
  } else {
    all.push(asset);
  }
  await writeAllMedia(all);
  return asset;
}

export async function deleteMediaAsset(id: string): Promise<void> {
  const all = await readAllMedia();
  const filtered = all.filter((a) => a.id !== id);
  await writeAllMedia(filtered);
}

// Marca exatamente 1 asset como "tabela de preços oficial" para o clientId.
// Implementação via meta.priceTableOfficial (boolean).
export async function setOfficialPriceTable(
  clientId: string,
  assetId: string
): Promise<void> {
  const all = await readAllMedia();
  let changed = false;

  for (const a of all) {
    if (a.clientId !== clientId) continue;
    const meta = (a.meta ?? {}) as Record<string, any>;
    const shouldBeOfficial = a.id === assetId;

    if (meta.priceTableOfficial !== shouldBeOfficial) {
      meta.priceTableOfficial = shouldBeOfficial;
      a.meta = meta;
      changed = true;
    }
  }

  if (changed) {
    await writeAllMedia(all);
  }
}

// ---------------------- Dashboard helpers ----------------------

export type MediaConfigStatus = {
  ok: boolean;
  issues: string[];
  totalAssets: number;
  enabledAssets: number;
  hasOfficialPriceTable: boolean;
};

export async function getMediaConfigStatus(clientId: string): Promise<MediaConfigStatus> {
  const all = await listMediaByClient(clientId);
  const enabled = all.filter((a) => a.enabled !== false);

  const hasOfficialPriceTable = enabled.some(
    (a) => Boolean((a.meta as Record<string, unknown> | undefined)?.priceTableOfficial)
  );

  const issues: string[] = [];
  if (enabled.length === 0) {
    issues.push("Nenhuma midia habilitada cadastrada.");
  }
  if (!hasOfficialPriceTable) {
    issues.push("Tabela de precos oficial nao configurada.");
  }

  return {
    ok: issues.length === 0,
    issues,
    totalAssets: all.length,
    enabledAssets: enabled.length,
    hasOfficialPriceTable,
  };
}