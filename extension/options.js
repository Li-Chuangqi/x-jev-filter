import { settings, dayKey, AD_CATEGORIES } from './core.js';
const $ = id => document.getElementById(id);
const say = text => { $('status').textContent = text; };
let savedDailyLimit;
for (const category of AD_CATEGORIES) {
  const label = document.createElement('label');
  label.className = 'toggle';
  const text = document.createElement('span');
  const title = document.createElement('strong');
  title.textContent = category.label;
  const detail = document.createElement('small');
  detail.textContent = category.description;
  text.append(title, detail);
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox'; checkbox.id = `category-${category.id}`;
  label.append(text, checkbox);
  $('aiCategories').append(label);
}
function updateCategoryHint() {
  $('categoryHint').textContent = $('aiEnabled').checked
    ? '勾选要屏蔽的类别。多选时，命中任一类别即可过滤；类别可能重叠。广告类别、AI 创作及 Jev 语义规则全部关闭后，不进行 AI 判断。'
    : '以下类别需要开启「用 Jev 识别营销内容」才会生效；当前可预先选择。系统广告可独立过滤，无需 API。';
}
$('aiEnabled').addEventListener('change', updateCategoryHint);

function updateDailyLimit() {
  const enabled = $('dailyLimitEnabled').checked;
  $('dailyLimitField').hidden = !enabled;
  $('dailyLimit').disabled = !enabled;
}
$('dailyLimitEnabled').addEventListener('change', updateDailyLimit);
$('dailyLimit').addEventListener('invalid', () => { $('advancedSettings').open = true; });

async function refreshStatus() {
  const [{ apiKey, lastError }, { usage, config }] = await Promise.all([
    chrome.storage.session.get(['apiKey', 'lastError']), chrome.storage.local.get(['usage', 'config'])
  ]);
  $('keyStatus').textContent = apiKey ? '密钥已设置，仅保存在当前浏览器会话中；浏览器退出后需重新填写。' : '尚未设置密钥。密钥仅保存在浏览器会话内存中。';
  const current = usage?.day === dayKey() ? usage : { requests: 0, inputTokens: 0 };
  $('usage').textContent = `今日 API 请求 ${current.requests} 次 · 已返回的输入用量 ${current.inputTokens.toLocaleString()} tokens`;
  const cfg = settings(config);
  $('usageLimit').textContent = cfg.dailyLimitEnabled
    ? `每日上限 ${cfg.dailyLimit} 次 · 今日剩余 ${Math.max(0, cfg.dailyLimit - current.requests)} 次`
    : '每日请求量不限 · 用量持续统计';
  $('lastError').textContent = lastError || '连接测试发送一条固定示例，不读取你的浏览内容。';
}
async function save() {
  const rawHandles = $('allowlist').value.split(/[\s,，]+/).filter(Boolean);
  if (rawHandles.some(x => !/^@?[a-zA-Z0-9_]{1,15}$/.test(x))) throw new Error('白名单中存在无效账号，请输入 @用户名，每行一个。');
  if (rawHandles.length > 500) throw new Error('白名单最多支持 500 个账号。');
  const key = $('apiKey').value.trim();
  if (key && /\s/.test(key)) throw new Error('密钥不能包含空格或换行。');
  if ($('dailyLimitEnabled').checked && !$('dailyLimit').checkValidity()) throw new Error('每日请求上限应为 1–10000 的整数。');
  if (key) {
    await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    await chrome.storage.session.set({ apiKey: key, backoffUntil: 0, lastError: '' });
    $('apiKey').value = '';
  }
  const { apiKey } = await chrome.storage.session.get('apiKey');
  if ($('aiEnabled').checked && !apiKey) throw new Error('开启 AI 过滤前，请先填写 API 密钥。');
  const cfg = settings({
    enabled: $('enabled').checked, platformAds: $('platformAds').checked,
    showPlaceholder: $('showPlaceholder').checked,
    aiContent: $('aiContent').checked,
    learningAiEnabled: $('learningAiEnabled').checked,
    categories: AD_CATEGORIES.filter(category => $(`category-${category.id}`).checked).map(category => category.id),
    aiEnabled: $('aiEnabled').checked, threshold: Number($('threshold').value),
    dailyLimitEnabled: $('dailyLimitEnabled').checked,
    dailyLimit: $('dailyLimitEnabled').checked ? Number($('dailyLimit').value) : savedDailyLimit, allowlist: rawHandles
  });
  await chrome.storage.local.set({ config: cfg });
  savedDailyLimit = cfg.dailyLimit;
  $('dailyLimit').value = cfg.dailyLimit;
  await refreshStatus();
}
$('threshold').addEventListener('input', () => { $('thresholdValue').textContent = `${Math.round(Number($('threshold').value) * 100)}%`; });
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  try { await save(); say('已保存，打开的 X 页面会自动应用。首次安装后请刷新 X。'); }
  catch (error) { say(error.message); }
});
$('test').addEventListener('click', async () => {
  $('test').disabled = true;
  try {
    await save(); say('正在测试 Jev 连接…');
    const result = await chrome.runtime.sendMessage({ type: 'test' });
    say(typeof result?.probability === 'number'
      ? `连接成功。营销示例的广告概率：${Math.round(result.probability * 100)}%。这不是准确率评测。`
      : result?.error || '未发出请求，请检查 API 密钥。');
    await refreshStatus();
  } catch (error) { say(error.message); }
  finally { $('test').disabled = false; }
});
$('forget').addEventListener('click', async () => {
  try {
    await chrome.storage.session.remove('apiKey');
    const { config } = await chrome.storage.local.get('config');
    await chrome.storage.local.set({ config: { ...settings(config), aiEnabled: false } });
    $('apiKey').value = ''; $('aiEnabled').checked = false; updateCategoryHint();
    await refreshStatus(); say('已清除密钥并关闭 AI 过滤。已发出的请求可能仍会完成。');
  } catch { say('清除失败，请重试。'); }
});
const { config } = await chrome.storage.local.get('config');
const cfg = settings(config);
for (const key of ['enabled', 'platformAds', 'aiEnabled', 'aiContent', 'showPlaceholder', 'learningAiEnabled', 'dailyLimitEnabled']) $(key).checked = cfg[key];
for (const category of AD_CATEGORIES) $(`category-${category.id}`).checked = cfg.categories.includes(category.id);
updateCategoryHint();
$('threshold').value = cfg.threshold;
$('thresholdValue').textContent = `${Math.round(cfg.threshold * 100)}%`;
savedDailyLimit = cfg.dailyLimit;
$('dailyLimit').value = cfg.dailyLimit;
updateDailyLimit();
$('allowlist').value = cfg.allowlist.map(x => `@${x}`).join('\n');
await refreshStatus();
chrome.storage.onChanged.addListener(() => { void refreshStatus(); });
