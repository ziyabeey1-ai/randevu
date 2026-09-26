import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebPushRecord, sendWebPush, WEB_PUSH_MAX_TIMEOUT_MS } from '../worker/web-push-provider.ts';

const b64 = bytes => Buffer.from(bytes).toString('base64url');
const endpoint = 'https://updates.push.services.mozilla.com/wpush/v2/safe-token';

async function fixture() {
  const receiver = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const vapidPrivate = await crypto.subtle.exportKey('jwk', vapid.privateKey);
  const vapidPublic = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey));
  return {
    receiver,
    subscription: { endpoint, keys: { p256dh: b64(new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey))), auth: b64(new Uint8Array(16).fill(9)) } },
    vapid: { subject: 'mailto:push@example.test', publicKey: b64(vapidPublic), privateKeyJwk: vapidPrivate },
  };
}

async function decrypt(body, receiver, auth) {
  const salt = body.slice(0, 16);
  assert.equal(new DataView(body.buffer, body.byteOffset).getUint32(16), 4096);
  assert.equal(body[20], 65);
  const senderPublic = body.slice(21, 86);
  const senderKey = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, receiver.privateKey, 256));
  const hmac = async (keyBytes, data) => {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
  };
  const cat = (...xs) => new Uint8Array(Buffer.concat(xs.map(x => Buffer.from(x))));
  const expand = async (key, info, length) => (await hmac(key, cat(info, [1]))).slice(0, length);
  const receiverPublic = new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey));
  const authPrk = await hmac(auth, shared);
  const ikm = await expand(authPrk, cat(new TextEncoder().encode('WebPush: info\0'), receiverPublic, senderPublic), 32);
  const prk = await hmac(salt, ikm);
  const cek = await expand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await expand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body.slice(86)));
}

