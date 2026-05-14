import { create } from "zustand";

/** Per-prompt options. */
export type ConfirmOpts = {
  /**
   * Stable identifier for this confirm flow. When provided, enables
   * the "don't ask again" checkbox below the buttons; checking it and
   * confirming records the choice in localStorage so subsequent calls
   * with the same id skip the dialog entirely (resolve true).
   *
   * Use the same id whenever you ask the same question (e.g. always
   * pass "dm-hide" for "remove this DM conversation?"). Different
   * actions should use different ids.
   */
  id?: string;
  /**
   * Label for the "don't ask again" checkbox. Defaults to "不再提醒".
   * Only rendered when `id` is also provided (the checkbox is
   * meaningless without a key to store the decision under).
   */
  rememberLabel?: string;
  /** Custom button labels (defaults: "确定" / "取消"). */
  okLabel?: string;
  cancelLabel?: string;
  /**
   * Visual tone for the primary button. "danger" (default) renders a
   * red button — appropriate for destructive confirms (delete, kick).
   * "primary" renders the accent purple — use for non-destructive
   * confirmations and for `alert()` informational dialogs.
   */
  tone?: "danger" | "primary";
};

type State = {
  open: boolean;
  message: string;
  rememberLabel: string | null;
  rememberId: string | null;
  okLabel: string;
  cancelLabel: string | null; // null => single-button (alert) mode
  tone: "danger" | "primary";
  _resolve: ((ok: boolean) => void) | null;
};

type Actions = {
  /**
   * Show a centered confirm dialog. Returns true if the user clicks
   * 确定. If opts.id was passed and the user previously chose "don't
   * ask again", resolves true synchronously without showing the
   * dialog.
   */
  confirm: (message: string, opts?: ConfirmOpts) => Promise<boolean>;
  /** Internal — invoked by the dialog component. */
  _answer: (ok: boolean, remember: boolean) => void;
};

const SKIP_PREFIX = "fl_confirm_skip:";

function shouldSkip(id: string | undefined): boolean {
  if (!id || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(SKIP_PREFIX + id) === "1";
  } catch {
    return false;
  }
}

function recordSkip(id: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SKIP_PREFIX + id, "1");
  } catch {
    /* quota / private mode — best-effort */
  }
}

export const useConfirmStore = create<State & Actions>((set, get) => ({
  open: false,
  message: "",
  rememberLabel: null,
  rememberId: null,
  okLabel: "确定",
  cancelLabel: "取消",
  tone: "danger",
  _resolve: null,

  confirm(message: string, opts?: ConfirmOpts): Promise<boolean> {
    if (opts?.id && shouldSkip(opts.id)) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      set({
        open: true,
        message,
        rememberLabel: opts?.id ? opts.rememberLabel ?? "不再提醒" : null,
        rememberId: opts?.id ?? null,
        okLabel: opts?.okLabel ?? "确定",
        cancelLabel: opts?.cancelLabel ?? "取消",
        tone: opts?.tone ?? "danger",
        _resolve: resolve,
      });
    });
  },

  _answer(ok: boolean, remember: boolean) {
    const { _resolve, rememberId } = get();
    if (ok && remember && rememberId) recordSkip(rememberId);
    set({
      open: false,
      _resolve: null,
      rememberLabel: null,
      rememberId: null,
    });
    _resolve?.(ok);
  },
}));

/** Imperative helper — call from async event handlers instead of window.confirm(). */
export const confirm = (message: string, opts?: ConfirmOpts) =>
  useConfirmStore.getState().confirm(message, opts);

/**
 * Single-button informational dialog — drop-in replacement for
 * window.alert(). Renders the same centered card as `confirm()` but
 * with no Cancel button and the primary action coloured in the
 * accent tone (no destructive red). Always resolves once the user
 * clicks 确定 or dismisses by clicking the backdrop. The promise
 * lets callers `await` if they need to sequence subsequent UI
 * updates after the user has acknowledged the message — same
 * semantics as window.alert(), just non-blocking.
 */
export const alert = (message: string, opts?: { okLabel?: string }): Promise<void> =>
  useConfirmStore
    .getState()
    .confirm(message, {
      okLabel: opts?.okLabel ?? "确定",
      // The empty cancelLabel signals single-button mode to ConfirmDialog.
      cancelLabel: "",
      tone: "primary",
    })
    .then(() => undefined);
