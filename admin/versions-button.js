/**
 * The "Edit as text" / "Restore & import" link on the CMS screen.
 *
 * Goes to admin/page-text.html as a full page. On a page's edit screen it
 * opens that page as text beside a live preview ("Edit as text"); the page's
 * versions are picked from the dropdown at the top of the preview
 * (preview.js). Elsewhere it is where a deleted page or the whole site is
 * restored, or a page file uploaded ("Restore & import") — things the CMS
 * cannot do: its History panel only lists saves, and a deleted entry
 * disappears from it altogether.
 *
 * Same tab on purpose: coming back loads the CMS afresh, so its editor shows
 * what was saved or restored there, rather than a stale copy that would
 * undo it if saved.
 */

const link = document.createElement('a');
link.className = 'versions-button';
document.body.append(link);

/** The page open in the CMS editor, from Sveltia's route (#/collections/pages/entries/<slug>). */
const currentPage = () => location.hash.match(/^#\/collections\/pages\/entries\/([a-z0-9-]+)/)?.[1] ?? null;

const update = () => {
  const slug = currentPage();
  link.href = slug ? `page-text.html?page=${encodeURIComponent(slug)}` : 'page-text.html';
  link.textContent = slug ? 'Edit as text' : 'Restore & import';
  link.title = slug
    ? `Edit “${slug}” as text with a live preview, or download / upload it`
    : 'Bring back a deleted page, restore the whole site, or upload a page file';
};
update();
window.addEventListener('hashchange', update);
