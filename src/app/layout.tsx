import type { Metadata } from "next";
import { Suspense } from "react";
import "./globals.css";
import { ClientSelector } from "@/components/ClientSelector";
import { SessionControls } from "@/components/SessionControls";
import { AppSidebar } from "@/components/AppSidebar";

export const metadata: Metadata = {
  title: "Nextia Dash",
  description: "Console de automação e campanhas WhatsApp",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body className="bg-slate-50 text-slate-900">
        <div className="min-h-screen">
          {/* Top bar */}
          <header className="border-b border-slate-200 bg-white">
            <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="rounded bg-sky-600 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                  Nextia
                </span>
                <span className="text-sm font-semibold text-slate-800">
                  Painel de automação
                </span>
              </div>
              <div className="flex items-center gap-4">
                {/* Cadastro/seleção de cliente */}
                <a
                  href="/clientes"
                  className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Clientes
                </a>
                <Suspense fallback={null}>
                  <ClientSelector />
                </Suspense>
                <Suspense fallback={null}>
                  <SessionControls />
                </Suspense>
              </div>
            </div>
          </header>

          {/* App layout: sidebar + content */}
          <div className="mx-auto flex max-w-7xl">
            <AppSidebar />
            <main className="min-w-0 flex-1 px-4 py-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
