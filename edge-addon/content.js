// Prime Only: greys out Prime Video tiles that aren't included in what you
// already pay for (Prime, plus any channel you subscribe to, such as
// Shudder). The tiles themselves don't say, so each title's own page is read
// once in the background: it says "Entitled" when you can watch it. Answers
// are cached for two days, so a channel that ends drops out within two days.
(() => {
  const TTL = 2 * 86_400_000;
  const PARALLEL = 3;
  const MODES = ['dim', 'hide', 'off'];
  const LABEL = { dim: 'Prime only: dim', hide: 'Prime only: hide', off: 'Prime only: off' };

  // chrome.storage when running as the add-on; localStorage when the file is
  // pasted into a page to test it.
  const ext = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const load = (key) =>
    ext
      ? new Promise((r) => chrome.storage.local.get(key, (v) => r(v[key])))
      : Promise.resolve(JSON.parse(localStorage.getItem(key) || 'null'));
  const save = (key, value) =>
    ext ? chrome.storage.local.set({ [key]: value }) : localStorage.setItem(key, JSON.stringify(value));

  let cache = {}; // id -> [status, checkedAt]; status is ok | paid | gone | unknown
  let mode = 'dim';
  let saveTimer = 0;
  const queue = [];
  let running = 0;
  const waiting = new Map(); // id -> articles waiting on that id

  const titleId = (href) => {
    const m = href && href.match(/\/detail\/([^/?#]+)(?:\/([A-Z0-9]{10,}))?/);
    return m ? m[2] || m[1] : null;
  };

  function remember(id, status) {
    cache[id] = [status, Date.now()];
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => save('pvo-cache', cache), 1000);
  }

  function mark(article, status) {
    if (status === 'ok' || status === 'paid' || status === 'gone') article.dataset.pvo = status;
    count();
  }

  // Reads the title page only until its own entitlement icon appears (about
  // the first 150 KB of ~550 KB), then stops the download.
  async function check(id) {
    const res = await fetch(`/detail/${id}/`, { credentials: 'include' });
    if (!res.ok || !res.body) return 'unknown';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let html = '';
    try {
      while (html.length < 800_000) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        // The icon's name is the <title> of its SVG: "Entitled", or a store bag.
        const icon = html.match(/data-testid="entitlement-icon"[\s\S]{0,600}?<title>([^<]+)<\/title>/);
        if (icon) return icon[1].trim() === 'Entitled' ? 'ok' : 'paid';
        if (html.includes('No longer available in your region')) return 'gone';
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return 'unknown';
  }

  function pump() {
    while (running < PARALLEL && queue.length) {
      const id = queue.shift();
      running++;
      check(id)
        .catch(() => 'unknown')
        .then((status) => {
          remember(id, status);
          for (const a of waiting.get(id) || []) mark(a, status);
          waiting.delete(id);
        })
        .finally(() => {
          running--;
          setTimeout(pump, 150);
        });
    }
  }

  const seen = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        seen.unobserve(e.target);
        const id = e.target.dataset.pvoId;
        if (!waiting.has(id)) {
          waiting.set(id, []);
          queue.push(id);
        }
        waiting.get(id).push(e.target);
      }
      pump();
    },
    { rootMargin: '600px' }
  );

  function scan() {
    for (const a of document.querySelectorAll('article:not([data-pvo-id])')) {
      const id = titleId(a.querySelector('a[href*="/detail/"]')?.getAttribute('href'));
      if (!id) continue;
      a.dataset.pvoId = id;
      // Hero cards carry their own entitlement icon.
      const own = a.querySelector('[data-testid="entitlement-icon"]');
      if (own) {
        const name = (own.querySelector('title')?.textContent || own.textContent).trim();
        const status = name === 'Entitled' ? 'ok' : 'paid';
        remember(id, status);
        mark(a, status);
        continue;
      }
      const hit = cache[id];
      if (hit && Date.now() - hit[1] < TTL && hit[0] !== 'unknown') mark(a, hit[0]);
      else seen.observe(a);
    }
  }

  let button;
  function count() {
    if (!button) return;
    const n = document.querySelectorAll('article[data-pvo="paid"], article[data-pvo="gone"]').length;
    button.textContent = `${LABEL[mode]}${mode === 'off' ? '' : ` (${n} paid)`}`;
  }

  function setMode(m) {
    mode = m;
    document.documentElement.dataset.pvoMode = m;
    save('pvo-mode', m);
    count();
  }

  async function start() {
    cache = (await load('pvo-cache')) || {};
    const now = Date.now();
    for (const [id, [, at]] of Object.entries(cache)) if (now - at > TTL) delete cache[id];
    setMode((await load('pvo-mode')) || 'dim');

    button = document.createElement('button');
    button.id = 'pvo-toggle';
    button.title = 'Prime Only: click to switch between dim, hide and off';
    button.addEventListener('click', () => setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length]));
    document.body.appendChild(button);
    count();

    scan();
    let pending = 0;
    new MutationObserver(() => {
      if (pending) return;
      pending = setTimeout(() => {
        pending = 0;
        scan();
      }, 300);
    }).observe(document.body, { childList: true, subtree: true });
  }

  start();
})();
