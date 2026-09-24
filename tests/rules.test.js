import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/learning.js';
import '../extension/rules.js';
const R = globalThis.XJevRules;
const data = { id: '123', author: 'seller', displayName: '返佣推广', text: '输入邀请码领取优惠 https://example.com/signup' };
const base = { name: '推广规则', kind: 'content', keywords: ['邀请码'], domains: ['example.com'] };

test('explicit conditions honor AND/OR, scopes, exact domains and exceptions', () => {
  const all = R.clean(base);
  assert.equal(R.match(all, data), true);
  assert.equal(R.match(all, { ...data, text: '邀请码 https://other.example/' }), false);
  assert.equal(R.match(R.clean({ ...base, mode: 'any' }), { ...data, text: '邀请码' }), true);
  assert.equal(R.match(all, { ...data, text: '邀请码 https://example.com.evil/' }), false);
  assert.equal(R.match(R.clean({ ...base, domains: [], keywords: ['返佣'], scope: 'name' }), data), true);
  assert.equal(R.match(R.clean({ ...base, domains: [], keywords: ['返佣'], scope: 'text' }), data), false);
  assert.equal(R.match(R.clean({ ...base, exceptKeywords: ['优惠'] }), data), false);
  assert.equal(R.match(R.clean({ ...base, exceptAuthors: ['@seller'] }), data), false);
  assert.equal(R.match(all, data, ['seller']), false);
  assert.equal(R.match(R.clean({ ...base, enabled: false }), data), false);
});
test('invalid or overly broad rules reject atomically on import', () => {
  assert.throws(() => R.clean({ kind: 'content', name: '空条件' }));
  assert.throws(() => R.clean({ ...base, domains: ['example.com/path'] }));
  assert.throws(() => R.clean({ name: '无描述', kind: 'semantic' }));
  assert.equal(R.clean({ ...base, kind: 'author', author: 'seller', domains: ['invalid/path'] }).domains.length, 0);
  assert.throws(() => R.clean({ name: '短评论', kind: 'content', match: 'similar', pattern: '卖打火机的' }));
  const document = { format: 'x-jev-rules', version: 1, rules: [{ ...base, recordId: 'old', sourceId: 'old', enabled: true }] };
  const [rule] = R.parseImport(document);
  assert.equal(rule.enabled, false);
  assert.equal(rule.recordId, ''); assert.equal(rule.sourceId, '');
  assert.throws(() => R.parseImport({ ...document, rules: [...document.rules, { name: 'invalid' }] }));
});
test('source sample eviction and dedup cannot remove persistent rules', () => {
  const rule = R.clean({ name: '屏蔽账号', kind: 'author', author: '@seller' });
  let samples = [];
  const first = R.addSample(samples, data); samples = first.samples;
  const repeated = R.addSample(samples, data);
  assert.equal(repeated.samples.length, 1); assert.equal(repeated.sample.recordId, first.sample.recordId);
  for (let i = 0; i < 110; i++) samples = R.addSample(samples, { ...data, id: String(1000 + i), text: `new sample ${i}` }).samples;
  assert.equal(samples.length, 100);
  assert.equal(R.match(rule, data), true);
});
test('legacy account, post and learned entries migrate into explicit editable rules', () => {
  const records = [
    { recordId: 'a', kind: 'author', author: 'seller', postId: '1', text: '' },
    { recordId: 'b', kind: 'post', author: 'other', postId: '2', text: 'hi' },
    { recordId: 'c', kind: 'similar', author: 'other', postId: '3', text: 'Get our premium courses today with special discounts!', displayName: 'Promo' }
  ];
  const migrated = R.migrate(records, { learningAiEnabled: true });
  assert.equal(migrated.rules.length, 5);
  assert.equal(migrated.samples.length, 2);
  assert.ok(migrated.rules.some(r => r.kind === 'semantic'));
  assert.ok(migrated.rules.some(r => R.match(r, { id: '2', author: 'other', text: 'changed' })));
  const disabled = R.migrate(records, { learningEnabled: false, learningAiEnabled: true });
  assert.equal(disabled.rules.find(r => r.match === 'similar').enabled, false);
  assert.equal(disabled.rules.some(r => r.kind === 'semantic'), false);
});
test('semantic context only includes eligible rules, strips IDs from examples and caps references', () => {
  const rules = Array.from({ length: 8 }, (_, i) => R.clean({ kind: 'semantic', name: `rule${i}`, description: '返佣推广', recordId: `r${i}`, sourceId: `s${i}` }));
  const samples = rules.map((r, i) => ({ ...data, recordId: `s${i}` }));
  const context = R.semanticContext(data, rules, samples, []);
  assert.equal(context.rules.length, 8, 'all eligible rules must be evaluated');
  assert.equal(context.rules.filter(r => r.example).length, 5);
  assert.equal(context.rules[0].example.author, undefined);
  assert.equal(R.semanticContext(data, rules, samples, ['seller']), null);
  const except = R.clean({ ...rules[0], exceptKeywords: ['优惠'] });
  assert.equal(R.semanticContext(data, [except], samples, []), null);
});
