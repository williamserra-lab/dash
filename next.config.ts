import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // React Compiler agora é opção de topo, não mais em experimental
  reactCompiler: true,

  // Libera o dev server para ser acessado pelo IP da máquina na rede
  // (não coloca http:// nem porta)
  allowedDevOrigins: ["192.168.3.252"],

  // Ensure SQL migrations are included in output tracing bundles
  outputFileTracingIncludes: {
    "/*": ["db/migrations/**/*.sql"],
  },
};

export default nextConfig;
