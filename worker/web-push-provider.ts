const encoder = new TextEncoder();

export const WEB_PUSH_MAX_PAYLOAD_BYTES = 3_993;
export const WEB_PUSH_RECORD_SIZE = 4_096;
export const WEB_PUSH_MAX_TIMEOUT_MS = 15_000;

export type WebPushEvent =
  | 'appointment.created'
  | 'appointment.changed'
  | 'appointment.cancelled'
  | 'appointment.reminder'
  | 'push.test';

const WEB_PUSH_EVENTS: ReadonlySet<string> = new Set<WebPushEvent>([
  'appointment.created',
  'appointment.changed',
  'appointment.cancelled',
  'appointment.reminder',
  'push.test',
]);

export type WebPushPayload = Readonly<{
  v: 1;
  event: WebPushEvent;
}>;

export type WebPushSubscription = Readonly<{
  endpoint: string;
  keys: Readonly<{ p256dh: string; auth: string }>;
}>;

export type VapidCredentials = Readonly<{
  subject: `mailto:${string}` | `https://${string}`;
  publicKey: string;
  privateKeyJwk: JsonWebKey;
}>;

export type WebPushResult =
  | Readonly<{ category: 'accepted'; providerStatus: 201 | 202 }>
  | Readonly<{ category: 'expired'; providerStatus: 404 | 410; deleteSubscription: true }>
  | Readonly<{ category: 'retry'; providerStatus: number | null; retryAfterSeconds?: number }>
  | Readonly<{ category: 'terminal'; providerStatus: number | null; reason: 'invalid-input' | 'crypto' | 'provider-response' }>;

export type SendWebPushOptions = Readonly<{
  subscription: WebPushSubscription;
  payload: WebPushPayload;
  vapid: VapidCredentials;
  ttlSeconds?: number;
  timeoutMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
}>;

function concat(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function strictBase64Url(value: string, expectedLength: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) throw new Error('invalid base64url');
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
  if (bytes.length !== expectedLength || base64Url(bytes) !== value) throw new Error('invalid base64url');
  return bytes;
}

function validEndpoint(raw: string) {
  let endpoint: URL;
  try { endpoint = new URL(raw); } catch { throw new Error('invalid endpoint'); }
  const provider = endpoint.hostname === 'fcm.googleapis.com'
    ? endpoint.pathname.startsWith('/fcm/send/')
    : endpoint.hostname === 'updates.push.services.mozilla.com'
      ? endpoint.pathname.startsWith('/wpush/v2/')
      : endpoint.hostname.endsWith('.push.apple.com') && endpoint.hostname !== 'push.apple.com'
        ? /^\/[A-Za-z0-9_-]+$/.test(endpoint.pathname)
        : false;
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password ||
      (endpoint.port && endpoint.port !== '443') || endpoint.search || endpoint.hash || !provider) {
    throw new Error('invalid endpoint');
  }
  return endpoint;
}

function validatePayload(payload: WebPushPayload) {
  if (payload.v !== 1 || !WEB_PUSH_EVENTS.has(payload.event)) throw new Error('invalid payload');
  const ownKeys = Object.keys(payload).sort();
  if (ownKeys.join(',') !== 'event,v') throw new Error('invalid payload');
  const bytes = encoder.encode(JSON.stringify({ v: 1, event: payload.event }));
  if (bytes.length > WEB_PUSH_MAX_PAYLOAD_BYTES) throw new Error('payload too large');
  return bytes;
}

async function hmac(keyBytes: Uint8Array, data: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', arrayBuffer(keyBytes), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, arrayBuffer(data)));
}

async function hkdfExtract(salt: Uint8Array, input: Uint8Array) {
  return hmac(salt, input);
}

async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number) {
  const output = await hmac(prk, concat(info, new Uint8Array([1])));
  return output.slice(0, length);
}

export async function createWebPushRecord(
  plaintext: Uint8Array,
  receiverPublic: Uint8Array,
  authSecret: Uint8Array,
  senderKeys: CryptoKeyPair,
  salt: Uint8Array,
) {
  if (plaintext.length > WEB_PUSH_MAX_PAYLOAD_BYTES || receiverPublic.length !== 65 || receiverPublic[0] !== 4 ||
      authSecret.length !== 16 || salt.length !== 16) throw new Error('invalid Web Push record input');
  const receiverKey = await crypto.subtle.importKey('raw', arrayBuffer(receiverPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', senderKeys.publicKey));
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: receiverKey }, senderKeys.privateKey, 256));
  const authPrk = await hkdfExtract(authSecret, shared);
  const ikm = await hkdfExpand(authPrk, concat(encoder.encode('WebPush: info\0'), receiverPublic, senderPublic), 32);
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, encoder.encode('Content-Encoding: nonce\0'), 12);
  const aesKey = await crypto.subtle.importKey('raw', arrayBuffer(cek), 'AES-GCM', false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(nonce) }, aesKey, arrayBuffer(concat(plaintext, new Uint8Array([2])))));
  const header = new Uint8Array(21 + senderPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, WEB_PUSH_RECORD_SIZE);
  header[20] = senderPublic.length;
  header.set(senderPublic, 21);
  return concat(header, ciphertext);
}

