/**
 * Pure-function message-list mergers shared between ChatView's two
 * critical send paths:
 *
 *   1. Realtime INSERT handler — when CloudBase's realtime stream
 *      delivers a row, we must dedupe against (a) the same row id
 *      arriving twice from poll + realtime, and (b) the optimistic
 *      `__pending__` row that send() inserted moments earlier.
 *
 *   2. Post-insert swap — when our own send()'s await resolves with
 *      the canonical row id, we replace the optimistic row in place.
 *      But the realtime handler may have ALREADY observed and pushed
 *      the real row in the meantime, so we must also strip any
 *      lingering copy of the real id.
 *
 * Both functions were inlined in ChatView until it became clear that
 * a subtle ordering bug between the two produced an avalanche of
 * "Encountered two children with the same key" React warnings that
 * dragged frame times to 1-2s. Extracting them lets us pin the
 * invariants down with unit tests.
 *
 * NOTE: Generic `T` so the callers in ChatView and any future tests
 * can use their own UiMessage shape without dragging the full type
 * here. The helpers only access `id`, `authorId`, and `content`.
 */

export type MergeableMessage = {
  id: string;
  authorId: string;
  content: string;
};

/**
 * Merge a row delivered via realtime INSERT into the existing list.
 *
 * Invariants:
 *  - The real row's id is never duplicated. If it already exists,
 *    `prev` is returned unchanged (referential identity preserved so
 *    React can short-circuit).
 *  - Any optimistic `__pending__` row with matching author + content
 *    is removed — that row IS the realtime row, just under a temp id.
 *  - The new row is appended at the end (callers render in arrival
 *    order; chronological sort happens elsewhere).
 */
export function mergeRealtimeInsert<T extends MergeableMessage>(
  prev: T[],
  incoming: T,
): T[] {
  if (prev.some((m) => m.id === incoming.id)) return prev;
  const filtered = prev.filter(
    (m) =>
      !(
        m.id.startsWith("__pending__") &&
        m.authorId === incoming.authorId &&
        m.content === incoming.content
      ),
  );
  return [...filtered, incoming];
}

/**
 * After our own insert resolves, swap the optimistic temp row for
 * the canonical one. Also defends against the case where the
 * realtime INSERT raced ahead of us and already added the real row
 * (common on a fast connection): in that case we just drop the temp
 * without re-adding the real row, leaving exactly one copy.
 */
export function mergeOptimisticSwap<T extends MergeableMessage>(
  prev: T[],
  tempId: string,
  real: T,
): T[] {
  const withoutTemp = prev.filter((m) => m.id !== tempId);
  if (withoutTemp.some((m) => m.id === real.id)) return withoutTemp;
  return [...withoutTemp, real];
}
