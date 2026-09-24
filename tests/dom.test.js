import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const learningCode = readFileSync(new URL('../extension/learning.js', import.meta.url), 'utf8');
const rulesCode = readFileSync(new URL('../extension/rules.js', import.meta.url), 'utf8');
const editorCode = readFileSync(new URL('../extension/rule-editor.js', import.meta.url), 'utf8');
const domCode = readFileSync(new URL('../extension/dom.js', import.meta.url), 'utf8');
const contentCode = readFileSync(new URL('../extension/content.js', import.meta.url), 'utf8');
const post = (id, text, extra = '') => `<article data-testid="tweet"><div><div data-testid="User-Name">Name @author</div><a href="/author/status/${id}"><time>now</time></a><div data-testid="tweetText">${text}</div>${extra}</div></article>`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test('AI authorship folds non-advertising text, restores when disabled and requires Jev master switch', async () => {
  const page = new JSDOM(post('101', 'AI generated example'), { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = page.window;
  let cfg = { enabled: true, platformAds: false, aiEnabled: true, aiContent: true, categories: [], threshold: 0.95, allowlist: [] };
  let changed;
  let calls = 0;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 200, width: 500 });
  w.chrome = { runtime: { id: 'test', sendMessage: async m => {
    if (m.type === 'config') return cfg;
    calls++; return { probability: 0.01, aiProbability: 0.99 };
  } }, storage: { onChanged: { addListener: fn => { changed = fn; } } } };
  w.eval(learningCode); w.eval(rulesCode); w.eval(editorCode); w.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; w.HTMLDialogElement.prototype.close = function () { this.open = false; }; w.eval(domCode); w.eval(contentCode);
  try {
    await sleep(650);
    const article = w.document.querySelector('article');
    assert.equal(article.getAttribute('data-xjev-folded'), 'true');
    assert.match(article.querySelector('.xjev-placeholder').textContent, /疑似 AI 创作/);
    cfg = { ...cfg, aiContent: false }; changed({ config: {} }, 'local');
    await sleep(300);
    assert.equal(article.hasAttribute('data-xjev-folded'), false);
    assert.equal(calls, 1);
    cfg = { ...cfg, aiContent: true, aiEnabled: false }; changed({ config: {} }, 'local');
    await sleep(300);
    assert.equal(article.hasAttribute('data-xjev-folded'), false);
    assert.equal(calls, 1);
  } finally { w.close(); }
});

test('system ads category is independent of AI, toggles restore and re-fold the post', async () => {
  const page = new JSDOM(post('100', 'SALE', '<span data-testid="promotedIndicator"></span>'), { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = page.window;
  let cfg = { enabled: true, platformAds: false, aiEnabled: true, threshold: 0.95, categories: ['products'], allowlist: [] };
  let changed;
  let calls = 0;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 200, width: 500 });
  w.chrome = { runtime: { id: 'test', sendMessage: async m => {
    if (m.type === 'config') return cfg;
    calls++; return { probability: 1 };
  } }, storage: { onChanged: { addListener: fn => { changed = fn; } } } };
  w.eval(learningCode); w.eval(rulesCode); w.eval(editorCode); w.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; w.HTMLDialogElement.prototype.close = function () { this.open = false; }; w.eval(domCode); w.eval(contentCode);
  try {
    const article = w.document.querySelector('article');
    await sleep(300);
    assert.equal(article.hasAttribute('data-xjev-folded'), false);
    assert.equal(calls, 0);
    cfg = { ...cfg, platformAds: true }; changed({ config: {} }, 'local');
    await sleep(300);
    assert.equal(article.getAttribute('data-xjev-folded'), 'true');
    cfg = { ...cfg, platformAds: false }; changed({ config: {} }, 'local');
    await sleep(300);
    assert.equal(article.hasAttribute('data-xjev-folded'), false);
    assert.equal(calls, 0);
    article.querySelector('[data-testid="promotedIndicator"]').remove();
    cfg = { ...cfg, categories: [] }; changed({ config: {} }, 'local');
    await sleep(300);
    assert.equal(calls, 0);
  } finally { w.close(); }
});

test('extracts correct post identity, does not mistake normal Ad text for platform ads', () => {
  const page = new JSDOM(post('123', 'Ad 广告 Promoted are words in a discussion.'), { runScripts: 'outside-only' });
  page.window.eval(domCode);
  const article = page.window.document.querySelector('article');
  const result = page.window.XJevDOM.extract(article);
  assert.equal(result.id, '123'); assert.equal(result.author, 'author'); assert.equal(result.promoted, false);
  article.querySelector('[data-testid="User-Name"]').textContent = 'Display name @trusted @author';
  assert.equal(page.window.XJevDOM.extract(article).author, 'author');
  article.setAttribute('data-testid', 'tweet');
  const wrapper = page.window.document.createElement('div'); wrapper.dataset.testid = 'placementTracking';
  article.before(wrapper); wrapper.append(article);
  assert.equal(page.window.XJevDOM.extract(article).promoted, true);
  page.window.close();
});