async function encryptPayload(plaintext: Uint8Array, receiverPublic: Uint8Array, authSecret: Uint8Array) {
  const senderKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return createWebPushRecord(plaintext, receiverPublic, authSecret, senderKeys, salt);
}

function validSubject(subject: string) {
  let url: URL;
  try { url = new URL(subject); } catch { return false; }
  if (url.protocol === 'mailto:') return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(url.pathname) && !url.search && !url.hash;
  return url.protocol === 'https:' && !url.username && !url.password && Boolean(url.hostname) && !url.hash;
}

function validVapid(vapid: VapidCredentials) {
  const publicKey = strictBase64Url(vapid.publicKey, 65);
  if (publicKey[0] !== 4 || !vapid.privateKeyJwk || vapid.privateKeyJwk.kty !== 'EC' ||
      vapid.privateKeyJwk.crv !== 'P-256' || vapid.privateKeyJwk.d === undefined ||
      !validSubject(vapid.subject)) {
    throw new Error('invalid VAPID credentials');
  }
  const x = strictBase64Url(vapid.privateKeyJwk.x ?? '', 32);
  const y = strictBase64Url(vapid.privateKeyJwk.y ?? '', 32);
  strictBase64Url(vapid.privateKeyJwk.d, 32);
  const jwkPublic = concat(new Uint8Array([4]), x, y);
  if (!publicKey.every((byte, index) => byte === jwkPublic[index])) {
    throw new Error('VAPID key mismatch');
  }
  return publicKey;
}

async function vapidAuthorization(endpoint: URL, credentials: VapidCredentials, nowMs: number) {
  const publicKey = validVapid(credentials);
  const expires = Math.floor(nowMs / 1000) + 12 * 60 * 60;
  const encodedHeader = base64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const encodedClaims = base64Url(encoder.encode(JSON.stringify({ aud: endpoint.origin, exp: expires, sub: credentials.subject })));
  const unsigned = `${encodedHeader}.${encodedClaims}`;
  const key = await crypto.subtle.importKey('jwk', credentials.privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(unsigned)));
  if (signature.length !== 64) throw new Error('invalid ECDSA signature');
  return `vapid t=${unsigned}.${base64Url(signature)}, k=${base64Url(publicKey)}`;
}

function retryAfter(response: Response, nowMs: number) {
  const value = response.headers.get('Retry-After');
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Math.min(Number(value), 86_400);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.min(86_400, Math.max(0, Math.ceil((date - nowMs) / 1000))) : undefined;
}

export async function sendWebPush(options: SendWebPushOptions): Promise<WebPushResult> {
  const nowMs = (options.now ?? Date.now)();
  const ttl = options.ttlSeconds ?? 300;
  const timeoutMs = options.timeoutMs ?? 10_000;
  let endpoint: URL;
  let receiverPublic: Uint8Array;
  let authSecret: Uint8Array;
  let plaintext: Uint8Array;
  try {
    if (!Number.isFinite(nowMs) || !Number.isInteger(ttl) || ttl < 0 || ttl > 86_400 ||
        !Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > WEB_PUSH_MAX_TIMEOUT_MS) throw new Error('invalid options');
    endpoint = validEndpoint(options.subscription.endpoint);
    receiverPublic = strictBase64Url(options.subscription.keys.p256dh, 65);
    if (receiverPublic[0] !== 4) throw new Error('invalid receiver key');
    authSecret = strictBase64Url(options.subscription.keys.auth, 16);
    plaintext = validatePayload(options.payload);
    validVapid(options.vapid);
  } catch {
    return { category: 'terminal', providerStatus: null, reason: 'invalid-input' };
  }

  let body: Uint8Array;
  let authorization: string;
  try {
    body = await encryptPayload(plaintext, receiverPublic, authSecret);
    authorization = await vapidAuthorization(endpoint, options.vapid, nowMs);
  } catch {
    return { category: 'terminal', providerStatus: null, reason: 'crypto' };
  }

  const controller = new AbortController();
  let timeoutReject: (reason: Error) => void = () => undefined;
  const timeout = new Promise<never>((_resolve, reject) => { timeoutReject = reject; });
  const timer = setTimeout(() => {
    controller.abort();
    timeoutReject(new Error('web push timeout'));
  }, timeoutMs);
  let response: Response;
  try {
    response = await Promise.race([
      (options.fetchImpl ?? fetch)(endpoint, {
        method: 'POST', redirect: 'manual', signal: controller.signal, body: arrayBuffer(body),
        headers: { Authorization: authorization, 'Content-Encoding': 'aes128gcm', TTL: String(ttl), 'Content-Type': 'application/octet-stream' },
      }),
      timeout,
    ]);
  } catch {
    return { category: 'retry', providerStatus: null };
  } finally {
    clearTimeout(timer);
  }
  void response.body?.cancel().catch(() => undefined);
  if (response.status === 201 || response.status === 202) return { category: 'accepted', providerStatus: response.status };
  if (response.status === 404 || response.status === 410) return { category: 'expired', providerStatus: response.status, deleteSubscription: true };
  if (response.status === 429 || response.status >= 500) {
    const delay = retryAfter(response, nowMs);
    return delay === undefined
      ? { category: 'retry', providerStatus: response.status }
      : { category: 'retry', providerStatus: response.status, retryAfterSeconds: delay };
  }
  return { category: 'terminal', providerStatus: response.status, reason: 'provider-response' };
}
