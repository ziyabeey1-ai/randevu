begin;

-- IYZ-02A: durable Sandbox payment attempts and atomic bridge into the
-- already-accepted F14 ticket payment ledger. This first DB slice settles the
-- full current ticket balance only; partial/deposit and public-customer payment
-- authority stay outside this migration.

create table public.iyzico_payment_attempts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id),
  ticket_id uuid not null,
  created_by_membership_id uuid not null,
  account_ref text not null
    check (account_ref ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  environment text not null default 'sandbox'
    check (environment = 'sandbox'),
  amount_minor integer not null
    check (amount_minor between 1 and 100000000),
  currency text not null default 'TRY'
    check (currency = 'TRY'),
  ticket_version integer not null
    check (ticket_version >= 1),
  idempotency_key text not null
    check (char_length(idempotency_key) between 8 and 128),
  request_hash text not null
    check (request_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'reserved'
    check (status in ('reserved','initialized','charged_applied','charged_unapplied')),
  token_hash text
    check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  token_ciphertext text
    check (
      token_ciphertext is null
      or (
        char_length(token_ciphertext) between 16 and 4096
        and token_ciphertext !~ '[[:cntrl:]]'
      )
    ),
  callback_capability_hash text
    check (
      callback_capability_hash is null
      or callback_capability_hash ~ '^[0-9a-f]{64}$'
    ),
  checkout_expires_at timestamptz,
  provider_payment_id text
    check (
      provider_payment_id is null
      or provider_payment_id ~ '^[1-9][0-9]{0,31}$'
    ),
  payment_event_id uuid,
  reconciliation_reason text
    check (
      reconciliation_reason is null
      or reconciliation_reason in (
        'ticket_not_open',
        'ticket_revision_changed',
        'settlement_not_ready',
        'ticket_currency_changed',
        'ticket_balance_changed'
      )
    ),
  initialized_at timestamptz,
  verified_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint iyzico_payment_attempts_business_ticket_fk
    foreign key (business_id, ticket_id)
    references public.tickets(business_id, id),
  constraint iyzico_payment_attempts_membership_fk
    foreign key (business_id, created_by_membership_id)
    references public.memberships(business_id, id),
  constraint iyzico_payment_attempts_payment_event_fk
    foreign key (business_id, ticket_id, payment_event_id)
    references public.ticket_payment_events(business_id, ticket_id, id),
  constraint iyzico_payment_attempts_idempotency_key
    unique (business_id, created_by_membership_id, idempotency_key),
  constraint iyzico_payment_attempts_state_shape
    check (
      (
        status = 'reserved'
        and token_hash is null
        and token_ciphertext is null
        and callback_capability_hash is null
        and checkout_expires_at is null
        and provider_payment_id is null
        and payment_event_id is null
        and reconciliation_reason is null
        and initialized_at is null
        and verified_at is null
        and applied_at is null
      )
      or
      (
        status = 'initialized'
        and token_hash is not null
        and token_ciphertext is not null
        and callback_capability_hash is not null
        and checkout_expires_at is not null
        and provider_payment_id is null
        and payment_event_id is null
        and reconciliation_reason is null
        and initialized_at is not null
        and verified_at is null
        and applied_at is null
      )
      or
      (
        status = 'charged_applied'
        and token_hash is not null
        and token_ciphertext is not null
        and callback_capability_hash is not null
        and checkout_expires_at is not null
        and provider_payment_id is not null
        and payment_event_id is not null
        and reconciliation_reason is null
        and initialized_at is not null
        and verified_at is not null
        and applied_at is not null
      )
      or
      (
        status = 'charged_unapplied'
        and token_hash is not null
        and token_ciphertext is not null
        and callback_capability_hash is not null
        and checkout_expires_at is not null
        and provider_payment_id is not null
        and payment_event_id is null
        and reconciliation_reason is not null
        and initialized_at is not null
        and verified_at is not null
        and applied_at is null
      )
    )
);

create unique index iyzico_payment_attempts_token_key
  on public.iyzico_payment_attempts(environment, account_ref, token_hash)
  where token_hash is not null;

create unique index iyzico_payment_attempts_provider_payment_key
  on public.iyzico_payment_attempts(environment, account_ref, provider_payment_id)
  where provider_payment_id is not null;

create unique index iyzico_payment_attempts_event_key
  on public.iyzico_payment_attempts(payment_event_id)
  where payment_event_id is not null;

-- One unresolved external-money lane per ticket. charged_unapplied remains
-- intentionally blocking until a later reconciliation/refund decision.
create unique index iyzico_payment_attempts_active_ticket_key
  on public.iyzico_payment_attempts(business_id, ticket_id)
  where status in ('reserved','initialized','charged_unapplied');

create index iyzico_payment_attempts_created_idx
  on public.iyzico_payment_attempts(business_id, created_at desc, id);

alter table public.iyzico_payment_attempts enable row level security;
alter table public.iyzico_payment_attempts force row level security;
revoke all on table public.iyzico_payment_attempts from public, anon, authenticated;

create or replace function public.iyzico_attempt_operator_receipt(
  p_attempt public.iyzico_payment_attempts
)
returns jsonb
language sql
stable
set search_path = ''
as $iyzreceipt$
  select jsonb_build_object(
    'attemptId', p_attempt.id,
    'businessId', p_attempt.business_id,
    'ticketId', p_attempt.ticket_id,
    'accountRef', p_attempt.account_ref,
    'environment', p_attempt.environment,
    'amountMinor', p_attempt.amount_minor,
    'currency', p_attempt.currency,
    'ticketVersion', p_attempt.ticket_version,
    'conversationId', p_attempt.id::text,
    'basketId', p_attempt.ticket_id::text,
    'status', p_attempt.status,
    'providerPaymentId', p_attempt.provider_payment_id,
    'paymentEventId', p_attempt.payment_event_id,
    'reconciliationReason', p_attempt.reconciliation_reason,
    'checkoutExpiresAt', p_attempt.checkout_expires_at
  )
$iyzreceipt$;

revoke all on function public.iyzico_attempt_operator_receipt(public.iyzico_payment_attempts)
from public, anon, authenticated;

create or replace function public.reserve_iyzico_payment_attempt_guarded(
  p_business_id uuid,
  p_ticket_id uuid,
  p_account_ref text,
  p_idempotency_key text,
  p_request_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $iyzreserve$
declare
  v_actor public.memberships;
  v_ticket public.tickets;
  v_projection jsonb;
  v_existing public.iyzico_payment_attempts;
  v_attempt public.iyzico_payment_attempts;
  v_amount bigint;
begin
  if p_ticket_id is null
     or p_account_ref is null
     or p_account_ref !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
     or p_idempotency_key is null
     or char_length(p_idempotency_key) not between 8 and 128
     or p_request_hash is null
     or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_IYZICO_PAYMENT_ATTEMPT';
  end if;

  v_actor := public.f14_payment_actor(p_business_id);

  -- Fast replay path. Do not lock the attempt before the ticket: provider
  -- commit locks attempt -> ticket, so reserve never creates the inverse order.
  select * into v_existing
  from public.iyzico_payment_attempts a
  where a.business_id = p_business_id
    and a.created_by_membership_id = v_actor.id
    and a.idempotency_key = p_idempotency_key
  limit 1;

  if v_existing.id is not null then
    if v_existing.request_hash is distinct from p_request_hash
       or v_existing.ticket_id is distinct from p_ticket_id
       or v_existing.account_ref is distinct from p_account_ref then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return public.iyzico_attempt_operator_receipt(v_existing);
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = p_business_id
    and t.id = p_ticket_id
  for update;

  if v_ticket.id is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if v_ticket.status <> 'open' then raise exception 'TICKET_NOT_OPEN'; end if;

  -- A concurrent identical reserve may have completed while this call waited
  -- for the ticket lock. Recheck without taking an attempt row lock.
  select * into v_existing
  from public.iyzico_payment_attempts a
  where a.business_id = p_business_id
    and a.created_by_membership_id = v_actor.id
    and a.idempotency_key = p_idempotency_key
  limit 1;

  if v_existing.id is not null then
    if v_existing.request_hash is distinct from p_request_hash
       or v_existing.ticket_id is distinct from p_ticket_id
       or v_existing.account_ref is distinct from p_account_ref then
      raise exception 'IDEMPOTENCY_CONFLICT';
    end if;
    return public.iyzico_attempt_operator_receipt(v_existing);
  end if;

  if exists (
    select 1
    from public.iyzico_payment_attempts a
    where a.business_id = p_business_id
      and a.ticket_id = p_ticket_id
      and a.status in ('reserved','initialized','charged_unapplied')
  ) then
    raise exception 'IYZICO_PAYMENT_ATTEMPT_ACTIVE';
  end if;

  v_projection := public.f14_ticket_projection(p_business_id, p_ticket_id);
  if v_projection is null then raise exception 'TICKET_NOT_FOUND'; end if;
  if not coalesce((v_projection->>'settlementReady')::boolean, false) then
    raise exception 'PAYMENT_REQUIRES_FINAL_TOTAL';
  end if;
  if v_projection->>'currency' <> 'TRY' then
    raise exception 'IYZICO_REQUIRES_TRY';
  end if;

  v_amount := (v_projection->>'balanceMinor')::bigint;
  if v_amount <= 0 then raise exception 'TICKET_ALREADY_PAID'; end if;
  if v_amount > 100000000 then raise exception 'INVALID_IYZICO_PAYMENT_ATTEMPT'; end if;

  insert into public.iyzico_payment_attempts(
    business_id, ticket_id, created_by_membership_id, account_ref,
    amount_minor, ticket_version, idempotency_key, request_hash
  ) values (
    p_business_id, p_ticket_id, v_actor.id, p_account_ref,
    v_amount::integer, v_ticket.version, p_idempotency_key, p_request_hash
  )
  returning * into v_attempt;

  return public.iyzico_attempt_operator_receipt(v_attempt);
end
$iyzreserve$;

create or replace function public.bind_iyzico_payment_checkout_guarded(
  p_business_id uuid,
  p_attempt_id uuid,
  p_token_hash text,
  p_token_ciphertext text,
  p_callback_capability_hash text,
  p_checkout_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $iyzbind$
declare
  v_actor public.memberships;
  v_attempt public.iyzico_payment_attempts;
begin
  if p_attempt_id is null
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_callback_capability_hash is null
        or p_callback_capability_hash !~ '^[0-9a-f]{64}$'
     or p_token_ciphertext is null
     or char_length(p_token_ciphertext) not between 16 and 4096
     or p_token_ciphertext ~ '[[:cntrl:]]'
     or p_checkout_expires_at is null
     or p_checkout_expires_at <= now()
     or p_checkout_expires_at > now() + interval '1 day' then
    raise exception 'INVALID_IYZICO_CHECKOUT_BINDING';
  end if;

  v_actor := public.f14_payment_actor(p_business_id);

  select * into v_attempt
  from public.iyzico_payment_attempts a
  where a.business_id = p_business_id
    and a.id = p_attempt_id
  for update;

  if v_attempt.id is null then raise exception 'IYZICO_PAYMENT_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.created_by_membership_id <> v_actor.id then
    raise exception 'NOT_ALLOWED' using errcode = '42501';
  end if;

  if v_attempt.status = 'initialized' then
    if v_attempt.token_hash is distinct from p_token_hash
       or v_attempt.token_ciphertext is distinct from p_token_ciphertext
       or v_attempt.callback_capability_hash is distinct from p_callback_capability_hash
       or v_attempt.checkout_expires_at is distinct from p_checkout_expires_at then
      raise exception 'IYZICO_CHECKOUT_BINDING_CONFLICT';
    end if;
    return public.iyzico_attempt_operator_receipt(v_attempt);
  end if;

  if v_attempt.status <> 'reserved' then
    raise exception 'IYZICO_PAYMENT_ATTEMPT_NOT_BINDABLE';
  end if;

  begin
    update public.iyzico_payment_attempts
    set status = 'initialized',
        token_hash = p_token_hash,
        token_ciphertext = p_token_ciphertext,
        callback_capability_hash = p_callback_capability_hash,
        checkout_expires_at = p_checkout_expires_at,
        initialized_at = now(),
        updated_at = now()
    where id = v_attempt.id
    returning * into v_attempt;
  exception when unique_violation then
    raise exception 'IYZICO_TOKEN_CONFLICT';
  end;

  return public.iyzico_attempt_operator_receipt(v_attempt);
end
$iyzbind$;

-- Narrow callback lookup. The raw provider token/capability are never stored;
-- the Worker supplies only SHA-256/HMAC-derived hashes. No PII is returned.
create or replace function public.lookup_iyzico_payment_attempt_callback(
  p_account_ref text,
  p_token_hash text,
  p_callback_capability_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $iyzlookup$
declare
  v_attempt public.iyzico_payment_attempts;
begin
  if p_account_ref is null
     or p_account_ref !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_callback_capability_hash is null
        or p_callback_capability_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;

  select * into v_attempt
  from public.iyzico_payment_attempts a
  where a.environment = 'sandbox'
    and a.account_ref = p_account_ref
    and a.token_hash = p_token_hash
    and a.callback_capability_hash = p_callback_capability_hash
    and a.status in ('initialized','charged_applied','charged_unapplied')
  limit 1;

  if v_attempt.id is null then return null; end if;

  return jsonb_build_object(
    'attemptId', v_attempt.id,
    'businessId', v_attempt.business_id,
    'ticketId', v_attempt.ticket_id,
    'accountRef', v_attempt.account_ref,
    'environment', v_attempt.environment,
    'revision', v_attempt.ticket_version,
    'conversationId', v_attempt.id::text,
    'basketId', v_attempt.ticket_id::text,
    'amountMinor', v_attempt.amount_minor,
    'paymentId', v_attempt.provider_payment_id,
    'status', v_attempt.status
  );
end
$iyzlookup$;

create or replace function public.commit_iyzico_verified_payment(
  p_attempt_id uuid,
  p_account_ref text,
  p_token_hash text,
  p_callback_capability_hash text,
  p_provider_payment_id text,
  p_amount_minor integer,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $iyzcommit$
declare
  v_attempt public.iyzico_payment_attempts;
  v_ticket public.tickets;
  v_projection jsonb;
  v_event public.ticket_payment_events;
  v_reason text;
begin
  if p_attempt_id is null
     or p_account_ref is null
     or p_account_ref !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
     or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_callback_capability_hash is null
        or p_callback_capability_hash !~ '^[0-9a-f]{64}$'
     or p_provider_payment_id is null
        or p_provider_payment_id !~ '^[1-9][0-9]{0,31}$'
     or p_amount_minor is null
        or p_amount_minor not between 1 and 100000000
     or p_currency <> 'TRY' then
    raise exception 'INVALID_IYZICO_VERIFIED_PAYMENT';
  end if;

  -- Global lock order for provider completion is attempt -> ticket.
  select * into v_attempt
  from public.iyzico_payment_attempts a
  where a.id = p_attempt_id
    and a.environment = 'sandbox'
    and a.account_ref = p_account_ref
    and a.token_hash = p_token_hash
    and a.callback_capability_hash = p_callback_capability_hash
  for update;

  if v_attempt.id is null then
    raise exception 'IYZICO_PAYMENT_ATTEMPT_NOT_FOUND';
  end if;

  if v_attempt.amount_minor <> p_amount_minor
     or v_attempt.currency <> p_currency then
    raise exception 'IYZICO_PAYMENT_BINDING_MISMATCH';
  end if;

  if v_attempt.status = 'charged_applied' then
    if v_attempt.provider_payment_id <> p_provider_payment_id
       or v_attempt.payment_event_id is null then
      raise exception 'IYZICO_PAYMENT_BINDING_MISMATCH';
    end if;
    return jsonb_build_object(
      'kind','already_applied',
      'attemptId',v_attempt.id,
      'paymentId',v_attempt.provider_payment_id,
      'paymentEventId',v_attempt.payment_event_id
    );
  end if;

  if v_attempt.status = 'charged_unapplied' then
    if v_attempt.provider_payment_id <> p_provider_payment_id then
      raise exception 'IYZICO_PAYMENT_BINDING_MISMATCH';
    end if;
    return jsonb_build_object(
      'kind','charged_unapplied',
      'attemptId',v_attempt.id,
      'paymentId',v_attempt.provider_payment_id,
      'reason',v_attempt.reconciliation_reason
    );
  end if;

  if v_attempt.status <> 'initialized' then
    raise exception 'IYZICO_PAYMENT_ATTEMPT_NOT_COMMITTABLE';
  end if;

  if exists (
    select 1
    from public.iyzico_payment_attempts other
    where other.environment = v_attempt.environment
      and other.account_ref = v_attempt.account_ref
      and other.provider_payment_id = p_provider_payment_id
      and other.id <> v_attempt.id
  ) then
    raise exception 'IYZICO_PROVIDER_PAYMENT_CONFLICT';
  end if;

  select * into v_ticket
  from public.tickets t
  where t.business_id = v_attempt.business_id
    and t.id = v_attempt.ticket_id
  for update;

  if v_ticket.id is null or v_ticket.status <> 'open' then
    v_reason := 'ticket_not_open';
  elsif v_ticket.version <> v_attempt.ticket_version then
    v_reason := 'ticket_revision_changed';
  else
    v_projection := public.f14_ticket_projection(
      v_attempt.business_id,
      v_attempt.ticket_id
    );

    if not coalesce((v_projection->>'settlementReady')::boolean, false) then
      v_reason := 'settlement_not_ready';
    elsif v_projection->>'currency' <> 'TRY' then
      v_reason := 'ticket_currency_changed';
    elsif (v_projection->>'balanceMinor')::bigint <> v_attempt.amount_minor::bigint then
      v_reason := 'ticket_balance_changed';
    end if;
  end if;

  if v_reason is not null then
    begin
      update public.iyzico_payment_attempts
      set status = 'charged_unapplied',
          provider_payment_id = p_provider_payment_id,
          verified_at = now(),
          reconciliation_reason = v_reason,
          updated_at = now()
      where id = v_attempt.id
      returning * into v_attempt;
    exception when unique_violation then
      raise exception 'IYZICO_PROVIDER_PAYMENT_CONFLICT';
    end;

    return jsonb_build_object(
      'kind','charged_unapplied',
      'attemptId',v_attempt.id,
      'paymentId',v_attempt.provider_payment_id,
      'reason',v_attempt.reconciliation_reason
    );
  end if;

  begin
    insert into public.ticket_payment_events(
      business_id, ticket_id, event_type, source_payment_event_id,
      payment_method, correction_direction, amount_minor, reason,
      actor_membership_id
    ) values (
      v_attempt.business_id, v_attempt.ticket_id, 'payment', null,
      'card', null, v_attempt.amount_minor, null,
      v_attempt.created_by_membership_id
    )
    returning * into v_event;

    update public.iyzico_payment_attempts
    set status = 'charged_applied',
        provider_payment_id = p_provider_payment_id,
        payment_event_id = v_event.id,
        verified_at = now(),
        applied_at = now(),
        updated_at = now()
    where id = v_attempt.id
    returning * into v_attempt;
  exception when unique_violation then
    raise exception 'IYZICO_PROVIDER_PAYMENT_CONFLICT';
  end;

  return jsonb_build_object(
    'kind','applied',
    'attemptId',v_attempt.id,
    'paymentId',v_attempt.provider_payment_id,
    'paymentEventId',v_attempt.payment_event_id
  );
end
$iyzcommit$;

revoke all on function public.reserve_iyzico_payment_attempt_guarded(uuid,uuid,text,text,text)
from public, anon, authenticated;
revoke all on function public.bind_iyzico_payment_checkout_guarded(uuid,uuid,text,text,text,timestamptz)
from public, anon, authenticated;
revoke all on function public.lookup_iyzico_payment_attempt_callback(text,text,text)
from public, anon, authenticated;
revoke all on function public.commit_iyzico_verified_payment(uuid,text,text,text,text,integer,text)
from public, anon, authenticated;

grant execute on function public.reserve_iyzico_payment_attempt_guarded(uuid,uuid,text,text,text)
to authenticated;
grant execute on function public.bind_iyzico_payment_checkout_guarded(uuid,uuid,text,text,text,timestamptz)
to authenticated;

-- Provider callbacks carry no user session. Access is capability-bound by two
-- independently derived hashes and the table itself remains fully inaccessible.
grant execute on function public.lookup_iyzico_payment_attempt_callback(text,text,text)
to anon, authenticated;
grant execute on function public.commit_iyzico_verified_payment(uuid,text,text,text,text,integer,text)
to anon, authenticated;

commit;
