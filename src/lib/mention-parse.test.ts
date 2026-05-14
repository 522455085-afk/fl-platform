import { describe, it, expect } from "vitest";
import { parseMentionTrigger } from "./mention-parse";

describe("parseMentionTrigger", () => {
  it("returns null at caret=0", () => {
    expect(parseMentionTrigger("", 0)).toBeNull();
    expect(parseMentionTrigger("@", 0)).toBeNull();
  });

  it("returns trigger when caret is right after a leading @", () => {
    const t = parseMentionTrigger("@", 1);
    expect(t).toEqual({ start: 0, end: 1, query: "" });
  });

  it("captures the query between @ and caret", () => {
    const t = parseMentionTrigger("@al", 3);
    expect(t).toEqual({ start: 0, end: 3, query: "al" });
  });

  it("works mid-string when @ is preceded by whitespace", () => {
    const t = parseMentionTrigger("hi @bo", 6);
    expect(t).toEqual({ start: 3, end: 6, query: "bo" });
  });

  it("rejects @ preceded by a non-whitespace char (e.g. email)", () => {
    // "foo@bar" — the @ is part of an email, not a mention.
    expect(parseMentionTrigger("foo@bar", 7)).toBeNull();
  });

  it("stops at whitespace inside the token", () => {
    // Caret is after a space inside what looked like a mention.
    expect(parseMentionTrigger("@al ice", 7)).toBeNull();
  });

  it("returns null when no @ at all", () => {
    expect(parseMentionTrigger("hello world", 5)).toBeNull();
  });

  it("handles caret in the middle of a longer string", () => {
    // "hi @ali ce" — caret after "ali" only sees the mention.
    const t = parseMentionTrigger("hi @ali ce", 7);
    expect(t).toEqual({ start: 3, end: 7, query: "ali" });
  });
});
