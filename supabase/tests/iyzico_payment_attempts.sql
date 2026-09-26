-- IYZ-02A durable payment-attempt and atomic F14 ledger bridge acceptance.

create function pg_temp.iyz_assert(p_ok boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_ok,false) then
    raise exception 'IYZ-02A assertion failed: %',p_message;
  end if;
end
$$;

insert into auth.users(id,email,raw_user_meta_data)
values ('2a000000-0000-4000-8000-000000000001','iyz02-owner@example.invalid','{}'::jsonb);

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '2a100000-0000-4000-8000-000000000001',
  'IYZ-02A Salon',
  'iyz02a-salon',
  'Europe/Istanbul',
  '2a000000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '2a200000-0000-4000-8000-000000000001',
  '2a100000-0000-4000-8000-000000000001',
  '2a000000-0000-4000-8000-000000000001',
  'owner',
  true
);

insert into public.customers(id,business_id,name,phone,created_by)
values (
  '2a300000-0000-4000-8000-000000000001',
  '2a100000-0000-4000-8000-000000000001',
  'IYZ-02A Customer',
  '05550002001',
  '2a000000-0000-4000-8000-000000000001'
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  '2a400000-0000-4000-8000-000000000001',
  '2a100000-0000-4000-8000-000000000001',
  'IYZ-02A Service 600',
  30,0,0,'Genel',10,60000,'fixed',60000,60000,'TRY',true
);

