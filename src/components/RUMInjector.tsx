"use client";

import { useEffect } from "react";

/**
 * 腾讯云 RUM 性能监控注入组件
 * 
 * 使用前请在 .env.local 中配置：
 * - NEXT_PUBLIC_RUM_APP_ID: RUM 应用 ID
 * - NEXT_PUBLIC_RUM_REPORT_URL: RUM 上报地址
 * - NEXT_PUBLIC_RUM_SAMPLE_RATE: 采样率（可选，默认 1）
 * 
 * 获取方式：https://console.cloud.tencent.com/rum
 */
export default function RUMInjector() {
  useEffect(() => {
    const appId = process.env.NEXT_PUBLIC_RUM_APP_ID;
    const reportUrl = process.env.NEXT_PUBLIC_RUM_REPORT_URL;
    const sampleRate = parseFloat(
      process.env.NEXT_PUBLIC_RUM_SAMPLE_RATE || "1"
    );

    // 如果未配置 RUM，则不注入
    if (!appId || !reportUrl) {
      return;
    }

    // 避免重复注入
    if (window.RUM) {
      return;
    }

    // 注入 RUM SDK
    const script = document.createElement("script");
    script.src = "https://cdn-go.tencent-cloud.com/aegis/aegis.min.js";
    script.async = true;
    
    script.onload = () => {
      if (window.RUM) {
        window.RUM.config = {
          appID: appId,
          reportUrl: reportUrl,
          rate: sampleRate,
          autoReport: true,
          autoReportApi: true,
          autoReportError: true,
        };
      }
    };

    document.head.appendChild(script);
  }, []);

  return null;
}
