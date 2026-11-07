import type { NextConfig } from "next";

const isProduction = process.env.NODE_ENV === "production";

// Bezpečnostní hlavičky. CSP jen v produkci (vývojový server potřebuje eval pro HMR).
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  ...(isProduction
    ? [
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            "script-src 'self' 'unsafe-inline'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self'",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join("; "),
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Soukromá aplikace s daty za přihlášením: vše se renderuje dynamicky.
  cacheComponents: false,
  serverExternalPackages: ["better-sqlite3", "@prisma/adapter-better-sqlite3", "@react-pdf/renderer", "tar"],
  // Do standalone buildu patří fonty pro PDF a migrace; lokální data nikdy.
  outputFileTracingIncludes: {
    "/**": ["./assets/fonts/**", "./prisma/migrations/**"],
  },
  outputFileTracingExcludes: {
    "/**": ["./data/**", "./.env*", "./tests/**", "./scripts/offline-schema-engine.sh"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
