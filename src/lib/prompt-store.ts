import { create } from "zustand";

type State = {
  open: boolean;
  message: string;
  placeholder: string;
  defaultValue: string;
  _resolve: ((value: string | null) => void) | null;
};

type Actions = {
  /** Show a centered prompt dialog. Returns the entered string, or null if cancelled. */
  prompt: (message: string, defaultValue?: string, placeholder?: string) => Promise<string | null>;
  _answer: (value: string | null) => void;
};

export const usePromptStore = create<State & Actions>((set, get) => ({
  open: false,
  message: "",
  placeholder: "",
  defaultValue: "",
  _resolve: null,

  prompt(message, defaultValue = "", placeholder = "") {
    return new Promise<string | null>((resolve) => {
      set({ open: true, message, defaultValue, placeholder, _resolve: resolve });
    });
  },

  _answer(value) {
    const { _resolve } = get();
    set({ open: false, _resolve: null });
    _resolve?.(value);
  },
}));

/** Imperative helper — replaces window.prompt(). */
export const prompt = (message: string, defaultValue?: string, placeholder?: string) =>
  usePromptStore.getState().prompt(message, defaultValue, placeholder);
