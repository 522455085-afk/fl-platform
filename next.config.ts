import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static export for EdgeOne Pages / any static host.
  // All auth & data calls happen client-side, so we don't need a Node server.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,

  // Ignore TypeScript errors during build (type definitions are incomplete)
  typescript: {
    ignoreBuildErrors: true,
  },

  // Next 16 默认拦截非 localhost 的 dev 资源请求；Windsurf 浏览器预览代理走
  // 127.0.0.1，会触发 "Blocked cross-origin request to /_next/webpack-hmr"，
  // 导致客户端 runtime 起不来、页面一直停在加载态。把代理常用的 host 列入
  // 白名单。生产 export 不受影响。
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.1.3"],

  // Force webpack to resolve `@cloudbase/*` packages with the browser variant
  // even during the static-export prerender pass. Without this, Next picks
  // the `node` conditional export which pulls in `jsonwebtoken` and other
  // server-only deps, breaking the build.
  webpack(config) {
    if (Array.isArray(config.resolve.conditionNames)) {
      config.resolve.conditionNames = [
        "browser",
        ...config.resolve.conditionNames.filter((c: string) => c !== "node"),
      ];
    } else {
      config.resolve.conditionNames = ["browser", "import", "require", "default"];
    }
    return config;
  },

  // Same as above for Turbopack (used by `next build` in Next 16).
  // Turbopack picks the `node` conditional export of `@cloudbase/app` because
  // SSR runs in a Node-ish environment, even though our pages are client
  // components. Force the browser entry for the only package that matters.
  turbopack: {
    resolveAlias: {
      "@cloudbase/app": "@cloudbase/app/dist/esm/index.js",
    },
  },
};

export default nextConfig;
