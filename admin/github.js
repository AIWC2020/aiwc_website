/**
 * The GitHub side of page versions, shared by the Page text & versions screen
 * (page-text.js) and the version picker in the CMS preview (preview.js).
 *
 * It signs in with the token the CMS already holds — Sveltia keeps its session
 * in local storage — so neither needs a second sign-in, and every write is an
 * ordinary commit that deploys like a CMS save.
 */

export class NotSignedIn extends Error {}

export const pagePath = (slug) => `content/pages/${slug}.json`;
export const slugOf = (path) => path.replace(/^content\/pages\//, '').replace(/\.json$/, '');

export const fromBase64 = (b64) => {
  const bin = atob(b64.replace(/\s/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

export const toBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** How a save is labelled in version lists. */
export const when = (iso) => new Date(iso).toLocaleString(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
});
export const short = (sha) => sha.slice(0, 7);
export const who = (c) => c.commit?.author?.name || c.author?.login || 'someone';
// CMS commit messages read: Update page “news”. Kept as they are.
export const what = (c) => c.commit.message.split('\n')[0];

const readToken = () => {
  try {
    const user = JSON.parse(localStorage.getItem('sveltia-cms.user') || 'null');
    return typeof user?.token === 'string' && user.token ? user.token : null;
  } catch {
    return null;
  }
};

/**
 * Reads repo and branch from the published content/site.json (the same
 * values the build writes into the CMS config) and returns a client.
 */
export const connect = async (base) => {
  const site = await fetch(`${base}/content/site.json`).then((r) => r.json());
  const repo = site.cms?.repo;
  const branch = site.cms?.branch || 'main';

  const gh = async (path, options = {}) => {
    // Read on every call: the CMS may sign in or out while this page is open.
    const token = readToken();
    if (!token) throw new NotSignedIn();
    const res = await fetch(`https://api.github.com${path}`, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
    if (res.status === 401) throw new NotSignedIn();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(body.message || `GitHub replied ${res.status}`), { status: res.status });
    }
    return res.status === 204 ? null : res.json();
  };

  /** A file's text at a commit (or the branch). Files over 1 MB come back
   *  without content from this endpoint; the blob endpoint has no limit. */
  const readFile = async (path, ref = branch) => {
    const file = await gh(`/repos/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    const b64 = file.content || (await gh(`/repos/${repo}/git/blobs/${file.sha}`)).content;
    return { text: fromBase64(b64), sha: file.sha };
  };

  const readBlob = async (sha) => fromBase64((await gh(`/repos/${repo}/git/blobs/${sha}`)).content);

  /** Saves that touched `path`, newest first. */
  const commitsFor = (path, page = 1, perPage = 10) =>
    gh(`/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=${perPage}&page=${page}`);

  /** The pages on the branch now, as Map(slug -> { sha }). */
  const listPages = async () => {
    const items = await gh(`/repos/${repo}/contents/content/pages?ref=${encodeURIComponent(branch)}`);
    return new Map(items.filter((f) => f.type === 'file' && f.name.endsWith('.json')).map((f) => [slugOf(f.path), { sha: f.sha }]));
  };

  /** Writes one page file as a commit. `sha` is the file being replaced, if any. */
  const writePage = (slug, text, message, sha) => gh(`/repos/${repo}/contents/${pagePath(slug)}`, {
    method: 'PUT',
    body: JSON.stringify({ message, content: toBase64(text), branch, ...(sha ? { sha } : {}) }),
  });

  /** Every file in the repository at a commit, as Map(path -> { sha, mode }). */
  const filesAt = async (commitSha) => {
    const commit = await gh(`/repos/${repo}/git/commits/${commitSha}`);
    const tree = await gh(`/repos/${repo}/git/trees/${commit.tree.sha}?recursive=1`);
    if (tree.truncated) throw new Error('The repository is too large to compare in one go.');
    return {
      treeSha: commit.tree.sha,
      files: new Map(tree.tree.filter((t) => t.type === 'blob').map((t) => [t.path, { sha: t.sha, mode: t.mode }])),
    };
  };

  /** Follows the deploy of a commit. Resolves 'success', 'failure' (with
   *  the run's URL) or null if it cannot tell (no access, or still running). */
  const deployResult = async (commitSha) => {
    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 10000));
      let run;
      try {
        run = (await gh(`/repos/${repo}/actions/runs?head_sha=${commitSha}&per_page=1`)).workflow_runs?.[0];
      } catch {
        return null;
      }
      if (run?.status === 'completed') return { ok: run.conclusion === 'success', url: run.html_url };
    }
    return null;
  };

  return { repo, branch, gh, readFile, readBlob, commitsFor, listPages, writePage, filesAt, deployResult };
};
