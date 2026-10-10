#!/usr/bin/env node
// Builds the Yarmouth Chamber Music Festival website from the JSON files in
// data/ into plain HTML in dist/. Uses only Node built-ins.
//
//   node build.mjs           build into dist/
//   node build.mjs --serve   build, then serve dist/ at http://localhost:8080

import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, 'dist');

// ---------------------------------------------------------------------------
// Data

const readJSON = async (file) => {
  try {
    return JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${file}: ${err.message}`);
  }
};

async function loadData() {
  const site = await readJSON('data/site.json');
  const artists = await readJSON('data/artists.json');
  const files = (await readdir(path.join(ROOT, 'data/festivals'))).filter((f) => /^\d{4}\.json$/.test(f));
  const festivals = await Promise.all(files.map((f) => readJSON(`data/festivals/${f}`)));
  festivals.sort((a, b) => a.year - b.year);
  festivals.forEach((f, i) => {
    f.season = i + 1;
    f.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  });
  validate(site, artists, festivals);
  return { site, artists, festivals, latest: festivals.at(-1) };
}

function validate(site, artists, festivals) {
  const errors = [];
  if (!festivals.length) errors.push('No festival years found in data/festivals/.');
  for (const fest of festivals) {
    const where = `data/festivals/${fest.year}.json`;
    for (const id of fest.artists ?? []) {
      if (!artists[id]) errors.push(`${where}: artist "${id}" is not defined in data/artists.json`);
    }
    const ids = new Set();
    for (const ev of fest.events ?? []) {
      const label = `${where}: event "${ev.id ?? ev.title}"`;
      if (!ev.id) errors.push(`${label} is missing an "id"`);
      if (ids.has(ev.id)) errors.push(`${label} has a duplicate id`);
      ids.add(ev.id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date ?? '')) errors.push(`${label} needs a date like "2025-10-03"`);
      if (ev.time && !/^\d{1,2}:\d{2}$/.test(ev.time)) errors.push(`${label} needs a 24-hour time like "19:30"`);
      if (!site.venues[ev.venue]) errors.push(`${label}: venue "${ev.venue}" is not defined in data/site.json`);
      for (const p of ev.performers ?? []) {
        if (typeof p === 'string' && !artists[p]) errors.push(`${label}: performer "${p}" is not defined in data/artists.json`);
      }
    }
  }
  if (errors.length) throw new Error(`Data problems:\n  - ${errors.join('\n  - ')}`);
}

// ---------------------------------------------------------------------------
// Formatting

const esc = (s = '') =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Text fields allow *italics* and [links](https://…), nothing more.
const inline = (s) =>
  esc(s)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');

const paras = (text) => [].concat(text ?? []).map((p) => `<p>${inline(p)}</p>`).join('\n');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d, weekday: DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()], month: MONTHS[m - 1] };
}

const longDate = (iso) => {
  const t = parseDate(iso);
  return `${t.weekday}, ${t.month} ${t.d}`;
};

const shortDate = (iso) => {
  const t = parseDate(iso);
  return `${t.weekday.slice(0, 3)} ${t.month.slice(0, 3)} ${t.d}`;
};

function time(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

function dateRange(fest, { withYear = true } = {}) {
  if (fest.dates) return fest.dates;
  if (!fest.events.length) return String(fest.year);
  const a = parseDate(fest.events[0].date);
  const b = parseDate(fest.events.at(-1).date);
  const yr = withYear ? `, ${b.y}` : '';
  if (a.m === b.m && a.d === b.d) return `${a.month} ${a.d}${yr}`;
  if (a.m === b.m) return `${a.month} ${a.d}–${b.d}${yr}`;
  return `${a.month} ${a.d} – ${b.month} ${b.d}${yr}`;
}

const seasonName = (n) => `The ${ORDINALS[n - 1] ?? `${n}th`} Season`;

// Venues get a Google Maps search link from their address unless they set
// "mapUrl" themselves (null hides the link, e.g. for a private home).
const mapUrl = (venue) => {
  if ('mapUrl' in venue) return venue.mapUrl;
  return venue.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${venue.name}, ${venue.address}`)}` : null;
};

// ---------------------------------------------------------------------------
// Paths
//
// Every festival year lives at /<year>/. The latest year is also published at
// the site root, so /schedule/ always means "this year's schedule". All links
// are relative, so the site works under any base path (e.g. GitHub Pages).

function linker(dir) {
  const depth = dir.split('/').filter(Boolean).length;
  return (target = '') => '../'.repeat(depth) + target || './';
}

// ---------------------------------------------------------------------------
// Layout

function layout(ctx, { title, section, body, description }) {
  const { site, festivals, latest, fest, dir, yearBase } = ctx;
  const href = linker(dir);
  const pageTitle = title ? `${title} · ${site.name}` : `${site.name} ${fest.year}`;

  const nav = [
    ['Schedule', `${yearBase}schedule/`, 'schedule'],
    ['Artists', `${yearBase}artists/`, 'artists'],
    ['About', 'about/', 'about'],
  ];

  const yearSub = section === 'schedule' || section === 'artists' ? `${section}/` : '';
  const years = [...festivals]
    .reverse()
    .map((f) => {
      const base = f === latest ? '' : `${f.year}/`;
      const current = f === fest ? ' aria-current="page"' : '';
      return `<li><a href="${href(base + yearSub)}"${current}>${f.year}${f === latest ? ' <span>current</span>' : ''}</a></li>`;
    })
    .join('');

  const archiveNote =
    fest !== latest && section !== 'about'
      ? `<div class="archive-note"><div class="wrap">You are viewing the ${fest.year} festival archive. <a href="${href(yearSub)}">See the ${latest.year} festival&nbsp;→</a></div></div>`
      : '';

  const socials = (site.social ?? []).map((s) => `<li><a href="${esc(s.url)}">${esc(s.label)}</a></li>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
