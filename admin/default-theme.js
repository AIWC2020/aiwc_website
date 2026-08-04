/* Make the CMS open in its light theme by default.
 *
 * Sveltia CMS has a Theme setting — Auto / Light / Dark — under Settings, but
 * no way to configure its default: admin/config.yml has no theme option, and
 * the CMS's own preference loader gives defaults to underlineLinks, beta,
 * devModeEnabled and friends while deliberately leaving `theme` undefined.
 *
 * Undefined means auto, and auto means prefers-color-scheme. So on a machine
 * set to dark mode the CMS always opened dark, with no way to change that for
 * everyone rather than one browser at a time.
 *
 * Preferences are plain JSON in localStorage under 'sveltia-cms.prefs', read
 * once when the app boots. Seeding a value there before the bundle loads is
 * therefore the whole fix — the CMS then treats light as the editor's own
 * choice and skips its auto-theming path entirely.
 *
 * Only ever written when `theme` is absent. That distinction matters: once an
 * editor picks anything in Settings — including Auto — the key exists, this
 * script leaves it alone, and their choice survives every future page load.
 * Writing unconditionally would defeat the setting it is meant to default.
 *
 * Loaded from <head>, so it runs before the CMS bundle at the end of <body>.
 * A separate file rather than inline, so it needs no 'unsafe-inline' script
 * allowance beyond what the admin CSP already grants.
 */
(() => {
  const KEY = 'sveltia-cms.prefs';

  try {
    const stored = localStorage.getItem(KEY);
    const prefs = stored ? JSON.parse(stored) : {};

    // A corrupt or non-object value is left untouched rather than clobbered —
    // the CMS handles its own parse failures, and guessing here could discard
    // an editor's API keys, which live in this same blob.
    if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return;

    if (prefs.theme === undefined) {
      prefs.theme = 'light';
      localStorage.setItem(KEY, JSON.stringify(prefs));
    }
  } catch {
    // Private-browsing modes can throw on localStorage access. The CMS still
    // works; it just falls back to following the operating system.
  }
})();
