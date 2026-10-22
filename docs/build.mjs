// Builds the docs site: content/**/*.md -> dist/**/*.html (Tailwind CSS is compiled separately).
// Pages and their order come from NAV below. Front matter: title, description.
// Markdown extras: GitHub-style callouts (> [!NOTE] / [!TIP] / [!WARNING] / [!IMPORTANT] / [!CAUTION]),
// links to other .md files are rewritten to .html.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked, Renderer } from 'marked';
import { markedHighlight } from 'marked-highlight';
import hljs from 'highlight.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.join(ROOT, 'content');
const DIST = path.join(ROOT, 'dist');
const REPO = 'https://github.com/syan-dev/cloudflare-tmux';
const SITE = 'cloudflare-tmux';

const NAV = [
  { section: 'Getting started', pages: ['index', 'prerequisites', 'quickstart'] },
  { section: 'Cloudflare', pages: ['cloudflare/cloudflare-login', 'cloudflare/api-token', 'cloudflare/what-gets-created'] },
  { section: 'Install', pages: ['install/single-user', 'install/multi-user'] },
  { section: 'Guides', pages: ['configuration', 'usage', 'security', 'two-step', 'operations', 'troubleshooting', 'development'] },
];

// ---------- markdown ----------

const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9 -]/g, '')
  .trim().replace(/\s+/g, '-');
const strip = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

const CALLOUTS = {
  NOTE: { label: 'Note', cls: 'callout-note' },
  TIP: { label: 'Tip', cls: 'callout-tip' },
  IMPORTANT: { label: 'Important', cls: 'callout-important' },
  WARNING: { label: 'Warning', cls: 'callout-warning' },
  CAUTION: { label: 'Caution', cls: 'callout-caution' },
};

