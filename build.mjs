#!/usr/bin/env node
// Builds the Yarmouth Chamber Music Festival website from the JSON files in
// data/ into plain HTML in dist/. Uses only Node built-ins.
//
//   node build.mjs           build into dist/
//   node build.mjs --serve   build, then serve dist/ at http://localhost:8080
//
// Set BUILD_DATE=2026-09-01 to preview the site as it will look on that day.

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

// Today's date where the festival happens, as YYYY-MM-DD.
const localToday = (timeZone) =>
  process.env.BUILD_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function loadData() {
  const site = await readJSON('data/site.json');
  const artists = await readJSON('data/artists.json');
  const files = (await readdir(path.join(ROOT, 'data/festivals'))).filter((f) => /^\d{4}\.json$/.test(f));
  const festivals = await Promise.all(files.map((f) => readJSON(`data/festivals/${f}`)));
  const today = localToday(site.timezone ?? 'America/Halifax');

  festivals.sort((a, b) => a.year - b.year);
  festivals.forEach((f, i) => {
    f.season = i + 1;
    f.events ??= [];
    f.gallery ??= [];
    f.events.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    for (const ev of f.events) ev.past = ev.date < today;
    // A festival is "over" once its last event has happened.
    f.over = f.events.length > 0 && f.events.every((ev) => ev.past);
  });
  validate(site, artists, festivals);
  return { site, artists, festivals, latest: festivals.at(-1), today };
}

function validate(site, artists, festivals) {
  const errors = [];
  const checkImage = (src, where) => {
    if (src && !/^https?:/.test(src) && !existsSync(path.join(ROOT, 'static', src))) {
      errors.push(`${where}: image "${src}" not found in static/`);
    }
  };
  if (!festivals.length) errors.push('No festival years found in data/festivals/.');
  for (const [id, a] of Object.entries(artists)) checkImage(a.photo, `data/artists.json "${id}"`);
  for (const [id, v] of Object.entries(site.venues)) checkImage(v.image, `data/site.json venue "${id}"`);
  checkImage(site.support?.image, 'data/site.json support');
  for (const fest of festivals) {
    const where = `data/festivals/${fest.year}.json`;
    for (const id of fest.artists ?? []) {
      if (!artists[id]) errors.push(`${where}: artist "${id}" is not defined in data/artists.json`);
    }
    for (const img of [...(fest.heroImages ?? []), ...fest.gallery]) checkImage(img.src, where);
    const ids = new Set();
    for (const ev of fest.events) {
      const label = `${where}: event "${ev.id ?? ev.title}"`;
      if (!ev.id) errors.push(`${label} is missing an "id"`);
      if (ids.has(ev.id)) errors.push(`${label} has a duplicate id`);
      ids.add(ev.id);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date ?? '')) errors.push(`${label} needs a date like "2026-10-03"`);
      if (ev.time && !/^\d{1,2}:\d{2}$/.test(ev.time)) errors.push(`${label} needs a 24-hour time like "19:30"`);
      if (!site.venues[ev.venue]) errors.push(`${label}: venue "${ev.venue}" is not defined in data/site.json`);
      checkImage(ev.image, label);
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

const plain = (s = '') => String(s).replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/\*/g, '');

// Paragraphs; consecutive lines starting with "- " become a bulleted list.
function paras(text) {
  const out = [];
  for (const p of [].concat(text ?? [])) {
    if (p.startsWith('- ')) {
      const item = `<li>${inline(p.slice(2))}</li>`;
      if (out.at(-1)?.startsWith('<ul>')) out[out.length - 1] = out.at(-1).replace('</ul>', `${item}</ul>`);
      else out.push(`<ul>${item}</ul>`);
    } else out.push(`<p>${inline(p)}</p>`);
  }
  return out.join('\n');
}

// "Johann Sebastian Bach (1685–1750)" -> "Bach"
const surname = (composer) => composer.replace(/\s*\(.*\)\s*$/, '').split(' ').at(-1);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

const toUTC = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const toISO = (date) => date.toISOString().slice(0, 10);
const addDays = (iso, n) => toISO(new Date(toUTC(iso).getTime() + n * 86400000));

function parseDate(iso) {
  const date = toUTC(iso);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate(), dow: date.getUTCDay(), weekday: DAYS[date.getUTCDay()], month: MONTHS[date.getUTCMonth()] };
}