set role authenticated;
select set_config('request.jwt.claim.sub','2a000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $iyzsetup$
declare
  v_ticket jsonb;
  v_attempt jsonb;
  v_replay jsonb;
  v_bound jsonb;
begin
  v_ticket := public.open_walk_in_ticket_guarded(
    '2a100000-0000-4000-8000-000000000001',
    '2a300000-0000-4000-8000-000000000001',
    'iyz02-primary-open',
    repeat('1',64)
  );
  v_ticket := public.add_ticket_service_line_guarded(
    '2a100000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    '2a400000-0000-4000-8000-000000000001',
    null,1,
    'iyz02-primary-add',
    repeat('2',64)
  );
  perform set_config('iyz02.primary_ticket',v_ticket->>'ticketId',false);

  v_attempt := public.reserve_iyzico_payment_attempt_guarded(
    '2a100000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'sandbox-primary',
    'iyz02-primary-reserve',
    repeat('a',64)
  );

  perform pg_temp.iyz_assert(v_attempt->>'status'='reserved','primary reserve status');
  perform pg_temp.iyz_assert((v_attempt->>'amountMinor')::int=60000,'server-derived full balance');
  perform pg_temp.iyz_assert(v_attempt->>'currency'='TRY','reserve currency');
  perform pg_temp.iyz_assert(v_attempt->>'basketId'=v_ticket->>'ticketId','basket binds ticket');
  perform pg_temp.iyz_assert(v_attempt->>'conversationId'=v_attempt->>'attemptId','conversation binds attempt');
  perform set_config('iyz02.primary_attempt',v_attempt->>'attemptId',false);

  v_replay := public.reserve_iyzico_payment_attempt_guarded(
    '2a100000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'sandbox-primary',
    'iyz02-primary-reserve',
    repeat('a',64)
  );
  perform pg_temp.iyz_assert(v_replay->>'attemptId'=v_attempt->>'attemptId','reserve replay identity');

  begin
    perform public.reserve_iyzico_payment_attempt_guarded(
      '2a100000-0000-4000-8000-000000000001',
      (v_ticket->>'ticketId')::uuid,
      'sandbox-primary',
      'iyz02-primary-reserve',
      repeat('b',64)
    );
    raise exception 'IYZ-02A changed replay unexpectedly succeeded';
  exception when others then
    if position('IDEMPOTENCY_CONFLICT' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.reserve_iyzico_payment_attempt_guarded(
      '2a100000-0000-4000-8000-000000000001',
      (v_ticket->>'ticketId')::uuid,
      'sandbox-primary',
      'iyz02-another-reserve',
      repeat('c',64)
    );
    raise exception 'IYZ-02A second active attempt unexpectedly succeeded';
  exception when others then
    if position('IYZICO_PAYMENT_ATTEMPT_ACTIVE' in sqlerrm)=0 then raise; end if;
  end;

  v_bound := public.bind_iyzico_payment_checkout_guarded(
    '2a100000-0000-4000-8000-000000000001',
    (v_attempt->>'attemptId')::uuid,
    repeat('d',64),
    'v1:ciphertext-fixture-primary',
    repeat('e',64),
    now()+interval '30 minutes'
  );
  perform pg_temp.iyz_assert(v_bound->>'status'='initialized','checkout binding status');
  perform pg_temp.iyz_assert(v_bound->>'providerPaymentId' is null,'provider ID absent before verification');
end
$iyzsetup$;

reset role;

-- Raw provider token is not persisted; only an opaque encrypted envelope and
-- independently derived hashes are retained.
do $iyzstored$
declare
  v_attempt public.iyzico_payment_attempts;
begin
  select * into v_attempt
  from public.iyzico_payment_attempts
  where id=current_setting('iyz02.primary_attempt')::uuid;

  perform pg_temp.iyz_assert(v_attempt.token_hash=repeat('d',64),'token hash stored');
  perform pg_temp.iyz_assert(v_attempt.callback_capability_hash=repeat('e',64),'capability hash stored');
  perform pg_temp.iyz_assert(v_attempt.token_ciphertext='v1:ciphertext-fixture-primary','opaque ciphertext stored');
  perform pg_temp.iyz_assert(v_attempt.status='initialized','stored initialized state');
end
$iyzstored$;

set role anon;

do $iyzacl$
declare
  v_lookup jsonb;
  v_result jsonb;
begin
  begin
    perform count(*) from public.iyzico_payment_attempts;
    raise exception 'IYZ-02A anon table read unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;

  v_lookup := public.lookup_iyzico_payment_attempt_callback(
    'sandbox-primary',
    repeat('d',64),
    repeat('e',64)
  );
  perform pg_temp.iyz_assert(v_lookup->>'attemptId'=current_setting('iyz02.primary_attempt'),'capability lookup identity');
  perform pg_temp.iyz_assert(v_lookup->>'businessId'='2a100000-0000-4000-8000-000000000001','lookup tenant binding');
  perform pg_temp.iyz_assert((v_lookup->>'amountMinor')::int=60000,'lookup amount binding');
  perform pg_temp.iyz_assert(v_lookup->>'paymentId' is null,'lookup has no provider payment before commit');

  perform pg_temp.iyz_assert(
    public.lookup_iyzico_payment_attempt_callback(
      'sandbox-primary',repeat('d',64),repeat('f',64)
    ) is null,
    'wrong callback capability is indistinguishable from absence'
  );

  v_result := public.commit_iyzico_verified_payment(
    current_setting('iyz02.primary_attempt')::uuid,
    'sandbox-primary',
    repeat('d',64),
    repeat('e',64),
    '9000001',
    60000,
    'TRY'
  );
  perform pg_temp.iyz_assert(v_result->>'kind'='applied','verified payment applied');
  perform pg_temp.iyz_assert(v_result->>'paymentId'='9000001','provider ID receipt');
  perform pg_temp.iyz_assert(v_result->>'paymentEventId' is not null,'ledger event receipt');

  v_result := public.commit_iyzico_verified_payment(
    current_setting('iyz02.primary_attempt')::uuid,
    'sandbox-primary',
    repeat('d',64),
    repeat('e',64),
    '9000001',
    60000,
    'TRY'
  );
  perform pg_temp.iyz_assert(v_result->>'kind'='already_applied','duplicate callback replay');
end
$iyzacl$;

reset role;

do $iyzprimarycheck$
declare
  v_projection jsonb;
  v_attempt public.iyzico_payment_attempts;
  v_event public.ticket_payment_events;
begin
  v_projection := public.f14_ticket_projection(
    '2a100000-0000-4000-8000-000000000001',
    current_setting('iyz02.primary_ticket')::uuid
  );
  perform pg_temp.iyz_assert((v_projection->>'paidMinor')::int=60000,'provider payment enters F14 paid amount once');
  perform pg_temp.iyz_assert((v_projection->>'balanceMinor')::int=0,'provider payment settles ticket');
  perform pg_temp.iyz_assert(v_projection->>'paymentStatus'='paid','provider payment status');

  select * into v_attempt
  from public.iyzico_payment_attempts
  where id=current_setting('iyz02.primary_attempt')::uuid;
  perform pg_temp.iyz_assert(v_attempt.status='charged_applied','attempt applied state');
  perform pg_temp.iyz_assert(v_attempt.provider_payment_id='9000001','attempt provider binding');
  perform pg_temp.iyz_assert(v_attempt.payment_event_id is not null,'attempt ledger binding');

  select * into v_event
  from public.ticket_payment_events
  where business_id=v_attempt.business_id
    and ticket_id=v_attempt.ticket_id
    and id=v_attempt.payment_event_id;
  perform pg_temp.iyz_assert(v_event.event_type='payment','provider ledger event type');
  perform pg_temp.iyz_assert(v_event.payment_method='card','provider ledger method');
  perform pg_temp.iyz_assert(v_event.amount_minor=60000,'provider ledger amount');
  perform pg_temp.iyz_assert(v_event.actor_membership_id='2a200000-0000-4000-8000-000000000001','initiating financial actor retained');

  perform pg_temp.iyz_assert(
    (select count(*) from public.ticket_payment_events
     where business_id=v_attempt.business_id and ticket_id=v_attempt.ticket_id)=1,
    'replay created one financial event only'
  );
end
$iyzprimarycheck$;

-- Race-safe money truth: if a valid manual payment lands after checkout was
-- opened, a later real provider charge is preserved as charged_unapplied rather
-- than overpaying the F14 ledger or being silently discarded.
set role authenticated;
select set_config('request.jwt.claim.sub','2a000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $iyzraceprep$
declare
  v_ticket jsonb;
  v_attempt jsonb;
begin
  v_ticket := public.open_walk_in_ticket_guarded(
    '2a100000-0000-4000-8000-000000000001',
    '2a300000-0000-4000-8000-000000000001',
    'iyz02-race-open',
    repeat('3',64)
  );
  v_ticket := public.add_ticket_service_line_guarded(
    '2a100000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    '2a400000-0000-4000-8000-000000000001',
    null,1,
    'iyz02-race-add',
    repeat('4',64)
  );
  perform set_config('iyz02.race_ticket',v_ticket->>'ticketId',false);

  v_attempt := public.reserve_iyzico_payment_attempt_guarded(
    '2a100000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'sandbox-primary',
    'iyz02-race-reserve',
    repeat('5',64)
  );
  perform set_config('iyz02.race_attempt',v_attempt->>'attemptId',false);

  perform public.bind_iyzico_payment_checkout_guarded(
    '2a100000-0000-4000-8000-000000000001',
    (v_attempt->>'attemptId')::uuid,
    repeat('6',64),
    'v1:ciphertext-fixture-race',
    repeat('7',64),
    now()+interval '30 minutes'
  );

  perform public.record_ticket_payment_guarded(
    '2a100000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'cash',
    10000,
    'iyz02-race-manual',
    repeat('8',64)
  );
end
$iyzraceprep$;

reset role;
set role anon;

do $iyzunapplied$
declare
  v_result jsonb;
begin
  v_result := public.commit_iyzico_verified_payment(
    current_setting('iyz02.race_attempt')::uuid,
    'sandbox-primary',
    repeat('6',64),
    repeat('7',64),
    '9000002',
    60000,
    'TRY'
  );
  perform pg_temp.iyz_assert(v_result->>'kind'='charged_unapplied','real charge retained outside ledger');
  perform pg_temp.iyz_assert(v_result->>'reason'='ticket_balance_changed','balance race reason');

  v_result := public.commit_iyzico_verified_payment(
    current_setting('iyz02.race_attempt')::uuid,
    'sandbox-primary',
    repeat('6',64),
    repeat('7',64),
    '9000002',
    60000,
    'TRY'
  );
  perform pg_temp.iyz_assert(v_result->>'kind'='charged_unapplied','unapplied replay stable');
end
$iyzunapplied$;

reset role;

do $iyzunappliedcheck$
declare
  v_projection jsonb;
  v_attempt public.iyzico_payment_attempts;
begin
  v_projection := public.f14_ticket_projection(
    '2a100000-0000-4000-8000-000000000001',
    current_setting('iyz02.race_ticket')::uuid
  );
  perform pg_temp.iyz_assert((v_projection->>'paidMinor')::int=10000,'real provider charge did not corrupt F14 paid amount');
  perform pg_temp.iyz_assert((v_projection->>'balanceMinor')::int=50000,'manual winner balance retained');
  perform pg_temp.iyz_assert(
    (select count(*) from public.ticket_payment_events
     where business_id='2a100000-0000-4000-8000-000000000001'
       and ticket_id=current_setting('iyz02.race_ticket')::uuid)=1,
    'unapplied provider charge created no second ledger event'
  );

  select * into v_attempt
  from public.iyzico_payment_attempts
  where id=current_setting('iyz02.race_attempt')::uuid;
  perform pg_temp.iyz_assert(v_attempt.status='charged_unapplied','durable reconciliation state');
  perform pg_temp.iyz_assert(v_attempt.provider_payment_id='9000002','unapplied charge keeps provider identity');
  perform pg_temp.iyz_assert(v_attempt.payment_event_id is null,'unapplied charge has no ledger binding');
end
$iyzunappliedcheck$;

set role authenticated;
select set_config('request.jwt.claim.sub','2a000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $iyzblocknew$
begin
  begin
    perform public.reserve_iyzico_payment_attempt_guarded(
      '2a100000-0000-4000-8000-000000000001',
      current_setting('iyz02.race_ticket')::uuid,
      'sandbox-primary',
      'iyz02-race-new',
      repeat('9',64)
    );
    raise exception 'IYZ-02A unresolved charge allowed a fresh payment attempt';
  exception when others then
    if position('IYZICO_PAYMENT_ATTEMPT_ACTIVE' in sqlerrm)=0 then raise; end if;
  end;
end
$iyzblocknew$;

reset role;

-- Provider payment identity is account/environment unique across attempts.
do $iyzproviderunique$
declare
  v_count integer;
begin
  select count(*)::integer into v_count
  from public.iyzico_payment_attempts
  where environment='sandbox'
    and account_ref='sandbox-primary'
    and provider_payment_id in ('9000001','9000002');
  perform pg_temp.iyz_assert(v_count=2,'provider identities remain unique durable facts');
end
$iyzproviderunique$;

raise notice 'IYZ-02A durable payment attempts and atomic F14 bridge passed';
