// src/lib/products.ts
// Catálogo de produtos/itens de venda por cliente.
// Mantém coisas simples e em disco, na pasta /data/products.json.

import { getDataPath, readJsonArray, writeJsonArray } from "./jsonStore";

// Categoria livre, mas com alguns valores comuns
export type ProductCategory =
  | "comida"
  | "bebida"
  | "combo"
  | "servico"
  | "outro"
  | string;

// Modelo de produto:
// - Preço sempre em CENTAVOS (int).
// - clientId obrigatório para separar os catálogos.
export type Product = {
  id: string;
  clientId: string;

  // Identificador comercial opcional (código interno, SKU etc.)
  sku?: string;

  name: string;
  description?: string;

  // Preço unitário em centavos (R$ 12,50 -> 1250)
  unitPriceCents: number;

  category?: ProductCategory;

  // Se false, não deve aparecer em buscas/listas
  active: boolean;

  // Campos de auditoria simples
  createdAt: string;
  updatedAt: string;

  // Campo livre para metadados adicionais
  meta?: Record<string, unknown>;
};

const productsFile = getDataPath("products.json");

async function readAllProducts(): Promise<Product[]> {
  try {
    const list = await readJsonArray<Product>(productsFile);
    if (!Array.isArray(list)) return [];
    return list;
  } catch {
    // Arquivo ainda não existe ou está inválido: começa vazio
    return [];
  }
}

async function writeAllProducts(list: Product[]): Promise<void> {
  await writeJsonArray<Product>(productsFile, list);
}

/**
 * Lista todos os produtos de um cliente.
 */
export async function listProductsByClient(
  clientId: string
): Promise<Product[]> {
  const all = await readAllProducts();
  return all
    .filter((p) => p.clientId === clientId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Busca um produto por id, independente de cliente.
 */
export async function getProductById(id: string): Promise<Product | null> {
  const all = await readAllProducts();
  return all.find((p) => p.id === id) ?? null;
}

/**
 * Cria ou atualiza um produto.
 * Se o id já existir, atualiza; senão, adiciona.
 *
 * Responsável apenas por persistir, não por gerar id.
 */
export async function upsertProduct(product: Product): Promise<Product> {
  const all = await readAllProducts();
  const idx = all.findIndex((p) => p.id === product.id);

  if (idx >= 0) {
    all[idx] = product;
  } else {
    all.push(product);
  }

  await writeAllProducts(all);
  return product;
}

/**
 * Remove um produto do catálogo.
 */
export async function deleteProduct(id: string): Promise<void> {
  const all = await readAllProducts();
  const filtered = all.filter((p) => p.id !== id);
  await writeAllProducts(filtered);
}
