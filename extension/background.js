import { settings, makeRequest, probability, ENDPOINT, dayKey, fingerprint } from './core.js';
import './learning.js';
import './rules.js';
import { createRuleSync } from './sync.js';
import { createKeySync, KEY_SYNC_ITEM } from './key-sync.js';

// Content scripts must never be able to read session credentials or session cache.
const ready = Promise.all([chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }), initializeRules(), chrome.storage.sync?.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })]);
let tail = Promise.resolve();
let waiting = 0;
const cache = new Map();
let cacheLoaded = false;
let learningTail = Promise.resolve();

const ruleSync = createRuleSync(chrome.storage);
const keySync = createKeySync(chrome.storage);
function queueSync() {
  const task = learningTail.then(() => ready).then(async () => { await ruleSync.run(); await keySync.run(); });
  learningTail = task.catch(() => {});
  return task;
}
let syncTimer;
function scheduleSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { void queueSync().catch(() => {}); }, 2000);
}
chrome.storage.onChanged?.addListener((changes, area) => {
  if ((area === 'local' && changes.rules) || (area === 'sync' && Object.keys(changes).some(k => k.startsWith('qingliu.rule.') || k === KEY_SYNC_ITEM))) scheduleSync();
});
chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === 'rule-sync') void queueSync().catch(() => {}); });
void ready.then(async () => {
  await chrome.alarms?.create('rule-sync', { periodInMinutes: 5 });
  await queueSync();
}).catch(() => {});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

function isOptions(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options.html');
}
function isX(sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return false;
  try { const u = new URL(sender.url); return u.protocol === 'https:' && ['x.com', 'www.x.com'].includes(u.hostname) && !/^\/(messages|i\/chat)(\/|$)/.test(u.pathname); }
  catch { return false; }
}

async function initializeRules() {
  const stored = await chrome.storage.local.get(['rules', 'blockedSamples', 'config']);
  if (!Array.isArray(stored.rules)) {
    const migrated = XJevRules.migrate(stored.blockedSamples || [], stored.config);
    await chrome.storage.local.set({ ...migrated, blockedSamples: [], rulesVersion: 1 });
  }
}

async function config() {
  await ready;
  const { config: stored, rules = [], samples = [] } = await chrome.storage.local.get(['config', 'rules', 'samples']);
  return { ...settings(stored), rules, samples };
}

async function mutateLearning(message) {
  const cfg = await config();
  let rules = cfg.rules, samples = cfg.samples, record, previous;
  if (message.type === 'save-rule' || message.type === 'learn-block') {
    let raw = message.rule;
    if (message.type === 'learn-block') {
      if (message.kind !== 'author') throw new Error('请预览并保存规则后再应用到后续内容');
      const data = XJevLearning.prepare(message.data, 'author');
      if (cfg.allowlist.includes(data.author)) throw new Error('该账号在白名单中，请先从白名单移除');
      const existing = rules.find(r => r.kind === 'author' && r.author === data.author);
      if (existing?.enabled) return { ok: true, record: existing, unchanged: true };
      raw = { name: `屏蔽账号 @${data.author}`, kind: 'author', author: data.author };
      if (existing) { previous = existing; raw = { ...existing, enabled: true }; }
    }
    record = XJevRules.clean(raw);
    if (record.kind === 'author' && cfg.allowlist.includes(record.author)) throw new Error('该账号在白名单中，请先从白名单移除');
    if (record.recordId && !rules.some(r => r.recordId === record.recordId)) throw new Error('规则已被删除，请刷新后重试');
    if (message.sourceData && record.kind !== 'author') {
      const added = XJevRules.addSample(samples, message.sourceData);
      samples = added.samples; record.sourceId = added.sample.recordId;
    }
    record.recordId ||= crypto.randomUUID();
    rules = [record, ...rules.filter(r => r.recordId !== record.recordId)];
  } else if (message.type === 'forget-block') {
    rules = rules.filter(r => r.recordId !== message.recordId);
  } else if (message.type === 'import-rules') {
    const incoming = XJevRules.parseImport(message.document);
    rules = [...incoming.map(r => ({ ...r, recordId: crypto.randomUUID() })), ...rules];
  } else if (message.type === 'clear-samples') samples = [];
  else if (message.type === 'delete-sample') samples = samples.filter(s => s.recordId !== message.recordId);
  await chrome.storage.local.set({ rules, samples });
  return { ok: true, record, previous, rules, samples };
}

