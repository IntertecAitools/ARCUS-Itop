/**
 * How alike two ticket titles are, for duplicate suggestions: the share of
 * meaningful words they have in common (Jaccard over word sets), 0..1.
 * Cheap, explainable, and good enough for "printer on floor 3 offline" vs
 * "Floor 3 printer is offline".
 */

const STOP_WORDS = new Set([
  "a", "an", "the", "is", "are", "was", "be", "to", "of", "in", "on", "at", "for", "and", "or",
  "not", "no", "my", "our", "it", "its", "with", "from", "by", "can", "cannot", "cant", "t",
  "i", "we", "please", "help", "issue", "problem", "does", "doesn", "do", "dont", "this", "that",
]);

/** Lower-cased words of 2+ letters or digits, stop words and trailing plural "s" dropped. */
export function titleWords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
  return new Set(words);
}

export function titleSimilarity(a: string, b: string): number {
  const left = titleWords(a);
  const right = titleWords(b);
  if (left.size === 0 || right.size === 0) return 0;
  let common = 0;
  for (const w of left) if (right.has(w)) common += 1;
  return common / (left.size + right.size - common);
}
