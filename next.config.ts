import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 캡처 엔진에서 사용하는 네이티브 모듈 번들 제외
  serverExternalPackages: ["puppeteer-core", "@sparticuz/chromium-min", "sharp"],
};

export default nextConfig;
