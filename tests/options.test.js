import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import * as core from '../extension/core.js';

test('advanced daily limit switch persists, keeps stats and restores previous cap', async () => {
  const html = readFileSync(new URL('../extension/options.html', import.meta.url), 'utf8');
  const code = readFileSync(new URL('../extension/options.js', import.meta.url), 'utf8').replace(/^import .*\n/, 'const { settings, dayKey, AD_CATEGORIES } = globalThis.core;\n');
  const page = new JSDOM(html, { runScripts: 'outside-only' });
  const w = page.window;
  const local = { config: { dailyLimit: 321 }, usage: { day: core.dayKey(), requests: 400, inputTokens: 1234 } };
  const area = data => ({
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])),
    set: async patch => Object.assign(data, structuredClone(patch))
  });
  w.core = core;
  w.chrome = { storage: { local: area(local), session: area({}), onChanged: { addListener() {} } } };
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await w.eval(`(async () => { ${code}\n })()`);
    const $ = id => w.document.getElementById(id);
    assert.equal($('advancedSettings').open, false);
    assert.equal($('dailyLimitEnabled').checked, true);
    assert.match($('usage').textContent, /400 次/);
    assert.match($('usageLimit').textContent, /剩余 0 次/);
    $('dailyLimitEnabled').checked = false;
    $('dailyLimitEnabled').dispatchEvent(new w.Event('change'));
    assert.equal($('dailyLimitField').hidden, true);
    assert.equal($('dailyLimit').disabled, true);
    $('settings').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await flush();
    assert.equal(local.config.dailyLimitEnabled, false);
    assert.equal(local.config.dailyLimit, 321);
    assert.match($('usageLimit').textContent, /不限/);
    assert.match($('usage').textContent, /400 次/);
    $('dailyLimitEnabled').checked = true;
    $('dailyLimitEnabled').dispatchEvent(new w.Event('change'));
    assert.equal($('dailyLimit').disabled, false);
    assert.equal($('dailyLimit').value, '321');
    $('dailyLimit').value = '0';
    assert.equal($('dailyLimit').checkValidity(), false);
    assert.equal($('advancedSettings').open, true);
    $('dailyLimit').value = '500';
    $('settings').dispatchEvent(new w.Event('submit', { cancelable: true }));
    await flush();
    assert.equal(local.config.dailyLimitEnabled, true);
    assert.equal(local.config.dailyLimit, 500);
    assert.match($('usageLimit').textContent, /剩余 100 次/);
  } finally { w.close(); }
});

test('saved API key stays masked without writing the mask, overwriting edits or exposing the stored secret', async () => {
  const html = readFileSync(new URL('../extension/options.html', import.meta.url), 'utf8');
  const code = readFileSync(new URL('../extension/options.js', import.meta.url), 'utf8').replace(/^import .*\n/, 'const { settings, dayKey, AD_CATEGORIES } = globalThis.core;\n');
  const page = new JSDOM(html, { runScripts: 'outside-only' });
  const w = page.window;
  const session = { apiKey: 'fake-existing-test-key' }, local = {};
  let changed, keyWrites = 0, tested = 0;
  const area = data => ({
    get: async keys => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k, data[k]])),
    set: async patch => { if (data === session && patch.apiKey) keyWrites++; Object.assign(data, structuredClone(patch)); },
    remove: async key => { delete data[key]; }, setAccessLevel: async () => {}
  });
  w.core = core;
  w.chrome = { runtime: { sendMessage: async () => { tested++; return { probability: 0.99 }; } }, storage: { local: area(local), session: area(session), onChanged: { addListener(fn) { changed = fn; } } } };
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await w.eval(`(async () => { ${code}\n })()`);
    const $ = id => w.document.getElementById(id), input = $('apiKey');
    assert.equal(input.type, 'password');
    assert.match(input.value, /^•+$/);
    assert.ok(!w.document.body.innerHTML.includes(session.apiKey));
    $('settings').dispatchEvent(new w.Event('submit', { cancelable: true })); await flush();
    assert.equal(keyWrites, 0); assert.equal(session.apiKey, 'fake-existing-test-key');
    $('test').click(); await flush();
    assert.equal(tested, 1); assert.equal(keyWrites, 0); assert.match(input.value, /^•+$/);
    input.focus(); input.dispatchEvent(new w.InputEvent('beforeinput', { inputType: 'insertFromPaste' }));
    assert.equal(input.value, '');
    input.value = 'fake-replacement-key'; input.dispatchEvent(new w.Event('input'));
    changed({ usage: {} }, 'local'); await flush();
    assert.equal(input.value, 'fake-replacement-key', 'usage refresh cannot discard a pending edit');
    $('settings').dispatchEvent(new w.Event('submit', { cancelable: true })); await flush();
    assert.equal(keyWrites, 1); assert.equal(session.apiKey, 'fake-replacement-key'); assert.match(input.value, /^•+$/);
    input.dispatchEvent(new w.InputEvent('beforeinput', { inputType: 'deleteContentBackward' }));
    input.dispatchEvent(new w.Event('input')); input.blur();
    assert.match(input.value, /^•+$/, 'empty edit retains the previously saved key');
    $('forget').click(); await flush();
    assert.equal(session.apiKey, undefined); assert.equal(input.value, '');
    assert.match($('keyStatus').textContent, /尚未设置/);
    assert.equal(local.config.aiEnabled, false);
  } finally { w.close(); }
});

test('sync setting is opt-in, independent of the settings form, and shows quota feedback', async () => {
  const html = readFileSync(new URL('../extension/options.html', import.meta.url), 'utf8');
  const code = readFileSync(new URL('../extension/sync-options.js', import.meta.url), 'utf8');
  const page = new JSDOM(html, { runScripts: 'outside-only' });
  const w = page.window;
  let status = { enabled: false, lastSync: 0, conflicts: 0 };
  const calls = [];
  w.chrome = { runtime: { sendMessage: async m => {
    calls.push(m);
    if (m.type === 'sync-enable') status = { ...status, enabled: m.enabled, error: m.enabled ? 'Chrome 同步容量不足' : '' };
    return { ok: true, status };
  } }, storage: { onChanged: { addListener() {} } } };
  try {
    await w.eval(`(async () => { ${code}\n })()`);
    const toggle = w.document.getElementById('ruleSyncEnabled');
    assert.equal(toggle.checked, false); assert.equal(toggle.closest('form'), null);
    assert.equal(w.document.getElementById('ruleSyncNow').disabled, true);
    toggle.checked = true; toggle.dispatchEvent(new w.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(calls.some(m => m.type === 'sync-enable' && m.enabled));
    assert.match(w.document.getElementById('ruleSyncStatus').textContent, /容量不足/);
    assert.equal(toggle.disabled, false);
    toggle.checked = false; toggle.dispatchEvent(new w.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.match(w.document.getElementById('ruleSyncStatus').textContent, /未开启/);
  } finally { w.close(); }
});
