import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn utility", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    const active = true;
    const disabled = false;
    expect(cn("base", active && "active", disabled && "disabled")).toBe(
      "base active",
    );
  });

  it("handles Tailwind duplicates", () => {
    // clsx merges, twMerge deduplicates Tailwind classes
    expect(cn("p-4 p-2")).toBe("p-2");
    expect(cn("bg-red-500 bg-blue-500")).toBe("bg-blue-500");
  });

  it("handles undefined and null", () => {
    expect(cn("foo", undefined, null, "bar")).toBe("foo bar");
  });

  it("handles empty strings", () => {
    expect(cn("", "foo", "", "bar")).toBe("foo bar");
  });

  it("handles array input", () => {
    expect(cn(["foo", "bar"])).toBe("foo bar");
  });

  it("handles mixed input types", () => {
    expect(cn("base", ["a", "b"], { c: true, d: false })).toBe(
      "base a b c",
    );
  });
});
