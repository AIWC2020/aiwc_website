/**
 * The "Versions" button on the CMS screen.
 *
 * Sveltia's own History panel only lists commits; it cannot open or restore
 * one, and a deleted entry disappears from the CMS altogether. This button
 * opens admin/page-text.html in a panel over the CMS instead. On a page's
 * edit screen it opens straight onto that page's versions.
 *
 * After a save or restore in the panel, the CMS editor still holds the old
 * text — and saving it would silently undo the restore. So closing the panel
 * offers to reload the CMS, which fetches the restored file.
 */

const button = document.createElement('button');
button.type = 'button';
button.className = 'versions-button';
document.body.append(button);

/** The page open in the CMS editor, from Sveltia's route (#/collections/pages/entries/<slug>). */
const currentPage = () => location.hash.match(/^#\/collections\/pages\/entries\/([a-z0-9-]+)/)?.[1] ?? null;

const label = () => {
  const slug = currentPage();
  button.textContent = slug ? 'Versions of this page ↺' : 'Page text & versions ⇄';
  button.title = slug
    ? `See and restore earlier versions of “${slug}”`
    : 'Edit pages as text, bring back deleted pages, or restore the whole site';
};
label();
window.addEventListener('hashchange', label);

let savedInPanel = false;
window.addEventListener('message', (e) => {
  if (e.origin === location.origin && e.data?.type === 'aiwc-page-text-saved') savedInPanel = true;
});

const close = (overlay) => {
  overlay.remove();
  document.removeEventListener('keydown', onKey);
  if (savedInPanel && confirm('Reload the content admin now so it shows what you restored or saved?\n\nThis is important: saving the old copy still open in the editor would undo it. Unsaved edits in the editor will be lost.')) {
    location.reload();
  }
  savedInPanel = false;
};

let onKey = () => {};

button.addEventListener('click', () => {
  const slug = currentPage();
  const overlay = document.createElement('div');
  overlay.className = 'versions-overlay';
  const panel = document.createElement('div');
  panel.className = 'versions-panel';
  const shut = document.createElement('button');
  shut.type = 'button';
  shut.className = 'versions-close';
  shut.textContent = 'Close ✕';
  const frame = document.createElement('iframe');
  frame.title = 'Page text & versions';
  frame.src = `page-text.html?embed=1${slug ? `&page=${encodeURIComponent(slug)}` : ''}`;
  panel.append(shut, frame);
  overlay.append(panel);
  document.body.append(overlay);

  shut.addEventListener('click', () => close(overlay));
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(overlay); });
  onKey = (e) => { if (e.key === 'Escape') close(overlay); };
  document.addEventListener('keydown', onKey);
});
