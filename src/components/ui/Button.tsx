import React from "react";

export type ButtonVariant = "primary" | "secondary";

export type ButtonProps = {
  children: React.ReactNode;
  variant?: ButtonVariant;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit" | "reset";
};

function cn(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  children,
  variant = "primary",
  disabled,
  onClick,
  className,
  type = "button",
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-lg px-3 py-2 text-sm font-medium shadow-sm "+
    "disabled:opacity-50 disabled:cursor-not-allowed";

  const primary = "bg-gray-900 text-white hover:bg-gray-800";
  const secondary = "bg-white text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50";

  const variantCls = variant === "secondary" ? secondary : primary;

  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(base, variantCls, className)}
    >
      {children}
    </button>
  );
}