test('content lifecycle: fold, restore, recycle node, disable, whitelist and private route', async () => {
  const css = readFileSync(new URL('../extension/content.css', import.meta.url), 'utf8');
  const page = new JSDOM(`<style>${css}</style>` + post('123', 'SALE') + post('456', 'ordinary conversation') + post('999', 'platform ad', '<span data-testid="promotedIndicator"></span>'), {
    url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = page.window;
  let cfg = { enabled: true, platformAds: true, aiEnabled: true, threshold: 0.95, allowlist: [] };
  let changed;
  let calls = 0;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 200, width: 500 });
  w.chrome = {
    runtime: { id: 'test', sendMessage: async m => {
      if (m.type === 'config') return cfg;
      calls++;
      return { probability: m.text === 'SALE' ? 0.99 : 0.1 };
    } },
    storage: { onChanged: { addListener: fn => { changed = fn; } } }
  };
  w.eval(learningCode); w.eval(rulesCode); w.eval(editorCode); w.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; w.HTMLDialogElement.prototype.close = function () { this.open = false; }; w.eval(domCode); w.eval(contentCode);
  try {
    await sleep(650);
    const articles = w.document.querySelectorAll('article');
    assert.equal(articles[0].getAttribute('data-xjev-folded'), 'true');
    assert.equal(articles[1].hasAttribute('data-xjev-folded'), false);
    assert.equal(articles[2].getAttribute('data-xjev-folded'), 'true');
    const beforeToggle = calls;
    cfg = { ...cfg, showPlaceholder: false }; changed({ config: {} }, 'local');
    await sleep(300);
    for (const index of [0, 2]) assert.equal(w.getComputedStyle(articles[index]).display, 'none');
    assert.notEqual(w.getComputedStyle(articles[1]).display, 'none');
    cfg = { ...cfg, showPlaceholder: true }; changed({ config: {} }, 'local');
    await sleep(300);
    for (const index of [0, 2]) {
      assert.notEqual(w.getComputedStyle(articles[index]).display, 'none');
      assert.equal(articles[index].getAttribute('data-xjev-folded'), 'true');
    }
    assert.equal(calls, beforeToggle, 'display setting must not trigger new classifications');
    articles[0].querySelector('button').click();
    await sleep(300);
    assert.equal(articles[0].hasAttribute('data-xjev-folded'), false);
    const before = calls;
    articles[0].querySelector('[data-testid="tweetText"]').textContent = 'a recycled ordinary post';
    articles[0].querySelector('a').href = '/author/status/789';
    await sleep(650);
    assert.equal(articles[0].hasAttribute('data-xjev-folded'), false);
    assert.equal(calls, before + 1);
    articles[1].querySelector('[data-testid="tweetText"]').textContent = 'SALE';
    await sleep(650);
    assert.equal(articles[1].getAttribute('data-xjev-folded'), 'true');
    cfg = { ...cfg, showPlaceholder: false }; changed({ config: {} }, 'local');
    await sleep(300);
    assert.equal(w.getComputedStyle(articles[1]).display, 'none');
    cfg = { ...cfg, enabled: false }; changed({ config: {} }, 'local');
    await sleep(300);
    assert.equal(w.document.querySelectorAll('[data-xjev-folded]').length, 0);
    assert.equal(w.document.querySelectorAll('[data-xjev-silent]').length, 0);
    cfg = { ...cfg, enabled: true, allowlist: ['author'] }; changed({ config: {} }, 'local');
    const whitelistedCalls = calls;
    await sleep(300);
    assert.equal(calls, whitelistedCalls);
    assert.equal(w.document.querySelectorAll('[data-xjev-folded]').length, 0);
    cfg = { ...cfg, allowlist: [] };
    w.history.pushState({}, '', '/messages/123'); changed({ config: {} }, 'local');
    await sleep(300);
    assert.equal(calls, whitelistedCalls);
  } finally { w.close(); }
});

test('late result cannot fold a recycled post; API errors leave content visible', async () => {
  const page = new JSDOM(post('123', 'SALE'), { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = page.window;
  let finish;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 200, width: 500 });
  w.chrome = { runtime: { id: 'test', sendMessage: async m => m.type === 'config'
    ? { enabled: true, aiEnabled: true, threshold: 0.95, allowlist: [] }
    : m.text === 'SALE' ? new Promise(resolve => { finish = resolve; }) : { error: 'timeout' }
  }, storage: { onChanged: { addListener() {} } } };
  w.eval(learningCode); w.eval(rulesCode); w.eval(editorCode); w.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; w.HTMLDialogElement.prototype.close = function () { this.open = false; }; w.eval(domCode); w.eval(contentCode);
  try {
    await sleep(300);
    w.document.querySelector('[data-testid="tweetText"]').textContent = 'ordinary';
    finish({ probability: 1 });
    await sleep(650);
    assert.equal(w.document.querySelectorAll('[data-xjev-folded]').length, 0);
  } finally { w.close(); }
});

