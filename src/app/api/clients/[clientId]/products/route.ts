import { NextRequest, NextResponse } from "next/server";

import { assertClientActive } from "@/lib/tenancy";
import { listProducts, upsertProduct } from "@/lib/productsCatalog";

export const runtime = "nodejs";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  await assertClientActive(clientId);
  const products = await listProducts(clientId);
  return NextResponse.json({ products });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ clientId: string }> }) {
  const { clientId } = await ctx.params;
  await assertClientActive(clientId);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const product = await upsertProduct(clientId, body);
    return NextResponse.json({ product }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 400 });
  }
}
