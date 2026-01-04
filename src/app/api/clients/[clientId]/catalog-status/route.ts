import { NextRequest, NextResponse } from "next/server";

import { assertClientActive } from "@/lib/tenancy";
import { getCatalogReadiness } from "@/lib/productsCatalog";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  await assertClientActive(clientId);
  const status = await getCatalogReadiness(clientId);
  return NextResponse.json({ status });
}