async function evaluate(message, test = false) {
  await ready;
  const cfg = await config();
  const learned = !test && cfg.learningAiEnabled
    ? XJevRules.semanticContext(message, cfg.rules, cfg.samples, cfg.allowlist) : null;
  if (!test && (!cfg.enabled || !cfg.aiEnabled || (cfg.categories.length === 0 && !cfg.aiContent && !learned))) return { skipped: true };
  if (!test && cfg.allowlist.includes(String(message.author || '').toLowerCase())) return { skipped: true };
  const text = message.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 5000) return { skipped: true };
  const { apiKey, backoffUntil = 0 } = await chrome.storage.session.get(['apiKey', 'backoffUntil']);
  if (!apiKey) return { skipped: true, error: '尚未设置 API 密钥', retryAfter: 60_000 };
  const hash = await fingerprint(text, cfg.categories, cfg.aiContent, learned);
  if (!cacheLoaded) {
    const { decisions = [] } = await chrome.storage.session.get('decisions');
    for (const pair of decisions) cache.set(...pair);
    cacheLoaded = true;
  }
  const cached = cache.get(hash);
  if (!test && cached && Date.now() - cached.at < 86_400_000) return { probability: cached.p, aiProbability: cached.aiProbability, ruleScores: cached.ruleScores, cached: true };
  if (Date.now() < backoffUntil) return { skipped: true, error: 'API 暂停中，请稍后重试', retryAfter: backoffUntil - Date.now() };
  const { usage: old = {} } = await chrome.storage.local.get('usage');
  const today = dayKey();
  const usage = old.day === today ? old : { day: today, requests: 0, inputTokens: 0 };
  if (cfg.dailyLimitEnabled && usage.requests >= cfg.dailyLimit) return { skipped: true, error: '已达今日请求上限', retryAfter: 60_000 };
  const { recent = [] } = await chrome.storage.session.get('recent');
  const window = recent.filter(t => Date.now() - t < 60_000);
  if (window.length >= 120) return { skipped: true, error: '已达每分钟请求上限', retryAfter: 60_000 - (Date.now() - window[0]) };
  // Reserve budget before fetching. Serialized across every X tab, including tests.
  usage.requests += 1;
  await chrome.storage.local.set({ usage });
  await chrome.storage.session.set({ recent: [...window, Date.now()] });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST', headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(makeRequest(text, cfg.categories, cfg.aiContent, learned)), signal: controller.signal,
      credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer'
    });
    if (!response.ok) {
      const retry = Number(response.headers.get('Retry-After'));
      const delay = [401, 403].includes(response.status) ? 300_000 : Math.max(30_000, Math.min(300_000, (Number.isFinite(retry) ? retry : 30) * 1000));
      await chrome.storage.session.set({ backoffUntil: Date.now() + delay });
      throw new Error(`API 返回 HTTP ${response.status}，内容保持显示`);
    }
    const data = await response.json();
    const p = probability(data);
    const aiDecision = cfg.aiContent ? { aiProbability: probability(data, 'ai_created') } : {};
    if (learned) aiDecision.ruleScores = learned.rules.map(rule => ({ recordId: rule.recordId, probability: probability(data, rule.key) }));
    if (Number.isInteger(data.usage?.input_tokens) && data.usage.input_tokens >= 0) usage.inputTokens += data.usage.input_tokens;
    await chrome.storage.local.set({ usage });
    cache.set(hash, { p, ...aiDecision, at: Date.now() });
    while (cache.size > 500) cache.delete(cache.keys().next().value);
    await chrome.storage.session.set({ decisions: [...cache], lastError: '', backoffUntil: 0 });
    return { probability: p, ...aiDecision };
  } catch (error) {
    const safeError = error.name === 'AbortError' ? 'API 请求超时，内容保持显示'
      : /^API 返回 HTTP|^模型响应格式/.test(error.message) ? error.message : 'API 连接失败，内容保持显示';
    const { backoffUntil: current = 0 } = await chrome.storage.session.get('backoffUntil');
    await chrome.storage.session.set({ lastError: safeError, backoffUntil: Math.max(current, Date.now() + 30_000) });
    return { error: safeError, retryAfter: Math.max(current - Date.now(), 30_000) };
  } finally { clearTimeout(timeout); }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  const options = isOptions(sender);
  const fromX = isX(sender);
  if (!message || (!options && !fromX)) return false;
  if (options && ['key-sync-status', 'key-sync-enable', 'key-sync-disable', 'key-sync-now', 'key-sync-save', 'key-sync-forget'].includes(message.type)) {
    const task = learningTail.then(() => ready).then(async () => {
      let status;
      if (message.type === 'key-sync-enable') status = await keySync.enable(message.password);
      else if (message.type === 'key-sync-disable') status = await keySync.disable();
      else if (message.type === 'key-sync-forget') status = await keySync.disable(true);
      else if (message.type === 'key-sync-now') status = await keySync.run();
      else if (message.type === 'key-sync-save') status = await keySync.publish(message.apiKey);
      else status = await keySync.status();
      return { ok: true, status };
    });
    learningTail = task.catch(() => {});
    task.then(respond, error => respond({ error: /^(请先|同步口令|同步密钥|无法写入 Chrome|密钥更新未保存)/.test(error.message || '') ? error.message : '密钥同步操作失败，请重试。' }));
    return true;
  }
  if (options && ['sync-status', 'sync-enable', 'sync-now', 'sync-backups'].includes(message.type)) {
    const task = learningTail.then(() => ready).then(async () => {
      if (message.type === 'sync-enable') {
        if (typeof message.enabled !== 'boolean') throw new Error('同步开关无效');
        return { ok: true, status: await ruleSync.enable(message.enabled) };
      }
      if (message.type === 'sync-now') return { ok: true, status: await ruleSync.run() };
      if (message.type === 'sync-backups') return { ok: true, backups: await ruleSync.backups() };
      return { ok: true, status: await ruleSync.status() };
    });
    learningTail = task.catch(() => {});
    task.then(respond, () => respond({ error: '无法访问同步存储，请重试。' }));
    return true;
  }
  if (message.type === 'config') { config().then(respond, () => respond(settings())); return true; }
  if ((message.type === 'learn-block' && fromX) || (['save-rule', 'forget-block'].includes(message.type) && (fromX || options)) || (['import-rules', 'clear-samples', 'delete-sample'].includes(message.type) && options)) {
    const task = learningTail.then(() => mutateLearning(message));
    learningTail = task.catch(() => {});
    task.then(respond, error => respond({ error: error.message || '保存屏蔽记录失败' }));
    return true;
  }
  if ((message.type === 'classify' && fromX) || (message.type === 'test' && options)) {
    if (waiting >= 20) { respond({ skipped: true, retryAfter: 5000 }); return false; }
    waiting++;
    const job = tail.then(() => evaluate(message.type === 'test' ? { text: 'Limited-time promotion: buy our premium plan today, use my referral code for 50% off!' } : message, options));
    tail = job.catch(() => {});
    job.then(respond, () => respond({ error: '扩展暂时无法判断，内容保持显示', retryAfter: 30_000 })).finally(() => waiting--);
    return true;
  }
  return false;
});
