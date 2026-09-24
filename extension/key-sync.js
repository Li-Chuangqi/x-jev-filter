export const KEY_SYNC_ITEM = 'qingliu.secret.jev.v1';
const ITERATIONS = 600000;
const encoder = new TextEncoder();
const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
const aad = encoder.encode(KEY_SYNC_ITEM);
function checkSecret(key) {
  if (typeof key !== 'string' || !key || key.length > 2048 || /\s/.test(key)) throw new Error('请先保存有效的 Jev API 密钥（最多 2048 字符）。');
}
function checkEnvelope(raw) {
  try {
    if (raw?.version !== 1 || raw.iterations !== ITERATIONS || raw.algorithm !== 'AES-GCM' || typeof raw.salt !== 'string' || raw.salt.length > 32 || unb64(raw.salt).length !== 16 || typeof raw.iv !== 'string' || raw.iv.length > 24 || unb64(raw.iv).length !== 12 || typeof raw.ciphertext !== 'string' || raw.ciphertext.length > 6000 || unb64(raw.ciphertext).length < 17) throw Error();
    return raw;
  } catch { throw new Error('同步密钥数据格式无效，请检查其他设备的插件版本。'); }
}
async function derive(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('同步口令需为 12–256 个字符；建议使用独立的长口令。');
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: ITERATIONS }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function encrypt(apiKey, key, salt) {
  checkSecret(apiKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, encoder.encode(apiKey));
  return { version: 1, algorithm: 'AES-GCM', iterations: ITERATIONS, salt, iv: b64(iv), ciphertext: b64(ciphertext) };
}
async function decrypt(envelope, key) {
  checkEnvelope(envelope);
  try {
    const bytes = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(envelope.iv), additionalData: aad }, key, unb64(envelope.ciphertext));
    const result = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    checkSecret(result); return result;
  } catch { throw new Error('同步口令不正确或密文已更改；现有本机密钥保持不变。'); }
}

// Non-exportable CryptoKey is device-local; neither it nor the password enters Chrome sync.
export function deviceKeyStore() {
  async function transaction(mode, action) {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('qingliu-device-credentials', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('keys', mode); const request = action(tx.objectStore('keys'));
        tx.oncomplete = () => resolve(request.result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Device storage failed'));
      });
    } finally { db.close(); }
  }
  return { get: () => transaction('readonly', s => s.get('jev')), put: value => transaction('readwrite', s => s.put(value, 'jev')), clear: () => transaction('readwrite', s => s.delete('jev')) };
}

export function createKeySync(storage, vault = deviceKeyStore()) {
  async function meta() { return (await storage.local.get('keySync')).keySync || { enabled: false }; }
  async function status() { const s = await meta(); return { enabled: !!s.enabled, error: s.error || '', lastSync: s.lastSync || 0 }; }
  async function activate(apiKey) {
    const current = await storage.session.get('apiKey');
    if (current.apiKey !== apiKey) await storage.session.set({ apiKey, backoffUntil: 0, lastError: '' });
  }
  async function enable(password) {
    // Existing cloud data must be unlocked, never silently overwritten by a joining device.
    const envelope = (await storage.sync.get(KEY_SYNC_ITEM))[KEY_SYNC_ITEM];
    const salt = envelope ? checkEnvelope(envelope).salt : b64(crypto.getRandomValues(new Uint8Array(16)));
    const key = await derive(password, salt);
    let apiKey;
    if (envelope) apiKey = await decrypt(envelope, key);
    else {
      apiKey = (await storage.session.get('apiKey')).apiKey; checkSecret(apiKey);
      if (password === apiKey) throw new Error('同步口令不能使用 API 密钥本身，请设置独立口令。');
      try { await storage.sync.set({ [KEY_SYNC_ITEM]: await encrypt(apiKey, key, salt) }); }
      catch { throw new Error('无法写入 Chrome 同步存储，请检查同步容量后重试。'); }
    }
    await vault.put({ key, salt });
    await activate(apiKey);
    await storage.local.set({ keySync: { enabled: true, error: '', lastSync: Date.now() } });
    return status();
  }
  async function disable(clearSession = false) {
    // Disable first, so a crash cannot silently restore a cleared key on restart.
    await storage.local.set({ keySync: { enabled: false, error: '' } });
    await vault.clear();
    if (clearSession) await storage.session.remove('apiKey');
    return status();
  }
  async function run() {
    const s = await meta(); if (!s.enabled) return status();
    try {
      const envelope = (await storage.sync.get(KEY_SYNC_ITEM))[KEY_SYNC_ITEM];
      if (!envelope) throw new Error('Chrome 同步存储中尚无密钥，请等待同步或在已有密钥的设备上设置。');
      checkEnvelope(envelope);
      const device = await vault.get();
      if (!device || device.salt !== envelope.salt) throw new Error('此设备需要重新输入同步口令解锁。');
      await activate(await decrypt(envelope, device.key));
      await storage.local.set({ keySync: { enabled: true, error: '', lastSync: Date.now() } });
    } catch (error) {
      const safe = /^(Chrome 同步存储中|同步密钥数据|此设备需要|同步口令不正确)/.test(error.message) ? error.message : '密钥同步暂时不可用；本机密钥保持不变，将自动重试。';
      await storage.local.set({ keySync: { ...s, error: safe } });
    }
    return status();
  }
  async function publish(apiKey) {
    checkSecret(apiKey);
    const s = await meta();
    if (!s.enabled) throw new Error('请先开启密钥同步。');
    const envelope = (await storage.sync.get(KEY_SYNC_ITEM))[KEY_SYNC_ITEM];
    const device = await vault.get();
    if (!envelope || !device || checkEnvelope(envelope).salt !== device.salt) throw new Error('请先重新输入同步口令解锁。');
    await decrypt(envelope, device.key);
    try { await storage.sync.set({ [KEY_SYNC_ITEM]: await encrypt(apiKey, device.key, device.salt) }); }
    catch { throw new Error('密钥更新未保存：Chrome 同步存储不可用或容量不足，请重试。'); }
    await activate(apiKey);
    await storage.local.set({ keySync: { ...s, error: '', lastSync: Date.now() } });
    return status();
  }
  return { status, enable, disable, run, publish };
}
