import { settings, makeRequest, probability, ENDPOINT, dayKey, fingerprint } from './core.js';

// Content scripts must never be able to read session credentials or session cache.
const ready = chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
let tail = Promise.resolve();
let waiting = 0;
const cache = new Map();
let cacheLoaded = false;

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

function isOptions(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('options.html');
}
function isX(sender) {
  if (sender.id !== chrome.runtime.id || !sender.tab || sender.frameId !== 0) return false;
  try { const u = new URL(sender.url); return u.protocol === 'https:' && ['x.com', 'www.x.com'].includes(u.hostname) && !/^\/(messages|i\/chat)(\/|$)/.test(u.pathname); }
  catch { return false; }
}

async function config() {
  const { config: stored } = await chrome.storage.local.get('config');
  return settings(stored);
}

async function evaluate(message, test = false) {
  await ready;
  const cfg = await config();
  if (!test && (!cfg.enabled || !cfg.aiEnabled || (cfg.categories.length === 0 && !cfg.aiContent))) return { skipped: true };
  if (!test && cfg.allowlist.includes(String(message.author || '').toLowerCase())) return { skipped: true };
  const text = message.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 5000) return { skipped: true };
  const { apiKey, backoffUntil = 0 } = await chrome.storage.session.get(['apiKey', 'backoffUntil']);
  if (!apiKey) return { skipped: true, error: '尚未设置 API 密钥', retryAfter: 60_000 };
  const hash = await fingerprint(text, cfg.categories, cfg.aiContent);
  if (!cacheLoaded) {
    const { decisions = [] } = await chrome.storage.session.get('decisions');
    for (const pair of decisions) cache.set(...pair);
    cacheLoaded = true;
  }
  const cached = cache.get(hash);
  if (!test && cached && Date.now() - cached.at < 86_400_000) return { probability: cached.p, aiProbability: cached.aiProbability, cached: true };
  if (Date.now() < backoffUntil) return { skipped: true, error: 'API 暂停中，请稍后重试', retryAfter: backoffUntil - Date.now() };
  const { usage: old = {} } = await chrome.storage.local.get('usage');
  const today = dayKey();
  const usage = old.day === today ? old : { day: today, requests: 0, inputTokens: 0 };
  if (usage.requests >= cfg.dailyLimit) return { skipped: true, error: '已达今日请求上限', retryAfter: 60_000 };
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
      body: JSON.stringify(makeRequest(text, cfg.categories, cfg.aiContent)), signal: controller.signal,
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
  if (message.type === 'config') { config().then(respond, () => respond(settings())); return true; }
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
