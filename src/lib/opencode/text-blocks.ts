/**
 * Assembles the agent's text from the `text` events the sandbox runtime emits.
 *
 * Each event carries the full current text of one block, keyed by its position
 * in the message. That makes assembly idempotent, which matters because events
 * are delivered over two transports at once and can therefore arrive twice, or
 * slightly out of order relative to one another.
 */
export type TextBlockState = Map<number, { seq: number; text: string }>;

export const createTextBlockState = (): TextBlockState => new Map();

/**
 * Applies one `text` event. Returns whether the state changed — an older or
 * duplicated snapshot of a block is discarded rather than rewinding it.
 */
export const applyTextBlock = (
  state: TextBlockState,
  input: { index: number; seq: number; text: string },
) => {
  const existing = state.get(input.index);

  if (existing && existing.seq >= input.seq) {
    return false;
  }

  if (existing?.text === input.text) {
    return false;
  }

  state.set(input.index, { seq: input.seq, text: input.text });
  return true;
};

/** Replaces the state with an authoritative, ordered set of blocks. */
export const setTextBlocks = (state: TextBlockState, blocks: string[]) => {
  state.clear();

  blocks.forEach((text, index) => {
    state.set(index, { seq: Number.MAX_SAFE_INTEGER, text });
  });
};

/**
 * The blocks in order. The last entry is the agent's final answer; everything
 * before it is intermediate narration.
 */
export const readTextBlocks = (state: TextBlockState) =>
  [...state.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, block]) => block.text.trim())
    .filter(Boolean);
