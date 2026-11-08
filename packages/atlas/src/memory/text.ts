const STOPWORDS = new Set(
  (
    'a an and are as at be been but by can could did do does for from had has have how if in into is it its ' +
    'may might not of on or our shall should so than that the their then there these they this those to ' +
    'was we were what when where which while who why will with would you your must never always use used using'
  ).split(' '),
);

/** Lowercase alphanumeric tokens, light plural stemming, stopwords removed. Deterministic. */
export function tokenize(text: string, minLength = 2): string[] {
  const tokens: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < minLength || STOPWORDS.has(raw)) continue;
    tokens.push(
      raw.length > 4 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw,
    );
  }
  return tokens;
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

/** A short excerpt around the first occurrence of any query token. */
export function snippet(text: string, queryTokens: readonly string[], max = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const token of queryTokens) {
    const found = lower.indexOf(token);
    if (found !== -1 && (at === -1 || found < at)) at = found;
  }
  if (at === -1 || flat.length <= max) return truncate(flat, max);
  const start = Math.max(0, at - Math.floor(max / 3));
  const piece = flat.slice(start, start + max).trim();
  return `${start > 0 ? '…' : ''}${piece}${start + max < flat.length ? '…' : ''}`;
}
