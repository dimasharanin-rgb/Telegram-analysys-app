import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // pdfkit reads its built-in AFM metrics and our embedded font from disk at
  // runtime, so both must be traced into the serverless/standalone output.
  outputFileTracingIncludes: {
    "/api/export/pdf": ["./assets/fonts/**/*", "./node_modules/pdfkit/js/data/**/*"],
  },
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
