# Yarmouth Chamber Music Festival website

Static site, no dependencies. See README.md for the data format.

- Build: `node build.mjs` (Node 22+). Preview: `node build.mjs --serve` → http://localhost:8080.
- Content lives in `data/`; the build fails loudly on bad references, so run it after every data edit.
- Preview another day with `BUILD_DATE=YYYY-MM-DD`; the home page changes before, during and after a festival.
- Hosting is GitHub Pages from `main`, at https://yarmouthchambermusicfestival.ca. There are no preview deploys.

## Showing changes

Every change that affects how the site looks ships with screenshots in the
reply (and in the PR body when there is one):

- desktop (1366px) and phone (390px) widths of each page touched;
- when the change depends on dates, both an upcoming build and an
  after-festival build (`BUILD_DATE`);
- check for horizontal overflow on phone widths and for images that fail to load.

Use the pre-installed Playwright/Chromium against `--serve`. Scroll the page
before capturing so lazy-loaded images appear.

## Images

Resize before committing: headshots ≤ 1000×1400, event and gallery photos about
2000px on the long side, JPEG quality ~80, metadata stripped. Credit
photographers (`photoCredit` / `credit`) when the source names them. Never
publish private home addresses for kitchen-party hosts.
