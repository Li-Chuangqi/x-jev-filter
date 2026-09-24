(() => {
  const states = new Map();
  let config = { enabled: false };
  let revision = 0;
  let scheduled;
  let active = 0;
  let stopped = false;
  const restored = new Set();
  const temporaryHidden = new Set();
  const privatePage = () => /^\/(messages|i\/chat)(\/|$)/.test(location.pathname);
  const identity = data => JSON.stringify([data.id, data.author, data.displayName, data.text, data.promoted]);
  const visible = article => { const rect = article.getBoundingClientRect(); return rect.bottom > 0 && rect.top < innerHeight && rect.width > 0; };
  let menu;
  let menuAnchor;
  let toastTimer;
  function closeMenu(focus = false) {
    menu?.remove(); menu = null;
    menuAnchor?.setAttribute('aria-expanded', 'false');
    if (focus && menuAnchor?.isConnected) menuAnchor.focus();
    menuAnchor = null;
  }
  function toast(text, undo) {
    document.getElementById('xjev-toast')?.remove();
    clearTimeout(toastTimer);
    const box = document.createElement('div'); box.id = 'xjev-toast'; box.setAttribute('role', 'status');
    const label = document.createElement('span'); label.textContent = text; box.append(label);
    if (undo) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = '撤销';
      button.onclick = async () => { button.disabled = true; try { await undo(); box.remove(); } catch { button.disabled = false; label.textContent = '撤销失败，请重试或在设置中删除记录'; } };
      box.append(button);
    }
    document.body.append(box);
    toastTimer = setTimeout(() => box.remove(), 15000);
  }
  async function forget(recordId) {
    const result = await chrome.runtime.sendMessage({ type: 'forget-block', recordId });
    if (!result?.ok) throw new Error(result?.error || '撤销失败');
    await reload();
  }
  function installManualButton(article, state, data) {
    if (!config.enabled || privatePage() || !data.id || !data.author || config.allowlist?.includes(data.author)) {
      article.querySelector('.xjev-manual-slot')?.remove(); return;
    }
    const group = [...article.querySelectorAll('[role="group"]')].find(node => node.closest('article') === article && node.querySelector('[data-testid="reply"]'));
    const share = group && [...group.querySelectorAll('button, [role="button"]')].find(node =>
      node.dataset.testid === 'share' || /^(share(?: post)?|分享(?:帖子|推文)?|分享貼文)$/i.test(node.getAttribute('aria-label') || ''));
    const shareSlot = share && [...group.children].find(node => node === share || node.contains(share));
    let button = article.querySelector('.xjev-manual');
    // Wait for X's action bar instead of attaching a floating article-level button.
    if (!shareSlot) { button?.closest('.xjev-manual-slot')?.remove(); return; }
    if (button?.dataset.identity === state.identity) {
      const slot = button.closest('.xjev-manual-slot');
      if (slot.parentElement !== group || slot.nextElementSibling !== shareSlot) group.insertBefore(slot, shareSlot);
      return;
    }
    button?.closest('.xjev-manual-slot')?.remove();
    button = document.createElement('button'); button.type = 'button'; button.className = 'xjev-manual';
    button.dataset.identity = state.identity;
    button.title = '清流：手动屏蔽'; button.setAttribute('aria-label', '清流：手动屏蔽');
    button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-haspopup', 'dialog');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute('d', 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.8 5.2A10 10 0 0 1 12 5c5 0 9 7 9 7a19 19 0 0 1-3.1 3.7M6.1 6.1A19 19 0 0 0 3 12s4 7 9 7a10 10 0 0 0 4.2-1');
    svg.append(path); button.append(svg);
    button.onclick = event => {
      event.preventDefault(); event.stopPropagation();
      if (menuAnchor === button) { closeMenu(true); return; }
      closeMenu();
      if (identity(XJevDOM.extract(article)) !== state.identity || privatePage()) return;
      menuAnchor = button; button.setAttribute('aria-expanded', 'true');
      menu = document.createElement('div'); menu.className = 'xjev-menu';
      menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', '清流屏蔽选项');
      for (const [kind, label] of [['similar', '屏蔽并学习相似内容'], ['author', `屏蔽账号 @${data.author}`]]) {
        const action = document.createElement('button'); action.type = 'button'; action.dataset.kind = kind; action.textContent = label;
        action.disabled = kind === 'similar' && !data.text.trim();
        action.onclick = async event => {
          event.preventDefault(); event.stopPropagation();
          if (!article.isConnected || identity(XJevDOM.extract(article)) !== state.identity || privatePage()) { closeMenu(); return; }
          closeMenu();
          if (kind === 'similar') {
            const key = state.identity;
            restored.delete(key); temporaryHidden.add(key); schedule();
            toast('本条已折叠；规则保存后才应用到后续内容', () => { temporaryHidden.delete(key); restored.add(key); schedule(); });
            XJevRuleEditor.open(XJevRules.draft(data), { source: data, onSave: async rule => {
              const result = await chrome.runtime.sendMessage({ type: 'save-rule', rule, sourceData: data });
              if (!result?.ok) throw new Error(result?.error || '保存失败');
              await reload();
              toast(`已保存规则：${result.record.name}`, async () => { await forget(result.record.recordId); temporaryHidden.delete(key); restored.add(key); schedule(); });
            } });
            return;
          }
          try {
            const result = await chrome.runtime.sendMessage({ type: 'learn-block', kind, data });
            if (!result?.ok) throw new Error(result?.error || '保存失败');
            restored.delete(state.identity);
            await reload();
            toast('已保存账号规则', result.unchanged ? undefined : async () => {
              if (result.previous) {
                const undo = await chrome.runtime.sendMessage({ type: 'save-rule', rule: result.previous });
                if (!undo?.ok) throw new Error('撤销失败');
                await reload();
              } else await forget(result.record.recordId);
              restored.add(state.identity); schedule();
            });
          } catch (error) { toast(error.message || '屏蔽失败，请重试'); }
        };
        menu.append(action);
      }
      document.body.append(menu);
      const rect = button.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(rect.right - 280, innerWidth - 296))}px`;
      menu.style.top = `${Math.max(8, Math.min(rect.bottom + 6, innerHeight - menu.offsetHeight - 8))}px`;
      menu.querySelector('button:not(:disabled)')?.focus();
    };
    const slot = document.createElement('div'); slot.className = 'xjev-manual-slot';
    slot.append(button);
    group.insertBefore(slot, shareSlot);
  }
  document.addEventListener('click', event => { if (menu && !menu.contains(event.target) && !menuAnchor?.contains(event.target)) closeMenu(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && menu) { event.preventDefault(); closeMenu(true); } });
  addEventListener('scroll', () => closeMenu(), { passive: true });

  function unfold(article) {
    article.removeAttribute('data-xjev-folded');
    article.removeAttribute('data-xjev-silent');
    for (const node of article.querySelectorAll(':scope > .xjev-placeholder')) node.remove();
  }
  function fold(article, state, reason, recordId) {
    article.toggleAttribute('data-xjev-silent', config.showPlaceholder === false);
    if (article.getAttribute('data-xjev-folded') === 'true' && state.reason === reason && state.recordId === recordId) return;
    unfold(article);
    article.toggleAttribute('data-xjev-silent', config.showPlaceholder === false);
    state.reason = reason; state.recordId = recordId;
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
    if (recordId) {
      const undo = document.createElement('button'); undo.type = 'button'; undo.textContent = '撤销此规则';
      undo.onclick = async event => { event.preventDefault(); event.stopPropagation(); try { await forget(recordId); restored.add(state.identity); unfold(article); } catch { toast('撤销失败，请在设置中删除记录'); } };
      bar.append(undo);
    }
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
      const result = await chrome.runtime.sendMessage({ type: 'classify', text: data.text, author: data.author,
        ...(config.learningAiEnabled ? { displayName: data.displayName } : {}) });
      if (!article.isConnected || version !== revision || states.get(article) !== state || identity(XJevDOM.extract(article)) !== state.identity) return;
      if (typeof result?.probability === 'number') {
        state.probability = result.probability;
        state.aiProbability = result.aiProbability;
        state.ruleScores = result.ruleScores;
      }
      else state.retryAt = Date.now() + Math.max(5000, result?.retryAfter || 60_000);
    } catch {
      state.retryAt = Date.now() + 60_000;
      if (!chrome.runtime?.id) { stopped = true; for (const a of states.keys()) unfold(a); }
    } finally { state.pending = false; active--; schedule(); }
  }
  function scan() {
    if (menu && (!config.enabled || privatePage() || !menuAnchor?.isConnected)) closeMenu();
    for (const article of states.keys()) if (!article.isConnected) states.delete(article);
    for (const article of document.querySelectorAll('article[data-testid="tweet"]')) {
      const data = XJevDOM.extract(article);
      const key = identity(data);
      let state = states.get(article);
      if (!state || state.identity !== key) {
        if (menuAnchor && article.contains(menuAnchor)) closeMenu();
        unfold(article);
        state = { identity: key, pending: false, retryAt: 0 };
        states.set(article, state);
      }
      installManualButton(article, state, data);
      if (!config.enabled || privatePage() || restored.has(key) || config.allowlist?.includes(data.author)) { unfold(article); continue; }
      const rules = config.rules || [];
      const local = rules.find(rule => XJevRules.match(rule, data, config.allowlist));
      if (local) { fold(article, state, local.name, local.recordId); continue; }
      if (temporaryHidden.has(key)) { fold(article, state, '本次手动屏蔽'); continue; }
      // System ads are a separate category: disabling it must not send them through AI.
      if (data.promoted) {
        if (config.platformAds) fold(article, state, '平台广告');
        else unfold(article);
        continue;
      }
      const learningActive = config.learningAiEnabled && rules.some(rule => rule.kind === 'semantic' && XJevRules.eligible(rule, data, config.allowlist));
      const semantic = config.aiEnabled && learningActive && state.ruleScores?.find(score => score.probability >= Math.max(0.98, config.threshold) && rules.some(rule => rule.recordId === score.recordId && XJevRules.eligible(rule, data, config.allowlist)));
      if (semantic) { const rule = rules.find(rule => rule.recordId === semantic.recordId); fold(article, state, rule.name, rule.recordId); continue; }
      if (config.aiEnabled && config.aiContent && state.aiProbability >= config.threshold) { fold(article, state, `疑似 AI 创作 · ${Math.round(state.aiProbability * 100)}%`); continue; }
      if (config.aiEnabled && config.categories?.length !== 0 && state.probability >= config.threshold) { fold(article, state, `疑似营销 · ${Math.round(state.probability * 100)}%`); continue; }
      unfold(article);
      if (!config.aiEnabled || (config.categories?.length === 0 && !config.aiContent && !learningActive) || !data.text || state.probability !== undefined || state.pending || Date.now() < state.retryAt || active >= 2 || !visible(article) || document.hidden) continue;
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
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.config || changes.rules || changes.samples)) void reload(); });
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['href', 'data-testid'] });
  addEventListener('scroll', schedule, { passive: true });
  addEventListener('popstate', schedule);
  document.addEventListener('visibilitychange', schedule);
  setInterval(schedule, 5000);
  void reload();
})();
