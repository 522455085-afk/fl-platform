"use client";

/**
 * Global Error Boundary for Next.js App Router.
 *
 * This file catches errors in the root layout segment.
 * For nested segments, create parallel `error.tsx` files.
 */
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("[Global Error]", error);
  }, [error]);

  return (
    <html>
      <body className="bg-[var(--bg-darkest)] text-white">
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="max-w-md w-full text-center space-y-6">
            <div className="text-6xl">⚔️</div>
            <h1 className="text-2xl font-bold text-[var(--accent)]">
              符文崩解了
            </h1>
            <p className="text-[var(--text-muted)] text-sm">
              发生了一个意外错误。请尝试刷新页面。
            </p>
            {error.digest && (
              <p className="text-xs text-[var(--text-muted)] font-mono">
                Digest: {error.digest}
              </p>
            )}
            <div className="flex gap-3 justify-center">
              <button
                onClick={() => reset()}
                className="px-4 py-2 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent)]/80 transition-colors text-sm font-medium"
              >
                重试
              </button>
              <button
                onClick={() => (window.location.href = "/")}
                className="px-4 py-2 rounded-lg bg-[var(--bg-mid)] text-white hover:bg-[var(--bg-light)] transition-colors text-sm font-medium"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
