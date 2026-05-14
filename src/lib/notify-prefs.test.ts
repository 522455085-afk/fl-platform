import { describe, it, expect, beforeEach } from "vitest";
import { useNotifyPrefs, notifyPrefs } from "./notify-prefs";

beforeEach(() => {
  // Reset to default in case earlier tests mutated the store. Persist
  // middleware writes to localStorage; jsdom resets per-file but not
  // per-test, so clear explicitly.
  if (typeof localStorage !== "undefined") localStorage.clear();
  useNotifyPrefs.setState({ mentionSound: true, browserNotifyEnabled: true });
});

describe("useNotifyPrefs", () => {
  it("starts with both toggles enabled by default", () => {
    expect(useNotifyPrefs.getState().mentionSound).toBe(true);
    expect(useNotifyPrefs.getState().browserNotifyEnabled).toBe(true);
  });

  it("setMentionSound flips only that flag", () => {
    useNotifyPrefs.getState().setMentionSound(false);
    expect(useNotifyPrefs.getState().mentionSound).toBe(false);
    expect(useNotifyPrefs.getState().browserNotifyEnabled).toBe(true);
  });

  it("setBrowserNotifyEnabled flips only that flag", () => {
    useNotifyPrefs.getState().setBrowserNotifyEnabled(false);
    expect(useNotifyPrefs.getState().browserNotifyEnabled).toBe(false);
    expect(useNotifyPrefs.getState().mentionSound).toBe(true);
  });

  it("notifyPrefs accessor reads through to the live store state", () => {
    expect(notifyPrefs.mentionSound()).toBe(true);
    useNotifyPrefs.getState().setMentionSound(false);
    expect(notifyPrefs.mentionSound()).toBe(false);
  });
});
