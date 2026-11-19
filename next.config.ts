import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PGlite carrega WASM do próprio pacote; postgres.js usa sockets nativos do Node
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  // PGlite (~58 MB) é só para desenvolvimento e testes: nunca entra nas funções de produção
  outputFileTracingExcludes: { "*": ["node_modules/@electric-sql/pglite/**"] },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // o script é carregado por sites de terceiros (páginas de venda)
      {
        source: "/t.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cross-Origin-Resource-Policy", value: "cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
