"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  label: string;
  href: string;
  matchPrefixes?: string[];
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const SECTIONS: NavSection[] = [
  {
    label: "Operação",
    items: [
      { label: "Dashboard", href: "/dashboard", matchPrefixes: ["/dashboard"] },
      { label: "Painel", href: "/painel", matchPrefixes: ["/painel"] },
      { label: "Pedidos", href: "/pedidos", matchPrefixes: ["/pedidos"] },
      { label: "Pré‑pedidos", href: "/pre-pedidos", matchPrefixes: ["/pre-pedidos"] },
      { label: "Agendamentos", href: "/agendamentos", matchPrefixes: ["/agendamentos"] },
      { label: "Follow-up", href: "/followup", matchPrefixes: ["/followup"] },
    ],
  },
  {
    label: "Campanhas",
    items: [
      { label: "Campanhas", href: "/campanhas", matchPrefixes: ["/campanhas"] },
      { label: "Campanhas em grupos", href: "/campanhas-grupos", matchPrefixes: ["/campanhas-grupos"] },
    ],
  },
  {
    label: "Cadastros",
    items: [
      { label: "Produtos", href: "/produtos", matchPrefixes: ["/produtos"] },
      { label: "Contatos", href: "/contatos", matchPrefixes: ["/contatos"] },
      { label: "Grupos", href: "/grupos", matchPrefixes: ["/grupos"] },
    ],
  },
  {
    label: "Administração",
    items: [
            { label: "Dados de teste", href: "/admin/dev-seed", matchPrefixes: ["/admin/dev-seed"] },
{ label: "Clientes", href: "/clientes", matchPrefixes: ["/clientes"] },
      { label: "Configurações", href: "/configuracoes", matchPrefixes: ["/configuracoes"] },
      { label: "Arquivos", href: "/arquivos", matchPrefixes: ["/arquivos"] },
      { label: "Assistente", href: "/assistente", matchPrefixes: ["/assistente"] },
    ],
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  const prefixes = item.matchPrefixes?.length ? item.matchPrefixes : [item.href];
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function AppSidebar() {
  const pathname = usePathname() || "/";

  return (
    <aside className="w-64 shrink-0 border-r border-slate-200 bg-white">
      <div className="sticky top-0 max-h-screen overflow-auto px-3 py-4">
        <div className="mb-4 px-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Navegação
          </div>
          <div className="mt-1 text-sm text-slate-700">
            Funções e subfunções
          </div>
        </div>

        <nav className="space-y-4">
          {SECTIONS.map((section) => (
            <div key={section.label}>
              <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                {section.label}
              </div>
              <ul className="mt-2 space-y-1">
                {section.items.map((item) => {
                  const active = isActive(pathname, item);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={[
                          "block rounded-md px-2 py-1.5 text-sm",
                          active
                            ? "bg-sky-50 text-sky-800 ring-1 ring-sky-100"
                            : "text-slate-700 hover:bg-slate-50 hover:text-slate-900",
                        ].join(" ")}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="mt-6 border-t border-slate-200 pt-4">
          <div className="px-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Dica rápida
          </div>
          <div className="mt-2 px-2 text-xs text-slate-600">
            Use a lista à esquerda para encontrar rapidamente cada módulo. Dentro
            de <span className="font-semibold">Clientes</span> você terá as páginas
            específicas por loja.
          </div>
        </div>
      </div>
    </aside>
  );
}
