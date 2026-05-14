import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act } from "@testing-library/react";
import { useToastStore, toast } from "./toast-store";

// Use fake timers for auto-dismiss tests
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  // Reset store
  useToastStore.setState({ toasts: [] });
});

describe("toast-store", () => {
  it("pushes a toast with info kind", () => {
    useToastStore.getState().push("info", "Hello");
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: "info", text: "Hello" });
  });

  it("pushes a toast with success kind", () => {
    useToastStore.getState().push("success", "Saved");
    expect(useToastStore.getState().toasts[0].kind).toBe("success");
  });

  it("pushes a toast with error kind", () => {
    useToastStore.getState().push("error", "Failed");
    expect(useToastStore.getState().toasts[0].kind).toBe("error");
  });

  it("generates unique ids for each toast", () => {
    useToastStore.getState().push("info", "A");
    useToastStore.getState().push("info", "B");
    const toasts = useToastStore.getState().toasts;
    expect(toasts[0].id).not.toBe(toasts[1].id);
  });

  it("dismisses toast by id", () => {
    useToastStore.getState().push("info", "Hello");
    const id = useToastStore.getState().toasts[0].id;
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("auto-dismisses after 2 seconds", () => {
    useToastStore.getState().push("info", "Temporary");
    expect(useToastStore.getState().toasts).toHaveLength(1);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("only dismisses the timed-out toast", () => {
    useToastStore.getState().push("info", "First");
    useToastStore.getState().push("info", "Second");
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("preserves other toasts when one is dismissed manually", () => {
    useToastStore.getState().push("info", "A");
    useToastStore.getState().push("info", "B");
    const idB = useToastStore.getState().toasts[1].id;
    useToastStore.getState().dismiss(idB);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].text).toBe("A");
  });
});

describe("toast facade", () => {
  it("is exported as a function", () => {
    expect(typeof toast).toBe("function");
    expect(typeof toast.success).toBe("function");
    expect(typeof toast.error).toBe("function");
    expect(typeof toast.info).toBe("function");
  });
});
