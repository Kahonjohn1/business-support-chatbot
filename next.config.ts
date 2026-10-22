import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The approved knowledge base is read from disk at request time, so the
  // Markdown files must be part of the server trace of the chat route.
  outputFileTracingIncludes: {
    "/api/chat": ["./knowledge-base/*.md"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
