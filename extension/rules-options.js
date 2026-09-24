import './learning.js';
import './rules.js';
import './rule-editor.js';
const $ = id => document.getElementById(id);
const names = { author: '账号规则', content: '内容规则', semantic: '语义规则' };
let current = { rules: [], samples: [] };
const say = message => { $('rulesStatus').textContent = message; };
async function send(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || '操作失败，请重试');
  return result;
}
function edit(rule) {
  XJevRuleEditor.open(rule, {
    source: current.samples.find(s => s.recordId === rule.sourceId),
    onSave: async value => { await send({ type: 'save-rule', rule: value }); await load(); say('规则已保存，打开的 X 页面会自动应用。'); }
  });
}
function describe(rule) {
  if (rule.kind === 'author') return `@${rule.author}`;
  if (rule.kind === 'semantic') return rule.description;
  if (rule.match === 'post') return `原帖编号：${rule.postId}`;
  if (rule.match === 'similar') return `高度相似模板：${rule.pattern}`;
  return `${{ text: '正文', name: '昵称', both: '正文与昵称' }[rule.scope]} · ${rule.mode === 'all' ? '满足全部' : '满足任一'}：${[...rule.keywords, ...rule.domains].join('、')}`;
}
function render() {
  const list = $('rulesList'); list.replaceChildren();
  const query = $('ruleSearch').value.trim().toLowerCase();
  const rules = current.rules.filter(r => `${r.name} ${names[r.kind]} ${describe(r)}`.toLowerCase().includes(query));
  const count = document.createElement('p'); count.className = 'hint'; count.textContent = `共 ${current.rules.length} 条规则 · ${current.rules.filter(r => r.enabled).length} 条启用`; list.append(count);
  if (!rules.length) { const empty = document.createElement('p'); empty.textContent = query ? '没有匹配的规则。' : '还没有规则。可新建规则，或在 X 中选择“屏蔽并学习相似内容”。'; list.append(empty); }
  for (const rule of rules) {
    const card = document.createElement('article'); card.className = 'rule-card';
    const heading = document.createElement('h3'); heading.textContent = rule.name;
    const label = document.createElement('label'); label.className = 'rule-enable';
    const toggle = document.createElement('input'); toggle.type = 'checkbox'; toggle.checked = rule.enabled; toggle.setAttribute('role', 'switch'); toggle.setAttribute('aria-label', `启用规则：${rule.name}`);
    label.append(toggle, document.createTextNode(rule.enabled ? '已启用' : '已停用'));
    toggle.onchange = async () => {
      toggle.disabled = true;
      try { await send({ type: 'save-rule', rule: { ...rule, enabled: toggle.checked } }); await load(); say('规则状态已更新。'); }
      catch (error) { toggle.checked = rule.enabled; toggle.disabled = false; say(error.message); }
    };
    const header = document.createElement('div'); header.className = 'rule-heading'; header.append(heading, label);
    const type = document.createElement('small'); type.textContent = `${names[rule.kind]}${rule.kind === 'semantic' && (!current.aiEnabled || !current.learningAiEnabled) ? ' · 等待开启连接 Jev 与语义规则开关' : ''}`;
    const description = document.createElement('p'); description.className = 'rule-description'; description.textContent = describe(rule);
    const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = '例外与来源'; details.append(summary);
    const exceptions = document.createElement('p'); exceptions.textContent = `例外关键词：${rule.exceptKeywords.join('、') || '无'}\n例外账号：${rule.exceptAuthors.join('、') || '无'}${rule.kind === 'semantic' ? `\n语义例外：${rule.exceptions || '无'}` : ''}`;
    const source = current.samples.find(s => s.recordId === rule.sourceId);
    const sourceText = document.createElement('p'); sourceText.textContent = source ? `来源：${source.displayName} @${source.author}\n${source.text}` : rule.sourceId ? '来源样本已删除或淘汰，规则仍保留。' : '手动创建或导入的规则，无独立来源样本。';
    details.append(exceptions, sourceText);
    const actions = document.createElement('div'); actions.className = 'actions';
    const editButton = document.createElement('button'); editButton.type = 'button'; editButton.textContent = '编辑'; editButton.onclick = () => edit(rule);
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除';
    remove.onclick = async () => {
      if (!confirm(`删除规则“${rule.name}”？`)) return;
      try { await send({ type: 'forget-block', recordId: rule.recordId }); await load(); say('规则已删除。'); } catch (error) { say(error.message); }
    };
    actions.append(editButton, remove); card.append(header, type, description, details, actions); list.append(card);
  }
  $('exportRules').disabled = current.rules.length === 0;
  const samples = $('samplesList'); samples.replaceChildren();
  const info = document.createElement('p'); info.textContent = `${current.samples.length} / 100 条来源样本`; samples.append(info);
  $('clearSamples').disabled = current.samples.length === 0;
  for (const sample of current.samples) {
    const details = document.createElement('details'); details.className = 'learned-record';
    const summary = document.createElement('summary'); summary.textContent = `${sample.displayName} @${sample.author}`;
    const text = document.createElement('p'); text.textContent = sample.text;
    const features = XJevLearning.features(sample); const feature = document.createElement('small'); feature.textContent = `提取线索：${features.cues.join('、') || '无'}；域名：${features.domains.join('、') || '无'}`;
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除样本'; remove.onclick = async () => { try { await send({ type: 'delete-sample', recordId: sample.recordId }); await load(); } catch (error) { say(error.message); } };
    details.append(summary, text, feature, remove); samples.append(details);
  }
}
async function load() {
  const cfg = await chrome.runtime.sendMessage({ type: 'config' });
  if (!Array.isArray(cfg?.rules)) throw new Error('规则读取失败，请重新加载扩展后再打开设置');
  current = cfg; render();
}
$('ruleSearch').oninput = render;
$('addRule').onclick = () => edit({ kind: 'content', name: '', enabled: true, scope: 'text', match: 'conditions', mode: 'all' });
$('clearSamples').onclick = async () => {
  if (!confirm('清空独立来源样本？保存的规则、模板和语义描述不会删除。')) return;
  try { await send({ type: 'clear-samples' }); await load(); say('来源样本已清空，规则仍保留。'); } catch (error) { say(error.message); }
};
$('exportRules').onclick = () => {
  const data = { format: 'x-jev-rules', version: 1, rules: current.rules.map(({ recordId, sourceId, ...r }) => r) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'x-jev-rules.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('importRules').onclick = () => $('rulesFile').click();
$('rulesFile').onchange = async () => {
  const file = $('rulesFile').files[0]; if (!file) return;
  try {
    if (file.size > 2_000_000) throw new Error('规则文件超过 2 MB，请拆分后导入');
    const document = JSON.parse(await file.text()); const incoming = XJevRules.parseImport(document);
    if (!incoming.length) throw new Error('文件中没有规则');
    if (!confirm(`将新增 ${incoming.length} 条规则，全部保持停用，现有规则不变。\n${incoming.slice(0, 5).map(r => r.name).join('\n')}\n继续导入？`)) return;
    await send({ type: 'import-rules', document }); await load(); say(`已导入 ${incoming.length} 条停用规则，请检查后启用。`);
  } catch (error) { say(error instanceof SyntaxError ? 'JSON 格式不正确，未导入任何规则。' : error.message); }
  finally { $('rulesFile').value = ''; }
};
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && (changes.rules || changes.samples || changes.config)) load().catch(error => say(error.message)); });
await load().catch(error => say(error.message));
