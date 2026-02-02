import { NextRequest, NextResponse } from "next/server";
import { createClient, listClients } from "@/lib/clients";
import { requireAdmin } from "@/lib/adminAuth";

// helper local: evita depender de "@/lib/phone" (não existe no projeto)
function digitsOnly(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "");
}

export async function GET() {
  const clients = await listClients();
  return NextResponse.json({ clients });
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;

  try {
    const body: any = await req.json();

    const patch: any = {
      id: body?.id,
      name: body?.name,
      segment: body?.segment,
      status: body?.status || "active",
    };

    // Compatibilidade: aceitar whatsappNumber simples (string)
    if (!patch.whatsappNumbers && body?.whatsappNumber) {
      const pn = digitsOnly(body.whatsappNumber);
      if (pn) {
        patch.whatsappNumbers = [{ id: "w1", phoneNumber: pn, active: true }];
      }
    }

    // Forma canônica: aceitar whatsappNumbers (array)
    if (Array.isArray(body?.whatsappNumbers)) {
      patch.whatsappNumbers = body.whatsappNumbers;
    }

    // Profile administrativo (JSONB)
    if (body?.profile && typeof body.profile === "object") {
      patch.profile = body.profile;
    }

    const client = await createClient(patch);
    return NextResponse.json({ client }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: String(err?.message || err) },
      { status: 400 }
    );
  }
}