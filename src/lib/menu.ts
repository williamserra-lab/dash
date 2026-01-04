// src/lib/menu.ts
// Helpers para menu inicial (WhatsApp) e seleção numérica.

import type { AssistantSettings } from "./assistantSettings";

export type MenuAction = "products" | "order" | "hours_location" | "human";

export type MenuItem = {
  id: string;
  label: string;
  action: MenuAction;
  enabled?: boolean;
};

export const DEFAULT_MENU: MenuItem[] = [
  { id: "menu", label: "Cardápio / produtos", action: "products", enabled: true },
  { id: "order", label: "Fazer pedido", action: "order", enabled: true },
  { id: "hours", label: "Horários / endereço", action: "hours_location", enabled: true },
  { id: "human", label: "Falar com humano", action: "human", enabled: true },
];

export function getMenuItems(settings: AssistantSettings | null): MenuItem[] {
  const raw = settings?.menuItems;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_MENU;

  const cleaned: MenuItem[] = raw
    .filter((x) => x && typeof x === "object")
    .map((x) => ({
      id: String((x as any).id || ""),
      label: String((x as any).label || ""),
      action: String((x as any).action || "") as MenuAction,
      enabled: (x as any).enabled === false ? false : true,
    }))
    .filter((x) => x.id && x.label && (x.action === "products" || x.action === "order" || x.action === "hours_location" || x.action === "human"))
    .filter((x) => x.enabled !== false);

  return cleaned.length ? cleaned : DEFAULT_MENU;
}

export function buildMenuText(settings: AssistantSettings | null): string {
  const items = getMenuItems(settings);
  return items
    .map((it, idx) => `${idx + 1}) ${it.label}`)
    .join("\n");
}

export function parseMenuChoice(text: string): number | null {
  const t = (text || "").trim();
  if (!t) return null;
  // Aceita "1" ou "1." ou "1)" ou "1 -" etc
  const m = t.match(/^([1-9])\s*[\.)\-:]?\s*$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n < 1) return null;
  return n;
}

export function getActionByChoice(settings: AssistantSettings | null, choice: number): MenuAction | null {
  const items = getMenuItems(settings);
  const idx = choice - 1;
  if (idx < 0 || idx >= items.length) return null;
  return items[idx]?.action ?? null;
}

// ------------------------------------------------------------
// Compat exports (evita quebrar imports antigos)
// Não muda a lógica: apenas reusa as funções existentes.
// ------------------------------------------------------------

// conversationStateMachine.ts usa estes nomes
export function normalizeMenuItems(settings: AssistantSettings | null): MenuItem[] {
  return getMenuItems(settings);
}

export function buildMenuMessage(settings: AssistantSettings | null): string {
  const greeting = (settings?.greetingText || "").trim();
  const menu = buildMenuText(settings);
  if (greeting && menu) return `${greeting}\n\n${menu}`;
  if (greeting) return greeting;
  return menu;
}
