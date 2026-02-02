import React from "react";

function cn(...parts: Array<string | undefined | false | null>) {
  return parts.filter(Boolean).join(" ");
}

export type CardProps = {
  children: React.ReactNode;
  className?: string;
};

export function Card({ children, className }: CardProps) {
  return <div className={cn("rounded-2xl bg-white ring-1 ring-black/5", className)}>{children}</div>;
}

export type CardSectionProps = {
  children: React.ReactNode;
  className?: string;
};

export function CardHeader({ children, className }: CardSectionProps) {
  return <div className={cn("p-6", className)}>{children}</div>;
}

export function CardContent({ children, className }: CardSectionProps) {
  return <div className={cn("px-6 pb-6", className)}>{children}</div>;
}

export function CardTitle({ children, className }: CardSectionProps) {
  return <div className={cn("text-base font-semibold text-gray-900", className)}>{children}</div>;
}

export function CardDescription({ children, className }: CardSectionProps) {
  return <div className={cn("mt-1 text-sm text-gray-600", className)}>{children}</div>;
}
