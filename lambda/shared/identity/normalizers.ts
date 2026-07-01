// Identity normalizers — transform raw extracted values into canonical forms
// so that "PO-001", "PO001", "PO 001" all resolve to the same identity.
// Each normalizer is pure (no I/O) and independently testable.

export type NormalizerName =
  | 'strip_prefix' | 'strip_whitespace' | 'iso6346'
  | 'company_name' | 'currency_convert' | 'strip_dots'
  | 'date_normalize' | 'none';

export function normalize(value: string, method: NormalizerName): string {
  switch (method) {
    case 'strip_prefix':
      // "PO-1409443" → "1409443", "PO1409443" → "1409443", "BL-DFS-001" → "DFS-001"
      return value.replace(/^[A-Z]{1,4}[-_\s]*/i, '').trim().toUpperCase();

    case 'strip_whitespace':
      return value.replace(/[\s\-_]/g, '').toUpperCase();

    case 'iso6346':
      // ISO 6346 container numbers: ABCU1234567 → ABCU1234567
      // Strip spaces and dashes, uppercase
      return value.replace(/[\s\-]/g, '').toUpperCase().slice(0, 11);

    case 'company_name':
      // "PT. UNGARAN SARI GARMENTS, Tbk." → "UNGARAN SARI GARMENTS"
      return value
        .toUpperCase()
        .replace(/\bPT\.?\s*/g, '')
        .replace(/\bCV\.?\s*/g, '')
        .replace(/\bPTE\.?\s*LTD\.?\s*/g, '')
        .replace(/\bLTD\.?\s*/g, '')
        .replace(/\bINC\.?\s*/g, '')
        .replace(/\bCO\.?\s*/g, '')
        .replace(/\bTBK\.?\s*/g, '')
        .replace(/,\s*$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    case 'strip_dots':
      // "8452.21.00" → "84522100"
      return value.replace(/\./g, '').trim();

    case 'date_normalize':
      // Various date formats → ISO YYYY-MM-DD
      try {
        const d = new Date(value);
        if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      } catch {}
      return value.trim();

    case 'currency_convert':
      // Extract numeric value for range comparison
      // "USD 162,500.00" → "162500"
      return value.replace(/[^0-9.]/g, '').replace(/,/g, '').trim();

    case 'none':
    default:
      return value.trim().toUpperCase();
  }
}

// Fuzzy match using token sort ratio (simplified Levenshtein-based)
export function fuzzyMatch(a: string, b: string): number {
  if (a === b) return 1.0;
  if (!a || !b) return 0.0;

  // Token sort: split into words, sort, rejoin — handles word order differences
  const sortTokens = (s: string) =>
    s.split(/\s+/).sort().join(' ');

  const sa = sortTokens(a);
  const sb = sortTokens(b);

  if (sa === sb) return 0.95;

  // Levenshtein distance
  const m = sa.length, n = sb.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = sa[i-1] === sb[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  const dist = dp[m][n];
  const maxLen = Math.max(m, n);
  return maxLen === 0 ? 1.0 : 1 - dist / maxLen;
}

// Range overlap for value ranges (invoice amounts)
export function rangeOverlap(
  valueA: string, valueB: string, tolerancePct = 0.15
): number {
  const a = parseFloat(valueA);
  const b = parseFloat(valueB);
  if (isNaN(a) || isNaN(b) || a === 0 || b === 0) return 0;
  const ratio = Math.abs(a - b) / Math.max(a, b);
  if (ratio <= tolerancePct * 0.3) return 1.0;
  if (ratio <= tolerancePct) return 0.7;
  return 0;
}

// Date range for ETA (±N days)
export function dateRangeMatch(
  valueA: string, valueB: string, toleranceDays = 7
): number {
  try {
    const a = new Date(valueA).getTime();
    const b = new Date(valueB).getTime();
    if (isNaN(a) || isNaN(b)) return 0;
    const diffDays = Math.abs(a - b) / (1000 * 60 * 60 * 24);
    if (diffDays === 0) return 1.0;
    if (diffDays <= toleranceDays / 2) return 0.9;
    if (diffDays <= toleranceDays) return 0.6;
    return 0;
  } catch { return 0; }
}
