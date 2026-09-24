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
