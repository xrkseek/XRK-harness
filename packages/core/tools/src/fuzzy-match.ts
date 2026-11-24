/**
 * Shared fuzzy ranking for tool_search + skill_search (one scorer).
 * Prefer substring + identifier splits over heavy edit-distance.
 */

/** Browse queries shared by skill_search / tool_search. */
export function isBrowseCatalogQuery(query: string): boolean {
  if (query.length === 0) return true;
  const q = query.toLowerCase();
  return q === "*" || q === "list" || q === "ls" || q === "catalog";
}

/** Split query / identifiers into searchable tokens (snake, kebab, camel). */
export function splitFuzzyTokens(text: string): string[] {
  const lower = text.toLowerCase().trim();
  if (!lower) return [];
  const raw = lower.split(/[\s,/|]+/).filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };
  for (const piece of raw) {
    push(piece);
    for (const part of piece.split(/[_\-.]+/).filter(Boolean)) {
      push(part);
      // camelCase leftovers after lowercasing are rare; keep digit boundaries.
      for (const camel of part.split(/(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/)) {
        push(camel);
      }
    }
  }
  return out;
}

/** Contiguous character subsequence coverage (0..1). */
export function subsequenceCoverage(needle: string, hay: string): number {
  if (!needle) return 0;
  if (hay.includes(needle)) return 1;
  let i = 0;
  for (const ch of hay) {
    if (ch === needle[i]) {
      i += 1;
      if (i >= needle.length) return 0.75;
    }
  }
  return i / needle.length;
}

/**
 * Higher is better. Empty query → 0.
 * Pass `name` when the primary identifier is known (tool / skill name).
 */
export function scoreFuzzyQuery(
  query: string,
  haystack: string,
  options?: { readonly name?: string },
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const hay = haystack.toLowerCase();
  const name = (options?.name ?? "").toLowerCase();
  const tokens = splitFuzzyTokens(q);
  if (tokens.length === 0) return 0;

  let score = 0;
  for (const token of tokens) {
    if (name) {
      if (name === token) score += 40;
      else if (
        name.startsWith(token) ||
        name.includes(`_${token}`) ||
        name.includes(`-${token}`) ||
        name.includes(`.${token}`)
      ) {
        score += 28;
      } else if (name.includes(token)) {
        score += 18;
      } else {
        const sub = subsequenceCoverage(token, name);
        if (token.length >= 3 && sub >= 0.7) score += Math.round(12 * sub);
        else if (token.length >= 4 && sub >= 0.5) score += Math.round(6 * sub);
      }
    }

    if (hay.includes(token)) {
      score += 10;
    } else if (!name.includes(token)) {
      const sub = subsequenceCoverage(token, hay);
      if (token.length >= 3 && sub >= 0.75) score += Math.round(6 * sub);
    }

    for (const word of hay.split(/[^a-z0-9\u4e00-\u9fff]+/)) {
      if (word.length >= 2 && word.startsWith(token) && token.length >= 2) {
        score += 6;
        break;
      }
    }
  }

  const compact = q.replace(/\s+/g, "_");
  const dashed = q.replace(/\s+/g, "-");
  if (hay.includes(q) || hay.includes(compact) || hay.includes(dashed)) score += 12;
  if (
    name &&
    (name.includes(compact) || name.includes(dashed) || name.includes(q))
  ) {
    score += 15;
  }

  return score;
}
