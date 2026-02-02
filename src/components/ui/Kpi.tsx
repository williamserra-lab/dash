import React from "react";

function cn(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(" ");
}

export type KpiProps = {
  label: string;
  value: string | number;
  className?: string;
};

export function Kpi({ label, value, className }: KpiProps) {
  return (
    <div className={cn("rounded-xl bg-white p-4 ring-1 ring-black/5", className)}>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-gray-900 tabular-nums">{value}</div>
    </div>
  );
}