test('manual action placement, learning, future matching, undo and stale menu protection', async () => {
  const actions = '<div role="group"><span><button data-testid="reply">reply</button></span><span><button data-testid="bookmark">bookmark</button></span><span><button aria-label="Share post">share</button></span></div>';
  const text = '限时优惠，购买我们的专业课程即可获得完整服务与教程，请私信了解详情。';
  const page = new JSDOM(post('321', text, actions), { url: 'https://x.com/example/status/1', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = page.window;
  let cfg = { enabled: true, aiEnabled: false, learningEnabled: true, allowlist: [], rules: [], samples: [] };
  let writes = 0;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 200, right: 400, width: 500 });
  w.chrome = { runtime: { id: 'test', sendMessage: async m => {
    if (m.type === 'config') return cfg;
    if (m.type === 'save-rule') {
      writes++;
      const record = { ...w.XJevRules.clean(m.rule), recordId: String(writes) };
      cfg = { ...cfg, rules: [...cfg.rules, record] };
      return { ok: true, record };
    }
    if (m.type === 'forget-block') { cfg = { ...cfg, rules: cfg.rules.filter(s => s.recordId !== m.recordId) }; return { ok: true }; }
    throw Error('No external classification while AI is off');
  } }, storage: { onChanged: { addListener() {} } } };
  w.eval(learningCode); w.eval(rulesCode); w.eval(editorCode); w.HTMLDialogElement.prototype.showModal = function () { this.open = true; }; w.HTMLDialogElement.prototype.close = function () { this.open = false; }; w.eval(domCode); w.eval(contentCode);
  try {
    await sleep(300);
    const article = w.document.querySelector('article');
    const manual = article.querySelector('.xjev-manual');
    assert.ok(manual.parentElement.nextElementSibling.querySelector('[aria-label="Share post"]'));
    manual.click();
    w.document.querySelector('[data-kind="similar"]').click();
    assert.equal(writes, 0, 'draft does not apply to future posts before save');
    w.document.querySelector('.xjev-rule-editor form').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await sleep(300);
    assert.equal(article.getAttribute('data-xjev-folded'), 'true');
    w.document.body.insertAdjacentHTML('beforeend', post('322', text, actions));
    await sleep(300);
    assert.equal(w.document.querySelectorAll('[data-xjev-folded]').length, 2);
    w.document.querySelector('#xjev-toast button').click();
    await sleep(300);
    assert.equal(w.document.querySelectorAll('[data-xjev-folded]').length, 0);
    article.querySelector('.xjev-manual').click();
    const staleAction = w.document.querySelector('[data-kind="author"]');
    article.querySelector('[data-testid="tweetText"]').textContent = 'Recycled comment';
    staleAction.click();
    assert.equal(writes, 1);
    // X may rebuild its detail action bar without changing the post identity.
    article.querySelector('[role="group"]').outerHTML = actions.replace('Share post', '分享帖子');
    await sleep(300);
    assert.equal(article.querySelectorAll('.xjev-manual').length, 1);
    assert.ok(article.querySelector('.xjev-manual-slot').nextElementSibling.querySelector('[aria-label="分享帖子"]'));
    article.querySelector('[role="group"]').remove();
    await sleep(300);
    assert.equal(article.querySelectorAll('.xjev-manual').length, 0, 'no floating fallback while action bar is missing');
  } finally { w.close(); }
});

test('semantic folding identifies the matched rule and restores when the rule is disabled', async () => {
  const page = new JSDOM(post('888', '推广课程'), { url: 'https://x.com/home', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = page.window;
  w.eval(learningCode); w.eval(rulesCode);
  const rule = w.XJevRules.clean({ recordId: 'specific', kind: 'semantic', name: '付费课程引流', description: '推广付费课程' });
  let cfg = { enabled: true, aiEnabled: true, learningAiEnabled: true, categories: [], threshold: 0.95, allowlist: [], rules: [rule] }, changed;
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ top: 20, bottom: 200, width: 500 });
  w.chrome = { runtime: { id: 'test', sendMessage: async m => m.type === 'config' ? cfg : { probability: 0.01, ruleScores: [{ recordId: 'specific', probability: 0.99 }] } }, storage: { onChanged: { addListener: fn => { changed = fn; } } } };
  w.eval(domCode); w.eval(contentCode);
  try {
    await sleep(650);
    assert.match(w.document.querySelector('.xjev-placeholder').textContent, /付费课程引流/);
    cfg = { ...cfg, rules: [{ ...rule, enabled: false }] }; changed({ rules: {} }, 'local');
    await sleep(300);
    assert.equal(w.document.querySelector('article').hasAttribute('data-xjev-folded'), false);
  } finally { w.close(); }
});
