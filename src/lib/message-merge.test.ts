import { describe, it, expect } from "vitest";
import {
  mergeRealtimeInsert,
  mergeOptimisticSwap,
  type MergeableMessage,
} from "./message-merge";

// Compact factory so tests stay readable.
const m = (id: string, authorId = "u1", content = "hi"): MergeableMessage => ({
  id,
  authorId,
  content,
});

describe("mergeRealtimeInsert", () => {
  it("appends a new row whose id isn't already present", () => {
    const out = mergeRealtimeInsert([m("a"), m("b")], m("c"));
    expect(out.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  it("returns prev unchanged when the row id is already present", () => {
    const prev = [m("a"), m("b")];
    const out = mergeRealtimeInsert(prev, m("b"));
    // Referential identity matters — React short-circuits on it.
    expect(out).toBe(prev);
  });

  it("strips a matching __pending__ row from the same author with same content", () => {
    // Simulates: send() pushed an optimistic temp row, then the
    // realtime stream delivered the canonical row before await
    // resolved. The temp row must vanish or we hit duplicate-key.
    const prev: MergeableMessage[] = [
      m("a"),
      { id: "__pending__xyz", authorId: "u1", content: "hello" },
    ];
    const incoming: MergeableMessage = {
      id: "real-123",
      authorId: "u1",
      content: "hello",
    };
    const out = mergeRealtimeInsert(prev, incoming);
    expect(out.map((x) => x.id)).toEqual(["a", "real-123"]);
  });

  it("does NOT strip a __pending__ row if author or content differs", () => {
    const prev: MergeableMessage[] = [
      { id: "__pending__1", authorId: "u1", content: "hi" },
      { id: "__pending__2", authorId: "u2", content: "hi" },
    ];
    // Same content, different author → not the same message.
    const out = mergeRealtimeInsert(prev, {
      id: "r1",
      authorId: "u1",
      content: "different",
    });
    expect(out.map((x) => x.id)).toEqual([
      "__pending__1",
      "__pending__2",
      "r1",
    ]);
  });
});

describe("mergeOptimisticSwap", () => {
  it("replaces the temp row with the real row", () => {
    const prev: MergeableMessage[] = [m("a"), m("__pending__t"), m("b")];
    const out = mergeOptimisticSwap(prev, "__pending__t", m("real-1"));
    expect(out.map((x) => x.id)).toEqual(["a", "b", "real-1"]);
  });

  it("drops the temp row and does NOT re-add real if it's already present (realtime raced)", () => {
    const prev: MergeableMessage[] = [
      m("__pending__t"),
      m("real-1"), // already arrived via realtime
    ];
    const out = mergeOptimisticSwap(prev, "__pending__t", m("real-1"));
    expect(out.map((x) => x.id)).toEqual(["real-1"]);
  });

  it("is a no-op-ish when temp is absent and real is absent", () => {
    const prev: MergeableMessage[] = [m("a")];
    const out = mergeOptimisticSwap(prev, "__pending__missing", m("real-z"));
    expect(out.map((x) => x.id)).toEqual(["a", "real-z"]);
  });
});
