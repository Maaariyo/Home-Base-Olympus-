import type { NextConfig } from "next";

// Static export: `npm run build` writes plain HTML/JS/CSS to out/, hostable on any static host.
const nextConfig: NextConfig = {
  output: "export",
  reactStrictMode: true,
};

export default nextConfig;
