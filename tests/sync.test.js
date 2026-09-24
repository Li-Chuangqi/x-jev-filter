import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuleSync } from '../extension/sync.js';
const PREFIX = 'qingliu.rule.';
function area(data) {
  return {
    get: async keys => structuredClone(keys === null ? data : Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]]))),
    set: async patch => { Object.assign(data, structuredClone(patch)); }
  };
}
function rule(id = 'one', name = '营销') { return XJevRules.clean({ recordId: id, name, kind: 'content', keywords: ['推广'], sourceId: 'private-sample' }); }
function device(cloud, id, rules = []) {
  const local = { rules, samples: [{ text: 'PRIVATE SAMPLE' }], usage: { requests: 8 }, config: { allowlist: ['private'] } };
  const storage = { local: area(local), sync: area(cloud) };
  let time = 100;
  const sync = createRuleSync(storage, { now: () => ++time, uuid: () => id });
  return { local, storage, sync };
}
test('opt-in only; merges two devices and never uploads samples, config or source identifiers', async () => {
  const cloud = {}, a = device(cloud, 'a', [rule()]), b = device(cloud, 'b', [rule('two')]);
  await a.sync.run(); assert.deepEqual(cloud, {});
  await a.sync.enable(true); await b.sync.enable(true); await a.sync.run();
  assert.equal(a.local.rules.length, 2); assert.equal(b.local.rules.length, 2);
  assert.equal(a.local.rules.find(r => r.recordId === 'one').sourceId, 'private-sample');
  assert.equal(b.local.rules.find(r => r.recordId === 'one').sourceId, '');
  assert.ok(!JSON.stringify(cloud).includes('private'));
  assert.ok(!JSON.stringify(cloud).includes('PRIVATE SAMPLE'));
  assert.ok(Object.keys(cloud).every(k => k.startsWith(PREFIX)));
});
test('deletion survives stale offline device, new-device bootstrap and worker restart', async () => {
  const cloud = {}, a = device(cloud, 'a', [rule()]), b = device(cloud, 'b');
  await a.sync.enable(true); await b.sync.enable(true);
  a.local.rules = []; await a.sync.run(); await b.sync.run();
  assert.equal(b.local.rules.length, 0); assert.equal(cloud[PREFIX + 'one'].rule, null);
  const c = device(cloud, 'c', [rule()]); await c.sync.enable(true);
  assert.equal(c.local.rules.length, 0, 'old initial copies cannot resurrect deletions');
  await createRuleSync(b.storage).run(); assert.equal(b.local.rules.length, 0);
});
test('concurrent offline changes converge, preserve loser and repair stale cloud writes', async () => {
  const cloud = {}, a = device(cloud, 'a', [rule()]), b = device(cloud, 'b');
  await a.sync.enable(true); await b.sync.enable(true);
  a.local.rules[0].name = '设备 A'; b.local.rules[0].name = '设备 B';
  const original = structuredClone(cloud);
  await a.sync.run(); const aCloud = structuredClone(cloud);
  Object.assign(cloud, original); await b.sync.run();
  const bCloud = structuredClone(cloud);
  Object.assign(cloud, aCloud); await b.sync.run(); await a.sync.run();
  assert.deepEqual(a.local.rules.map(r=>r.name), b.local.rules.map(r=>r.name));
  assert.ok((await a.sync.backups()).length + (await b.sync.backups()).length > 0);
  assert.ok(cloud[PREFIX+'one'].clock >= bCloud[PREFIX+'one'].clock);
});
test('write failures retain journal and local changes; retry uploads; disabling stops writes', async () => {
  const cloud = {}, a = device(cloud, 'a', [rule()]);
  a.storage.sync.set = async () => { throw Error('offline'); };
  assert.match((await a.sync.enable(true)).error, /重试/);
  assert.equal(a.local.rules.length, 1); assert.ok(a.local.ruleSync.entries.one);
  a.storage.sync.set = area(cloud).set; await a.sync.run(); assert.ok(cloud[PREFIX+'one']);
  await a.sync.enable(false); a.local.rules = []; await a.sync.run();
  assert.ok(cloud[PREFIX+'one'].rule);
  await a.sync.enable(true); assert.equal(cloud[PREFIX+'one'].rule, null);
});
test('capacity and malformed remote fail safely without dropping local rules', async () => {
  const cloud = {}, a = device(cloud, 'a', [rule()]);
  cloud[PREFIX+'bad'] = { version: 99 };
  assert.match((await a.sync.enable(true)).error, /格式/); assert.equal(a.local.rules.length, 1);
  delete cloud[PREFIX+'bad'];
  for (let i=0; i<512; i++) cloud['other'+i] = 'x';
  assert.match((await a.sync.run()).error, /容量/); assert.equal(a.local.rules.length, 1);
  for (const k of Object.keys(cloud)) delete cloud[k];
  await a.sync.run(); assert.ok(cloud[PREFIX+'one']);
});
test('a rule exceeding per-item quota stays local with a visible error', async () => {
  const cloud = {}, r = rule(); r.keywords = Array.from({length:100},(_,i)=>`${i}`+'字'.repeat(100));
  const a = device(cloud, 'a', [r]);
  assert.match((await a.sync.enable(true)).error, /容量/);
  assert.equal(a.local.rules.length, 1); assert.deepEqual(cloud, {});
});

test('remote changes retain rule exceptions and enabled state but not sample links', async () => {
  const cloud = {}, a = device(cloud, 'a', [rule()]), b = device(cloud, 'b');
  await a.sync.enable(true); await b.sync.enable(true);
  b.local.rules[0].enabled = false; b.local.rules[0].exceptAuthors = ['safe']; b.local.rules[0].exceptKeywords = ['新闻'];
  await b.sync.run(); await a.sync.run();
  assert.equal(a.local.rules[0].enabled, false);
  assert.deepEqual(a.local.rules[0].exceptAuthors, ['safe']);
  assert.deepEqual(a.local.rules[0].exceptKeywords, ['新闻']);
  assert.equal(a.local.rules[0].sourceId, 'private-sample');
});
