import { Suspense } from "react";
import GruposClient from "./page.client";

// Evita prerender estático e o erro do useSearchParams no build
export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div style={{ padding: 16 }}>Carregando…</div>}>
      <GruposClient />
    </Suspense>
  );
}
