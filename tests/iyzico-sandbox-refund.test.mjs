import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createIyzicoSandboxRefundClient } from '../worker/iyzico-sandbox-refund.ts';

const env = {
  IYZICO_SANDBOX_API_KEY: 'sandbox-fake-key',
  IYZICO_SANDBOX_SECRET_KEY: 'sandbox-fake-secret',
};
const input = () => ({
  conversationId: 'refund-attempt-1',
  paymentId: '25180208',
  amountMinor: 1500,
  ip: '203.0.113.7',
});
const sign = (fields) => createHmac('sha256', env.IYZICO_SANDBOX_SECRET_KEY)
  .update(fields.join(':')).digest('hex');
function success(overrides = {}) {
  const r = {
    status: 'success',
    conversationId: 'refund-attempt-1',
    paymentId: '25180208',
    price: 15,
    currency: 'TRY',
    authCode: '581421',
    refundHostReference: 'fixture',
    retryable: false,
    ...overrides,
  };
  r.signature = sign([String(r.paymentId), String(r.conversationId)]);
  return r;
}
const json = (value, init = {}) => new Response(JSON.stringify(value), {
  headers: { 'content-type': 'application/json' },
  ...init,
});
const originalFetch = globalThis.fetch;
let globalFetchCalls = 0;
globalThis.fetch = async () => {
  globalFetchCalls += 1;
  throw Error('NETWORK_DISABLED');
};
after(() => {
  globalThis.fetch = originalFetch;
  assert.equal(globalFetchCalls, 0);
});

function fixture(factory = async () => json(success()), timeoutMs = 8000) {
  const requests = [];
  const client = createIyzicoSandboxRefundClient(env, async (url, init) => {
    requests.push({ url, init });
    return factory(url, init);
  }, { timeoutMs });
  return { client, requests };
}

test('IYZ-01C signs Refund V2 exact path/body with independent HMAC', async () => {
  const f = fixture();
  const r = await f.client.refund(input());
  assert.equal(r.ok, true);
  assert.equal(f.requests.length, 1);
  const { url, init } = f.requests[0];
  assert.equal(url, 'https://sandbox-api.iyzipay.com/v2/payment/refund');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(init.credentials, 'omit');
  assert.deepEqual(JSON.parse(init.body), {
    locale: 'tr',
    conversationId: 'refund-attempt-1',
    paymentId: '25180208',
    price: '15.0',
    currency: 'TRY',
    ip: '203.0.113.7',
  });
  const nonce = init.headers['x-iyzi-rnd'];
  const independent = createHmac('sha256', env.IYZICO_SANDBOX_SECRET_KEY)
    .update(nonce + '/v2/payment/refund' + init.body).digest('hex');
  assert.equal(
    Buffer.from(init.headers.Authorization.slice(8), 'base64').toString(),
    'apiKey:' + env.IYZICO_SANDBOX_API_KEY + '&randomKey:' + nonce + '&signature:' + independent,
  );
});

test('IYZ-01C request amount formatting matches official formatPrice semantics without rounding', async () => {
  for (const [minor, wire] of [
    [1, '0.01'],
    [100, '1.0'],
    [1050, '10.5'],
    [1051, '10.51'],
    [100000000, '1000000.0'],
  ]) {
    const f = fixture((_url, init) => {
      const b = JSON.parse(init.body);
      const r = success({ price: minor / 100 });
      r.conversationId = b.conversationId;
      r.paymentId = b.paymentId;
      r.signature = sign([r.paymentId, r.conversationId]);
      return json(r);
    });
    const r = await f.client.refund({ ...input(), amountMinor: minor });
    assert.equal(r.ok, true);
    assert.equal(JSON.parse(f.requests[0].init.body).price, wire);
  }
});

test('IYZ-01C verifies official Refund V2 response signature field order and exact amount', async () => {
  const f = fixture();
  assert.deepEqual(await f.client.refund(input()), {
    ok: true,
    value: {
      kind: 'verified_sandbox_refund',
      conversationId: 'refund-attempt-1',
      paymentId: '25180208',
      amountMinor: 1500,
      currency: 'TRY',
    },
  });
});

