// src/lib/contactLists.ts
// Listas nomeadas de contatos (segmentação de campanhas).

import { getDataPath, readJsonArray, writeJsonArray } from "@/lib/jsonStore";

export type ContactList = {
  id: string;
  clientId: string;
  name: string;
  contactIds: string[];
  createdAt: string;
  updatedAt: string;
};

const listsFile = getDataPath("contact_lists.json");

function createId(prefix: string): string {
  const r1 = Math.random().toString(36).slice(2, 10);
  const r2 = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}_${r1}${r2}`;
}

async function readAllLists(): Promise<ContactList[]> {
  const raw = await readJsonArray<ContactList>(listsFile);
  const normalized: ContactList[] = [];
  const now = new Date().toISOString();
  for (const entry of Array.isArray(raw) ? raw : []) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as any;
    const id = String(e.id || "").trim();
    const clientId = String(e.clientId || "").trim();
    const name = String(e.name || "").trim();
    if (!id || !clientId || !name) continue;
    const contactIds = Array.isArray(e.contactIds)
      ? e.contactIds.map((x: any) => String(x || "").trim()).filter(Boolean)
      : [];
    normalized.push({
      id,
      clientId,
      name,
      contactIds: Array.from(new Set(contactIds)),
      createdAt: typeof e.createdAt === "string" && e.createdAt ? e.createdAt : now,
      updatedAt: typeof e.updatedAt === "string" && e.updatedAt ? e.updatedAt : now,
    });
  }
  return normalized;
}

async function writeAllLists(all: ContactList[]): Promise<void> {
  await writeJsonArray(listsFile, all);
}

export async function getListsByClient(clientId: string): Promise<ContactList[]> {
  const all = await readAllLists();
  return all
    .filter((l) => l.clientId === clientId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getListById(
  clientId: string,
  listId: string
): Promise<ContactList | null> {
  const all = await readAllLists();
  return all.find((l) => l.clientId === clientId && l.id === listId) || null;
}

export async function createList(
  clientId: string,
  input: { name: string; contactIds?: string[] }
): Promise<ContactList> {
  const all = await readAllLists();
  const now = new Date().toISOString();
  const list: ContactList = {
    id: createId("list"),
    clientId,
    name: String(input.name || "").trim() || "Lista",
    contactIds: Array.from(
      new Set(
        (Array.isArray(input.contactIds) ? input.contactIds : [])
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      )
    ),
    createdAt: now,
    updatedAt: now,
  };
  all.push(list);
  await writeAllLists(all);
  return list;
}

export async function updateList(
  clientId: string,
  listId: string,
  patch: { name?: string; contactIds?: string[] }
): Promise<ContactList | null> {
  const all = await readAllLists();
  const idx = all.findIndex((l) => l.clientId === clientId && l.id === listId);
  if (idx < 0) return null;
  const prev = all[idx];
  const next: ContactList = {
    ...prev,
    name: typeof patch.name === "string" ? patch.name.trim() || prev.name : prev.name,
    contactIds: Array.isArray(patch.contactIds)
      ? Array.from(
          new Set(patch.contactIds.map((x) => String(x || "").trim()).filter(Boolean))
        )
      : prev.contactIds,
    updatedAt: new Date().toISOString(),
  };
  all[idx] = next;
  await writeAllLists(all);
  return next;
}

export async function deleteList(
  clientId: string,
  listId: string
): Promise<boolean> {
  const all = await readAllLists();
  const next = all.filter((l) => !(l.clientId === clientId && l.id === listId));
  if (next.length === all.length) return false;
  await writeAllLists(next);
  return true;
}
