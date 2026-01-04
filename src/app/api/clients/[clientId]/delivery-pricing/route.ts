import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getDeliveryPricing,
  saveDeliveryPricing,
  type DeliveryPricingSaveInput,
} from "@/lib/deliveryPricing";

type RouteContext = { params: Promise<{ clientId: string }> };

const DeliveryNeighborhoodRowSchema = z.object({
  neighborhood: z.string().min(1),
  feeCents: z.number().int().nonnegative(),
  etaMinutesMin: z.number().int().nonnegative().optional(),
  etaMinutesMax: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
});

/**
 * NOTE (intencional):
 * - Não validamos "clientId" via registry aqui, porque o projeto já aceita
 *   fluxos onde o clientId pode existir em outras fontes (ex.: mídia/arquivos)
 *   e isso estava gerando falso-negativo ("Cliente não encontrado") e 500.
 * - Segurança: esta rota permanece restrita ao mesmo perímetro do app; se no
 *   futuro houver exposição pública, reintroduzimos validação consistente.
 *
 * O save input espera:
 * - fixed: { mode: "fixed", fixedFeeCents }
 * - by_neighborhood: { mode: "by_neighborhood", byNeighborhood: DeliveryNeighborhoodRule[] }
 *
 * Para conveniência da UI, aceitamos "rows" e mapeamos -> "byNeighborhood".
 */
const DeliveryPricingSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("fixed"),
    fixedFeeCents: z.number().int().nonnegative(),
  }),
  z.object({
    mode: z.literal("by_neighborhood"),
    rows: z.array(DeliveryNeighborhoodRowSchema).default([]),
  }),
]);

export async function GET(_req: NextRequest, ctx: RouteContext) {
  const { clientId } = await ctx.params;
  const pricing = await getDeliveryPricing(clientId);
  return NextResponse.json(pricing);
}

export async function POST(req: NextRequest, ctx: RouteContext) {
  const { clientId } = await ctx.params;

  try {
    const body = await req.json();
    const parsed = DeliveryPricingSchema.parse(body);

    const input: DeliveryPricingSaveInput =
      parsed.mode === "fixed"
        ? parsed
        : { mode: "by_neighborhood", byNeighborhood: parsed.rows };

    await saveDeliveryPricing(clientId, input);

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    const message = err?.message || "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
