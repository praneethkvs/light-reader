# Light Reader

Light Reader is a dependency-free Chrome extension that makes dark reading pages easier on the eyes. It detects article-like dark pages and applies a soft light reading surface with dark text, while keeping dashboards, app chrome, and light pages mostly untouched.

The project is intentionally plain MV3 HTML, CSS, and JavaScript. There is no build step, package manager, telemetry, backend, or external runtime dependency.

## Features

- Auto-detects dark reading surfaces and applies a comfortable light background.
- Supports per-site modes: **Auto**, **Always**, and **Never**.
- Provides **Lighten Now** for temporary per-tab activation without saving a site rule.
- Offers **Looks dark. Lighten this page?** when Auto sees a dark page but is not confident enough to run automatically.
- Includes background presets: Paper, Warm, Soft, and White.
- Supports a custom hex background color.
- Keeps an editable **Always Lighten Sites** list.
- Rechecks dynamic pages using delayed detection, mutation observation, and SPA route changes.
- Repairs smaller dark text islands, such as badges, callouts, rows, and cards inside the active reading surface.
- Supports a keyboard shortcut for **Lighten Now**.
- Includes compact in-popup help, support diagnostics, reset controls, and a QA guide.

## Install Locally

1. Clone or download this repository.
2. Open Chrome and go to `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked**.
5. Select the `light-reader` folder.
6. Pin Light Reader from the Chrome extensions menu.

After code changes, return to `chrome://extensions` and click the reload button on the Light Reader card. Reload any test page that already had the content script injected.

## Popup Controls

- **Header toggle** turns Light Reader on or off globally.
- **Auto** detects dark reading pages automatically.
- **Always** runs Light Reader on the current site.
- **Never** keeps Light Reader off on the current site.
- **Reading Background** changes the light reading surface color.
- **Set default** saves the current preset or custom shade as the default reset target.
- **Reset shade** restores the saved default shade.
- **Lighten Now** temporarily lightens the current tab and does not save a rule.
- **Looks dark. Lighten this page?** appears when Auto is uncertain and offers **Lighten Now** or **Always**.
- **Always Lighten Sites** shows saved domains and lets you remove them.
- **More Options** can refresh page detection, reset settings, open the QA guide, and show version details.
- **How it works** explains the detection model.
- **Support** shows why Light Reader did or did not activate, with copyable diagnostics for bug reports.
- **Dark island repair** runs inside the active reading surface and keeps most form controls conservative.

## Keyboard Shortcut

Light Reader includes a **Toggle Lighten Now** command:

- default: `Alt+Shift+L`
- macOS: `Control+Shift+L`

Chrome users can change the shortcut from `chrome://extensions/shortcuts`.

## Manual QA

The `fixtures/` folder contains local pages for manual testing.

Recommended flow:

1. Reload Light Reader from `chrome://extensions`.
2. Open Light Reader details.
3. Enable **Allow access to file URLs** if you want to test fixtures directly from disk.
4. Open `fixtures/index.html` from this repo, or open each fixture file directly.

Important: if fixtures are opened from `chrome-extension://...`, Chrome treats them as extension-owned pages and normal content scripts will not run. The popup may show **Not available on this page**. Use `file://` pages with file access enabled, or serve the folder locally with any static server.

Fixture expectations:

- `dark-article.html`: should auto-lighten.
- `dark-shell-article.html`: should auto-lighten the article and surrounding page shell.
- `nested-dark-backdrop.html`: should remove dark inner panels behind lightened text.
- `dark-news-list.html`: should auto-lighten prose inside dark image/texture-backed listing cards.
- `substack-newsletter.html`: should auto-lighten a dark newsletter article.
- `gaming-news-texture.html`: should handle texture-backed game news content.
- `docs-code-reference.html`: should improve docs while keeping code readable.
- `blog-overlay.html`: should neutralize pseudo-element overlays.
- `app-dashboard-controls.html`: should stay inactive in Auto.
- `forum-comments.html`: should show the uncertain-page fallback.
- `uncertain-dark-page.html`: should offer **Lighten Now** and **Always**.
- `nav-shell-mismatch.html`: should keep top and secondary navigation readable after activation.
- `dark-header-changelog.html`: should preserve dark global headers and fix changelog text.
- `dark-island-badges.html`: should repair dark badges, custom tags, and callouts.
- `dark-island-table.html`: should repair dark table rows and cells.
- `dark-island-svg-labels.html`: should repair icon-adjacent dark labels.
- `dark-island-dashboard-negative.html`: should stay inactive on app-like pages.
- `light-article.html`: should stay unchanged in Auto; **Lighten Now** should still work.
- `spa-article-swap.html`: should remain lightened after clicking **Swap Route Content**.
- `dark-dashboard.html`: should not auto-lighten in Auto; **Lighten Now** should force it.
- `code-heavy-docs.html`: should keep code blocks readable.

## Developer Checks

Run syntax checks before manual QA:

```sh
node --check light-reader-shared.js
node --check content.js
node --check popup.js
node --check background.js
node --check fixtures/spa-article-swap.js
node --check scripts/check-fixtures.js
node scripts/check-fixtures.js
```

There is no bundler or external test runner in this version. The fixture checker is a dependency-free Node script for static QA coverage.

## Repository Structure

```text
.
├── manifest.json
├── light-reader-shared.js
├── background.js
├── content.js
├── popup.html
├── popup.css
├── popup.js
├── PRIVACY.md
├── assets/
├── fixtures/
├── scripts/
└── mockups/
```

## Privacy

See [PRIVACY.md](PRIVACY.md) for the full policy. In short, Light Reader stores settings in Chrome sync storage:

- global enabled state
- selected background/text/link colors
- default background color
- per-site mode rules

The extension does not send data to a server and does not include analytics.

## Known Limitations

- Chrome blocks content scripts on Chrome Web Store pages, `chrome://` pages, extension pages, and some browser-owned screens.
- Auto-detection is intentionally conservative on dashboards and control-heavy apps.
- Some sites with aggressive CSS, iframes, closed shadow DOM, or canvas-rendered text may not fully inherit Light Reader styles.
- Dark island repair does not traverse Shadow DOM or iframes in this version.
- Cross-browser support, packaging, store listing assets, onboarding, import/export, and analytics are outside the current V1 scope.
