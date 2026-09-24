const $ = id => document.getElementById(id);
let busy = false;
function render(s) {
  $('ruleSyncEnabled').checked = s.enabled;
  $('ruleSyncNow').disabled = busy || !s.enabled;
  $('ruleSyncBackups').disabled = busy || !s.conflicts;
  $('ruleSyncStatus').textContent = !s.enabled ? '未开启同步，本机规则保持不变。' : s.error || (s.lastSync ? `已与 Chrome 同步存储合并 · ${s.count} 条规则 · ${new Date(s.lastSync).toLocaleString()}。云端传输状态请查看 Chrome 设置。` : '等待同步…');
}
async function request(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...extra });
  if (!result?.ok) throw new Error(result?.error || '同步操作失败，请重试。');
  return result;
}
async function refresh() {
  try { render((await request('sync-status')).status); }
  catch (error) { $('ruleSyncStatus').textContent = error.message; }
}
async function change(type, extra) {
  busy = true; $('ruleSyncEnabled').disabled = true; $('ruleSyncNow').disabled = true;
  $('ruleSyncStatus').textContent = '正在处理…';
  try { await request(type, extra); }
  catch (error) { $('ruleSyncStatus').textContent = error.message; }
  finally { busy = false; $('ruleSyncEnabled').disabled = false; await refresh(); }
}
$('ruleSyncEnabled').addEventListener('change', () => { void change('sync-enable', { enabled: $('ruleSyncEnabled').checked }); });
$('ruleSyncNow').addEventListener('click', () => { void change('sync-now'); });
$('ruleSyncBackups').addEventListener('click', async () => {
  try {
    const { backups } = await request('sync-backups');
    const documentData = { format: 'x-jev-rules', version: 1, rules: backups.map(b => b.rule) };
    const url = URL.createObjectURL(new Blob([JSON.stringify(documentData, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'qingliu-sync-conflicts.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { $('ruleSyncStatus').textContent = error.message; }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.ruleSync && !busy) void refresh(); });
await refresh();
