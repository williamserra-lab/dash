import { Suspense } from "react";
import ProdutosClient from "./ProdutosClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ProdutosClient />
    </Suspense>
  );
}