<meta name="description" content="${esc(description ?? site.description)}">
<meta property="og:title" content="${esc(pageTitle)}">
<meta property="og:description" content="${esc(description ?? site.description)}">
<meta property="og:type" content="website">
<link rel="icon" href="${href('favicon.svg')}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=EB+Garamond:ital,wght@0,400;0,500;1,400&display=swap">
<link rel="stylesheet" href="${href('styles.css')}">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="brand" href="${href(yearBase)}">
      <span class="brand-place">Yarmouth</span>
      <span class="brand-rest">Chamber Music Festival</span>
    </a>
    <nav class="nav" aria-label="Main">
      <ul>
        ${nav.map(([label, target, key]) => `<li><a href="${href(target)}"${key === section ? ' aria-current="page"' : ''}>${label}</a></li>`).join('\n        ')}
        <li><a class="nav-support" href="${href('about/#support')}">Support</a></li>
      </ul>
    </nav>
    <details class="year-switch">
      <summary><span class="year-switch-label">Festival</span> ${fest.year}</summary>
      <ul>${years}</ul>
    </details>
  </div>
</header>
${archiveNote}
<main id="main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <p class="footer-name">${esc(site.name)}</p>
      <p>${esc(site.location)}</p>
      ${site.acknowledgement ? `<p class="footer-ack">${inline(site.acknowledgement)}</p>` : ''}
    </div>
    <div>
      <h2 class="label">Contact</h2>
      <p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>
      ${site.mailingAddress ? `<p>${[].concat(site.mailingAddress).map(esc).join('<br>')}</p>` : ''}
    </div>
    <div>
      <h2 class="label">Stay in touch</h2>
      ${site.newsletterUrl ? `<p><a href="${esc(site.newsletterUrl)}">Join the mailing list</a></p>` : ''}
      ${socials ? `<ul class="plain">${socials}</ul>` : ''}
    </div>
  </div>
  <div class="wrap footer-base">
    <p>© ${new Date().getFullYear()} ${esc(site.name)}${site.charityNumber ? ` · Registered charity ${esc(site.charityNumber)}` : ''}</p>
  </div>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Pieces shared between pages

function performerList(ctx, ev, href) {
  const items = (ev.performers ?? []).map((p) => {
    if (typeof p !== 'string') return `<li>${esc(p.name)}${p.instrument ? ` <span class="instrument">${esc(p.instrument)}</span>` : ''}</li>`;
    const a = ctx.artists[p];
    return `<li><a href="${href(`${ctx.yearBase}artists/#${p}`)}">${esc(a.name)}</a> <span class="instrument">${esc(a.instrument)}</span></li>`;
  });
  return items.length ? `<ul class="performers">${items.join('')}</ul>` : '';
}

function programList(ev) {
  if (!ev.program?.length) return '';
  const items = ev.program.map(
    (w) => `<li>
          ${w.composer ? `<span class="composer">${esc(w.composer)}</span>` : ''}
          <span class="work">${inline(w.work)}</span>${w.note ? ` <span class="work-note">${inline(w.note)}</span>` : ''}
        </li>`,
  );
  return `<ol class="program">${items.join('')}</ol>`;
}

