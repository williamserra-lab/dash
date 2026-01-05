import React from "react";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function getFirst(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

async function safeJson<T>(res: Response): Promise<T | null> {
  try {
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const sp = searchParams ? await searchParams : {};
  const clientId = getFirst(sp.clientId);

  if (!clientId) {
    return (
      <main style={{ padding: 16 }}>
        <h1>Dashboard</h1>
        <p>Informe o <code>clientId</code> na URL. Ex.: <code>/dashboard?clientId=SEU_CLIENTE</code></p>
      </main>
    );
  }

  // Minimal, best-effort KPIs. Any missing endpoints should not break the page.
  const [preorders, bookings, campaignsDash] = await Promise.all([
    safeJson<any>(await fetch(`/api/clients/${clientId}/preorders`, { cache: "no-store" })),
    safeJson<any>(await fetch(`/api/clients/${clientId}/bookings`, { cache: "no-store" })),
    safeJson<any>(await fetch(`/api/clients/${clientId}/campaigns/dashboard`, { cache: "no-store" })),
  ]);

  const preordersCount =
    Array.isArray(preorders) ? preorders.length :
    Array.isArray(preorders?.items) ? preorders.items.length :
    typeof preorders?.count === "number" ? preorders.count :
    null;

  const bookingsCount =
    Array.isArray(bookings) ? bookings.length :
    Array.isArray(bookings?.items) ? bookings.items.length :
    typeof bookings?.count === "number" ? bookings.count :
    null;

  const campaignsCount =
    Array.isArray(campaignsDash) ? campaignsDash.length :
    Array.isArray(campaignsDash?.items) ? campaignsDash.items.length :
    typeof campaignsDash?.count === "number" ? campaignsDash.count :
    null;

  return (
    <main style={{ padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <div style={{ opacity: 0.8 }}>clientId: <code>{clientId}</code></div>
        </div>
        <nav style={{ display: "flex", gap: 12 }}>
          <a href={`/pre-pedidos?clientId=${encodeURIComponent(clientId)}`}>Pré-pedidos</a>
          <a href={`/agendamentos?clientId=${encodeURIComponent(clientId)}`}>Agendamentos</a>
          <a href={`/campanhas?clientId=${encodeURIComponent(clientId)}`}>Campanhas</a>
        </nav>
      </header>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Pré-pedidos</div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>{preordersCount ?? "—"}</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Agendamentos</div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>{bookingsCount ?? "—"}</div>
        </div>
        <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Campanhas</div>
          <div style={{ fontSize: 28, fontWeight: 600 }}>{campaignsCount ?? "—"}</div>
        </div>
      </section>

      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0 }}>Campanhas (visão rápida)</h2>
        {Array.isArray(campaignsDash?.items) ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px" }}>Nome</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: "8px 6px" }}>Status</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px" }}>Alvos</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px" }}>Enviados</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #eee", padding: "8px 6px" }}>Falhas</th>
              </tr>
            </thead>
            <tbody>
              {campaignsDash.items.map((c: any) => (
                <tr key={c.id}>
                  <td style={{ borderBottom: "1px solid #f2f2f2", padding: "8px 6px" }}>{c.name ?? c.title ?? c.id}</td>
                  <td style={{ borderBottom: "1px solid #f2f2f2", padding: "8px 6px" }}>{c.status ?? "—"}</td>
                  <td style={{ borderBottom: "1px solid #f2f2f2", padding: "8px 6px", textAlign: "right" }}>{c.targetsCount ?? c.targets ?? "—"}</td>
                  <td style={{ borderBottom: "1px solid #f2f2f2", padding: "8px 6px", textAlign: "right" }}>{c.sentCount ?? c.sent ?? "—"}</td>
                  <td style={{ borderBottom: "1px solid #f2f2f2", padding: "8px 6px", textAlign: "right" }}>{c.failedCount ?? c.failed ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ opacity: 0.7 }}>Sem dados (ou endpoint ainda não disponível).</div>
        )}
      </section>
    </main>
  );
}