const longDate = (iso) => {
  const t = parseDate(iso);
  return `${t.weekday}, ${t.month} ${t.d}`;
};

function time(hm) {
  if (!hm) return '';
  const [h, m] = hm.split(':').map(Number);
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

function dateRange(fest, { withYear = true } = {}) {
  if (fest.dates) return fest.dates;
  if (!fest.events.length) return withYear ? `Dates to be announced` : String(fest.year);
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
// Calendar files (.ics)

const icsText = (s = '') => plain(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');

// Lines longer than 75 bytes must be folded.
function icsFold(line) {
  const out = [];
  let rest = Buffer.from(line);
  while (rest.length > 75) {
    let cut = out.length ? 74 : 75;
    while ((rest[cut] & 0xc0) === 0x80) cut--; // don't split a UTF-8 character
    out.push(rest.subarray(0, cut).toString());
    rest = rest.subarray(cut);
  }
  out.push(rest.toString());
  return out.join('\r\n ');
}

function icsDateTime(date, hm, addMinutes = 0) {
  const [h, m] = (hm ?? '00:00').split(':').map(Number);
  const total = h * 60 + m + addMinutes;
  const day = addDays(date, Math.floor(total / 1440));
  const mins = total % 1440;
  return `${day.replaceAll('-', '')}T${String(Math.floor(mins / 60)).padStart(2, '0')}${String(mins % 60).padStart(2, '0')}00`;
}

function icsCalendar(site, name, events) {
  const tz = site.timezone ?? 'America/Halifax';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${icsText(site.name)}//EN`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsText(name)}`,
    // Atlantic time. Other zones would need their own rules here.
    'BEGIN:VTIMEZONE', `TZID:${tz}`,
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0300', 'TZNAME:ADT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0300', 'TZOFFSETTO:-0400', 'TZNAME:AST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE',
  ];
  for (const { ev, fest } of events) {
    const venue = site.venues[ev.venue];
    lines.push(
      'BEGIN:VEVENT',
      `UID:${fest.year}-${ev.id}@ycmf`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=${tz}:${icsDateTime(ev.date, ev.time)}`,
      `DTEND;TZID=${tz}:${icsDateTime(ev.date, ev.time, ev.duration ?? 120)}`,
      `SUMMARY:${icsText(ev.title)}`,
      `LOCATION:${icsText([venue.name, venue.address].filter(Boolean).join(', '))}`,
      `DESCRIPTION:${icsText([].concat(ev.description ?? []).join('\n\n'))}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// Paths
//
// Every festival year lives at /<year>/. The latest year is also published at
// the site root, so /schedule/ always means "this year's schedule". All links
// are relative, so the site works under any base path (e.g. GitHub Pages).

function linker(dir) {
  const depth = dir.split('/').filter(Boolean).length;
  return (target = '') => (/^(https?:|mailto:|#)/.test(target) ? target : '../'.repeat(depth) + target || './');
}

// ---------------------------------------------------------------------------
// Shared pieces

function img(href, src, { alt = '', focus, cls = '', eager = false } = {}) {
  if (!src) return '';
  return `<img${cls ? ` class="${cls}"` : ''} src="${esc(href(src))}" alt="${esc(alt)}"${focus ? ` style="object-position: ${esc(focus)}"` : ''}${eager ? '' : ' loading="lazy"'} decoding="async">`;
}

function portrait(href, artist) {
  if (artist.photo) return img(href, artist.photo, { alt: artist.name, focus: artist.photoFocus });
  const initials = artist.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2);
  return `<span class="portrait-blank" aria-hidden="true">${esc(initials)}</span>`;
}

const sectionHead = (title, link) => `
    <div class="section-head">
      <h2>${title}</h2>
      ${link ?? ''}
    </div>`;

function ticketBlock(ev, fest, href, { compact = false } = {}) {
  const t = ev.tickets ?? {};
  const url = 'url' in t ? t.url : fest.ticketsUrl; // explicit null means no ticket link
  let action = '';
  if (ev.past) action = '<span class="ticket-state">Past event</span>';
  else if (t.soldOut) action = '<span class="ticket-state">Sold out</span>';
  else if (url) action = `<a class="button button-primary" href="${esc(href(url))}">${esc(t.label ?? 'Tickets')}</a>`;
  return `<div class="tickets${compact ? ' tickets-compact' : ''}">
        ${t.price ? `<span class="price">${esc(t.price)}</span>` : ''}
        ${t.note && !ev.past ? `<span class="price-note">${inline(t.note)}</span>` : ''}
        ${action}
      </div>`;
}

function programList(ev) {
  if (!ev.program?.length) return '';
  const items = ev.program.map(
    (w) => `<li>${w.composer ? `<span class="composer">${esc(w.composer)}</span> ` : ''}<span class="work">${inline(w.work)}</span>${w.note ? ` <span class="work-note">${inline(w.note)}</span>` : ''}</li>`,
  );
  return `<ul class="program">${items.join('')}</ul>`;
}

function performerList(ctx, ev, href) {
  const items = (ev.performers ?? []).map((p) => {
    if (typeof p !== 'string') return `<li>${esc(p.name)}${p.instrument ? ` <span class="instrument">${esc(p.instrument)}</span>` : ''}</li>`;
    const a = ctx.artists[p];
    return `<li><a href="${href(`${ctx.yearBase}artists/#${p}`)}">${esc(a.name)}</a> <span class="instrument">${esc(a.instrument)}</span></li>`;
  });
  return items.length ? `<ul class="performers">${items.join('')}</ul>` : '';
}

function calendarTitle(fest) {
  const a = parseDate(fest.events[0].date).month;
  const b = parseDate(fest.events.at(-1).date).month;
  return a === b ? `${a} ${fest.year}` : `${a} – ${b} ${fest.year}`;
}

// A month-style grid of the festival weeks, Monday first.
function calendarGrid(ctx, href) {
  const { fest, site } = ctx;
  if (!fest.events.length) return '';
  const first = fest.events[0].date;
  const last = fest.events.at(-1).date;
  const start = addDays(first, -((parseDate(first).dow + 6) % 7));
  const end = addDays(last, (7 - parseDate(last).dow) % 7);
  const byDate = Map.groupBy(fest.events, (ev) => ev.date);

  const cells = [];
  for (let day = start; day <= end; day = addDays(day, 1)) {
    const t = parseDate(day);
    const events = byDate.get(day) ?? [];
    const outside = day < first || day > last;
    const label = t.d === 1 || day === start ? `${t.month.slice(0, 3)} ${t.d}` : t.d;
    const items = events
      .map((ev) => {
        const venue = site.venues[ev.venue];
        const free = !ev.tickets?.url && 'url' in (ev.tickets ?? {});
        return `<a class="cal-event${free ? ' cal-free' : ''}" href="${href(`${ctx.yearBase}schedule/#${ev.id}`)}">${inline(ev.title)}<span>${time(ev.time)} · ${esc(venue.short ?? venue.name)}</span></a>`;
      })
      .join('');
    cells.push(`<div class="cal-day${outside ? ' cal-outside' : ''}${events.length ? ' cal-has' : ''}"><span class="cal-date"><span class="cal-dow">${t.weekday.slice(0, 3)}</span> ${label}</span>${items}</div>`);
  }
  const heads = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="cal-head">${d}</div>`).join('');
  return `<div class="calendar">${heads}${cells.join('')}</div>
    <p class="cal-legend"><span class="key"></span> Ticketed <span class="key key-free"></span> Free</p>`;
}

function eventRow(ctx, ev, href) {
  const venue = ctx.site.venues[ev.venue];
  const t = parseDate(ev.date);
  const image = ev.image ?? venue.image;
  return `
    <article class="row${ev.past ? ' row-past' : ''}">
      <a class="row-date" href="${href(`${ctx.yearBase}schedule/#${ev.id}`)}"><span class="row-dow">${t.weekday.slice(0, 3)}</span><span class="row-num">${t.d}</span><span class="row-month">${t.month.slice(0, 3)}</span></a>
      <a class="row-photo" href="${href(`${ctx.yearBase}schedule/#${ev.id}`)}" tabindex="-1" aria-hidden="true">${img(href, image, { focus: ev.imageFocus })}</a>
      <div class="row-body">
        <p class="row-meta">${time(ev.time)}${ev.kind ? ` <span class="sep">·</span> ${esc(ev.kind)}` : ''}</p>
        <h3><a href="${href(`${ctx.yearBase}schedule/#${ev.id}`)}">${inline(ev.title)}</a></h3>
        <p class="row-venue">${esc(venue.name)}</p>
        ${ev.program?.length ? `<p class="row-program">${ev.program.map((w) => (w.composer ? esc(surname(w.composer)) : inline(w.work))).filter((v, i, a) => a.indexOf(v) === i).join(', ')}</p>` : ''}
      </div>
      ${ticketBlock(ev, ctx.fest, href, { compact: true })}
    </article>`;
}

function gallery(href, photos, { limit } = {}) {
  const list = limit ? photos.slice(0, limit) : photos;
  return `<div class="gallery">${list
    .map((p) => {
      const caption = [p.caption && inline(p.caption), p.credit && `Photo: ${esc(p.credit)}`].filter(Boolean).join(' · ');
      return `<figure>${img(href, p.src, { alt: p.alt ?? p.caption ?? '', focus: p.focus })}${caption ? `<figcaption>${caption}</figcaption>` : ''}</figure>`;
    })
    .join('')}</div>`;
}

const photoCredit = (fest) => (fest.photoCredit ? `<p class="photo-credit">Photographs by ${inline(fest.photoCredit)}</p>` : '');

// ---------------------------------------------------------------------------
// Layout

function layout(ctx, { title, section, body, description }) {
  const { site, festivals, latest, fest, dir, yearBase } = ctx;
  const href = linker(dir);
  const pageTitle = title ? `${title} · ${site.name}` : `${site.name} ${fest.year}`;

  const nav = [
    ['Schedule', `${yearBase}schedule/`, 'schedule'],
    ['Artists', `${yearBase}artists/`, 'artists'],
    ['Photos', `${yearBase}photos/`, 'photos'],
    ['About', 'about/', 'about'],
  ];

  const yearSub = ['schedule', 'artists', 'photos'].includes(section) ? `${section}/` : '';
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

  const ticketsLive = fest === latest && !fest.over && fest.ticketsUrl;
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;1,400&family=Nunito+Sans:ital,opsz,wght@0,6..12,300..700;1,6..12,300..700&display=swap">
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
      </ul>
    </nav>
    <details class="year-switch">
      <summary><span class="year-switch-label">Festival</span> ${fest.year}</summary>
      <ul>${years}</ul>
    </details>
    ${ticketsLive ? `<a class="button button-primary header-tickets" href="${esc(href(fest.ticketsUrl))}">Tickets</a>` : `<a class="button header-tickets" href="${href('about/#support')}">Support</a>`}
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
      ${site.nameFr ? `<p class="footer-fr">${esc(site.nameFr)}</p>` : ''}
      ${site.presenter ? `<p>Presented by ${site.presenter.url ? `<a href="${esc(site.presenter.url)}">${esc(site.presenter.name)}</a>` : esc(site.presenter.name)}</p>` : ''}
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
      <p><a href="${href('about/#support')}">Support the festival</a></p>
    </div>
  </div>
  <div class="wrap footer-base">
    <p>© ${new Date().getFullYear()} ${esc(site.name)}${site.charityNumber ? ` · Registered charity ${esc(site.charityNumber)}` : ''}${site.photoCredit ? ` · ${inline(site.photoCredit)}` : ''}</p>
  </div>
</footer>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Pages

function homePage(ctx) {
  const { site, fest, festivals, artists } = ctx;
  const href = linker(ctx.dir);
  const isLatest = fest === ctx.latest;
  const over = fest.over || !isLatest;
  const range = dateRange(fest, { withYear: false });

  // Hero: text on one side, a cluster of photographs on the other.
  const [main, ...extra] = fest.heroImages ?? [];
  const heroPhotos = main
    ? `<div class="hero-photos${extra.length ? '' : ' hero-photos-single'}">
        <figure class="hero-main">${img(href, main.src, { alt: main.alt ?? '', focus: main.focus, eager: true })}${main.caption ? `<figcaption>${inline(main.caption)}</figcaption>` : ''}</figure>
        ${extra.slice(0, 2).map((p) => `<figure>${img(href, p.src, { alt: p.alt ?? '', focus: p.focus, eager: true })}</figure>`).join('')}
      </div>`
    : '';

  const heroText = over
    ? `<p class="eyebrow">${seasonName(fest.season)} <span class="sep">·</span> ${esc(range)}, ${fest.year}</p>
      <h1>${isLatest ? 'Thank you for a wonderful festival' : `The ${fest.year} festival`}</h1>
      <div class="hero-summary">${paras(isLatest ? (fest.afterword ?? fest.summary) : fest.summary)}</div>
      <p class="actions">
        <a class="button button-primary" href="${href(`${ctx.yearBase}photos/`)}">Photos from ${fest.year}</a>
        ${isLatest && site.newsletterUrl ? `<a class="button" href="${esc(site.newsletterUrl)}">Hear about ${fest.year + 1}</a>` : ''}
      </p>`
    : `<p class="eyebrow">${seasonName(fest.season)} <span class="sep">·</span> ${esc(range)}, ${fest.year}</p>
      <h1>${inline(fest.headline ?? site.name)} <em>${esc(site.location)}</em></h1>
      <div class="hero-summary">${paras(fest.summary)}</div>
      <p class="actions">
        ${fest.ticketsUrl ? `<a class="button button-primary" href="${esc(href(fest.ticketsUrl))}">Buy tickets</a>` : ''}
        <a class="button" href="#calendar">See the calendar</a>
      </p>`;

  const rows = fest.events.map((ev) => eventRow(ctx, ev, href)).join('');

  const roster = (fest.artists ?? [])
    .map((id) => `<a class="artist-card" href="${href(`${ctx.yearBase}artists/#${id}`)}"><span class="portrait">${portrait(href, artists[id])}</span><span class="artist-name">${esc(artists[id].name)}</span><span class="instrument">${esc(artists[id].instrument)}</span></a>`)
    .join('');

  // Show this year's photos, or last year's until there are some.
  const photoYear = fest.gallery.length ? fest : [...festivals].reverse().find((f) => f.year < fest.year && f.gallery.length);
  const photoBase = photoYear && (photoYear === ctx.latest ? '' : `${photoYear.year}/`);

  const body = `
<section class="hero">
  <div class="wrap hero-grid">
    <div class="hero-text">${heroText}</div>
    ${heroPhotos}
  </div>
</section>

${fest.intro && !over ? `<section class="band band-plain">
  <div class="wrap split">
    <h2 class="label">The ${fest.year} Festival</h2>
    <div class="prose lead">${paras(fest.intro)}</div>
  </div>
</section>` : ''}

${fest.events.length ? `<section class="band band-tint" id="calendar">
  <div class="wrap">
    ${sectionHead(calendarTitle(fest), over ? '' : `<a href="${href(`${ctx.yearBase}festival-${fest.year}.ics`)}">Add every event to your calendar&nbsp;→</a>`)}
    ${calendarGrid(ctx, href)}
  </div>
</section>

<section class="band band-plain">
  <div class="wrap">
    ${sectionHead(over ? `The ${fest.year} program` : 'Concerts &amp; events', `<a href="${href(`${ctx.yearBase}schedule/`)}">Full schedule and repertoire&nbsp;→</a>`)}
    <div class="rows">${rows}</div>
  </div>
</section>` : `<section class="band band-tint">
  <div class="wrap"><p class="lead">The ${fest.year} program will be announced soon.</p></div>
</section>`}

${roster ? `<section class="band band-tint">
  <div class="wrap">
    ${sectionHead('The artists', `<a href="${href(`${ctx.yearBase}artists/`)}">Biographies&nbsp;→</a>`)}
    <div class="artist-grid">${roster}</div>
  </div>
</section>` : ''}

${photoYear ? `<section class="band band-plain">
  <div class="wrap">
    ${sectionHead(photoYear === fest ? `${fest.year} in pictures` : `From the ${photoYear.year} festival`, `<a href="${href(`${photoBase}photos/`)}">All photographs&nbsp;→</a>`)}
  </div>
  <div class="wrap-wide">${gallery(href, photoYear.gallery, { limit: 9 })}</div>
  <div class="wrap">${photoCredit(photoYear)}</div>
</section>` : ''}

${site.support ? `<section class="band band-dark support">
  ${site.support.image ? img(href, site.support.image, { cls: 'support-bg' }) : ''}
  <div class="wrap support-inner">
    <p class="support-text">${inline(site.support.headline)}</p>
    <p class="actions">
      ${site.support.donateUrl ? `<a class="button button-light" href="${esc(href(site.support.donateUrl))}">Make a gift</a>` : ''}
      <a class="button button-ghost" href="${href('about/#support')}">Other ways to help</a>
    </p>
  </div>
</section>` : ''}
`;

  return layout(ctx, { section: 'home', body, description: plain([].concat(fest.summary ?? site.description).join(' ')) });
}

const pageHead = (eyebrow, title, intro = '') => `
<header class="page-head">
  <div class="wrap">
    <p class="eyebrow">${eyebrow}</p>
    <h1>${title}</h1>
    ${intro ? `<div class="page-intro">${intro}</div>` : ''}
  </div>
</header>`;

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
          const image = ev.image ?? venue.image;
          return `
      <article class="event${ev.past ? ' event-past' : ''}" id="${esc(ev.id)}">
        ${image ? `<div class="event-photo">${img(href, image, { focus: ev.imageFocus })}</div>` : ''}
        <div class="event-body">
          <p class="event-meta"><span class="event-time">${time(ev.time)}</span>${ev.kind ? ` <span class="sep">·</span> ${esc(ev.kind)}` : ''}</p>
          <h3>${inline(ev.title)}</h3>
          <p class="event-venue">${map ? `<a href="${esc(map)}">${esc(venue.name)}</a>` : esc(venue.name)}${venue.address ? `<span class="event-address">${esc(venue.address)}</span>` : ''}</p>
          <div class="prose">${paras(ev.description)}</div>
          ${programList(ev)}
          ${performerList(ctx, ev, href)}
          <div class="event-foot">
            ${ticketBlock(ev, fest, href)}
            ${ev.past ? '' : `<a class="add-cal" href="${href(`${ctx.yearBase}calendar/${ev.id}.ics`)}">Add to calendar</a>`}
          </div>
        </div>
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

  const body = `
${pageHead(`${fest.year} <span class="sep">·</span> ${esc(dateRange(fest, { withYear: false }))}`, 'Schedule', paras(fest.scheduleNote))}
${fest.events.length ? `<section class="band band-tint"><div class="wrap">${calendarGrid(ctx, href)}${fest.over ? '' : `<p class="cal-ics"><a href="${href(`${ctx.yearBase}festival-${fest.year}.ics`)}">Add every event to your calendar&nbsp;→</a></p>`}</div></section>` : ''}
<div class="wrap schedule">${dayBlocks || '<p class="lead">The schedule will be announced soon.</p>'}</div>
${fest.thanks?.length ? `<section class="band band-tint"><div class="wrap split"><h2 class="label">With thanks to</h2><ul class="plain thanks">${fest.thanks.map((t) => `<li>${inline(t)}</li>`).join('')}</ul></div></section>` : ''}
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
        ? `<div class="appearances"><h3 class="label">Appearing</h3><ul class="plain">${events
            .map((ev) => `<li><a href="${href(`${ctx.yearBase}schedule/#${ev.id}`)}">${inline(ev.title)}</a> <span class="muted">${longDate(ev.date)}</span></li>`)
            .join('')}</ul></div>`
        : '';
      return `
  <article class="artist" id="${esc(id)}">
    <div class="artist-photo">
      <div class="portrait">${portrait(href, a)}</div>
      ${a.photo && a.photoCredit ? `<p class="photo-credit">Photo: ${esc(a.photoCredit)}</p>` : ''}
    </div>
    <div class="artist-bio">
      <h2>${esc(a.name)}</h2>
      <p class="instrument">${esc(a.instrument)}</p>
      <div class="prose">${paras(a.bio)}</div>
      ${a.website ? `<p class="artist-site"><a href="${esc(a.website)}">Website&nbsp;→</a></p>` : ''}
      ${appearances}
    </div>
  </article>`;
    })
    .join('');

  const body = `
${pageHead(`${fest.year} Festival`, 'Artists')}
<div class="wrap artists">${list || '<p class="lead">Artists will be announced soon.</p>'}</div>
`;
  return layout(ctx, { title: `Artists ${fest.year}`, section: 'artists', body });
}

function photosPage(ctx) {
  const { fest, festivals } = ctx;
  const href = linker(ctx.dir);
  const others = festivals.filter((f) => f !== fest && f.gallery.length);
  const empty = `<div class="wrap"><p class="lead">Photographs from the ${fest.year} festival will appear here${fest.over ? ' soon' : ' after the festival'}.</p>
    ${others.length ? `<p>${others.map((f) => `<a href="${href(`${f === ctx.latest ? '' : `${f.year}/`}photos/`)}">Photographs from ${f.year}&nbsp;→</a>`).join('<br>')}</p>` : ''}</div>`;
  const body = `
${pageHead(`${fest.year} Festival`, 'Photographs')}
<section class="band band-plain">${fest.gallery.length ? `<div class="wrap-wide">${gallery(href, fest.gallery)}</div><div class="wrap">${photoCredit(fest)}</div>` : empty}</section>
`;
  return layout(ctx, { title: `Photographs ${fest.year}`, section: 'photos', body });
}

function aboutPage(ctx) {
  const { site } = ctx;
  const href = linker(ctx.dir);
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
        ${v.image ? `<div class="venue-photo">${img(href, v.image, { focus: v.imageFocus })}</div>` : ''}
        <div>
          <h3>${esc(v.name)}</h3>
          ${v.address ? `<p class="muted">${esc(v.address)}</p>` : ''}
          ${v.description ? `<div class="prose">${paras(v.description)}</div>` : ''}
          ${map ? `<p><a href="${esc(map)}">Map&nbsp;→</a></p>` : ''}
        </div>
      </li>`;
    })
    .join('');

  const s = site.support ?? {};
  const body = `
${pageHead('About', 'The Festival', paras(site.tagline))}
<section class="band band-plain">
  <div class="wrap split">
    <h2 class="label">Our story</h2>
    <div class="prose lead">${paras(site.about)}</div>
  </div>
</section>
${team ? `<section class="band band-tint">
  <div class="wrap split">
    <h2 class="label">People</h2>
    <ul class="people">${team}</ul>
  </div>
</section>` : ''}
${venues ? `<section class="band band-plain">
  <div class="wrap split">
    <h2 class="label">Venues</h2>
    <ul class="venues">${venues}</ul>
  </div>
</section>` : ''}
<section class="band band-tint" id="support">
  <div class="wrap split">
    <h2 class="label">Support</h2>
    <div class="prose">
      ${paras(s.text)}
      <p class="actions">
        ${s.donateUrl ? `<a class="button button-primary" href="${esc(href(s.donateUrl))}">Make a gift</a>` : ''}
        ${s.volunteerUrl ? `<a class="button" href="${esc(s.volunteerUrl)}">Volunteer</a>` : ''}
      </p>
      ${s.sponsors?.length ? `<h3>With thanks to</h3><ul class="plain sponsors">${s.sponsors.map((sp) => `<li>${sp.url ? `<a href="${esc(sp.url)}">${esc(sp.name)}</a>` : esc(sp.name)}</li>`).join('')}</ul>` : ''}
    </div>
  </div>
</section>
<section class="band band-plain" id="contact">
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
  const body = pageHead('Not found', 'This page has wandered off', `<p><a href="${esc(base)}">Return to the festival&nbsp;→</a></p>`);
  return layout(ctx, { title: 'Not found', section: '404', body })
    .replaceAll('href="./', `href="${base}`)
    .replace(/href="(?!https?:|mailto:|\/|#)/g, `href="${base}`);
}

// ---------------------------------------------------------------------------
// Build

async function write(file, content) {
  const target = path.join(OUT, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
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
    ['photos/', photosPage],
  ];

  let count = 0;
  for (const fest of data.festivals) {
    // Links on every page of the latest year point at the root copies.
    const yearBase = fest === data.latest ? '' : `${fest.year}/`;
    const roots = fest === data.latest ? ['', `${fest.year}/`] : [`${fest.year}/`];
    for (const root of roots) {
      for (const [sub, render] of pages) {
        const dir = root + sub;
        await write(`${dir}index.html`, render({ ...data, fest, dir, yearBase }));
        count++;
      }
      const all = fest.events.map((ev) => ({ ev, fest }));
      await write(`${root}festival-${fest.year}.ics`, icsCalendar(data.site, `${data.site.name} ${fest.year}`, all));
      for (const item of all) await write(`${root}calendar/${item.ev.id}.ics`, icsCalendar(data.site, data.site.name, [item]));
    }
  }
  await write('about/index.html', aboutPage({ ...data, fest: data.latest, dir: 'about/', yearBase: '' }));
  await write('404.html', notFoundPage(data));
  count += 2;

  const state = data.latest.over ? 'over' : 'upcoming';
  console.log(`Built ${count} pages for ${data.festivals.map((f) => f.year).join(', ')} (latest: ${data.latest.year}, ${state} as of ${data.today}) → dist/`);
}

function serve(port = 8080) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf', '.ics': 'text/calendar; charset=utf-8' };
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
