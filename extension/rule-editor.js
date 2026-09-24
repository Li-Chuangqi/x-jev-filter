(() => {
  function open(draft, { source, onSave, onCancel = () => {} } = {}) {
    const existing = document.querySelector('.xjev-rule-editor');
    if (existing) { existing.focus(); return existing; }
    const previousFocus = document.activeElement;
    const dialog = document.createElement('dialog'); dialog.className = 'xjev-rule-editor';
    dialog.setAttribute('aria-label', draft.recordId ? '编辑屏蔽规则' : '预览屏蔽规则');
    const form = document.createElement('form'); dialog.append(form);
    const title = document.createElement('h2'); title.textContent = draft.recordId ? '编辑规则' : '保存屏蔽规则'; form.append(title);
    const hint = document.createElement('p'); hint.textContent = '确认屏蔽条件，保存后用于后续信息流。'; form.append(hint);
    const fields = {};
    function field(key, labelText, options = {}) {
      const label = document.createElement('label'); label.className = 'xjev-rule-field';
      const text = document.createElement('span'); text.textContent = labelText; label.append(text);
      const input = document.createElement(options.choices ? 'select' : options.multiline ? 'textarea' : 'input');
      input.name = key;
      if (options.choices) for (const [value, name] of options.choices) {
        const option = document.createElement('option'); option.value = value; option.textContent = name; input.append(option);
      }
      else if (options.checkbox) input.type = 'checkbox';
      else if (!options.multiline) input.type = 'text';
      if (options.multiline) input.rows = 2;
      if (options.max) input.maxLength = options.max;
      if (options.required) input.required = true;
      if (options.checkbox) input.checked = draft[key] !== false;
      else input.value = Array.isArray(draft[key]) ? draft[key].join('\n') : draft[key] || options.fallback || '';
      label.append(input);
      if (options.help) { const help = document.createElement('small'); help.textContent = options.help; label.append(help); }
      form.append(label); fields[key] = { input, label }; return input;
    }
    field('name', '规则名称', { required: true, max: 100 });
    field('kind', '规则类型', { choices: [['content', '内容规则 · 本地匹配'], ['semantic', '语义规则 · Jev 判断'], ['author', '账号规则 · 本地匹配']] });
    field('enabled', '启用此规则', { checkbox: true });
    field('author', '屏蔽账号', { help: '填写 @用户名，不是昵称。', max: 16 });
    field('scope', '匹配范围', { fallback: 'text', choices: [['text', '正文与引用文字'], ['name', '昵称'], ['both', '正文与昵称']] });
    field('match', '匹配方式', { fallback: 'conditions', choices: [['conditions', '关键词与域名'], ['similar', '高度相似的文字模板'], ...(draft.match === 'post' ? [['post', '指定原帖 · 旧规则']] : [])] });
    field('mode', '条件关系', { fallback: 'all', choices: [['all', '满足全部条件（且）'], ['any', '满足任一条件（或）']] });
    field('keywords', '屏蔽这些关键词', { multiline: true, help: '每行一个。请填写具体词语，避免误屏蔽。' });
    field('domains', '链接域名 · 每行一个', { multiline: true, help: '例如 example.com。精确匹配正文中可见的 HTTP(S) 链接域名，不自动包含子域名或展开短链接。' });
    field('pattern', '文字模板', { multiline: true, max: 1200, help: '至少 20 字符；仅匹配长度接近且文字高度相似的内容。' });
    field('postId', '原帖编号', { max: 30 });
    field('description', '要屏蔽的具体内容模式', { multiline: true, max: 2000, help: '例如：推广交易平台返佣，并引导注册或私信。需开启 Jev 与语义规则开关。' });
    field('exceptions', '语义例外 · 哪些内容应保留', { multiline: true, max: 1000, help: '例如：保留批评、新闻报道和正常讨论。' });
    field('exceptKeywords', '排除关键词 · 每行一个', { multiline: true, help: '正文或昵称包含任一项时，这条规则不生效。其他规则仍可独立匹配。' });
    field('exceptAuthors', '例外账号 · 每行一个', { multiline: true, help: '这条规则跳过这些账号；全局白名单优先于所有规则。' });
    const primary = document.createElement('div'); primary.className = 'xjev-rule-primary'; form.append(primary);
    const overview = document.createElement('p'); overview.className = 'xjev-rule-overview'; form.append(overview);
    const advanced = document.createElement('details'); advanced.className = 'xjev-rule-advanced';
    const advancedTitle = document.createElement('summary'); advancedTitle.textContent = '高级设置'; advanced.append(advancedTitle); form.append(advanced);
    for (const key of ['name', 'author', 'keywords', 'pattern', 'postId', 'description']) primary.append(fields[key].label);
    for (const key of ['kind', 'enabled', 'scope', 'match', 'mode', 'domains', 'exceptions', 'exceptKeywords', 'exceptAuthors']) advanced.append(fields[key].label);
    // Existing domain conditions must stay visible in the preview.
    if (fields.domains.input.value.trim()) primary.append(fields.domains.label);
    function summarize() {
      const kind = fields.kind.input.value, match = fields.match.input.value;
      const parts = [fields.enabled.input.checked ? '保存后启用' : '已停用'];
      if (kind === 'author') parts.push('按账号屏蔽');
      else {
        parts.push(kind === 'semantic' ? 'Jev 语义判断' : '本地匹配', fields.scope.input.selectedOptions[0].textContent);
        if (kind === 'content' && match === 'conditions') {
          parts.push(fields.mode.input.value === 'any' ? '任一条件命中' : '需满足全部条件');
          const domains = XJevRules.words(fields.domains.input.value);
          if (domains.length) parts.push(`域名：${domains.join('、')}`);
        }
      }
      const exceptCount = XJevRules.words(fields.exceptKeywords.input.value).length + XJevRules.words(fields.exceptAuthors.input.value).length;
      if (exceptCount || (kind === 'semantic' && fields.exceptions.input.value.trim())) parts.push('含例外条件');
      overview.textContent = parts.join(' · ');
    }
    form.addEventListener('input', summarize);
    form.addEventListener('change', summarize);
    form.addEventListener('invalid', event => { if (advanced.contains(event.target)) advanced.open = true; }, true);
    function update() {
      const kind = fields.kind.input.value, match = fields.match.input.value;
      const show = {
        author: kind === 'author', scope: kind !== 'author', match: kind === 'content',
        mode: kind === 'content' && match === 'conditions', keywords: kind === 'content' && match === 'conditions', domains: kind === 'content' && match === 'conditions',
        pattern: kind === 'content' && match === 'similar', postId: kind === 'content' && match === 'post',
        description: kind === 'semantic', exceptions: kind === 'semantic'
      };
      for (const [key, visible] of Object.entries(show)) { fields[key].label.hidden = !visible; fields[key].input.disabled = !visible; }
      summarize();
    }
    fields.kind.input.onchange = update; fields.match.input.onchange = update; update();
    if (source) {
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '来源样本';
      const text = document.createElement('p'); text.textContent = `${source.displayName || ''} @${source.author || ''}\n${source.text || ''}`;
      const features = XJevLearning.features(source); const detail = document.createElement('small');
      detail.textContent = `提取线索：${features.cues.join('、') || '无'}；域名：${features.domains.join('、') || '无'}`;
      const privacy = document.createElement('small'); privacy.textContent = '保存规则时在本机保留此样本。';
      details.append(summary, text, detail, privacy); advanced.append(details);
    } else if (draft.sourceId) { const note = document.createElement('p'); note.textContent = '来源样本已删除或淘汰；保存的规则仍然有效。'; advanced.append(note); }
    const status = document.createElement('p'); status.setAttribute('role', 'status'); form.append(status);
    const actions = document.createElement('div'); actions.className = 'xjev-rule-actions';
    const save = document.createElement('button'); save.type = 'submit'; save.textContent = '保存规则';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = '取消'; actions.append(save, cancel); form.append(actions);
    const close = () => { dialog.close(); dialog.remove(); if (previousFocus?.isConnected) previousFocus.focus(); };
    cancel.onclick = () => { close(); onCancel(); };
    dialog.addEventListener('cancel', event => { event.preventDefault(); if (!save.disabled) { close(); onCancel(); } });
    let saving = false;
    dialog.addEventListener('click', event => event.stopPropagation());
    form.onsubmit = async event => {
      event.preventDefault(); event.stopPropagation();
      if (saving) return;
      try {
        const raw = { ...draft };
        for (const [key, { input }] of Object.entries(fields)) raw[key] = input.type === 'checkbox' ? input.checked : input.value;
        const rule = XJevRules.clean(raw);
        saving = true; save.disabled = true; cancel.disabled = true;
        await onSave(rule); close();
      } catch (error) {
        saving = false;
        if (/例外|域名|每组条件|每项最多|账号格式/.test(error.message)) advanced.open = true;
        status.textContent = error.message || '保存失败，请重试'; save.disabled = false; cancel.disabled = false; }
    };
    document.body.append(dialog); dialog.showModal(); fields.name.input.focus(); return dialog;
  }
  globalThis.XJevRuleEditor = { open };
})();
