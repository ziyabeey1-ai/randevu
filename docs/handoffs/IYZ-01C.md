# IYZ-01C: isolated Sandbox Refund V2 provider adapter

## State and scope

User direction on 26 September 2026: continue iyzico while the other agent completes MVP/F17. This slice stays outside the shared runtime/database lane.

- Parent: PR #643 exact head 7462e196e79a5777fe51e12bc57f7d66bfc0f55c.
- Parent automatic CI #3094 / run 36258910730 is verified SUCCESS.
- Proposed branch: iyz-01c-sandbox-refund-provider, stacked on iyz-01b-sandbox-result-receiver.
- Coordination receipt: Issue #65 comment 5849277064.
- Size M / FOCUSED. Provider money semantics require independent review before integration.
- Three NEW paths only: worker/iyzico-sandbox-refund.ts, tests/iyzico-sandbox-refund.test.mjs, this handoff.

No worker/app.ts, tickets/auth code, existing financial functions, migrations, TASKS, package/lockfile, CI/staging/deploy or Netgsm/F17 files are changed. No route is registered and no real secret/provider request is used.

## Implemented contract

createIyzicoSandboxRefundClient exposes one refund operation for iyzico Sandbox Refund V2.

- Fixed origin https://sandbox-api.iyzipay.com and fixed POST /v2/payment/refund; no live fallback or request-selected origin.
- Explicit injected transport; no global fetch fallback, process.env, logging or import-time I/O.
- Request contains only server-provided conversationId, provider paymentId, exact integer minor amount and caller IP plus fixed locale=tr/currency=TRY.
- Provider payment IDs are decimal strings; amount is 1..100,000,000 minor units. IPv4/IPv6 input is validated.
- Refund request amount formatting follows the official SDK formatPrice semantics and never rounds fractional cents.
- IYZWSv2 signs exact nonce + path + exact serialized JSON body with HMAC-SHA256. Redirects and credentials are disabled; no automatic retry exists.
- Response is accepted only for HTTP 200, API status=success, matching conversation/payment/currency, exact requested amount and a valid response signature over paymentId:conversationId, matching the official Refund V2 sample.
- Success returns only verified_sandbox_refund evidence. It does not create a local refund event, modify an adisyon, change outstanding balance or imply settlement.
- Provider rejection, network error or timeout remains UNCONFIRMED; the adapter does not automatically submit another refund.
- Total deadline and optional caller AbortSignal cancel the provider transport. A local regression test caught and closed a case where a transport ignoring AbortSignal could hold the caller until the internal timeout.

## Actual local evidence

Node v22.16.0:
- Refund tests: 17 PASS / 0 FAIL / 0 SKIP, 11 top-level tests.
- Strict isolated TypeScript check: PASS.
- Fabricated API keys, injected transport, real Web Crypto and independent Node HMAC.
- Global fetch calls: zero.

Coverage includes exact request authorization/body/path, amount formatting, response signature order, wrong ID/currency/amount/signature, provider failure, no-retry behavior, invalid input, IPv6, timeout, caller abort, mutable caller data, malformed/oversized response and invalid configuration.

This is not repository full CI, PostgreSQL acceptance or real Sandbox proof. Automatic exact-head CI must be read after publication.

## Official provider sources checked

Current official iyzico/iyzipay-node master was read before implementation:
- lib/resources/RefundV2.js: POST /v2/payment/refund.
- lib/requests/CreateRefundV2Request.js: locale, conversationId, formatted price, paymentId, currency and ip.
- samples/IyziPayRefundV2Samples.js: successful result signature verified over paymentId and conversationId.
- lib/utils.js: IYZWSv2 body authentication and formatPrice behavior.

The official SDK is protocol evidence only and is not added as a dependency.

## Still open

- Durable authorized refund-attempt state and exact source provider-payment binding.
- Atomic sequence: verified provider refund -> matching local ticket_payment_events refund, with idempotency and current source-net checks.
- Unknown/refund reconciliation after timeout or response loss. Local UNCONFIRMED is not proof that iyzico did not refund.
- Real Sandbox refund against a previously verified Sandbox payment followed by provider/local ledger reconciliation.
- Route/env wiring after shared PR #627 hands off. #627 currently touches worker/app.ts, TASKS, staging and the migration execution plan, so this PR deliberately does not compete for them.
- Production merchant/salon money-flow agreement and live activation.

Next after this provider slice: once shared writer ownership clears, implement the durable payment/refund attempt migration and atomic ledger RPC in one bounded DB slice rather than another in-memory abstraction.
