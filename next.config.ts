import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Prisma client (and pg) must stay out of the bundler and be required at
  // runtime from node_modules — Turbopack cannot trace the generated client.
  // pdfkit reads its AFM font metrics from disk at runtime, so it has to be
  // required from node_modules rather than bundled — the same reason as Prisma.
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg", "pdfkit", "pg-boss"],
  typedRoutes: false,
  output: "standalone",
};

export default nextConfig;
