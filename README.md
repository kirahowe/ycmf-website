# Yarmouth Chamber Music Festival website

A static site with no dependencies and no JavaScript in the browser. The pages
are plain HTML built from the JSON files in `data/` by one script
(`build.mjs`) that uses only Node built-ins.

```sh
node build.mjs           # build into dist/
node build.mjs --serve   # build, then preview at http://localhost:8080
```

Requires Node 22 or newer.

## Where things live

```
data/site.json             festival-wide: name, contact, about, team, support, venues
data/artists.json          every artist who has ever played, keyed by id
data/festivals/2026.json   one file per festival year
static/                    copied into the site as is (styles.css, favicon, images/)
static/images/             artists/, events/, gallery/, venues/, site/
build.mjs                  the generator
```

## Years

Each file in `data/festivals/` is one festival year. The newest year is the
current festival: it is published at the site root (`/`, `/schedule/`,
`/artists/`, `/photos/`). Every year, including the newest, is also published
under its own year (`/2025/`, `/2025/schedule/`, …), and the year menu in the
header switches between them.

The site follows the calendar, in Atlantic time:

- Before and during the festival, the home page leads with tickets, and each
  event has a ticket button and an "add to calendar" link.
- Once a day has passed, its events show as past events, without ticket buttons.
- After the last event, the home page becomes a thank-you (the year's
  `"afterword"`) with a link to the photographs.

The deploy workflow rebuilds every morning so this happens on its own. To
preview another day, build with `BUILD_DATE=2026-09-01 node build.mjs --serve`.

To start a new season, copy last year's file to `data/festivals/2027.json`,
change `"year"`, and update the events, artists and photos. As soon as it
exists, it becomes the front page. With no events yet, the page says the
program will be announced soon.

## Photographs

Put images in `static/images/` and refer to them by path, for example
`"images/artists/clara-whitmore.jpg"`. The build stops if a file is missing.
Wherever a photo is cropped (headshots, event photos), an optional focus
setting such as `"photoFocus": "50% 30%"` moves the crop. The first number is
left to right, the second top to bottom.

Suggested sizes: headshots at least 800px wide (shown at 4:5, in black and
white until hovered); event and gallery photos about 1600px on the long
side, saved as JPEG at roughly 80% quality.

The current images are openly licensed stand-ins. See
`static/images/PLACEHOLDER-CREDITS.md`, and replace them all before launch.

## Editing content

**A festival year** (`data/festivals/2026.json`):

```json
{
  "year": 2026,
  "headline": "Ten days of chamber music on the southern shore",
  "summary": "One or two sentences under the headline.",
  "intro": ["Longer introduction, one string per paragraph."],
  "afterword": ["Shown on the home page once the festival is over."],
  "heroImages": [
    { "src": "images/site/hero.jpg", "caption": "Finale, 2025" },
    { "src": "images/site/two.jpg", "focus": "50% 30%" },
    { "src": "images/site/three.jpg" }
  ],
  "ticketsUrl": "https://…",
  "artists": ["clara-whitmore", "hana-sato"],
  "events": [ … ],
  "gallery": [{ "src": "images/gallery/2026-01.jpg", "caption": "Finale" }]
}
```

The first hero image is the large one. One to three images all work.

**Artists** are defined once in `data/artists.json` and listed by id in each
year's `"artists"`, so a returning artist's bio doesn't need to be copied:

```json
"clara-whitmore": {
  "name": "Clara Whitmore",
  "instrument": "violin",
  "photo": "images/artists/clara-whitmore.jpg",
  "photoFocus": "50% 30%",
  "website": "https://…",
  "bio": ["Paragraph one.", "Paragraph two."]
}
```

**Events**:

```json
{
  "id": "night-music",               // used in links: /schedule/#night-music
  "title": "Night Music in the Dark",
  "kind": "Concert",
  "date": "2026-10-08",
  "time": "19:30",                   // 24-hour, Atlantic time
  "duration": 120,                   // minutes, for calendar files (default 120)
  "venue": "mountain-cemetery-chapel",   // a key in site.json "venues"
  "image": "images/events/night-music.jpg",
  "imageFocus": "50% 40%",
  "description": ["Paragraph one."],
  "program": [
    { "composer": "Arvo Pärt", "work": "*Fratres*", "note": "optional" }
  ],
  "performers": ["clara-whitmore", { "name": "Guest Choir" }],
  "tickets": { "price": "$50", "url": "https://…", "label": "Tickets", "note": "students free", "soldOut": false }
}
```

Each event's ticket link falls back to the year's `"ticketsUrl"`. Set
`"url": null` for free events with no booking; they show in a different
colour on the calendar. An event without an image uses its venue's photo.

**Venues** live in `site.json`, each with a `"name"`, a `"short"` name for
calendar squares, an `"address"`, an `"image"` and a `"description"`. A Google
Maps link is made from the address; set `"mapUrl"` to override it, or to
`null` to hide it. Set `"hidden": true` to keep a venue off the About page.

Any text field accepts `*italics*` and `[links](https://…)`.

The build checks the data and stops with a clear message if, for example, an
event refers to an artist, venue or image that doesn't exist.

## Deploying

Pushing to `main` builds the site and publishes it with GitHub Pages
(`.github/workflows/deploy.yml`). It also rebuilds every morning, as
described under Years. In the repository settings, under
Pages → Source, choose "GitHub Actions".

The output in `dist/` is ordinary static files, so any host works. On Netlify
or Cloudflare Pages, set the build command to `node build.mjs` and the output
directory to `dist`, and schedule a daily rebuild with a build hook. All links are relative, so the site works at a domain
root or under a sub-path such as `username.github.io/ycmf-website/`. If it is
served from a sub-path, set `"basePath"` in `site.json` (for example
`"/ycmf-website/"`) so the 404 page links correctly.
