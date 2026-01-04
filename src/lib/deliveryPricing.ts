// src/lib/deliveryPricing.ts
import { getDataPath, readJsonValue, writeJsonValue } from "@/lib/jsonStore";

export type DeliveryPricingMode = "fixed" | "by_neighborhood";

export type DeliveryNeighborhoodRule = {
  neighborhood: string;
  feeCents: number;
  etaMinutesMin?: number;
  etaMinutesMax?: number;
  notes?: string;
};

export type DeliveryPricing =
  | { mode: "fixed"; fixedFeeCents: number }
  | { mode: "by_neighborhood"; byNeighborhood: DeliveryNeighborhoodRule[] };

export type DeliveryPricingSaveInput = DeliveryPricing;

type StoreShape = Record<string, DeliveryPricing>;

const DATA_FILE = getDataPath("delivery_pricing.json");

async function readStore(): Promise<StoreShape> {
  // jsonStore pode exigir default. Se sua assinatura for diferente, ajuste aqui.
  const raw = await readJsonValue<unknown>(DATA_FILE, {});
  if (!raw || typeof raw !== "object") return {};
  return raw as StoreShape;
}

async function writeStore(store: StoreShape): Promise<void> {
  await writeJsonValue(DATA_FILE, store);
}

function normalizePricing(input: any): DeliveryPricing | null {
  if (!input || typeof input !== "object") return null;

  // formato novo (esperado)
  if (input.mode === "fixed" && typeof input.fixedFeeCents === "number") {
    return { mode: "fixed", fixedFeeCents: input.fixedFeeCents };
  }

  if (input.mode === "by_neighborhood") {
    const arr = Array.isArray(input.byNeighborhood) ? input.byNeighborhood : [];
    return {
      mode: "by_neighborhood",
      byNeighborhood: arr
        .map((r: any) => ({
          neighborhood: String(r.neighborhood ?? "").trim(),
          feeCents: Number(r.feeCents ?? 0),
          etaMinutesMin:
            typeof r.etaMinutesMin === "number" ? r.etaMinutesMin : undefined,
          etaMinutesMax:
            typeof r.etaMinutesMax === "number" ? r.etaMinutesMax : undefined,
          notes: typeof r.notes === "string" ? r.notes : undefined,
        }))
        .filter((r: any) => r.neighborhood && Number.isFinite(r.feeCents)),
    };
  }

  // compat: alguns patches antigos podem ter salvo como { mode:"by_neighborhood", rows:[...] }
  if (input.mode === "by_neighborhood" && Array.isArray(input.rows)) {
    const arr = input.rows;
    return {
      mode: "by_neighborhood",
      byNeighborhood: arr
        .map((r: any) => ({
          neighborhood: String(r.neighborhood ?? "").trim(),
          feeCents: Number(r.feeCents ?? 0),
          etaMinutesMin:
            typeof r.etaMinutesMin === "number" ? r.etaMinutesMin : undefined,
          etaMinutesMax:
            typeof r.etaMinutesMax === "number" ? r.etaMinutesMax : undefined,
          notes: typeof r.notes === "string" ? r.notes : undefined,
        }))
        .filter((r: any) => r.neighborhood && Number.isFinite(r.feeCents)),
    };
  }

  return null;
}

export async function getDeliveryPricing(clientId: string): Promise<DeliveryPricing | null> {
  const store = await readStore();
  const raw = store[clientId];
  return normalizePricing(raw);
}

export async function saveDeliveryPricing(
  clientId: string,
  input: DeliveryPricingSaveInput
): Promise<void> {
  const store = await readStore();
  store[clientId] = input;
  await writeStore(store);
}

export type AssistantDeliveryContext = {
  enabled: boolean;
  mode?: DeliveryPricingMode;
  fixedFeeCents?: number;
  byNeighborhood?: DeliveryNeighborhoodRule[];
};

export function toAssistantDeliveryContext(
  pricing: DeliveryPricing | null | undefined
): AssistantDeliveryContext {
  if (!pricing) return { enabled: false };

  if (pricing.mode === "fixed") {
    return {
      enabled: true,
      mode: "fixed",
      fixedFeeCents: pricing.fixedFeeCents,
    };
  }

  const list = Array.isArray(pricing.byNeighborhood) ? pricing.byNeighborhood : [];
  return {
    enabled: true,
    mode: "by_neighborhood",
    byNeighborhood: list,
  };
}

export function deliveryPricingToPromptText(
  pricing: DeliveryPricing | null | undefined
): string {
  // Regra: se não tem config, o assistente NÃO inventa e encaminha ao humano.
  if (!pricing) {
    return (
      "DELIVERY (não configurado):\n" +
      "- Se o cliente pedir entrega e a taxa não estiver configurada, NÃO inventar.\n" +
      "- Encaminhar para humano para definir taxa/prazo.\n"
    );
  }

  if (pricing.mode === "fixed") {
    const fee = (pricing.fixedFeeCents / 100).toFixed(2).replace(".", ",");
    return (
      "DELIVERY (taxa fixa):\n" +
      `- Taxa de entrega: R$ ${fee}\n` +
      "- Se o cliente pedir entrega, usar essa taxa no pré-pedido.\n"
    );
  }

  const rows = Array.isArray(pricing.byNeighborhood) ? pricing.byNeighborhood : [];
  if (rows.length === 0) {
    return (
      "DELIVERY (por bairro):\n" +
      "- Configuração vazia.\n" +
      "- NÃO inventar taxa. Encaminhar para humano.\n"
    );
  }

  const lines = rows.map((r) => {
    const fee = (r.feeCents / 100).toFixed(2).replace(".", ",");
    const eta =
      typeof r.etaMinutesMin === "number" || typeof r.etaMinutesMax === "number"
        ? ` · prazo: ${r.etaMinutesMin ?? "-"}–${r.etaMinutesMax ?? "-"} min`
        : "";
    const notes = r.notes ? ` · obs: ${r.notes}` : "";
    return `- ${r.neighborhood}: R$ ${fee}${eta}${notes}`;
  });

  return (
    "DELIVERY (por bairro):\n" +
    "Regras:\n" +
    "- Perguntar o BAIRRO.\n" +
    "- Se o bairro não existir na lista, NÃO inventar: encaminhar para humano.\n" +
    "Tabela:\n" +
    lines.join("\n") +
    "\n"
  );
}
