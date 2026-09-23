import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // El plano nombra la pantalla de integraciones como /settings/integrations;
  // todas las pantallas del proyecto viven bajo /dashboard (F24).
  async redirects() {
    return [
      { source: "/settings/integrations", destination: "/dashboard/settings/integrations", permanent: false },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default nextConfig;
