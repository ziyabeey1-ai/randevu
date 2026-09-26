# IYZ-02A: durable iyzico payment attempts and atomic F14 ledger bridge

## State and ownership

User direction: continue iyzico while the other agent completes MVP/G16, without overwriting their files.

This candidate is intentionally stacked on G16 PR #627 exact parent `70d6a9efe0de1b1ca740c93d46292dd605b4be05`. It does not mutate the parent branch. Coordination receipt: Issue #65 comment `5849408657`.

Proposed task identity: **IYZ-02A**. Size **L / FOCUSED** because it changes persistent money authority, callback capability access, lock ordering and the F14 ledger. This handoff is implementer/coordinator evidence only. Independent payment/DB review is required before integration.

Canonical `TASKS.md` is not modified in this child because #627 currently owns that shared file. Therefore this PR must remain draft and cannot be treated as a registered/merge-ready task until the active coordinator writes the IYZ track after the parent handoff.

## Files

- `supabase/migrations/20260926223000_iyzico_payment_attempts.sql`
- `supabase/tests/iyzico_payment_attempts.sql`
- `supabase/tests/iyzico_payment_attempts_concurrency.sql`
- `scripts/ci-postgres-plan.json`: child appends one three-step IYZ group on top of #627's exact plan
- this handoff

No existing migration, `worker/app.ts`, staging workflow/script, provider adapter, ticket HTTP code, Netgsm code or F17 product code is changed.

## Frozen first-slice product rule

IYZ-02A is deliberately **full-balance operator-initiated online card payment only**.

An authenticated member with the accepted F14 `payments_write` authority can reserve the ticket's exact current remaining TRY balance. Partial payments, deposits and anonymous/public customer payment initiation are not silently invented here.

Provider confirmation does not create a second financial model. A normal verified iyzico charge inserts one existing F14 `ticket_payment_events` row with `event_type=payment`, `payment_method=card` and the membership that initiated the external checkout as the audit actor.

## Durable attempt model

`public.iyzico_payment_attempts` is FORCE RLS and has no table grants for `anon` or `authenticated`.

The attempt binds:

- business and ticket;
- initiating membership;
- Sandbox merchant/account reference;
- exact server-derived amount and TRY currency;
- ticket version at reservation;
- idempotency key + request hash;
- provider token hash;
- opaque Worker-encrypted token envelope for later reconciliation;
- independent callback-capability hash;
- checkout expiry;
- provider payment ID after verified charge;
- resulting F14 payment event when applied;
- explicit reconciliation reason when a real charge cannot safely enter the ticket ledger.

Raw provider token and iyzico API secrets are not stored by this schema.

One unresolved attempt per ticket is enforced for `reserved`, `initialized` and `charged_unapplied`. The latter deliberately blocks a fresh charge until a later reconciliation/refund decision.

## Functions

### `reserve_iyzico_payment_attempt_guarded`

Requires the existing F14 standard-session + `payments_write` actor. It accepts no client amount. Under the ticket row lock it derives the F14 projection and reserves exactly the remaining balance only when:

- ticket is open;
- final total is settlement-ready;
- currency is TRY;
- remaining balance is positive;
- no unresolved external payment attempt exists.

Exact idempotency-key replay returns the same attempt. Same key/different request hash is rejected.

### `bind_iyzico_payment_checkout_guarded`

Requires the same initiating financial actor. It changes `reserved -> initialized` and stores only hash/ciphertext/capability/expiry fields. Same initialized binding can replay; conflicting binding is rejected.

### `lookup_iyzico_payment_attempt_callback`

Narrow provider-callback lookup, callable by `anon` only through unguessable account+token-hash+capability-hash facts. It returns no PII or ciphertext. The underlying table stays inaccessible.

### `commit_iyzico_verified_payment`

This is the atomic database side of the IYZ-01B receiver port. It does **not** verify provider HMAC itself; the Worker/provider adapter already does that. The DB verifies the durable attempt capability and immutable amount/currency binding.

Global completion lock order is **attempt -> ticket**. Provider payment ID is unique per Sandbox account.

Normal case:
1. lock attempt;
2. bind verified provider payment ID;
3. lock ticket;
4. recheck open status, reserved ticket version, settlement readiness, TRY and exact unchanged remaining balance;
5. insert exactly one existing F14 card payment event;
6. atomically bind the attempt to that event as `charged_applied`.

Replay with the same provider payment ID returns `already_applied`.

### Real-charge race: `charged_unapplied`

A real provider charge must never disappear merely because local ticket truth changed while the customer was on the payment page.

If the ticket was closed/cancelled, its version changed, settlement became non-final, currency changed, or another valid payment changed the balance, the function writes **no extra F14 payment event**. Instead the provider payment ID is durably retained as `charged_unapplied` with a bounded reconciliation reason.

This protects both truths simultaneously:

- F14 never violates paid <= total;
- a real external charge is never silently discarded.

The unresolved row remains a blocker for another iyzico charge until a later reconciliation/refund slice resolves it.

## Concurrency acceptance

The dedicated dblink race starts two identical provider callbacks against one initialized attempt while a blocker holds the attempt row.

Acceptance target:
- one callback returns `applied`;
- one returns `already_applied`;
- exactly one F14 payment event exists;
- final paid amount equals ticket total and balance is zero.

A separate semantic case opens a full-balance checkout, records a valid 10,000 minor-unit manual payment, then delivers a verified 60,000 provider charge. Expected state is `charged_unapplied / ticket_balance_changed`, with only the manual 10,000 in the F14 ledger.

## Security / Supabase notes

Skills read:
- `supabase:supabase`
- `supabase:supabase-postgres-best-practices`

Applied guidance:
- FORCE RLS and no direct table grants;
- explicit `REVOKE ALL` on every SECURITY DEFINER helper before narrow grants;
- capability-bound anon functions instead of ordinary session privilege;
- consistent attempt -> ticket lock order for provider completion;
- composite/partial unique indexes match callback and active-attempt access patterns.

Supabase changelog markdown was requested as required by the skill, but the available web reader rejected `text/markdown`; no unverified breaking-change assertion is made. The Supabase CLI is not installed in this environment, so `supabase migration new` could not be truthfully run. The filename follows this repository's timestamp migration convention.

## Not in IYZ-02A

- public/anonymous customer payment initiation;
- partial payment/deposit policy;
- online refund DB attempt/ledger commit;
- reconciliation worker or operator UI;
- route/env/secret wiring;
- actual Sandbox charge;
- iyzico live application/production activation;
- merchant/salon settlement model.

Provider candidates #642/#643/#645 remain separate stacked drafts. This DB slice can be reviewed independently and later joined in a bounded route integration after parent #627 lands.

## Validation boundary

The GitHub exact-head PostgreSQL plan is authoritative for this published migration because there is no local PostgreSQL/Supabase CLI in this container. CI must execute:

1. the migration;
2. semantic payment-attempt acceptance;
3. dblink duplicate-callback concurrency acceptance.

Any SQL or invariant failure stays red and is repaired on the exact candidate. No PASS is claimed before that run completes.
