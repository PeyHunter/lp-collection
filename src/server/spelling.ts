/** How many single-letter changes (insert, delete, replace, or swap two neighbours) turn one text into the other. */
export function editDistance(a: string, b: string) {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

function plain(name: string) {
  return name
    .toLowerCase()
    .replace(/ \(\d+\)$/, "")
    .replace(/^the /, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * The names closest in spelling to what was typed, closest first, ignoring case, a leading "The"
 * and Discogs' "(2)" numbering. Names too far off to be a misspelling are left out.
 */
export function closestNames(typed: string, names: string[], limit: number): string[] {
  const wanted = plain(typed);
  if (!wanted) return [];
  const allowed = Math.max(2, Math.floor(wanted.length * 0.4));
  const seen = new Set<string>();
  const ranked: { name: string; distance: number }[] = [];
  for (const name of names) {
    const key = plain(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const distance = editDistance(wanted, key);
    if (distance <= allowed) ranked.push({ name: name.replace(/ \(\d+\)$/, ""), distance });
  }
  return ranked
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
    .map(({ name }) => name);
}
