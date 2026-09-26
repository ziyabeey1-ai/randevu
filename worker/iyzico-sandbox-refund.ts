/**
 * IYZ-01C: isolated Sandbox Refund V2 adapter candidate.
 * No router, database, global fetch fallback, environment auto-read or import-time I/O.
 * A verified refund response is provider evidence only; it does not mutate the ticket ledger.
 */
export type IyzicoRefundEnv = {
  IYZICO_SANDBOX_API_KEY?: string;
  IYZICO_SANDBOX_SECRET_KEY?: string;
};
export type RefundTransport = (url: string, init: RequestInit) => Promise<Response>;
export type SandboxRefundInput = {
  conversationId: string;
  paymentId: string;
  amountMinor: number;
  ip: string;
};
export type VerifiedSandboxRefund = {
  kind: 'verified_sandbox_refund';
  conversationId: string;
  paymentId: string;
  amountMinor: number;
  currency: 'TRY';
};
export type RefundResult =
  | { ok: true; value: VerifiedSandboxRefund }
  | { ok: false; code: 'INVALID_INPUT' | 'UNCONFIRMED' | 'INVALID_RESPONSE' };

const API = 'https://sandbox-api.iyzipay.com';
const REFUND = '/v2/payment/refund';
const REQUEST_LIMIT = 16 * 1024;
const RESPONSE_LIMIT = 64 * 1024;
const MAX_MINOR = 100_000_000;
const encoder = new TextEncoder();
const fail = (code: 'INVALID_INPUT' | 'UNCONFIRMED' | 'INVALID_RESPONSE') => ({ ok: false, code } as const);

