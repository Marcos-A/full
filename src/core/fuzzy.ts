/**
 * Subsequence match; returns a score (higher is better) or null when it doesn't match. Shorter
 * targets win ties, unless `ignoreLength` is set for targets that should stay in their own order.
 */
export function fuzzyScore(query: string, target: string, ignoreLength = false): number | null {
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  const t = target.toLowerCase();
  let score = 0;
  let from = 0;
  let previous = -2;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = t.indexOf(ch, from);
    if (at < 0) return null;
    score += at === previous + 1 ? 5 : 1;
    if (at === 0 || t[at - 1] === ' ') score += 4;
    previous = at;
    from = at + 1;
  }
  return ignoreLength ? score : score - t.length * 0.01;
}
