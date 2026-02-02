import { Suspense } from "react";
import CampanhasGruposClient from "./page.client";
import { Card, CardContent } from "@/components/ui";

// Evita prerender estático e o erro do useSearchParams no build
export const dynamic = "force-dynamic";

function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <Card>
        <CardContent>
          <div className="py-6 text-sm text-slate-600">Carregando…</div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <CampanhasGruposClient />
    </Suspense>
  );
}
