import React from "react";

export function EmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div className={["rounded-xl border border-gray-200 bg-gray-50 p-4", className].filter(Boolean).join(" ")}>
      <div className="text-sm font-medium text-gray-900">{title}</div>
      {description ? <div className="mt-1 text-sm text-gray-600">{description}</div> : null}
    </div>
  );
}