function tickets(ev, fest, isPast) {
  const t = ev.tickets ?? {};
  if (isPast) return '';
  const url = 'url' in t ? t.url : fest.ticketsUrl; // explicit null means no ticket link
  const parts = [];
  if (t.price) parts.push(`<span class="price">${esc(t.price)}</span>`);
  if (t.note) parts.push(`<span>${inline(t.note)}</span>`);
  if (url && !t.soldOut) parts.push(`<a href="${esc(url)}">Tickets</a>`);
  if (t.soldOut) parts.push('<span class="sold-out">Sold out</span>');
  return parts.length ? `<p class="event-tickets">${parts.join(' <span class="sep">·</span> ')}</p>` : '';
}

const pageHead = (eyebrow, title, intro = '') => `
<header class="page-head">
  <div class="wrap">
    <p class="eyebrow">${eyebrow}</p>
    <h1>${title}</h1>
    ${intro ? `<div class="page-intro">${intro}</div>` : ''}
  </div>
</header>`;

// ---------------------------------------------------------------------------
// Pages

function homePage(ctx) {
  const { site, fest, artists } = ctx;
  const href = linker(ctx.dir);

  const glance = fest.events
    .map((ev) => {
      const venue = site.venues[ev.venue];
      return `<li>
        <a href="${href(`${ctx.yearBase}schedule/#${ev.id}`)}">
          <span class="glance-date">${shortDate(ev.date)}</span>
          <span class="glance-title">${inline(ev.title)}<span class="glance-venue">${esc(venue.name)}</span></span>
          <span class="glance-time">${time(ev.time)}</span>
        </a>
      </li>`;
    })
    .join('');

  const roster = (fest.artists ?? [])
    .map((id) => `<li><a href="${href(`${ctx.yearBase}artists/#${id}`)}"><span class="roster-name">${esc(artists[id].name)}</span> <span class="instrument">${esc(artists[id].instrument)}</span></a></li>`)
    .join('');

  const ticketsUrl = fest === ctx.latest ? fest.ticketsUrl : null;

  const body = `
<section class="masthead">
  <div class="wrap">
    <p class="eyebrow">${seasonName(fest.season)}</p>
    <h1><span class="masthead-name">${esc(site.name)}</span> <span class="masthead-year">${fest.year}</span></h1>
    <p class="masthead-dates">${esc(dateRange(fest, { withYear: false }))} <span class="sep">·</span> ${esc(site.location)}</p>
    ${fest.tagline ? `<p class="masthead-tagline">${inline(fest.tagline)}</p>` : ''}
    <p class="actions">
      <a class="button button-primary" href="${href(`${ctx.yearBase}schedule/`)}">The schedule</a>
      ${ticketsUrl ? `<a class="button" href="${esc(ticketsUrl)}">Tickets</a>` : ''}
    </p>
  </div>
</section>

${fest.intro ? `<section class="section">
  <div class="wrap split">
    <h2 class="label">${fest.theme ? esc(fest.theme) : `The ${fest.year} Festival`}</h2>
    <div class="prose lead">${paras(fest.intro)}</div>
  </div>
</section>` : ''}

${glance ? `<section class="section">
  <div class="wrap">
    <div class="section-head">
      <h2>Program</h2>
      <a href="${href(`${ctx.yearBase}schedule/`)}">Full schedule and repertoire&nbsp;→</a>
    </div>
    <ol class="glance">${glance}</ol>
  </div>
</section>` : ''}

${roster ? `<section class="section">
  <div class="wrap">
    <div class="section-head">
      <h2>Artists</h2>
      <a href="${href(`${ctx.yearBase}artists/`)}">Biographies&nbsp;→</a>
    </div>
    <ul class="roster">${roster}</ul>
  </div>
</section>` : ''}

${site.support ? `<section class="band">
  <div class="wrap band-inner">
    <p class="band-text">${inline(site.support.headline)}</p>
    <p class="actions">
      ${site.support.donateUrl ? `<a class="button button-light" href="${esc(site.support.donateUrl)}">Make a gift</a>` : ''}
      <a class="button button-ghost" href="${href('about/#support')}">Other ways to help</a>
    </p>
  </div>
</section>` : ''}
`;

  return layout(ctx, { section: 'home', body, description: fest.tagline ?? site.description });
}

function schedulePage(ctx) {
  const { site, fest } = ctx;
  const href = linker(ctx.dir);

  const days = Map.groupBy(fest.events, (ev) => ev.date);
  const dayBlocks = [...days]
    .map(([date, events]) => {
      const t = parseDate(date);
      const items = events
        .map((ev) => {
          const venue = site.venues[ev.venue];
          const map = mapUrl(venue);
          return `
      <article class="event" id="${esc(ev.id)}">
        <p class="event-meta"><span class="event-time">${time(ev.time)}</span>${ev.kind ? ` <span class="sep">·</span> ${esc(ev.kind)}` : ''}</p>
        <h3>${inline(ev.title)}</h3>
        <p class="event-venue">${map ? `<a href="${esc(map)}">${esc(venue.name)}</a>` : esc(venue.name)}${venue.address ? `<span class="event-address">${esc(venue.address)}</span>` : ''}</p>
        <div class="prose">${paras(ev.description)}</div>
        ${programList(ev)}
        ${performerList(ctx, ev, href)}
        ${tickets(ev, fest, fest !== ctx.latest)}
      </article>`;
        })
        .join('');
      return `
  <section class="day">
    <h2 class="day-date"><span class="day-weekday">${t.weekday}</span> <span class="day-num">${t.d}</span> <span class="day-month">${t.month}</span></h2>
    <div class="day-events">${items}</div>
  </section>`;
    })
    .join('');

  const intro = fest.scheduleNote ? paras(fest.scheduleNote) : '';
  const body = `
${pageHead(`${fest.year} <span class="sep">·</span> ${esc(dateRange(fest, { withYear: false }))}`, 'Schedule', intro)}
<div class="wrap schedule">${dayBlocks || '<p>The schedule will be announced soon.</p>'}</div>
`;
  return layout(ctx, { title: `Schedule ${fest.year}`, section: 'schedule', body });
}

function artistsPage(ctx) {
  const { artists, fest } = ctx;
  const href = linker(ctx.dir);

  const list = (fest.artists ?? [])
    .map((id) => {
      const a = artists[id];
      const events = fest.events.filter((ev) => ev.performers?.includes(id));
      const appearances = events.length
        ? `<p class="appearances"><span class="label">Appearing</span> ${events
            .map((ev) => `<a href="${href(`${ctx.yearBase}schedule/#${ev.id}`)}">${inline(ev.title)}</a> <span class="muted">${shortDate(ev.date)}</span>`)
            .join('<span class="sep">·</span>')}</p>`
        : '';
      return `
  <article class="artist" id="${esc(id)}">
    <div class="artist-id">
      ${a.photo ? `<img src="${href(a.photo)}" alt="${esc(a.name)}" loading="lazy" width="480" height="600">` : ''}
      <h2>${esc(a.name)}</h2>
      <p class="instrument">${esc(a.instrument)}</p>
      ${a.website ? `<p class="artist-site"><a href="${esc(a.website)}">Website</a></p>` : ''}
    </div>
    <div class="artist-bio">
      <div class="prose">${paras(a.bio)}</div>
      ${appearances}
    </div>
  </article>`;
    })
    .join('');

  const body = `
${pageHead(`${fest.year} Festival`, 'Artists')}
<div class="wrap artists">${list || '<p>Artists will be announced soon.</p>'}</div>
`;
  return layout(ctx, { title: `Artists ${fest.year}`, section: 'artists', body });
}

function aboutPage(ctx) {
  const { site } = ctx;
  const team = (site.team ?? [])
    .map(
      (p) => `<li class="person">
        <h3>${esc(p.name)}</h3>
        <p class="instrument">${esc(p.role)}</p>
        ${p.bio ? `<div class="prose">${paras(p.bio)}</div>` : ''}
      </li>`,
    )
    .join('');

  const venues = Object.values(site.venues)
    .filter((v) => !v.hidden)
    .map((v) => {
      const map = mapUrl(v);
      return `<li class="venue">
        <h3>${esc(v.name)}</h3>
        ${v.address ? `<p class="muted">${esc(v.address)}</p>` : ''}
        ${v.description ? `<div class="prose">${paras(v.description)}</div>` : ''}
        ${map ? `<p><a href="${esc(map)}">Map&nbsp;→</a></p>` : ''}
      </li>`;
    })
    .join('');

  const s = site.support ?? {};
  const body = `
${pageHead('About', 'The Festival', paras(site.tagline))}
<section class="section">
  <div class="wrap split">
    <h2 class="label">Our story</h2>
    <div class="prose lead">${paras(site.about)}</div>
  </div>
</section>
${team ? `<section class="section">
  <div class="wrap split">
    <h2 class="label">People</h2>
    <ul class="people">${team}</ul>
  </div>
</section>` : ''}
${venues ? `<section class="section">
  <div class="wrap split">
    <h2 class="label">Venues</h2>
    <ul class="venues">${venues}</ul>
  </div>
</section>` : ''}
<section class="section" id="support">
  <div class="wrap split">
    <h2 class="label">Support</h2>
    <div class="prose">
      ${paras(s.text)}
      <p class="actions">
        ${s.donateUrl ? `<a class="button button-primary" href="${esc(s.donateUrl)}">Make a gift</a>` : ''}
        ${s.volunteerUrl ? `<a class="button" href="${esc(s.volunteerUrl)}">Volunteer</a>` : ''}
      </p>
      ${s.sponsors?.length ? `<h3>With thanks to</h3><ul class="plain sponsors">${s.sponsors.map((sp) => `<li>${sp.url ? `<a href="${esc(sp.url)}">${esc(sp.name)}</a>` : esc(sp.name)}</li>`).join('')}</ul>` : ''}
    </div>
  </div>
</section>
<section class="section" id="contact">
  <div class="wrap split">
    <h2 class="label">Contact</h2>
    <div class="prose">
      <p><a href="mailto:${esc(site.email)}">${esc(site.email)}</a></p>
      ${site.mailingAddress ? `<p>${[].concat(site.mailingAddress).map(esc).join('<br>')}</p>` : ''}
    </div>
  </div>
</section>
`;
  return layout(ctx, { title: 'About', section: 'about', body });
}

function notFoundPage(data) {
  // GitHub Pages serves 404.html at whatever URL was requested, so relative
  // links can't be trusted here; use site.basePath instead.
  const base = data.site.basePath ?? '/';
  const ctx = { ...data, fest: data.latest, dir: '', yearBase: '' };
  const body = `${pageHead('Not found', 'This page has wandered off', `<p><a href="${esc(base)}">Return to the festival&nbsp;→</a></p>`)}`;
  return layout(ctx, { title: 'Not found', section: '404', body })
    .replaceAll('href="./', `href="${base}`)
    .replace(/href="(?!https?:|mailto:|\/|#)/g, `href="${base}`);
}

// ---------------------------------------------------------------------------
// Build

async function write(dir, html) {
  const target = path.join(OUT, dir, 'index.html');
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, html);
}

async function build() {
  const data = await loadData();
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  if (existsSync(path.join(ROOT, 'static'))) await cp(path.join(ROOT, 'static'), OUT, { recursive: true });

  const pages = [
    ['', homePage],
    ['schedule/', schedulePage],
    ['artists/', artistsPage],
  ];

  let count = 0;
  for (const fest of data.festivals) {
    const roots = fest === data.latest ? ['', `${fest.year}/`] : [`${fest.year}/`];
    for (const root of roots) {
      for (const [sub, render] of pages) {
        const dir = root + sub;
        // Links on every page of the latest year point at the root copies.
        const yearBase = fest === data.latest ? '' : `${fest.year}/`;
        await write(dir, render({ ...data, fest, dir, yearBase }));
        count++;
      }
    }
  }
  await write('about/', aboutPage({ ...data, fest: data.latest, dir: 'about/', yearBase: '' }));
  await writeFile(path.join(OUT, '404.html'), notFoundPage(data));
  count += 2;

  console.log(`Built ${count} pages for ${data.festivals.map((f) => f.year).join(', ')} (latest: ${data.latest.year}) → dist/`);
}

function serve(port = 8080) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf' };
  createServer(async (req, res) => {
    let p = path.join(OUT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!p.startsWith(OUT)) return res.writeHead(403).end();
    if (p.endsWith(path.sep) || !path.extname(p)) p = path.join(p, 'index.html');
    try {
      res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }).end(await readFile(p));
    } catch {
      res.writeHead(404, { 'content-type': types['.html'] }).end(await readFile(path.join(OUT, '404.html')));
    }
  }).listen(port, () => console.log(`Serving dist/ at http://localhost:${port}`));
}

try {
  await build();
  if (process.argv.includes('--serve')) serve(Number(process.env.PORT) || 8080);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
