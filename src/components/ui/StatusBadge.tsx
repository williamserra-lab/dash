import React from "react";

export type CampaignStatus =
  | "rascunho"
  | "simulada"
  | "disparada"
  | "em_andamento"
  | "pausada"
  | "cancelada";

const STATUS_LABEL: Record<CampaignStatus, string> = {
  rascunho: "Rascunho",
  simulada: "Simulada",
  disparada: "Disparada",
  em_andamento: "Em andamento",
  pausada: "Pausada",
  cancelada: "Cancelada",
};

export function StatusBadge({ status, className }: { status: CampaignStatus; className?: string }) {
  const base =
    "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset";

  const cls =
    status === "disparada"
      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
      : status === "em_andamento"
        ? "bg-amber-50 text-amber-800 ring-amber-200"
        : status === "pausada"
          ? "bg-slate-100 text-slate-700 ring-slate-200"
          : status === "cancelada"
            ? "bg-rose-50 text-rose-700 ring-rose-200"
            : status === "simulada"
              ? "bg-blue-50 text-blue-700 ring-blue-200"
              : "bg-gray-50 text-gray-700 ring-gray-200";

  const label = STATUS_LABEL[status] ?? status;

  return <span className={[base, cls, className].filter(Boolean).join(" ")}>{label}</span>;
}
