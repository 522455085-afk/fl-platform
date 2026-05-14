"use client";

/**
 * useMicLevel — capture the local microphone via getUserMedia and expose
 * a smoothed 0..1 RMS level. Provides a clear "I'm speaking" indicator
 * for the voice UI even though we don't yet ship audio to other peers.
 *
 * Usage:
 *   const { level, error, hasPermission } = useMicLevel(active && !muted);
 *
 * When `active` flips to false the underlying MediaStream + AudioContext
 * are torn down (no leaked mic indicator in the OS).
 */

import { useEffect, useRef, useState } from "react";

type State = {
  level: number;
  /** True once getUserMedia has resolved successfully at least once. */
  hasPermission: boolean;
  error: string | null;
};

export function useMicLevel(active: boolean): State {
  const [state, setState] = useState<State>({
    level: 0,
    hasPermission: false,
    error: null,
  });

  // Latest level kept in a ref so the RAF loop stays GC-friendly and
  // doesn't re-trigger setState on every frame; we throttle setState.
  const rafRef = useRef<number | null>(null);
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    if (!active) {
      setState((s) => (s.level === 0 ? s : { ...s, level: 0 }));
      return;
    }
    if (typeof window === "undefined") return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        level: 0,
        hasPermission: false,
        error: "浏览器不支持麦克风采集",
      });
      return;
    }

    let cancelled = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let buf: Uint8Array | null = null;

    const tick = () => {
      if (cancelled || !analyser || !buf) return;
      // Note: TypeScript's lib.dom typings for getByteTimeDomainData want
      // `Uint8Array<ArrayBuffer>` (not `<ArrayBufferLike>`), which our
      // freshly-allocated buffer satisfies; cast keeps TS quiet across
      // versions.
      analyser.getByteTimeDomainData(
        buf as unknown as Uint8Array<ArrayBuffer>,
      );
      // Compute RMS in [0, 1]. byte values are 128 ± amplitude.
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = (buf[i] - 128) / 128;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / buf.length);
      // Slight gain so quiet speech still registers; clamp to 1.
      const level = Math.min(1, rms * 2.5);
      const now = performance.now();
      if (now - lastUpdateRef.current > 50) {
        // 20fps state updates is plenty for a glow ring.
        lastUpdateRef.current = now;
        setState((s) => (s.level === level ? s : { ...s, level }));
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const Ctx: typeof AudioContext =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        ctx = new Ctx();
        source = ctx.createMediaStreamSource(stream);
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        source.connect(analyser);
        buf = new Uint8Array(analyser.fftSize);
        setState({ level: 0, hasPermission: true, error: null });
        rafRef.current = requestAnimationFrame(tick);
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "无法获取麦克风（已拒绝授权？）";
        if (!cancelled) {
          setState({ level: 0, hasPermission: false, error: msg });
        }
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      if (source) try { source.disconnect(); } catch { /* noop */ }
      if (analyser) try { analyser.disconnect(); } catch { /* noop */ }
      if (ctx) ctx.close().catch(() => { /* noop */ });
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [active]);

  return state;
}