test('IYZ-01C valid-looking success cannot substitute payment, conversation, currency, amount or signature', async (t) => {
  for (const [name, change] of [
    ['payment', { paymentId: '25180209' }],
    ['conversation', { conversationId: 'other' }],
    ['currency', { currency: 'USD' }],
    ['price-low', { price: 14.99 }],
    ['price-high', { price: 15.01 }],
    ['fractional-cent', { price: '15.0001' }],
  ]) {
    await t.test(name, async () => {
      const f = fixture(() => json(success(change)));
      assert.deepEqual(await f.client.refund(input()), { ok: false, code: 'INVALID_RESPONSE' });
    });
  }
  for (const signature of [undefined, 'a'.repeat(64), 'g'.repeat(64), 'abcd']) {
    const r = { ...success(), signature };
    const f = fixture(() => json(r));
    assert.deepEqual(await f.client.refund(input()), { ok: false, code: 'INVALID_RESPONSE' });
  }
});

test('IYZ-01C provider/API failure stays unconfirmed and never auto-retries', async () => {
  for (const factory of [
    async () => new Response('private', { status: 500 }),
    async () => new Response('private', { status: 302 }),
    async () => json({ status: 'failure', errorMessage: 'private' }),
    async () => { throw Error('private'); },
  ]) {
    const f = fixture(factory);
    assert.deepEqual(await f.client.refund(input()), { ok: false, code: 'UNCONFIRMED' });
    assert.equal(f.requests.length, 1);
  }
});

test('IYZ-01C invalid input performs zero provider calls', async () => {
  const variants = [
    null,
    {},
    { ...input(), amountMinor: 0 },
    { ...input(), amountMinor: 1.2 },
    { ...input(), paymentId: 'abc' },
    { ...input(), conversationId: 'bad:value' },
    { ...input(), ip: '999.1.1.1' },
    { ...input(), ip: 'not-an-ip' },
    { ...input(), currency: 'TRY' },
  ];
  for (const value of variants) {
    const f = fixture();
    assert.deepEqual(await f.client.refund(value), { ok: false, code: 'INVALID_INPUT' });
    assert.equal(f.requests.length, 0);
  }
});

test('IYZ-01C accepts bounded IPv6 source address', async () => {
  const f = fixture();
  assert.equal((await f.client.refund({ ...input(), ip: '2001:db8::1' })).ok, true);
});

test('IYZ-01C timeout and caller abort remain unconfirmed, cancel transport and never retry', async () => {
  const slow = fixture(() => new Promise(() => {}), 20);
  const timed = await slow.client.refund(input());
  assert.deepEqual(timed, { ok: false, code: 'UNCONFIRMED' });
  assert.equal(slow.requests.length, 1);
  assert.equal(slow.requests[0].init.signal.aborted, true);

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const aborting = fixture(async () => {
    await gate;
    return json(success());
  });
  const controller = new AbortController();
  const pending = aborting.client.refund(input(), controller.signal);
  while (aborting.requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  controller.abort();
  assert.deepEqual(await pending, { ok: false, code: 'UNCONFIRMED' });
  release();
  assert.equal(aborting.requests.length, 1);
});

test('IYZ-01C mutable caller input cannot rewrite expected binding after request starts', async () => {
  const original = input();
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const f = fixture(async () => {
    await gate;
    return json(success());
  });
  const pending = f.client.refund(original);
  while (f.requests.length === 0) await new Promise((resolve) => setTimeout(resolve, 1));
  original.paymentId = '99999';
  original.amountMinor = 1;
  original.conversationId = 'other';
  release();
  const r = await pending;
  assert.equal(r.ok, true);
  assert.equal(r.value.paymentId, '25180208');
  assert.equal(r.value.amountMinor, 1500);
});

test('IYZ-01C malformed or oversized response never verifies', async () => {
  for (const body of ['not json', 'null', '[]', '"text"', ' '.repeat(64 * 1024 + 1)]) {
    const f = fixture(() => new Response(body));
    const r = await f.client.refund(input());
    assert.equal(r.ok, false);
  }
});

test('IYZ-01C invalid configuration fails at construction and has no global network fallback', () => {
  for (const [e, o] of [
    [{}, {}],
    [env, { timeoutMs: 0 }],
    [env, { timeoutMs: 30001 }],
    [{ ...env, IYZICO_SANDBOX_API_KEY: 'bad&key' }, {}],
  ]) {
    assert.throws(
      () => createIyzicoSandboxRefundClient(e, async () => json(success()), o),
      /IYZICO_SANDBOX_REFUND_CONFIGURATION_INVALID/,
    );
  }
  assert.throws(
    () => createIyzicoSandboxRefundClient(env, undefined, {}),
    /IYZICO_SANDBOX_REFUND_CONFIGURATION_INVALID/,
  );
});
