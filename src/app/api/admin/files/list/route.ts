export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { listAdminFiles } from "@/lib/adminFiles";

export async function GET() {
  try {
    const files = await listAdminFiles(200);
    return NextResponse.json({ files }, { status: 200 });
  } catch (err) {
    console.error("admin files list error:", err);
    return NextResponse.json({ error: "Erro ao listar arquivos." }, { status: 500 });
  }
}
