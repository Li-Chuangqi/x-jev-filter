import './learning.js';
import './rules.js';

const PREFIX = 'qingliu.rule.';
const STATE = 'ruleSync';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const newer = (a, b) => !b || a.clock > b.clock || (a.clock === b.clock && a.device > b.device);
const bytes = value => new TextEncoder().encode(value).length;
function portable(raw) {
  const rule = XJevRules.clean(raw);
  if (!rule.recordId || ['__proto__', 'constructor', 'prototype'].includes(rule.recordId)) throw new Error('云端规则编号无效。');
  rule.sourceId = ''; // Source samples and their local identifiers never leave this device.
  return rule;
}
function valid(key, raw) {
  if (!raw || raw.version !== 1 || !Number.isSafeInteger(raw.clock) || raw.clock < 1 || !/^[\w-]{1,100}$/.test(raw.device || '')) throw new Error('云端规则格式不兼容，请更新清流后重试。');
  const id = key.slice(PREFIX.length);
  if (!/^[\w-]{1,100}$/.test(id)) throw new Error('云端规则编号无效。');
  if (raw.rule !== null && (!same(portable(raw.rule), raw.rule) || raw.rule.recordId !== id)) throw new Error('云端规则校验失败，本机规则未被覆盖。');
  return { version: 1, clock: raw.clock, device: raw.device, rule: raw.rule };
}

// Caller serializes all rule mutations and reconciliation in the worker.
export function createRuleSync(storage, { now = Date.now, uuid = () => crypto.randomUUID() } = {}) {
  async function status() {
    const { ruleSync: s = {} } = await storage.local.get(STATE);
    return { enabled: !!s.enabled, lastSync: s.lastSync || 0, error: s.error || '', count: Object.values(s.entries || {}).filter(e => e.rule).length, conflicts: s.conflicts?.length || 0 };
  }
  async function enable(enabled) {
    const { ruleSync: s = {} } = await storage.local.get(STATE);
    await storage.local.set({ [STATE]: { ...s, enabled, error: '' } });
    if (enabled) await run();
    return status();
  }
  async function run() {
    const { ruleSync: stored = {}, rules = [] } = await storage.local.get([STATE, 'rules']);
    if (!stored.enabled) return status();
    const s = structuredClone(stored);
    s.device ||= uuid(); s.entries ||= {}; s.baseline ||= {}; s.conflicts ||= [];
    try {
      // Journal local edits before any network/storage.sync operation, including deletions.
      const local = Object.fromEntries(rules.map(r => [r.recordId, portable(r)]));
      let clock = Math.max(s.clock || 0, now());
      for (const id of new Set([...Object.keys(local), ...Object.keys(s.baseline)])) {
        const value = local[id] || null;
        if (!same(value, s.baseline[id] || null)) {
          s.entries[id] = { version: 1, clock: s.initialized ? ++clock : 1, device: s.device, rule: value };
        }
      }
      s.clock = clock; s.baseline = local; s.initialized = true;
      await storage.local.set({ [STATE]: s });
      const cloud = await storage.sync.get(null);
      const remote = Object.fromEntries(Object.entries(cloud).filter(([key]) => key.startsWith(PREFIX)).map(([key, value]) => [key.slice(PREFIX.length), valid(key, value)]));
      for (const [id, entry] of Object.entries(remote)) {
        s.clock = Math.max(s.clock, entry.clock);
        const previous = s.entries[id];
        if (newer(entry, previous)) {
          if (previous?.rule && !same(previous.rule, entry.rule)) {
            s.conflicts.unshift({ rule: previous.rule, at: now() });
            s.conflicts = s.conflicts.slice(0, 20);
          }
          s.entries[id] = entry;
        }
      }
      const merged = Object.values(s.entries).filter(e => e.rule).map(e => e.rule);
      s.baseline = Object.fromEntries(merged.map(r => [r.recordId, r]));
      // Retain local source links where available; remote source links are never imported.
      const sourceIds = new Map(rules.map(r => [r.recordId, r.sourceId]));
      const nextRules = merged.map(r => ({ ...r, sourceId: sourceIds.get(r.recordId) || '' }));
      const patch = {};
      for (const [id, entry] of Object.entries(s.entries)) if (!same(remote[id], entry)) patch[PREFIX + id] = entry;
      // Commit merge and baseline together, so a restart cannot mistake remote edits for local ones.
      await storage.local.set({ [STATE]: s, ...(!same(rules, nextRules) ? { rules: nextRules } : {}) });
      const projected = { ...cloud, ...patch };
      if (Object.keys(projected).length > 512 || Object.entries(projected).some(([k, v]) => bytes(k) + bytes(JSON.stringify(v)) > 8192) || Object.entries(projected).reduce((n, [k, v]) => n + bytes(k) + bytes(JSON.stringify(v)), 0) > 102400) {
        throw new Error('Chrome 同步容量不足（总计 100 KB、单条 8 KB）；本机规则已保留，请精简规则后重试。删除记录也占用容量。');
      }
      if (Object.keys(patch).length) await storage.sync.set(patch);
      s.error = ''; s.lastSync = now();
      await storage.local.set({ [STATE]: s });
    } catch (error) {
      s.error = /云端|Chrome 同步容量/.test(error.message || '') ? error.message : '暂时无法写入 Chrome 同步存储；本机规则已保留，将自动重试。';
      await storage.local.set({ [STATE]: s });
    }
    return status();
  }
  async function backups() {
    const { ruleSync: s = {} } = await storage.local.get(STATE);
    return s.conflicts || [];
  }
  return { status, enable, run, backups };
}
