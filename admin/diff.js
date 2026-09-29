/**
 * Line diff for the version screen (Myers' O(ND) algorithm).
 *
 * A plain longest-common-subsequence table would need rows × columns memory,
 * which is ~40 MB for the people page (3,000+ lines). Myers' cost grows with
 * the number of changed lines instead, and a restore usually changes few.
 *
 * Pure and DOM-free so scripts/test-admin-diff.mjs can run it under Node.
 */

/** Returns [{ op: 'same' | 'del' | 'add', text }] turning `a` into `b`. */
export const diffLines = (aText, bText) => {
  const a = aText.split('\n');
  const b = bText.split('\n');
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
        ? v[offset + k + 1]
        : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[offset + k] = x;
      if (x >= n && y >= m) { found = true; break; }
    }
  }

  // Walk the trace backwards to recover the edit script.
  const out = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = vd[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      out.push({ op: 'same', text: a[--x] });
      y--;
    }
    if (d > 0) {
      if (x === prevX) out.push({ op: 'add', text: b[--y] });
      else out.push({ op: 'del', text: a[--x] });
    }
  }
  return out.reverse();
};

/**
 * Groups a diff into hunks with `context` unchanged lines either side, and
 * counts the changes. Returns { added, removed, hunks: [[{op, text}]] }.
 */
export const summarise = (ops, context = 2) => {
  let added = 0;
  let removed = 0;
  const keep = new Array(ops.length).fill(false);
  ops.forEach((o, i) => {
    if (o.op === 'same') return;
    if (o.op === 'add') added++; else removed++;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j++) keep[j] = true;
  });
  const hunks = [];
  let current = null;
  ops.forEach((o, i) => {
    if (!keep[i]) { current = null; return; }
    if (!current) hunks.push((current = []));
    current.push(o);
  });
  return { added, removed, hunks };
};
