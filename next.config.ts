import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Reuse recently visited authenticated screens; their live subscriptions
    // refresh changed data. Role switches explicitly clear the router cache.
    staleTimes: { dynamic: 60, static: 60 },
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
