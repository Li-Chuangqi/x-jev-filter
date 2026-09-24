import test from 'node:test';
import assert from 'node:assert/strict';
import { createKeySync, KEY_SYNC_ITEM } from '../extension/key-sync.js';
const password = 'a-long-independent-test-passphrase';
const secret = 'fake-jev-api-key-for-testing';
const area = data => ({
 get: async keys => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(k => [k,data[k]]))),
 set: async patch => Object.assign(data,structuredClone(patch)),
 remove: async key => { delete data[key]; }
});
function device(cloud, apiKey) {
 const local={},session=apiKey?{apiKey}:{};
 let stored;
 const vault={get:async()=>stored,put:async value=>{stored=structuredClone(value);},clear:async()=>{stored=undefined;}};
 const storage={local:area(local),session:area(session),sync:area(cloud)};
 return {local,session,storage,vault,engine:createKeySync(storage,vault)};
}
test('default off; encrypted cloud payload excludes plaintext, password and device key', async()=>{
 const cloud={},a=device(cloud,secret);
 await a.engine.run();assert.deepEqual(cloud,{});assert.equal((await a.engine.status()).enabled,false);
 await a.engine.enable(password);
 assert.ok(cloud[KEY_SYNC_ITEM].ciphertext);
 for(const sensitive of [secret,password]) {
  assert.ok(!JSON.stringify(cloud).includes(sensitive));assert.ok(!JSON.stringify(a.local).includes(sensitive));
 }
 const {key}=await a.vault.get();assert.equal(key.extractable,false);
 await assert.rejects(crypto.subtle.exportKey('raw',key));
 assert.deepEqual(Object.keys(a.local),['keySync']);
});
test('new device unlocks once, survives session restart, and receives replacement keys',async()=>{
 const cloud={},a=device(cloud,secret),b=device(cloud);
 await a.engine.enable(password);await b.engine.enable(password);assert.equal(b.session.apiKey,secret);
 delete b.session.apiKey;
 await createKeySync(b.storage,b.vault).run();assert.equal(b.session.apiKey,secret);
 const previous=cloud[KEY_SYNC_ITEM].iv;
 await a.engine.publish('fake-replacement-key');assert.notEqual(cloud[KEY_SYNC_ITEM].iv,previous);
 await b.engine.run();assert.equal(b.session.apiKey,'fake-replacement-key');
 assert.ok(!JSON.stringify(cloud).includes('fake-replacement-key'));
});
test('wrong passwords, tampering and incompatible data never replace existing local keys',async()=>{
 const cloud={},a=device(cloud,secret),b=device(cloud,'keep-local-key');
 await a.engine.enable(password);
 await assert.rejects(b.engine.enable('a-wrong-long-test-passphrase'),/口令不正确/);
 assert.equal(b.session.apiKey,'keep-local-key');assert.equal((await b.engine.status()).enabled,false);
 await b.engine.enable(password);b.session.apiKey='keep-local-key';
 cloud[KEY_SYNC_ITEM].ciphertext=cloud[KEY_SYNC_ITEM].ciphertext.replace(/^./,c=>c==='A'?'B':'A');
 assert.match((await b.engine.run()).error,/口令不正确/);assert.equal(b.session.apiKey,'keep-local-key');
 cloud[KEY_SYNC_ITEM].iterations=999999999;
 assert.match((await b.engine.run()).error,/格式无效/);assert.equal(b.session.apiKey,'keep-local-key');
});
test('disable removes device credential, retains session and cloud; forget cannot auto-restore',async()=>{
 const cloud={},a=device(cloud,secret);await a.engine.enable(password);
 await a.engine.disable();assert.equal(await a.vault.get(),undefined);assert.equal(a.session.apiKey,secret);
 assert.ok(cloud[KEY_SYNC_ITEM]);
 await a.engine.enable(password);await a.engine.disable(true);await a.engine.run();
 assert.equal(a.session.apiKey,undefined);assert.ok(cloud[KEY_SYNC_ITEM]);
});
test('quota errors preserve previous session key and do not silently enable sync',async()=>{
 const cloud={},a=device(cloud,secret);
 a.storage.sync.set=async()=>{throw Error('quota');};
 await assert.rejects(a.engine.enable(password),/无法写入/);
 assert.equal((await a.engine.status()).enabled,false);assert.equal(a.session.apiKey,secret);
 a.storage.sync.set=area(cloud).set;await a.engine.enable(password);
 a.storage.sync.set=async()=>{throw Error('quota');};
 await assert.rejects(a.engine.publish('new-fake-key'),/未保存/);assert.equal(a.session.apiKey,secret);
});
test('missing cloud and changed salt do not re-upload or overwrite local keys',async()=>{
 const cloud={},a=device(cloud,secret);await a.engine.enable(password);
 delete cloud[KEY_SYNC_ITEM];assert.match((await a.engine.run()).error,/尚无密钥/);assert.deepEqual(cloud,{});
 const b=device(cloud,'another-key');await b.engine.enable('another-long-test-password');
 assert.match((await a.engine.run()).error,/重新输入/);assert.equal(a.session.apiKey,secret);
 await assert.rejects(a.engine.publish(secret),/重新输入/);
});
