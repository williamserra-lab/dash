import React from "react";

export type AlertVariant = "success" | "error" | "info";

function cn(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(" ");
}

export function Alert({
  children,
  variant,
  className,
}: {
  children: React.ReactNode;
  variant: AlertVariant;
  className?: string;
}) {
  const base = "rounded-xl p-4 text-sm ring-1";
  const cls =
    variant === "success"
      ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
      : variant === "error"
        ? "bg-rose-50 text-rose-800 ring-rose-200"
        : "bg-slate-50 text-slate-800 ring-slate-200";

  return <div className={cn(base, cls, className)}>{children}</div>;
}