function text(value: unknown, max = 256): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}
function identifier(value: unknown): value is string {
  return text(value, 128) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(value);
}
function providerPaymentId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9][0-9]{0,31}$/u.test(value);
}
function minor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= MAX_MINOR;
}
function ipValue(value: unknown): value is string {
  if (!text(value, 64)) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/u.test(value)) {
    return value.split('.').every((part) => String(Number(part)) === part && Number(part) <= 255);
  }
  if (!/^[0-9A-Fa-f:.]+$/u.test(value) || !value.includes(':')) return false;
  try {
    const parsed = new URL('http://[' + value + ']/');
    return parsed.hostname.length > 2;
  } catch { return false; }
}
/** Match iyzico SDK formatPrice semantics: 15.00 -> 15.0, 10.50 -> 10.5, 0.01 -> 0.01. */
function requestPrice(value: number): string {
  const whole = Math.floor(value / 100);
  const cents = value % 100;
  if (cents === 0) return String(whole) + '.0';
  if (cents % 10 === 0) return String(whole) + '.' + String(cents / 10);
  return String(whole) + '.' + String(cents).padStart(2, '0');
}
function responseMinor(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const match = /^(0|[1-9]\d{0,6})(?:\.(\d{1,8}))?$/u.exec(String(value));
  if (!match) return null;
  const fraction = match[2] ?? '';
  if (/[1-9]/u.test(fraction.slice(2))) return null;
  const amount = Number(match[1]) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  return minor(amount) ? amount : null;
}
async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
async function hexHmac(key: CryptoKey, data: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
async function verifyResponseSignature(key: CryptoKey, supplied: unknown, fields: string[]): Promise<boolean> {
  if (typeof supplied !== 'string' || !/^[0-9a-fA-F]{64}$/u.test(supplied)) return false;
  const bytes = new Uint8Array(32);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(supplied.slice(i * 2, i * 2 + 2), 16);
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(fields.join(':')));
}
async function boundedJson(response: Response): Promise<Record<string, unknown> | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let raw = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > RESPONSE_LIMIT) {
        void reader.cancel().catch(() => {});
        return null;
      }
      raw += decoder.decode(part.value, { stream: true });
    }
    raw += decoder.decode();
    const value: unknown = JSON.parse(raw);
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export function createIyzicoSandboxRefundClient(
  env: IyzicoRefundEnv,
  transport: RefundTransport,
  options: { timeoutMs?: number } = {},
) {
  const apiKey = env?.IYZICO_SANDBOX_API_KEY;
  const secret = env?.IYZICO_SANDBOX_SECRET_KEY;
  const timeoutMs = options.timeoutMs ?? 8000;
  if (!text(apiKey, 512) || !/^[A-Za-z0-9._-]+$/u.test(apiKey)
    || !text(secret, 512) || typeof transport !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('IYZICO_SANDBOX_REFUND_CONFIGURATION_INVALID');
  }
  const safeApiKey = apiKey;
  const safeSecret = secret;

  return Object.freeze({
    async refund(input: SandboxRefundInput, signal?: AbortSignal): Promise<RefundResult> {
      if (!input || typeof input !== 'object'
        || Object.keys(input).some((key) => !['conversationId', 'paymentId', 'amountMinor', 'ip'].includes(key))
        || !identifier(input.conversationId) || !providerPaymentId(input.paymentId)
        || !minor(input.amountMinor) || !ipValue(input.ip)
        || (signal !== undefined && !(signal instanceof AbortSignal))) return fail('INVALID_INPUT');

      const expected = Object.freeze({
        conversationId: input.conversationId,
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        ip: input.ip,
      });
      const body = {
        locale: 'tr', conversationId: expected.conversationId, paymentId: expected.paymentId,
        price: requestPrice(expected.amountMinor), currency: 'TRY', ip: expected.ip,
      };
      const serialized = JSON.stringify(body);
      if (encoder.encode(serialized).byteLength > REQUEST_LIMIT) return fail('INVALID_INPUT');

      const controller = new AbortController();
      const combined = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let response: Response | undefined;
      let resolveAbort: ((value: RefundResult) => void) | undefined;
      const onAbort = () => {
        void response?.body?.cancel().catch(() => {});
        resolveAbort?.(fail('UNCONFIRMED'));
      };
      const aborted = new Promise<RefundResult>((resolve) => {
        resolveAbort = resolve;
        if (combined.aborted) resolve(fail('UNCONFIRMED'));
        else combined.addEventListener('abort', onAbort, { once: true });
      });
      const timeout = new Promise<RefundResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(fail('UNCONFIRMED'));
        }, timeoutMs);
      });
      const work = (async (): Promise<RefundResult> => {
        try {
          if (combined.aborted) return fail('UNCONFIRMED');
          const key = await importKey(safeSecret);
          const nonce = crypto.randomUUID().replaceAll('-', '');
          const mac = await hexHmac(key, nonce + REFUND + serialized);
          if (combined.aborted) return fail('UNCONFIRMED');
          const authorization = btoa('apiKey:' + safeApiKey + '&randomKey:' + nonce + '&signature:' + mac);
          response = await transport(API + REFUND, {
            method: 'POST',
            headers: {
              Authorization: 'IYZWSv2 ' + authorization,
              'x-iyzi-rnd': nonce,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: serialized,
            signal: combined,
            redirect: 'error',
            credentials: 'omit',
            cache: 'no-store',
          });
          if (combined.aborted) {
            void response.body?.cancel().catch(() => {});
            return fail('UNCONFIRMED');
          }
          if (response.status !== 200 || response.redirected
            || (response.url && response.url !== API + REFUND)) {
            void response.body?.cancel().catch(() => {});
            return fail('UNCONFIRMED');
          }
          const parsed = await boundedJson(response);
          if (combined.aborted) return fail('UNCONFIRMED');
          if (!parsed) return fail('INVALID_RESPONSE');
          if (parsed.status !== 'success') return fail('UNCONFIRMED');
          if (parsed.conversationId !== expected.conversationId
            || parsed.paymentId !== expected.paymentId
            || parsed.currency !== 'TRY'
            || responseMinor(parsed.price) !== expected.amountMinor) return fail('INVALID_RESPONSE');
          if (!await verifyResponseSignature(key, parsed.signature, [expected.paymentId, expected.conversationId])) {
            return fail('INVALID_RESPONSE');
          }
          return { ok: true, value: {
            kind: 'verified_sandbox_refund',
            conversationId: expected.conversationId,
            paymentId: expected.paymentId,
            amountMinor: expected.amountMinor,
            currency: 'TRY',
          } };
        } catch { return fail('UNCONFIRMED'); }
      })();
      try { return await Promise.race([work, timeout, aborted]); }
      finally {
        clearTimeout(timer);
        combined.removeEventListener('abort', onAbort);
      }
    },
  });
}
