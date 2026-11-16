export type ReviewTextChange = { kind: "same" | "added" | "removed"; text: string };

/** Exact, display-only comparison. Never normalizes source text or interprets facts. */
export function compareReviewText(original: string, proposed: string): { changes: ReviewTextChange[]; coarse: boolean } {
  if (original === proposed) return { changes: [{ kind: "same", text: original }], coarse: false };
  const tokenize = (text: string) => text.match(/\s+|[\p{L}\p{M}\p{N}]+|[^\s\p{L}\p{M}\p{N}]/gu) ?? [];
  const before = tokenize(original), after = tokenize(proposed);
  const width = after.length + 1;
  // Bound memory and CPU even for unexpectedly large legacy descriptions.
  if ((before.length + 1) * width > 1_000_000) {
    return { changes: [{ kind: "removed", text: original }, { kind: "added", text: proposed }], coarse: true };
  }
  const lengths = new Uint32Array((before.length + 1) * width);
  for (let i = before.length - 1; i >= 0; i--) {
    for (let j = after.length - 1; j >= 0; j--) {
      lengths[i * width + j] = before[i] === after[j]
        ? 1 + lengths[(i + 1) * width + j + 1]!
        : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
    }
  }
  const changes: ReviewTextChange[] = [];
  const append = (kind: ReviewTextChange["kind"], text: string) => {
    const last = changes.at(-1);
    if (last?.kind === kind) last.text += text;
    else changes.push({ kind, text });
  };
  let i = 0, j = 0;
  while (i < before.length || j < after.length) {
    if (i < before.length && j < after.length && before[i] === after[j]) {
      append("same", before[i++]!); j++;
    } else if (i < before.length && (j === after.length || lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!)) {
      append("removed", before[i++]!);
    } else {
      append("added", after[j++]!);
    }
  }
  return { changes, coarse: false };
}
