'use strict';
// Docs site behavior: theme toggle, mobile nav, copy buttons, TOC highlight, search.
(() => {
  const $ = (id) => document.getElementById(id);
  const root = document.body.dataset.root || '';

  // Theme
  $('theme-btn').addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    try { localStorage.setItem('theme', dark ? 'dark' : 'light'); } catch { /* storage unavailable */ }
  });

  // Mobile nav
  const sidebar = $('sidebar');
  const backdrop = $('nav-backdrop');
  const setNav = (open) => {
    sidebar.classList.toggle('-translate-x-full', !open);
    backdrop.classList.toggle('hidden', !open);
  };
  $('menu-btn').addEventListener('click', () => setNav(true));
  backdrop.addEventListener('click', () => setNav(false));

  // Copy buttons on code blocks
  for (const pre of document.querySelectorAll('.prose pre')) {
    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.type = 'button';
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(pre.querySelector('code').innerText);
        btn.textContent = 'Copied';
      } catch { btn.textContent = 'Failed'; }
      setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
    });
    pre.append(btn);
  }

  // Highlight the current section in "On this page"
  const links = new Map([...document.querySelectorAll('[data-toc]')].map((a) => [a.dataset.toc, a]));
  if (links.size && 'IntersectionObserver' in window) {
    const visible = new Set();
    const obs = new IntersectionObserver((entries) => {
      for (const e of entries) (e.isIntersecting ? visible.add(e.target.id) : visible.delete(e.target.id));
      const first = [...links.keys()].find((id) => visible.has(id));
      if (!first) return;
      for (const [id, a] of links) a.classList.toggle('toc-active', id === first);
    }, { rootMargin: '-64px 0px -60% 0px' });
    for (const id of links.keys()) { const h = $(id); if (h) obs.observe(h); }
  }

  // Search
  const modal = $('search-modal');
  const input = $('search-input');
  const results = $('search-results');
  let index = null;
  let selected = 0;

  const openSearch = async () => {
    modal.classList.remove('hidden');
    input.focus();
    if (!index) {
      try { index = await (await fetch(root + 'assets/search.json')).json(); } catch { index = []; }
      render();
    }
  };
  const closeSearch = () => { modal.classList.add('hidden'); input.value = ''; results.replaceChildren(); };

  function snippet(text, q) {
    const i = text.toLowerCase().indexOf(q);
    if (i < 0) return text.slice(0, 120) + '…';
    const start = Math.max(0, i - 50);
    return (start ? '…' : '') + text.slice(start, i + 90) + '…';
  }

  function render() {
    const q = input.value.trim().toLowerCase();
    results.replaceChildren();
    if (!q || !index) return;
    const terms = q.split(/\s+/);
    const hits = index.map((p) => {
      let score = 0;
      for (const t of terms) {
        if (p.title.toLowerCase().includes(t)) score += 10;
        if (p.headings.some((h) => h.toLowerCase().includes(t))) score += 5;
        if (p.text.toLowerCase().includes(t)) score += 1; else return null;
      }
      return { p, score };
    }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
    if (!hits.length) {
      const li = document.createElement('li');
      li.className = 'px-3 py-6 text-center text-sm text-slate-500';
      li.textContent = 'No results';
      results.append(li);
      return;
    }
    selected = 0;
    hits.forEach(({ p }, i) => {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = root + p.url;
      a.className = 'block rounded-lg px-3 py-2 hover:bg-slate-100 dark:hover:bg-slate-800' + (i === 0 ? ' bg-slate-100 dark:bg-slate-800' : '');
      const t = document.createElement('div');
      t.className = 'text-sm font-medium text-slate-900 dark:text-slate-100';
      t.textContent = p.title;
      const s = document.createElement('div');
      s.className = 'mt-0.5 line-clamp-2 text-xs text-slate-500';
      s.textContent = snippet(p.text, terms[0]);
      a.append(t, s);
      li.append(a);
      results.append(li);
    });
  }

  function move(delta) {
    const items = [...results.querySelectorAll('a')];
    if (!items.length) return;
    items[selected].classList.remove('bg-slate-100', 'dark:bg-slate-800');
    selected = (selected + delta + items.length) % items.length;
    items[selected].classList.add('bg-slate-100', 'dark:bg-slate-800');
    items[selected].scrollIntoView({ block: 'nearest' });
  }

  $('search-btn').addEventListener('click', openSearch);
  input.addEventListener('input', render);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeSearch(); });
  document.addEventListener('keydown', (e) => {
    const open = !modal.classList.contains('hidden');
    if (!open && (e.key === '/' || (e.key === 'k' && (e.metaKey || e.ctrlKey))) && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
      e.preventDefault(); openSearch();
    } else if (open && e.key === 'Escape') closeSearch();
    else if (open && e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (open && e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (open && e.key === 'Enter') { const a = results.querySelectorAll('a')[selected]; if (a) location.href = a.href; }
  });
})();
