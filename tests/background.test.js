import test from 'node:test';
import assert from 'node:assert/strict';

const local = {};
const session = {};
const area = data => ({
  get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])),
  set: async patch => Object.assign(data, structuredClone(patch)),
  setAccessLevel: async () => {}
});
let listener;
globalThis.chrome = {
  storage: { local: area(local), session: area(session) },
  action: { onClicked: { addListener() {} } },
  runtime: { id: 'extension', getURL: file => `chrome-extension://extension/${file}`, onMessage: { addListener: fn => { listener = fn; } } }
};
await import('../extension/background.js');
const sender = { id: 'extension', tab: { id: 1 }, frameId: 0, url: 'https://x.com/home' };
const send = (m, origin = sender) => new Promise(resolve => {
  const async = listener(m, origin, resolve);
  if (!async) resolve(undefined);
});
let requests = 0;
let responseStatus = 200;
let lastRequest;
let responseBody = { answers: { advertising: { type: 'noul', noul: 0.99 } }, usage: { input_tokens: 100 } };
globalThis.fetch = async (url, options) => {
  requests++;
  lastRequest = JSON.parse(options.body);
  assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.headers.Authorization, 'Bearer fake-test-key');
  return new Response(JSON.stringify(responseBody), { status: responseStatus });
};

test('background integration with mocked Chrome and HTTP', async t => {
  await t.test('rejects foreign origins and DM requests', async () => {
    assert.equal(await send({ type: 'classify', text: 'x' }, { ...sender, url: 'https://evil.example/' }), undefined);
    assert.equal(await send({ type: 'classify', text: 'x' }, { ...sender, url: 'https://x.com/messages/1' }), undefined);
    assert.equal(requests, 0);
  });
  await t.test('AI off and missing key do not make external requests', async () => {
    await send({ type: 'classify', text: 'one' });
    local.config = { aiEnabled: true };
    assert.match((await send({ type: 'classify', text: 'one' })).error, /密钥/);
    assert.equal(requests, 0);
  });
  await t.test('concurrent identical posts deduplicate and consume one request', async () => {
    session.apiKey = 'fake-test-key';
    const results = await Promise.all([send({ type: 'classify', text: 'same' }), send({ type: 'classify', text: 'same' })]);
    assert.equal(results[0].probability, 0.99);
    assert.equal(results[1].cached, true);
    assert.equal(requests, 1);
    assert.equal(local.usage.requests, 1);
    assert.equal(local.usage.inputTokens, 100);
    assert.ok(!JSON.stringify(session.decisions).includes('same'));
    assert.ok(!JSON.stringify(local).includes('fake-test-key'));
  });
  await t.test('allowlist is enforced in background before API', async () => {
    local.config.allowlist = ['safe'];
    assert.equal((await send({ type: 'classify', text: 'new', author: 'safe' })).skipped, true);
    assert.equal(requests, 1);
  });
  await t.test('budget enforced before API across tabs', async () => {
    local.config.dailyLimit = 1;
    assert.match((await send({ type: 'classify', text: 'new' }, { ...sender, tab: { id: 2 } })).error, /上限/);
    assert.equal(requests, 1);
    local.config.dailyLimit = 100;
  });
  await t.test('invalid model output fails open and sets cooldown', async () => {
    responseBody = { answers: { advertising: { type: 'noul', noul: 'yes' } } };
    const result = await send({ type: 'classify', text: 'invalid' });
    assert.equal(result.probability, undefined);
    assert.match(result.error, /格式/);
    await send({ type: 'classify', text: 'cooldown' });
    assert.equal(requests, 2);
  });
  await t.test('429 backs off instead of starting request storm', async () => {
    session.backoffUntil = 0; responseStatus = 429;
    const result = await send({ type: 'classify', text: 'limited' });
    assert.match(result.error, /429/);
    await send({ type: 'classify', text: 'next' });
    assert.equal(requests, 3);
    assert.equal(local.usage.requests, 3);
  });
  await t.test('empty categories skip API; changed categories invalidate cached decision', async () => {
    session.backoffUntil = 0;
    local.config.categories = [];
    const before = requests;
    assert.equal((await send({ type: 'classify', text: 'same' })).skipped, true);
    assert.equal(requests, before);
    local.config.categories = ['gambling'];
    responseStatus = 200;
    responseBody = { answers: { advertising: { type: 'noul', noul: 0.01 } } };
    assert.equal((await send({ type: 'classify', text: 'same' })).probability, 0.01);
    assert.equal(requests, before + 1);
    assert.ok(lastRequest.questions.advertising.criteria.true.includes('gambling'));
    assert.ok(!lastRequest.questions.advertising.criteria.true.includes('subscriptions'));
  });
  await t.test('AI authorship works without ad categories and caches both scores', async () => {
    local.config.categories = [];
    local.config.aiContent = true;
    responseBody = { answers: { advertising: { type: 'noul', noul: 0.01 }, ai_created: { type: 'noul', noul: 0.99 } } };
    const before = requests;
    const result = await send({ type: 'classify', text: 'AI sample' });
    assert.equal(result.aiProbability, 0.99);
    assert.equal(result.probability, 0.01);
    assert.ok(lastRequest.questions.ai_created);
    const cached = await send({ type: 'classify', text: 'AI sample' });
    assert.equal(cached.cached, true);
    assert.equal(cached.aiProbability, 0.99);
    assert.equal(requests, before + 1);
    local.config.aiContent = false;
    assert.equal((await send({ type: 'classify', text: 'AI sample' })).skipped, true);
    assert.equal(requests, before + 1);
  });
});

