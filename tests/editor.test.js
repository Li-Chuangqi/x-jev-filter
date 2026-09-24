import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
function setup() {
  const page = new JSDOM('<button id="launch">launch</button>', { runScripts: 'outside-only' });
  const w = page.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  for (const file of ['learning.js', 'rules.js', 'rule-editor.js']) w.eval(readFileSync(new URL(`../extension/${file}`, import.meta.url), 'utf8'));
  return page;
}
test('rule preview validates short drafts and saves only an explicit edited condition', async () => {
  const page = setup(), w = page.window;
  const source = { text: '卖打火机的', author: 'seller', displayName: 'Example', id: '123' };
  let saved;
  try {
    const dialog = w.XJevRuleEditor.open(w.XJevRules.draft(source), { source, onSave: async rule => { saved = rule; } });
    assert.equal(saved, undefined);
    assert.equal(dialog.querySelector('.xjev-rule-advanced').open, false);
    assert.ok(dialog.querySelector('[name=keywords]').closest('.xjev-rule-primary'));
    assert.ok(dialog.querySelector('[name=exceptKeywords]').closest('.xjev-rule-advanced'));
    const form = dialog.querySelector('form');
    form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    assert.match(dialog.querySelector('[role=status]').textContent, /至少填写/);
    form.elements.keywords.value = '打火机';
    form.elements.exceptKeywords.value = '评测';
    form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
    assert.equal(saved.keywords[0], '打火机');
    assert.equal(saved.exceptKeywords[0], '评测');
    assert.equal(dialog.isConnected, false);
  } finally { w.close(); }
});
test('canceling preview never writes a rule; semantic fields remain editable', () => {
  const page = setup(), w = page.window;
  let saved = false, canceled = false;
  try {
    const dialog = w.XJevRuleEditor.open({ kind: 'semantic', name: '规则', description: '推广课程', exceptions: '保留讨论' }, { onSave: () => { saved = true; }, onCancel: () => { canceled = true; } });
    assert.equal(dialog.querySelector('[name=description]').disabled, false);
    assert.equal(dialog.querySelector('[name=keywords]').disabled, true);
    dialog.querySelector('button[type=button]').click();
    assert.equal(saved, false); assert.equal(canceled, true); assert.equal(dialog.isConnected, false);
  } finally { w.close(); }
});

test('rule manager renders untrusted names as text and supports toggle, edit and delete', async () => {
  const page = new JSDOM(readFileSync(new URL('../extension/options.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' });
  const w = page.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  for (const file of ['learning.js', 'rules.js', 'rule-editor.js']) w.eval(readFileSync(new URL(`../extension/${file}`, import.meta.url), 'utf8'));
  const cfg = { rules: [w.XJevRules.clean({ recordId: 'one', kind: 'author', name: '<img src=x onerror=alert(1)>', author: 'seller' })], samples: [] };
  w.confirm = () => true;
  w.chrome = { runtime: { sendMessage: async m => {
    if (m.type === 'config') return cfg;
    if (m.type === 'save-rule') cfg.rules = [w.XJevRules.clean(m.rule)];
    if (m.type === 'forget-block') cfg.rules = [];
    return { ok: true };
  } }, storage: { onChanged: { addListener() {} } } };
  const code = readFileSync(new URL('../extension/rules-options.js', import.meta.url), 'utf8').replace(/^import .*\n/gm, '');
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await w.eval(`(async () => { ${code}\n })()`);
    assert.equal(w.document.querySelector('#rulesList img'), null);
    assert.match(w.document.querySelector('.rule-heading h3').textContent, /<img/);
    const toggle = w.document.querySelector('.rule-enable input'); toggle.checked = false; toggle.dispatchEvent(new w.Event('change'));
    await flush(); assert.equal(cfg.rules[0].enabled, false);
    w.document.querySelector('.rule-card button').click();
    const form = w.document.querySelector('.xjev-rule-editor form'); form.elements.name.value = '已编辑规则';
    form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    await flush(); assert.equal(cfg.rules[0].name, '已编辑规则');
    w.document.querySelectorAll('.rule-card button')[1].click(); await flush();
    assert.equal(cfg.rules.length, 0);
    assert.match(w.document.getElementById('rulesList').textContent, /还没有规则/);
  } finally { w.close(); }
});

test('editor prevents stacked dialogs and duplicate saves while a save is pending', async () => {
  const page = setup(), w = page.window;
  let count = 0, finish;
  try {
    const draft = { kind: 'author', name: '账号规则', author: 'seller' };
    const dialog = w.XJevRuleEditor.open(draft, { onSave: () => { count++; return new Promise(resolve => { finish = resolve; }); } });
    assert.equal(w.XJevRuleEditor.open(draft), dialog);
    assert.equal(w.document.querySelectorAll('dialog').length, 1);
    const form = dialog.querySelector('form');
    form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    form.dispatchEvent(new w.Event('submit', { cancelable: true }));
    assert.equal(count, 1);
    finish(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(w.document.querySelector('dialog'), null);
  } finally { w.close(); }
});
