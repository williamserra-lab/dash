// src/lib/clientsRegistry.ts
// Camada de compatibilidade: mantém imports antigos apontando para o cadastro canônico.
// Fonte de verdade: src/lib/clients.ts

import { getClientById as getClientByIdCanon, listClients, type ClientRecord, type ClientWhatsappNumber } from "@/lib/clients";

function digitsOnly(v: string): string {
  return String(v || "").replace(/\D+/g, "");
}

// Re-export de tipos usados em alguns pontos do código.
export type { ClientRecord, ClientWhatsappNumber };

// Mantém assinatura usada no inbound/rotas.
export async function getClientById(clientId: string): Promise<ClientRecord | null> {
  return getClientByIdCanon(clientId);
}

export async function getClientByWhatsappNumber(phoneNumber: string): Promise<ClientRecord | null> {
  const needle = digitsOnly(phoneNumber);
  if (!needle) return null;

  const clients = await listClients();
  for (const c of clients) {
    const nums = Array.isArray((c as any).whatsappNumbers) ? ((c as any).whatsappNumbers as any[]) : [];
    for (const n of nums) {
      const pn = digitsOnly(String(n?.phoneNumber || ""));
      if (pn && pn === needle) return c;
    }
  }

  return null;
}

export async function assertClientActive(clientId: string): Promise<void> {
  await assertClientActiveOrThrow(clientId);
}

export async function assertClientActiveOrThrow(clientId: string): Promise<ClientRecord> {
  const id = String(clientId || "").trim();
  if (!id) throw new Error("clientId vazio.");

  const client = await getClientByIdCanon(id);
  if (!client) {
    throw new Error(`Cliente '${id}' não encontrado.`);
  }

  // Compatibilidade: alguns ramos antigos usam `active: boolean`,
  // e o canônico usa `status: "active" | "inactive"`.
  const activeFlag = (client as any).active;
  const status = (client as any).status;

  const isActive =
    typeof activeFlag === "boolean"
      ? activeFlag
      : status === "inactive"
        ? false
        : true;

  if (!isActive) {
    throw new Error(`Cliente '${id}' está inativo.`);
  }

  return client;
}