function makeMarked(page, toc) {
  const marked = new Marked(markedHighlight({
    emptyLangClass: 'hljs',
    langPrefix: 'hljs language-',
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : 'plaintext';
      return hljs.highlight(code, { language }).value;
    },
  }));
  const used = new Set();
  marked.use({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens);
        let id = slug(text) || 'section';
        for (let n = 2; used.has(id); n++) id = `${slug(text)}-${n}`;
        used.add(id);
        if (depth === 2 || depth === 3) toc.push({ depth, id, text: strip(text) });
        if (depth === 1) return `<h1>${text}</h1>\n`;
        return `<h${depth} id="${id}" class="group scroll-mt-24">${text}` +
          `<a href="#${id}" class="anchor" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        let url = href;
        const external = /^[a-z]+:/i.test(url);
        if (!external && !url.startsWith('#')) url = url.replace(/(^|\/)index\.md(#|$)/, '$1index.html$2').replace(/\.md(#|$)/, '.html$1');
        const attrs = external ? ' target="_blank" rel="noopener"' : '';
        return `<a href="${url}"${title ? ` title="${title}"` : ''}${attrs}>${text}</a>`;
      },
      blockquote({ tokens }) {
        const first = tokens[0];
        const m = first?.type === 'paragraph' && first.raw.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/);
        if (!m) return `<blockquote>${this.parser.parse(tokens)}</blockquote>\n`;
        const c = CALLOUTS[m[1]];
        // Drop the [!TYPE] marker from the first paragraph.
        const para = { ...first, tokens: [...first.tokens] };
        const lead = para.tokens[0];
        if (lead?.type === 'text') para.tokens[0] = { ...lead, text: lead.text.replace(/^\[!\w+\]\s*/, ''), tokens: undefined };
        const rest = [para, ...tokens.slice(1)];
        return `<div class="callout ${c.cls} not-prose"><p class="callout-title">${c.label}</p>` +
          `<div class="callout-body prose prose-slate dark:prose-invert max-w-none">${this.parser.parse(rest)}</div></div>\n`;
      },
      table(token) {
        return `<div class="table-wrap">${Renderer.prototype.table.call(this, token)}</div>`;
      },
    },
  });
  return marked;
}

function readPage(id) {
  const raw = fs.readFileSync(path.join(CONTENT, `${id}.md`), 'utf8');
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const meta = {};
  if (fm) for (const line of fm[1].split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return { id, meta, body: fm ? raw.slice(fm[0].length) : raw };
}

// ---------- layout ----------

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function rel(fromId, toId) {
  const depth = fromId.split('/').length - 1;
  return '../'.repeat(depth) + (toId === 'index' ? 'index.html' : `${toId}.html`);
}

function asset(fromId, file) { return '../'.repeat(fromId.split('/').length - 1) + file; }

const ICONS = {
  github: '<svg viewBox="0 0 16 16" class="h-5 w-5" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" class="h-5 w-5 hidden dark:block" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>',
  moon: '<svg viewBox="0 0 24 24" class="h-5 w-5 dark:hidden" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  menu: '<svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  search: '<svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  logo: '<svg viewBox="0 0 32 32" class="h-7 w-7" aria-hidden="true"><rect width="32" height="32" rx="7" fill="#f6821f"/><path d="M8 11l5 5-5 5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 22h9" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>',
};

function sidebar(currentId, titles) {
  return NAV.map(({ section, pages }) => `
    <div class="mb-6">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">${esc(section)}</p>
      <ul class="space-y-0.5 border-l border-slate-200 dark:border-slate-800">
        ${pages.map((id) => {
          const active = id === currentId;
          return `<li><a href="${rel(currentId, id)}" class="-ml-px block border-l py-1.5 pl-4 text-sm transition ${active
            ? 'border-brand-500 font-medium text-brand-600 dark:text-brand-400'
            : 'border-transparent text-slate-600 hover:border-slate-400 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'}"${active ? ' aria-current="page"' : ''}>${esc(titles[id])}</a></li>`;
        }).join('')}
      </ul>
    </div>`).join('');
}

function hero(id) {
  return `
  <section class="relative overflow-hidden border-b border-slate-200 dark:border-slate-800">
    <div class="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(246,130,31,0.18),transparent_60%)]"></div>
    <div class="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24 lg:flex lg:items-center lg:gap-12">
      <div class="lg:w-1/2">
        <p class="mb-4 inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-3 py-1 text-xs font-medium text-brand-700 dark:text-brand-300">Cloudflare Tunnel · Zero Trust Access · tmux</p>
        <h1 class="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl dark:text-white">Your tmux sessions,<br><span class="bg-gradient-to-r from-brand-500 to-amber-400 bg-clip-text text-transparent">in any browser.</span></h1>
        <p class="mt-6 text-lg leading-8 text-slate-600 dark:text-slate-300">Open a terminal on your server from your phone or laptop. Nothing is exposed to the internet. You sign in with your Cloudflare account, and your programs keep running when you close the tab.</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a href="${rel(id, 'quickstart')}" class="rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-brand-600">Get started in 5 minutes →</a>
          <a href="${REPO}" target="_blank" rel="noopener" class="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800">${ICONS.github} GitHub</a>
        </div>
      </div>
      <div class="mt-12 lg:mt-0 lg:w-1/2">
        <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-2xl shadow-brand-500/10">
          <div class="flex items-center gap-1.5 border-b border-slate-800 px-4 py-3">
            <span class="h-3 w-3 rounded-full bg-red-500/80"></span><span class="h-3 w-3 rounded-full bg-yellow-500/80"></span><span class="h-3 w-3 rounded-full bg-green-500/80"></span>
            <span class="ml-3 text-xs text-slate-500">term.example.com</span>
          </div>
          <pre class="overflow-x-auto p-5 text-[13px] leading-6 text-slate-300"><code><span class="text-slate-500">$</span> git clone ${REPO}
<span class="text-slate-500">$</span> cd cloudflare-tmux
<span class="text-slate-500">$</span> ./install.sh --host term.example.com
<span class="text-green-400">  ✓</span> tunnel   cloudflare-tmux
<span class="text-green-400">  ✓</span> access   Cloudflare login · you@example.com
<span class="text-green-400">  ✓</span> dns      term.example.com → tunnel
<span class="text-green-400">  ✓</span> services running, start on boot
<span class="font-semibold text-brand-400">Done. Open https://term.example.com</span></code></pre>
        </div>
      </div>
    </div>
  </section>`;
}

function layout({ id, meta, html, toc, titles, prev, next }) {
  const title = id === 'index' ? `${SITE} — tmux in your browser via Cloudflare Tunnel + Access` : `${meta.title} · ${SITE}`;
  const editUrl = `${REPO}/edit/main/docs/content/${id}.md`;
  const tocHtml = toc.length ? `
      <p class="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">On this page</p>
      <ul class="space-y-2 text-sm">${toc.map((t) => `<li class="${t.depth === 3 ? 'pl-3' : ''}"><a href="#${t.id}" data-toc="${t.id}" class="block text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200">${esc(t.text)}</a></li>`).join('')}</ul>` : '';
  const pager = `
      <nav class="mt-16 grid gap-4 border-t border-slate-200 pt-8 sm:grid-cols-2 dark:border-slate-800">
        ${prev ? `<a href="${rel(id, prev)}" class="group rounded-lg border border-slate-200 p-4 hover:border-brand-500 dark:border-slate-800"><span class="text-xs text-slate-500">← Previous</span><span class="mt-1 block font-medium text-slate-900 group-hover:text-brand-600 dark:text-slate-100">${esc(titles[prev])}</span></a>` : '<span></span>'}
        ${next ? `<a href="${rel(id, next)}" class="group rounded-lg border border-slate-200 p-4 text-right hover:border-brand-500 dark:border-slate-800"><span class="text-xs text-slate-500">Next →</span><span class="mt-1 block font-medium text-slate-900 group-hover:text-brand-600 dark:text-slate-100">${esc(titles[next])}</span></a>` : ''}
      </nav>`;
  return `<!doctype html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(meta.description || '')}">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(meta.description || '')}">
  <link rel="icon" href="${asset(id, 'assets/favicon.svg')}" type="image/svg+xml">
  <link rel="stylesheet" href="${asset(id, 'assets/site.css')}">
  <script>
    try { const t = localStorage.getItem('theme'); if (t === 'dark' || (!t && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark'); } catch {}
  </script>
</head>
<body class="bg-white text-slate-800 antialiased dark:bg-slate-950 dark:text-slate-200" data-root="${asset(id, '')}">
  <header class="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
    <div class="mx-auto flex h-16 max-w-screen-2xl items-center gap-4 px-4 sm:px-6">
      <button id="menu-btn" class="-ml-1 rounded p-1 text-slate-600 lg:hidden dark:text-slate-300" aria-label="Open navigation">${ICONS.menu}</button>
      <a href="${rel(id, 'index')}" class="flex shrink-0 items-center gap-2 whitespace-nowrap font-semibold text-slate-900 dark:text-white">${ICONS.logo}<span class="hidden min-[400px]:inline">${SITE}</span></a>
      <button id="search-btn" aria-label="Search docs" class="ml-auto flex min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500 hover:border-slate-300 sm:ml-8 sm:w-full sm:max-w-xs dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700">${ICONS.search}<span class="hidden sm:inline">Search docs…</span><kbd class="ml-auto hidden rounded border border-slate-300 px-1.5 text-xs sm:inline dark:border-slate-700">/</kbd></button>
      <div class="flex shrink-0 items-center gap-1 sm:ml-auto">
        <button id="theme-btn" class="rounded p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="Toggle dark mode">${ICONS.sun}${ICONS.moon}</button>
        <a href="${REPO}" target="_blank" rel="noopener" class="rounded p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800" aria-label="GitHub repository">${ICONS.github}</a>
      </div>
    </div>
  </header>
${id === 'index' ? hero(id) : ''}
  <div class="mx-auto flex max-w-screen-2xl px-4 sm:px-6">
    <div id="nav-backdrop" class="fixed inset-0 z-40 hidden bg-slate-900/50 lg:hidden"></div>
    <aside id="sidebar" class="fixed inset-y-0 left-0 z-50 w-72 -translate-x-full overflow-y-auto bg-white px-6 py-8 transition-transform lg:sticky lg:top-16 lg:z-0 lg:h-[calc(100vh-4rem)] lg:w-64 lg:shrink-0 lg:translate-x-0 lg:bg-transparent lg:px-0 lg:pr-8 dark:bg-slate-950 lg:dark:bg-transparent">
      ${sidebar(id, titles)}
    </aside>
    <main class="min-w-0 flex-1 py-10 lg:px-8">
      <article class="prose prose-slate max-w-3xl dark:prose-invert prose-headings:scroll-mt-24 prose-a:text-brand-600 prose-a:no-underline hover:prose-a:underline dark:prose-a:text-brand-400 prose-pre:bg-transparent prose-pre:p-0 prose-code:before:content-none prose-code:after:content-none">
        ${html}
      </article>
      <div class="max-w-3xl">
        <a href="${editUrl}" target="_blank" rel="noopener" class="mt-10 inline-block text-sm text-slate-500 hover:text-brand-600">Edit this page on GitHub</a>
        ${pager}
      </div>
    </main>
    <aside class="hidden w-56 shrink-0 xl:block">
      <div class="sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto py-10">${tocHtml}</div>
    </aside>
  </div>
  <footer class="border-t border-slate-200 py-8 text-center text-sm text-slate-500 dark:border-slate-800">
    MIT licensed · <a href="${REPO}" class="hover:text-brand-600">syan-dev/cloudflare-tmux</a> · Not affiliated with Cloudflare, Inc.
  </footer>

  <div id="search-modal" class="fixed inset-0 z-50 hidden bg-slate-900/60 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Search">
    <div class="mx-auto mt-16 max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-slate-900">
      <input id="search-input" type="search" placeholder="Search the docs…" class="w-full border-0 border-b border-slate-200 bg-transparent px-5 py-4 text-base outline-none dark:border-slate-800" autocomplete="off">
      <ul id="search-results" class="max-h-96 overflow-y-auto p-2"></ul>
    </div>
  </div>
  <script src="${asset(id, 'assets/site.js')}"></script>
</body>
</html>
`;
}

// ---------- build ----------

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });
fs.cpSync(path.join(ROOT, 'public'), DIST, { recursive: true });

const order = NAV.flatMap((s) => s.pages);
const pages = order.map(readPage);
const titles = Object.fromEntries(pages.map((p) => [p.id, p.meta.title || p.id]));
const search = [];

pages.forEach((page, i) => {
  const toc = [];
  const html = makeMarked(page, toc).parse(page.body);
  const out = path.join(DIST, `${page.id}.html`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, layout({ ...page, html, toc, titles, prev: order[i - 1], next: order[i + 1] }));
  search.push({ url: `${page.id}.html`, title: titles[page.id], headings: toc.map((t) => t.text),
    text: strip(html).replace(/\s+/g, ' ').slice(0, 5000) });
});

fs.writeFileSync(path.join(DIST, 'assets', 'search.json'), JSON.stringify(search));
fs.writeFileSync(path.join(DIST, '.nojekyll'), '');
console.log(`built ${pages.length} pages -> ${path.relative(process.cwd(), DIST) || '.'}`);
