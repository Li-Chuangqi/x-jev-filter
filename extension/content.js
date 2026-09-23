(() => {
  const states = new Map();
  let config = { enabled: false };
  let revision = 0;
  let scheduled;
  let active = 0;
  let stopped = false;
  const restored = new Set();
  const privatePage = () => /^\/(messages|i\/chat)(\/|$)/.test(location.pathname);
  const identity = data => JSON.stringify([data.id, data.author, data.text, data.promoted]);
  const visible = article => { const rect = article.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight && rect.width > 0; };

  function unfold(article) {
    article.removeAttribute('data-xjev-folded');
    article.removeAttribute('data-xjev-silent');
    for (const node of article.querySelectorAll(':scope > .xjev-placeholder')) node.remove();
  }
  function fold(article, state, reason) {
    article.toggleAttribute('data-xjev-silent', config.showPlaceholder === false);
    if (article.getAttribute('data-xjev-folded') === 'true') return;
    const bar = document.createElement('div');
    bar.className = 'xjev-placeholder';
    const label = document.createElement('span');
    label.textContent = `清流已折叠 · ${reason}`;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '显示原文';
    button.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      restored.add(state.identity);
      if (restored.size > 1000) restored.delete(restored.values().next().value);
      unfold(article);
    });
    bar.append(label, button);
    article.prepend(bar);
    article.setAttribute('data-xjev-folded', 'true');
  }
  function schedule() {
    if (stopped || scheduled) return;
    scheduled = setTimeout(() => { scheduled = null; scan(); }, 200);
  }
  async function classify(article, state, data) {
    state.pending = true; active++;
    const version = revision;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'classify', text: data.text, author: data.author });
      if (!article.isConnected || version !== revision || states.get(article) !== state || identity(XJevDOM.extract(article)) !== state.identity) return;
      if (typeof result?.probability === 'number') {
        state.probability = result.probability;
        state.aiProbability = result.aiProbability;
      }
      else state.retryAt = Date.now() + Math.max(5000, result?.retryAfter || 60_000);
    } catch {
      state.retryAt = Date.now() + 60_000;
      if (!chrome.runtime?.id) { stopped = true; for (const a of states.keys()) unfold(a); }
    } finally { state.pending = false; active--; schedule(); }
  }
  function scan() {
    for (const article of states.keys()) if (!article.isConnected) states.delete(article);
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const data = XJevDOM.extract(article);
      const key = identity(data);
      let state = states.get(article);
      if (!state || state.identity !== key) {
        unfold(article);
        state = { identity: key, pending: false, retryAt: 0 };
        states.set(article, state);
      }
      if (!config.enabled || privatePage() || restored.has(key) || config.allowlist?.includes(data.author)) { unfold(article); continue; }
      // System ads are a separate category: disabling it must not send them through AI.
      if (data.promoted) {
        if (config.platformAds) fold(article, state, '平台广告');
        else unfold(article);
        continue;
      }
      if (config.aiEnabled && config.aiContent && state.aiProbability >= config.threshold) { fold(article, state, `疑似 AI 创作 · ${Math.round(state.aiProbability * 100)}%`); continue; }
      if (config.aiEnabled && config.categories?.length !== 0 && state.probability >= config.threshold) { fold(article, state, `疑似营销 · ${Math.round(state.probability * 100)}%`); continue; }
      unfold(article);
      if (!config.aiEnabled || (config.categories?.length === 0 && !config.aiContent) || !data.text || state.probability !== undefined || state.pending || Date.now() < state.retryAt || active >= 2 || !visible(article) || document.hidden) continue;
      void classify(article, state, data);
    }
  }
  async function reload() {
    try {
      const next = await chrome.runtime.sendMessage({ type: 'config' });
      // Presentation changes must retain decisions, including posts currently hidden.
      const { showPlaceholder: previousDisplay, ...previousRules } = config;
      const { showPlaceholder: nextDisplay, ...nextRules } = next;
      if (JSON.stringify(previousRules) !== JSON.stringify(nextRules)) { revision++; states.clear(); }
      config = next;
      schedule();
    }
    catch { for (const article of states.keys()) unfold(article); }
  }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.config) void reload(); });
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-testid'] });
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('popstate', schedule);
  document.addEventListener('visibilitychange', schedule);
  setInterval(schedule, 5000);
  void reload();
})();
