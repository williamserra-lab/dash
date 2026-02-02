// src/app/admin/clientes/[clientId]/page.tsx
import Link from "next/link";
import { getClientById } from "@/lib/clients";
import AdminClienteEditor from "./page.client";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ clientId: string }> };

export default async function AdminClientePage(ctx: Ctx) {
  const { clientId } = await ctx.params;
  const client = await getClientById(clientId);

  if (!client) {
    return (
      <main className="p-6 space-y-4">
        <h1 className="text-xl font-semibold">Cliente não encontrado</h1>
        <p className="opacity-80">clientId: <span className="font-mono">{clientId}</span></p>
        <Link className="underline" href="/admin/clientes">Voltar</Link>
      </main>
    );
  }

  return (
    <main className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin • Cliente</h1>
          <p className="text-sm opacity-80">
            clientId: <span className="font-mono">{client.id}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <Link className="px-3 py-2 rounded border hover:bg-black/5 text-sm" href="/admin/clientes">
            Voltar
          </Link>
          <Link className="px-3 py-2 rounded border hover:bg-black/5 text-sm" href={`/painel/${encodeURIComponent(client.id)}`}>
            Abrir Painel
          </Link>
        </div>
      </header>

      <AdminClienteEditor initialClient={client} />
    </main>
  );
}
