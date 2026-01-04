import { NextRequest, NextResponse } from "next/server";

import { assertClientActive } from "@/lib/tenancy";
import { deleteProduct, getProduct, upsertProduct } from "@/lib/productsCatalog";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ clientId: string; productId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { clientId, productId } = await ctx.params;
  await assertClientActive(clientId);

  const p = await getProduct(clientId, productId);
  if (!p) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ product: p });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { clientId, productId } = await ctx.params;
  await assertClientActive(clientId);

  try {
    const body = (await req.json()) as any;
    const product = await upsertProduct(clientId, {
      ...(body || {}),
      id: productId,
      name: body?.name || body?.title || body?.label,
    });
    return NextResponse.json({ product });
  } catch (err: any) {
    return NextResponse.json({ error: String(err?.message || err) }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { clientId, productId } = await ctx.params;
  await assertClientActive(clientId);

  await deleteProduct(clientId, productId);
  return NextResponse.json({ ok: true });
}
