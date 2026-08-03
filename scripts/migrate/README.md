# Migration from aiwc.org.au

One-time scripts that produced `content/`. They are kept for provenance —
if a page's copy looks wrong, these show exactly where it came from. They are
**not** part of the build and are not run by CI.

Run in order, from the repository root:

| Script | What it does |
| --- | --- |
| `pull.mjs` | Downloads every page, post, category and media record from the WordPress REST API at aiwc.org.au into `aiwc-raw/`. Retries, because the host drops long connections. |
| `extract.mjs` | Renders the Elementor HTML to readable text in `aiwc-text/`, for reading and diffing. |
| `normalise.mjs` | Parses the raw dump into the canonical dataset: `people.json`, `partners.json`, `articles.json`. |
| `assets.mjs` | Downloads every portrait, logo and photograph into `aiwc-assets/`. |
| `gen-collections.mjs` | Writes `content/people/*.json` and `content/partners/*.json`, and copies assets into `assets/`. |
| `gen-pages.mjs` | Writes `content/pages/*.json` — the narrative layer. Long lists (publications, programme write-ups) are pulled from the dataset rather than retyped. |

After the first run, `content/` is the source of truth and is edited through
the CMS at `/admin/`. Re-running these would overwrite editorial changes.
