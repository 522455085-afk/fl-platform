"use client";

/**
 * Client-side Error Boundary for wrapping specific components.
 * Use this inside the App Router (which already has built-in error.tsx support)
 * when you want to isolate a subtree and show a fallback UI without
 * unmounting the entire layout.
 *
 * Usage:
 *   <ErrorBoundary fallback={<p>渲染失败</p>}>
 *     <ProblematicComponent />
 *   </ErrorBoundary>
 */

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Custom fallback UI. Defaults to a simple error message. */
  fallback?: ReactNode;
  /** Optional callback when an error is caught. */
  onError?: (error: Error, info: { componentStack: string }) => void;
};

type State = { hasError: boolean; error?: Error };

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[ErrorBoundary]", error, info);
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? (
          <div className="p-4 text-center text-[var(--danger)] text-sm italic">
            ⚠️ 组件渲染失败，请刷新页面重试。
          </div>
        )
      );
    }

    return this.props.children;
  }
}
