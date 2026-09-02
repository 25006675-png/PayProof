import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The legal pages read docs/ from the repository root at request time.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: { "/legal/[doc]": ["../docs/*.md"] },
};

export default nextConfig;