test('PUSH-03 matches the published RFC 8291 section 5 watermelon vector', async () => {
  const receiverPublic = Buffer.from('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'base64url');
  const senderPublic = Buffer.from('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', 'base64url');
  const senderJwk = { key_ops: ['deriveBits'], ext: true, kty: 'EC', crv: 'P-256', x: b64(senderPublic.slice(1, 33)), y: b64(senderPublic.slice(33)), d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' };
  const privateKey = await crypto.subtle.importKey('jwk', senderJwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const { d: _d, ...senderPublicJwk } = senderJwk;
  const publicKey = await crypto.subtle.importKey('jwk', { ...senderPublicJwk, key_ops: [] }, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const record = await createWebPushRecord(
    new TextEncoder().encode('When I grow up, I want to be a watermelon'), receiverPublic,
    Buffer.from('BTBZMqHH6r4Tts7J_aSIgg', 'base64url'), { privateKey, publicKey },
    Buffer.from('DGv6ra1nlYgDCS1FRnbzlw', 'base64url'),
  );
  assert.equal(b64(record), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('PUSH-03 encrypts one RFC 8291 aes128gcm record and signs distinct RFC 8292 VAPID JWT', async () => {
  const data = await fixture();
  let request;
  const result = await sendWebPush({ ...data, payload: { v: 1, event: 'appointment.changed' }, now: () => 1_800_000_000_000,
    fetchImpl: async (input, init) => { request = { input, init }; return new Response(null, { status: 201 }); } });
  assert.deepEqual(result, { category: 'accepted', providerStatus: 201 });
  assert.equal(String(request.input), endpoint);
  assert.equal(request.init.redirect, 'manual');
  const headers = new Headers(request.init.headers);
  assert.equal(headers.get('Content-Encoding'), 'aes128gcm');
  assert.equal(headers.get('Content-Type'), 'application/octet-stream');
  assert.equal(headers.get('TTL'), '300');
  const authorization = headers.get('Authorization');
  assert.match(authorization, /^vapid t=[^.]+\.[^.]+\.[^,]+, k=/);
  const token = authorization.slice(8, authorization.indexOf(', k='));
  const [encodedHeader, encodedClaims, encodedSignature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, 'base64url')), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(Buffer.from(encodedClaims, 'base64url')), { aud: 'https://updates.push.services.mozilla.com', exp: 1_800_043_200, sub: 'mailto:push@example.test' });
  const vapidPublic = await crypto.subtle.importKey('raw', Buffer.from(data.vapid.publicKey, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapidPublic, Buffer.from(encodedSignature, 'base64url'), new TextEncoder().encode(`${encodedHeader}.${encodedClaims}`)), true);
  const plaintext = await decrypt(new Uint8Array(request.init.body), data.receiver, Buffer.alloc(16, 9));
  assert.equal(plaintext.at(-1), 2);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext.slice(0, -1))), { v: 1, event: 'appointment.changed' });
});

test('PUSH-03 rejects invalid keys, oversized/private payload shapes and unsafe endpoints before fetch', async () => {
  const data = await fixture();
  const invalid = [
    { ...data, subscription: { ...data.subscription, endpoint: 'http://fcm.googleapis.com/fcm/send/x' } },
    { ...data, subscription: { ...data.subscription, endpoint: 'https://127.0.0.1/fcm/send/x' } },
    { ...data, subscription: { ...data.subscription, endpoint: 'https://fcm.googleapis.com:444/fcm/send/x' } },
    { ...data, subscription: { ...data.subscription, endpoint: 'https://fcm.googleapis.com/fcm/send/x?next=https://internal/' } },
    { ...data, subscription: { ...data.subscription, endpoint: 'https://push.apple.com/token' } },
    { ...data, subscription: { ...data.subscription, endpoint: 'https://push.apple.com.evil.test/token' } },
    { ...data, subscription: { ...data.subscription, keys: { ...data.subscription.keys, p256dh: 'not*base64' } } },
    { ...data, vapid: { ...data.vapid, publicKey: data.subscription.keys.p256dh } },
    { ...data, payload: { v: 1, event: 'x'.repeat(4000) } },
    { ...data, payload: { v: 1, event: 'appointment.changed.secret123' } },
    { ...data, payload: { v: 1, event: '5551234567' } },
    { ...data, payload: { v: 1, event: 'appointment.changed', phone: '555' } },
    { ...data, vapid: { ...data.vapid, subject: 'mailto:not-an-address' } },
  ];
  for (const options of invalid) {
    let calls = 0;
    const result = await sendWebPush({ ...options, fetchImpl: async () => { calls += 1; return new Response(); } });
    assert.deepEqual(result, { category: 'terminal', providerStatus: null, reason: 'invalid-input' });
    assert.equal(calls, 0);
  }
  let appleUrl;
  const apple = await sendWebPush({ ...data, subscription: { ...data.subscription, endpoint: 'https://regional.push.apple.com/safe_token' }, payload: { v: 1, event: 'appointment.changed' }, fetchImpl: async input => { appleUrl = String(input); return new Response(null, { status: 202 }); } });
  assert.deepEqual(apple, { category: 'accepted', providerStatus: 202 });
  assert.equal(appleUrl, 'https://regional.push.apple.com/safe_token');
});

test('PUSH-03 classifies status, redirect, retry hints and bounded timeout without reading bodies', async () => {
  const data = await fixture();
  const send = (response, extra = {}) => sendWebPush({ ...data, payload: { v: 1, event: 'appointment.changed' }, fetchImpl: async () => response, ...extra });
  assert.deepEqual(await send(new Response(null, { status: 410 })), { category: 'expired', providerStatus: 410, deleteSubscription: true });
  assert.deepEqual(await send(new Response(null, { status: 307, headers: { Location: 'https://127.0.0.1/' } })), { category: 'terminal', providerStatus: 307, reason: 'provider-response' });
  assert.deepEqual(await send(new Response(null, { status: 429, headers: { 'Retry-After': '999999' } })), { category: 'retry', providerStatus: 429, retryAfterSeconds: 86400 });
  assert.deepEqual(await send(new Response(null, { status: 503 })), { category: 'retry', providerStatus: 503 });
  const timeout = await sendWebPush({ ...data, payload: { v: 1, event: 'appointment.changed' }, timeoutMs: 5, fetchImpl: async () => new Promise(() => {}) });
  assert.deepEqual(timeout, { category: 'retry', providerStatus: null });
  let calls = 0;
  assert.deepEqual(await sendWebPush({ ...data, payload: { v: 1, event: 'appointment.changed' }, timeoutMs: WEB_PUSH_MAX_TIMEOUT_MS + 1, fetchImpl: async () => { calls++; return new Response(); } }), { category: 'terminal', providerStatus: null, reason: 'invalid-input' });
  assert.equal(calls, 0);
});
