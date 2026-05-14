"use client";

/**
 * Virtualized list for rendering large message/item lists efficiently.
 * Only renders items visible in the viewport + overscan buffer.
 *
 * Usage:
 *   <VirtualList
 *     items={messages}
 *     estimatedSize={72}
 *     overscan={5}
 *     renderItem={(msg, index) => <MessageRow key={msg.id} message={msg} />}
 *     getItemKey={(msg) => msg.id}
 *   />
 */

import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
  type CSSProperties,
} from "react";

export interface VirtualListProps<T> {
  /** Array of items to render */
  items: T[];
  /** Estimated height of each item in pixels */
  estimatedSize?: number;
  /** Number of items to render outside viewport */
  overscan?: number;
  /** Render function for each item */
  renderItem: (item: T, index: number) => ReactNode;
  /** Key extractor for items */
  getItemKey: (item: T) => string | number;
  /** Container class */
  className?: string;
  /** Custom item height measurement (optional) */
  measureItem?: (element: HTMLElement) => number;
}

export function VirtualList<T>({
  items,
  estimatedSize = 72,
  overscan = 3,
  renderItem,
  getItemKey,
  className,
  measureItem,
}: VirtualListProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(0);
  const itemHeights = useRef<Map<string | number, number>>(new Map());
  const containerRefReady = useRef<boolean>(false);

  // Measure container on mount and resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    containerRefReady.current = true;

    const updateHeight = () => {
      if (container) {
        setContainerHeight(container.clientHeight);
      }
    };

    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // Calculate positions with measured heights
  const { positions, totalHeight } = useMemo(() => {
    const positions: { offset: number; size: number; index: number }[] = [];
    let offset = 0;

    for (let i = 0; i < items.length; i++) {
      const key = getItemKey(items[i]);
      const measuredSize = itemHeights.current.get(key) ?? estimatedSize;
      positions.push({ offset, size: measuredSize, index: i });
      offset += measuredSize;
    }

    return { positions, totalHeight: offset };
  }, [items, estimatedSize, getItemKey]);

  // Find visible range
  const visibleRange = useMemo(() => {
    const start = positions.findIndex((p) => p.offset + p.size > scrollTop);
    const end = positions.findIndex(
      (p) => p.offset > scrollTop + containerHeight,
    );

    const startIndex = Math.max(0, (start === -1 ? items.length : start) - overscan);
    const endIndex = Math.min(
      items.length,
      (end === -1 ? items.length : end) + overscan,
    );

    return { startIndex, endIndex };
  }, [positions, scrollTop, containerHeight, overscan, items.length]);

  // Measure rendered items
  const measureRenderedItems = useCallback(() => {
    if (!containerRef.current) return;

    const container = containerRef.current;
    const firstChild = container.firstElementChild as HTMLElement | null;
    if (!firstChild) return;

    // Measure all visible item elements
    const rows = firstChild.querySelectorAll<HTMLElement>(
      "[data-virtual-row]",
    );
    rows.forEach((row) => {
      const key = row.dataset.virtualKey;
      if (!key) return;

      const measuredHeight = measureItem
        ? measureItem(row)
        : row.getBoundingClientRect().height;

      if (itemHeights.current.get(key) !== measuredHeight) {
        itemHeights.current.set(key, measuredHeight);
      }
    });
  }, [measureItem]);

  // Attach measurement after render
  useEffect(() => {
    // Use requestAnimationFrame to measure after layout
    const raf = requestAnimationFrame(measureRenderedItems);
    return () => cancelAnimationFrame(raf);
  });

  // Handle scroll
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Visible items
  const visibleItems = useMemo(() => {
    const result: { item: T; index: number; key: string | number }[] = [];
    for (let i = visibleRange.startIndex; i < visibleRange.endIndex; i++) {
      result.push({
        item: items[i],
        index: i,
        key: getItemKey(items[i]),
      });
    }
    return result;
  }, [items, visibleRange, getItemKey]);

  const containerStyle: CSSProperties = {
    height: "100%",
    overflowY: "auto",
    position: "relative",
  };

  const contentStyle: CSSProperties = {
    height: totalHeight,
    position: "relative",
  };

  return (
    <div
      ref={containerRef}
      className={className}
      onScroll={handleScroll}
      style={containerStyle}
    >
      <div style={contentStyle}>
        {visibleItems.map(({ item, index, key }) => {
          const pos = positions[index];
          const style: CSSProperties = {
            position: "absolute",
            top: pos.offset,
            left: 0,
            right: 0,
            minHeight: pos.size,
          };

          return (
            <div
              key={key}
              data-virtual-row
              data-virtual-key={key}
              style={style}
            >
              {renderItem(item, index)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Hook for simple virtualization with manual item height tracking.
 * Use this when you need more control over the virtualization logic.
 */
export function useVirtualization<T>({
  items,
  estimatedSize,
  containerHeight,
  scrollTop,
  overscan = 3,
}: {
  items: T[];
  estimatedSize: number;
  containerHeight: number;
  scrollTop: number;
  overscan?: number;
}) {
  const totalHeight = items.length * estimatedSize;
  const startIndex = Math.max(0, Math.floor(scrollTop / estimatedSize) - overscan);
  const visibleCount = Math.ceil(containerHeight / estimatedSize);
  const endIndex = Math.min(items.length, startIndex + visibleCount + overscan * 2);

  return {
    totalHeight,
    visibleItems: items.slice(startIndex, endIndex),
    startIndex,
    endIndex,
    offsets: Array.from({ length: items.length }, (_, i) => i * estimatedSize),
  };
}
