import test from 'node:test';
import assert from 'node:assert/strict';
import '../extension/learning.js';
const L = globalThis.XJevLearning;
const data = { id: '123', author: 'seller', displayName: '手续费返佣', text: '限时优惠，购买我们的专业课程即可获得完整服务与教程，请私信了解详情。' };
test('local extraction returns cues without creating a rule', () => {
  const sample = L.prepare(data, 'similar');
  assert.ok(sample.features.cues.includes('返佣'));
  assert.ok(L.similarity(data.text, data.text) === 1);
  assert.ok(L.similarity(data.text, '完全不同的正常讨论') < 0.94);
  assert.equal(sample.enabled, undefined);
});
test('sample validation and clipping keep source storage bounded', () => {
  assert.throws(() => L.prepare({ ...data, id: 'invalid' }, 'post'));
  assert.throws(() => L.prepare({ ...data, text: '' }, 'similar'));
  assert.equal(L.prepare({ ...data, text: 'x'.repeat(2000) }, 'similar').text.length, 1200);
  assert.deepEqual(L.features({ text: 'https://example.com/a https://example.com/b' }).domains, ['example.com']);
});
