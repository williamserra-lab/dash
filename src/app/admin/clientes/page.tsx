// src/app/admin/clientes/page.tsx
import Link from "next/link";
import { listClients } from "@/lib/clients";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminClientesPage() {
  const clients = await listClients();

  return (
    <main className="p-6 space-y-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Admin • Clientes</h1>
          <p className="text-sm opacity-80">
            Gestão de tenants (clientId). Edite configurações operacionais e acesse o painel.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/painel"
            className="px-3 py-2 rounded border hover:bg-black/5 text-sm"
          >
            Ver Painel Global
          </Link>
          <Link
            href="/admin-login"
            className="px-3 py-2 rounded border hover:bg-black/5 text-sm"
          >
            Admin Login
          </Link>
        </div>
      </header>

      <section className="rounded border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-black/5">
            <tr>
              <th className="text-left p-3">clientId</th>
              <th className="text-left p-3">Nome</th>
              <th className="text-left p-3">Status</th>
              <th className="text-left p-3">Pré-pedido expira (h)</th>
              <th className="text-left p-3">Ações</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-3 font-mono">{c.id}</td>
                <td className="p-3">{c.name}</td>
                <td className="p-3">{c.status}</td>
                <td className="p-3">{(c.profile as any)?.preorderExpiresHours ?? "—"}</td>
                <td className="p-3">
                  <div className="flex flex-wrap gap-2">
                    <Link
                      className="px-2 py-1 rounded border hover:bg-black/5"
                      href={`/admin/clientes/${encodeURIComponent(c.id)}`}
                    >
                      Editar
                    </Link>
                    <Link
                      className="px-2 py-1 rounded border hover:bg-black/5"
                      href={`/painel/${encodeURIComponent(c.id)}`}
                    >
                      Painel do cliente
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
            {clients.length === 0 ? (
              <tr>
                <td className="p-6 opacity-70" colSpan={5}>
                  Nenhum cliente encontrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </main>
  );
}
