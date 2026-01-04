// src/lib/productsCatalog.ts
// Catálogo de produtos "real" (armazenamento simples em JSON) por cliente.
// Objetivo: reduzir mal-entendidos e bloquear pré-pedido sem descrição/valores.

import { getDataPath, readJsonArray, writeJsonArray } from "./jsonStore";

export type Product = {
  id: string;
  clientId: string;
  name: string;
  description: string;
  priceCents: number; // inteiro
  currency: string; // "BRL"
  active: boolean;
  tags?: string[];
  imageUrl?: string;
  createdAt: string;
  updatedAt: string;
};

const PRODUCTS_FILE = getDataPath("products.json");

function nowIso(): string {
  return new Date().toISOString();
}

function digitsOnly(v: unknown): string {
  return String(v ?? "").replace(/\D+/g, "");
}

function slugify(input: string) {
  return input
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function coercePriceToCents(raw: any): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    // se vier 12.34, assume reais
    return Math.round(raw * 100);
  }

  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return 0;
    // "12,90" ou "12.90" ou "1290"
    if (/^[0-9]+([\.,][0-9]{1,2})?$/.test(t)) {
      const normalized = t.replace(",", ".");
      const n = Number(normalized);
      return Number.isFinite(n) ? Math.round(n * 100) : 0;
    }
    const digits = digitsOnly(t);
    if (digits.length >= 3) {
      // tenta interpretar últimos 2 como centavos
      const reais = digits.slice(0, -2);
      const cents = digits.slice(-2);
      return Number(reais) * 100 + Number(cents);
    }
  }
  return 0;
}

async function readAll(): Promise<Product[]> {
  try {
    const list = await readJsonArray<Product>(PRODUCTS_FILE);
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function writeAll(list: Product[]): Promise<void> {
  await writeJsonArray<Product>(PRODUCTS_FILE, list);
}

export async function listProducts(clientId: string): Promise<Product[]> {
  const all = await readAll();
  return all
    .filter((p) => p.clientId === clientId)
    .sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : 1));
}

export async function getProduct(clientId: string, productId: string): Promise<Product | null> {
  const all = await readAll();
  const p = all.find((x) => x.clientId === clientId && x.id === productId);
  return p ?? null;
}

export async function upsertProduct(
  clientId: string,
  input: Partial<Product> & { name: string }
): Promise<Product> {
  const all = await readAll();
  const now = nowIso();

  const name = String(input.name || "").trim();
  if (!name) {
    throw new Error("Nome do produto é obrigatório.");
  }

  const id = String(input.id || "").trim() || `${slugify(name) || "produto"}-${Math.random().toString(16).slice(2, 8)}`;

  const description = String((input.description ?? "") as any).trim();
  const priceCents = coercePriceToCents((input as any).priceCents ?? (input as any).price ?? (input as any).priceValue);
  const currency = String((input.currency || "BRL") as any).trim() || "BRL";
  const active = (input as any).active === false ? false : true;
  const tags = Array.isArray(input.tags) ? input.tags.map(String).filter(Boolean) : undefined;
  const imageUrl = typeof (input as any).imageUrl === "string" ? String((input as any).imageUrl).trim() : undefined;

  const idx = all.findIndex((x) => x.clientId === clientId && x.id === id);
  if (idx >= 0) {
    const prev = all[idx];
    const updated: Product = {
      ...prev,
      name,
      description,
      priceCents,
      currency,
      active,
      tags,
      imageUrl,
      updatedAt: now,
    };
    all[idx] = updated;
    await writeAll(all);
    return updated;
  }

  const created: Product = {
    id,
    clientId,
    name,
    description,
    priceCents,
    currency,
    active,
    tags,
    imageUrl,
    createdAt: now,
    updatedAt: now,
  };
  all.push(created);
  await writeAll(all);
  return created;
}

export async function deleteProduct(clientId: string, productId: string): Promise<void> {
  const all = await readAll();
  const filtered = all.filter((x) => !(x.clientId === clientId && x.id === productId));
  await writeAll(filtered);
}

export type CatalogIssue = {
  code: "no_products" | "missing_description" | "missing_price";
  message: string;
  count: number;
  productIds?: string[];
};

export type CatalogReadiness = {
  ready: boolean;
  activeProducts: number;
  issues: CatalogIssue[];
};

export async function getCatalogReadiness(clientId: string): Promise<CatalogReadiness> {
  const list = await listProducts(clientId);
  const active = list.filter((p) => p.active !== false);

  const issues: CatalogIssue[] = [];
  if (active.length === 0) {
    issues.push({
      code: "no_products",
      message: "Nenhum produto ativo cadastrado.",
      count: 0,
    });
  }

  const missingDesc = active.filter((p) => !String(p.description || "").trim());
  if (missingDesc.length) {
    issues.push({
      code: "missing_description",
      message: "Produtos sem descrição (obrigatório para evitar mal-entendido).",
      count: missingDesc.length,
      productIds: missingDesc.map((p) => p.id),
    });
  }

  const missingPrice = active.filter((p) => !(Number(p.priceCents) > 0));
  if (missingPrice.length) {
    issues.push({
      code: "missing_price",
      message: "Produtos sem preço (obrigatório).",
      count: missingPrice.length,
      productIds: missingPrice.map((p) => p.id),
    });
  }

  return {
    ready: issues.length === 0,
    activeProducts: active.length,
    issues,
  };
}

export function formatPriceBRL(priceCents: number): string {
  const n = Number(priceCents || 0) / 100;
  // sem Intl para evitar variações em build; formata simples.
  return `R$ ${n.toFixed(2)}`.replace(".", ",");
}
