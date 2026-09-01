# AIWC — Australia India Water Centre

| | |
|---|---|
| **Website** | <https://aiwc2020.github.io/aiwc_website/> |
| **Edit the site** | <https://aiwc2020.github.io/aiwc_website/admin/> — sign in with a GitHub access token ([how](#signing-in)) |
| **Published by** | GitHub Actions, on every push to `main` ([what to do when a change does not appear](#my-change-is-not-on-the-site)) |

The Centre's website: 15 pages, 108 researcher profiles and 33 partner
institutions, built as static HTML and published to GitHub Pages.

Content from [aiwc.org.au](https://aiwc.org.au), built on the MARVI site's
structure: the same chrome, the same 24 block types, the same per-block layout
controls and the same CMS. The palette is AIWC's own — cool deep water,
indigo and ochre for the two countries, rather than MARVI's green and copper.

Two things exist here that the MARVI site has no equivalent for, because AIWC
has content MARVI does not: the searchable **researcher directory** and the
**partner directory**, each of which also gives every researcher and every
institution a page of its own.

## Editing

The CMS lives at <https://aiwc2020.github.io/aiwc_website/admin/> — **Sveltia
CMS**, talking straight to GitHub with no broker in between. A page is a header
plus content **blocks** you add and drag to reorder; each block type shows only
its own fields. Saving commits to `main`, and the site rebuilds itself.

What the CMS lets you save and what the site will publish are checked against
each other on every build, so the editor cannot offer a block the site cannot
draw, and cannot call a field optional that the site refuses to publish without.
If those two ever drift apart the build says so by name.

The CMS has **one collection: Pages**. Everything shown on a page is edited
inside that page — including the 108 researchers (in the Researchers block on
*Our people*) and the 33 partner institutions (in *Our partners*). Each of them
still gets its own address, `/people/<name>/` and `/partners/<name>/`,
generated from those blocks.

The trade-off, stated plainly: `content/pages/people.json` is 434 KB, and the
CMS rewrites the whole file on every save. That was a deliberate choice — one
place per page beats a smaller diff — but it has a sharp edge worth
understanding.

**Two people editing *Our people* at the same time can lose work.** Sveltia
commits with GitHub's `createCommitOnBranch` and an `expectedHeadOid`, but it
reads that hash immediately before writing rather than when the editor opened
the page. So the guard only covers the instant of the write. If you open the
page, someone else saves, and you save ten minutes later, your copy of the
whole file wins and their changes are gone — with no warning to either of you.

Until researchers live in one file each, the protection is procedural:

- One person edits *Our people* at a time. It is a big page; agree who has it.
- **Reload `/admin/` immediately before you start editing**, not before you
  save. A stale tab is the whole danger.
- After saving, check the change is live before closing the tab.

Nothing has been lost so far — `git log content/pages/people.json` is the
record, and every earlier save is still in it.

### Signing in

`admin/config.yml` is a **template**. The build fills in `repo`, `branch`,
`base_url` and `public_folder` from `content/site.json`, so those live in one
place and cannot drift from the site's base path. Edit `content/site.json`,
never the deployed `/admin/config.yml`.

```jsonc
"cms": {
  "repo": "AIWC2020/aiwc_website",
  "branch": "main",
  "authUrl": null          // null = no OAuth broker; token sign-in only
}
```

This site runs **Sveltia CMS** with **no OAuth broker**, so the CMS depends on
nothing but GitHub itself — no Cloudflare Worker, no third-party service
holding a client secret.

The trade-off is how editors sign in. GitHub's OAuth code flow requires a
*server* to exchange the auth code for a token using a client secret, and
GitHub Pages only serves static files. So a one-click "Login with GitHub"
button is impossible without hosting something somewhere. The serverless
alternative is a personal access token.

**To sign in at `/admin/`:**

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new)
   - Repository access: **Only select repositories** → `AIWC2020/aiwc_website`
   - Permissions → Repository → **Contents: Read and write**
   - Set an expiry you are comfortable with; the token must be recreated after it lapses
2. Open `/admin/`, click **Sign In Using Access Token**, paste it

The token is stored in that browser's local storage, so it is entered once per
browser. Give each editor their own token — never share one.

**The admin page is locked down with a Content-Security-Policy.** It holds a
GitHub token in local storage, and both security advisories published against
Sveltia CMS to date have been stored XSS — so the policy allows connections to
nothing but `api.github.com`. Even if injected markup ran, it could not send
the token anywhere. Check it still passes after upgrading the vendored bundle;
a future version wanting a new host would be blocked.

**What the admin page depends on.** The CMS bundle is vendored into
`assets/cms/`, so nothing has to be fetched to start it. Sveltia would otherwise make a
few optional requests at runtime — a version check on `unpkg.com`, two web
fonts from `cdn.jsdelivr.net`, and a status banner from `githubstatus.com` —
but the CSP blocks all three, which was verified: they record as attempts
transferring **zero bytes**. The cost is fallback fonts and no status banner. They are anonymous CDN reads, not accounts
anyone has to hold or maintain — which is the point. The thing this setup
removes is the *managed* dependency: an OAuth broker on someone's Cloudflare
account, holding a client secret, that breaks sign-in if it lapses.

> **Note on the "Sign In with GitHub" button.** Sveltia shows it even with no
> `base_url`, and it then falls back to *Netlify's* OAuth broker — a third
> party. There is currently no documented way to hide the button, so tell
> editors to use **Sign In Using Access Token**.

**If you would rather have the one-click button**, set `cms.authUrl` to an
OAuth broker URL and the token step disappears. That means hosting
[sveltia/sveltia-cms-auth](https://github.com/sveltia/sveltia-cms-auth) —
Cloudflare Workers' free tier is ample — plus a GitHub OAuth App whose
callback is `<WORKER_URL>/callback`, with `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET` and `ALLOWED_DOMAINS` set on the worker. The broker
allowlists by **domain, not repository**, so `ALLOWED_DOMAINS` must contain
`aiwc2020.github.io`.

GitHub has announced client-side PKCE, which would give a one-click sign-in
with no server at all. It is not shipped yet; when it is, this setup gets
strictly better with no migration.

## Deployment

Push to `main` → `.github/workflows/deploy.yml` builds, verifies, runs the
directory test, and publishes `_site/` to GitHub Pages.

Pages must be set to **Source: GitHub Actions** (not "deploy from a branch").

### My change is not on the site

**Saving in the CMS is not publishing.** The CMS reports success the moment
the commit lands, which is true — but the commit still has to pass `npm run
build`, `npm run verify` and the directory test before Pages is updated. If any
of them fails, the commit stays on `main` and the live site keeps serving the
last version that passed. Nothing is lost; nothing is published either.

Nobody is notified when that happens. So when a change does not appear:

```bash
gh run list --repo AIWC2020/aiwc_website --limit 5
```

A red run is the answer. Read why:

```bash
gh run view --repo AIWC2020/aiwc_website --log-failed
```

Then fix the content it names and push. The backlog releases itself — every
commit that queued up behind the failure goes live together.

**Do not fix a red build by relaxing the check.** Those checks are why a
half-finished profile cannot reach the public directory. The failing record is
the bug.

> This is not hypothetical. On 2026-08-18 an empty profile named `test` was
> created in the CMS. `verify` refuses to publish a researcher with no
> portrait, so every deploy failed from that moment. Five real content commits
> — an institution change, a new portrait and biography, a rewritten profile —
> sat unpublished for two weeks while the CMS reported every save as
> successful. Deleting the one empty profile released all of them at once.
> The CMS now refuses to save a researcher without a portrait, which is the
> same rule stated in the place where the mistake was made.

## Known gaps

- **Photography is thin.** The best source images are eight conference photos
  at 1280×720; the four programme images are 500×300. The home page hero is
  therefore typographic over an SVG rather than a stretched JPEG. Better
  photography would lift the whole site more than any code change.
- **Two researcher profiles have no biography** (`howard-fallowfield`,
  `dr-prabhat-kumar-singh`) — those fields are blank on aiwc.org.au. `npm run
  verify` prints them as a warning each run.
- **Symposium PDFs are linked, not mirrored** — they still resolve to
  aiwc.org.au and will break if that site goes away.

## Developing

How the build works, the project base path and the repository layout are in
[docs/developing.md](docs/developing.md).
