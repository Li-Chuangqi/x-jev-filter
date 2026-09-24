const $ = id => document.getElementById(id);
let busy = false, enabled = false;
async function request(type, extra = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...extra });
  if (!result?.ok) throw new Error(result?.error || '密钥同步操作失败，请重试。');
  return result.status;
}
function render(s) {
  enabled = s.enabled;
  $('keySyncEnabled').checked = enabled;
  $('keySyncSetup').hidden = !enabled || !s.error;
  $('keySyncStatus').textContent = s.error || (enabled ? '已开启加密密钥同步；此设备已解锁。其他设备首次使用时请输入同步口令。' : '未开启，密钥仅在当前浏览器会话内使用。');
}
async function refresh() { try { render(await request('key-sync-status')); } catch (e) { $('keySyncStatus').textContent = e.message; } }
$('keySyncEnabled').addEventListener('change', async () => {
  if ($('keySyncEnabled').checked) {
    $('keySyncSetup').hidden = false;
    $('keySyncStatus').textContent = '填写同步口令并点击“开启并解锁”后生效。';
    $('keySyncPassword').focus(); return;
  }
  busy = true; $('keySyncEnabled').disabled = true;
  try { render(await request('key-sync-disable')); $('keySyncPassword').value = ''; }
  catch(e) { $('keySyncEnabled').checked = enabled; $('keySyncStatus').textContent = e.message; }
  finally { busy = false; $('keySyncEnabled').disabled = false; }
});
$('keySyncUnlock').addEventListener('click', async () => {
  if (busy) return;
  if (!$('keySyncPassword').reportValidity()) return;
  busy = true; $('keySyncUnlock').disabled = true; $('keySyncEnabled').disabled = true;
  const password = $('keySyncPassword').value; $('keySyncPassword').value = '';
  $('keySyncStatus').textContent = '正在加密或解锁…';
  try { render(await request('key-sync-enable', { password })); }
  catch(e) { $('keySyncEnabled').checked = enabled; $('keySyncStatus').textContent = e.message; }
  finally { busy = false; $('keySyncUnlock').disabled = false; $('keySyncEnabled').disabled = false; }
});
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.keySync && !busy && $('keySyncSetup').hidden) void refresh(); });
await refresh();
