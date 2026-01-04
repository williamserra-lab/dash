// src/app/assistente/page.tsx
import { Suspense } from "react";
import AssistenteClient from "./AssistenteClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AssistenteClient />
    </Suspense>
  );
}