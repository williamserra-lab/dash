export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getAdminUploadsDir, saveAdminUpload } from "@/lib/adminFiles";
import { enforceStorageLimits, StorageLimitError } from "@/lib/storageLimits";

export async function POST(req: NextRequest) {
  try {
    const denied = await requireAdmin(req);
    if (denied) return denied;

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
    }

    // Limites universais: 10MB por arquivo, 100MB total (escopo global aqui).
    await enforceStorageLimits({
      scope: "global",
      scopeLabel: "admin",
      scopeDir: getAdminUploadsDir(),
      incomingBytes: file.size,
    });

    // Prefer PDF by default (tooling), but allow other types if needed later.
    const mime = (file.type || "").toLowerCase();
    if (mime && mime !== "application/pdf") {
      return NextResponse.json(
        { error: "Apenas PDF é aceito neste endpoint." },
        { status: 400 }
      );
    }

    const saved = await saveAdminUpload(file);
    return NextResponse.json({ file: saved }, { status: 200 });
  } catch (err) {
    if (err instanceof StorageLimitError) {
      return NextResponse.json(
        { error: err.message, code: err.code, details: err.details },
        { status: 413 }
      );
    }
    console.error("admin files upload error:", err);
    return NextResponse.json({ error: "Erro ao enviar arquivo." }, { status: 500 });
  }
}