test('explicit rules storage and remote consent', async () => {
  local.config = { aiEnabled: true, categories: ['products'], learningAiEnabled: false };
  session.backoffUntil = 0; responseStatus = 200;
  responseBody = { answers: { advertising: { type: 'noul', noul: 0.01 }, rule_0: { type: 'noul', noul: 0.99 } } };
  const data = { id: '1001', author: 'seller', text: 'Get our premium courses today with special discounts!', displayName: 'Promo' };
  const [first, second] = await Promise.all([
    send({ type: 'save-rule', rule: { kind: 'semantic', name: '课程营销', description: '推广付费课程' }, sourceData: data }),
    send({ type: 'learn-block', kind: 'author', data: { ...data, id: '1002' } })
  ]);
  assert.ok(first.ok && second.ok);
  assert.equal(local.rules.length, 2);
  assert.equal(local.samples.length, 1);
  assert.equal(await send({ type: 'clear-samples' }), undefined);
  await send({ type: 'classify', text: 'consent off' });
  assert.equal(lastRequest.state.rules, undefined);
  local.config.learningAiEnabled = true;
  const classified = await send({ type: 'classify', text: 'consent on', displayName: 'Promo two' });
  assert.equal(classified.ruleScores[0].probability, 0.99);
  assert.equal(classified.ruleScores[0].recordId, first.record.recordId);
  assert.equal(lastRequest.state.rules.length, 1);
  assert.equal(lastRequest.state.rules[0].recordId, undefined);
  assert.equal(lastRequest.state.rules[0].example.author, undefined);
  assert.ok(lastRequest.questions.rule_0);
  const before = requests;
  await send({ type: 'save-rule', rule: { ...first.record, description: '更具体的课程营销模式' } });
  await send({ type: 'classify', text: 'consent on', displayName: 'Promo two' });
  assert.equal(requests, before + 1, 'edited descriptions invalidate prior cache');
  await send({ type: 'forget-block', recordId: first.record.recordId });
  assert.equal(local.rules.length, 1);
  await send({ type: 'classify', text: 'consent on' });
  assert.equal(lastRequest.state.rules, undefined);
  const options = { id: 'extension', url: 'chrome-extension://extension/options.html' };
  assert.ok((await send({ type: 'clear-samples' }, options)).ok);
  assert.equal(local.samples.length, 0);
  assert.equal(local.rules.length, 1, 'clearing samples cannot remove rules');
});

