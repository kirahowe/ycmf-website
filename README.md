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
data/festivals/2025.json   one file per festival year
static/                    copied into the site as is (styles.css, favicon, images/)
build.mjs                  the generator
```

## Years

Each file in `data/festivals/` is one festival year. The newest year is the
current festival: it is published at the site root (`/`, `/schedule/`,
`/artists/`). Every year, including the newest, is also published under its
own year (`/2024/`, `/2024/schedule/`, …), and the year menu in the header
switches between them. Archive pages show a note pointing back to the current
festival and hide ticket links.

To start a new season, copy last year's file to `data/festivals/2026.json`,
change `"year"`, and update the events and artist list. As soon as it exists,
it becomes the front page.

## Editing content

**Artists** are defined once in `data/artists.json` and listed by id in each
year's `"artists"` array, so a returning artist's bio doesn't need to be
copied. Put photos in `static/images/artists/` and set
`"photo": "images/artists/name.jpg"` (portrait, about 4:5).

**Events** in a year file:

```json
{
  "id": "night-music",               // used in links: /schedule/#night-music
  "title": "Night Music in the Dark",
  "kind": "Concert",                 // shown above the title
  "date": "2025-10-09",
  "time": "19:30",                   // 24-hour
  "venue": "mountain-cemetery-chapel",   // a key in site.json "venues"
  "description": ["Paragraph one.", "Paragraph two."],
  "program": [
    { "composer": "Arvo Pärt", "work": "*Fratres*", "note": "optional" }
  ],
  "performers": ["clara-whitmore", { "name": "Guest Choir" }],
  "tickets": { "price": "$50", "url": "https://…", "note": "students free", "soldOut": false }
}
```

Each event's tickets link falls back to the year's `"ticketsUrl"`. Set
`"url": null` to show no link.

**Venues** live in `site.json`. A Google Maps link is made from the address
automatically; set `"mapUrl"` to override it, or to `null` to hide it. Set
`"hidden": true` to keep a venue off the About page.

Any text field accepts `*italics*` and `[links](https://…)`. Text that runs to
several paragraphs is an array of strings.

The build checks the data and stops with a clear message if, for example, an
event refers to an artist or venue that doesn't exist.

## Deploying

Pushing to `main` builds the site and publishes it with GitHub Pages
(`.github/workflows/deploy.yml`). In the repository settings, under
Pages → Source, choose "GitHub Actions".

The output in `dist/` is ordinary static files, so any host works. On Netlify
or Cloudflare Pages, set the build command to `node build.mjs` and the output
directory to `dist`. All links are relative, so the site works at a domain
root or under a sub-path such as `username.github.io/ycmf-website/`. If it is
served from a sub-path, set `"basePath"` in `site.json` (for example
`"/ycmf-website/"`) so the 404 page links correctly.
