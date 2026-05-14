import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useUnreadStore } from "./unread-store";

// Reset store between tests
beforeEach(() => {
  useUnreadStore.setState({
    unread: {},
    mentions: {},
    serverMentions: {},
    serverMentionCounts: {},
    mentionCounts: {},
  });
});

describe("unread-store", () => {
  describe("markChannelUnread", () => {
    it("marks channel as unread", () => {
      useUnreadStore.getState().markChannelUnread("ch-1");
      expect(useUnreadStore.getState().unread["ch-1"]).toBe(true);
    });

    it("marks channel as mention when hasMention=true", () => {
      useUnreadStore.getState().markChannelUnread("ch-1", true);
      const state = useUnreadStore.getState();
      expect(state.unread["ch-1"]).toBe(true);
      expect(state.mentions["ch-1"]).toBe(true);
      expect(state.mentionCounts["ch-1"]).toBe(1);
    });

    it("increments mention count on multiple calls", () => {
      useUnreadStore.getState().markChannelUnread("ch-1", true);
      useUnreadStore.getState().markChannelUnread("ch-1", true);
      expect(useUnreadStore.getState().mentionCounts["ch-1"]).toBe(2);
    });

    it("does not mark mention when hasMention=false", () => {
      useUnreadStore.getState().markChannelUnread("ch-1", false);
      const state = useUnreadStore.getState();
      expect(state.unread["ch-1"]).toBe(true);
      expect(state.mentions["ch-1"]).toBeUndefined();
    });
  });

  describe("markChannelRead", () => {
    it("clears unread state", () => {
      useUnreadStore.getState().markChannelUnread("ch-1", true);
      useUnreadStore.getState().markChannelRead("ch-1");
      const state = useUnreadStore.getState();
      expect(state.unread["ch-1"]).toBeUndefined();
      expect(state.mentions["ch-1"]).toBeUndefined();
      expect(state.mentionCounts["ch-1"]).toBeUndefined();
    });

    it("only clears the specified channel", () => {
      useUnreadStore.getState().markChannelUnread("ch-1");
      useUnreadStore.getState().markChannelUnread("ch-2");
      useUnreadStore.getState().markChannelRead("ch-1");
      expect(useUnreadStore.getState().unread["ch-1"]).toBeUndefined();
      expect(useUnreadStore.getState().unread["ch-2"]).toBe(true);
    });
  });

  describe("markServerMention", () => {
    it("marks server as having mention", () => {
      useUnreadStore.getState().markServerMention("srv-1");
      expect(useUnreadStore.getState().serverMentions["srv-1"]).toBe(true);
      expect(useUnreadStore.getState().serverMentionCounts["srv-1"]).toBe(1);
    });

    it("increments server mention count", () => {
      useUnreadStore.getState().markServerMention("srv-1");
      useUnreadStore.getState().markServerMention("srv-1");
      expect(useUnreadStore.getState().serverMentionCounts["srv-1"]).toBe(2);
    });
  });

  describe("markServerRead", () => {
    it("clears all channel unread state", () => {
      useUnreadStore.getState().markChannelUnread("ch-1", true);
      useUnreadStore.getState().markChannelUnread("ch-2", true);
      useUnreadStore.getState().markServerMention("srv-1");
      useUnreadStore.getState().markServerRead(["ch-1", "ch-2"], "srv-1");
      const state = useUnreadStore.getState();
      expect(state.unread["ch-1"]).toBeUndefined();
      expect(state.unread["ch-2"]).toBeUndefined();
      expect(state.serverMentions["srv-1"]).toBeUndefined();
    });
  });
});