test('optional daily cap stops new requests only when enabled; unlimited still counts and rate-limits', async () => {
  local.config = { aiEnabled: true, dailyLimit: 1, dailyLimitEnabled: true };
  session.backoffUntil = 0;
  responseStatus = 200;
  responseBody = { answers: { advertising: { type: 'noul', noul: 0.01 } }, usage: { input_tokens: 12 } };
  const before = requests;
  const counted = local.usage.requests;
  assert.ok(counted >= 1);
  assert.match((await send({ type: 'classify', text: 'daily cap enabled' })).error, /今日请求上限/);
  assert.equal(requests, before);
  local.config.dailyLimitEnabled = false;
  assert.equal((await send({ type: 'classify', text: 'daily cap disabled' })).probability, 0.01);
  assert.equal(requests, before + 1);
  assert.equal(local.usage.requests, counted + 1);
  await send({ type: 'classify', text: 'daily cap disabled' });
  assert.equal(local.usage.requests, counted + 1, 'cache hits still do not count');
  session.recent = Array(120).fill(Date.now());
  assert.match((await send({ type: 'classify', text: 'minute cap still applies' })).error, /每分钟/);
  assert.equal(requests, before + 1);
  session.recent = [];
  local.config.dailyLimitEnabled = true;
  assert.match((await send({ type: 'classify', text: 'daily cap restored' })).error, /今日请求上限/);
  assert.equal(local.config.dailyLimit, 1);
});

test('saved rules survive beyond 100; import is atomic, inactive and isolated from samples', async () => {
  const options = { id: 'extension', url: 'chrome-extension://extension/options.html' };
  const firstId = local.rules[0].recordId;
  for (let i = 0; i < 105; i++) {
    const saved = await send({ type: 'save-rule', rule: { kind: 'author', name: `账号 ${i}`, author: `account${i}` } }, options);
    assert.ok(saved.ok);
  }
  assert.equal(local.rules.length, 106);
  assert.ok(local.rules.some(r => r.recordId === firstId));
  const document = { format: 'x-jev-rules', version: 1, rules: [{ kind: 'content', name: '<script>alert(1)</script>', keywords: ['promo'], enabled: true }] };
  assert.equal(await send({ type: 'import-rules', document }), undefined, 'X pages cannot import');
  const count = local.rules.length;
  const invalid = await send({ type: 'import-rules', document: { ...document, rules: [...document.rules, { name: 'invalid' }] } }, options);
  assert.ok(invalid.error);
  assert.equal(local.rules.length, count);
  assert.ok((await send({ type: 'import-rules', document }, options)).ok);
  assert.equal(local.rules[0].enabled, false);
  assert.equal(local.rules.length, count + 1);
  assert.equal(local.samples.length, 0);
});

test('sync controls are restricted to options, not X content scripts', async () => {
  assert.equal(await send({ type: 'sync-enable', enabled: true }), undefined);
  assert.equal(await send({ type: 'sync-backups' }), undefined);
  for (const type of ['key-sync-status', 'key-sync-enable', 'key-sync-save', 'key-sync-disable', 'key-sync-forget']) assert.equal(await send({ type, password: 'not-a-secret', apiKey: 'fake' }), undefined);
  const optionsSender = { id: 'extension', url: 'chrome-extension://extension/options.html' };
  assert.equal((await send({ type: 'sync-status' }, optionsSender)).status.enabled, false);
  assert.equal((await send({ type: 'sync-enable', enabled: false }, optionsSender)).ok, true);
  assert.ok((await send({ type: 'sync-enable', enabled: 'true' }, optionsSender)).error);
});
