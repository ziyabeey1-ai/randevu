-- IYZ-02A concurrent duplicate provider callbacks: one ledger effect, stable replay.

create extension if not exists dblink;

create function pg_temp.iyz_conc_assert(p_ok boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if not coalesce(p_ok,false) then
    raise exception 'IYZ-02A concurrency assertion failed: %',p_message;
  end if;
end
$$;

insert into auth.users(id,email,raw_user_meta_data)
values ('2b000000-0000-4000-8000-000000000001','iyz02-race@example.invalid','{}'::jsonb);

insert into public.businesses(id,name,slug,timezone,created_by)
values (
  '2b100000-0000-4000-8000-000000000001',
  'IYZ-02A Concurrency Salon',
  'iyz02a-concurrency',
  'Europe/Istanbul',
  '2b000000-0000-4000-8000-000000000001'
);

insert into public.memberships(id,business_id,user_id,role,active)
values (
  '2b200000-0000-4000-8000-000000000001',
  '2b100000-0000-4000-8000-000000000001',
  '2b000000-0000-4000-8000-000000000001',
  'owner',
  true
);

insert into public.customers(id,business_id,name,phone,created_by)
values (
  '2b300000-0000-4000-8000-000000000001',
  '2b100000-0000-4000-8000-000000000001',
  'IYZ-02A Race Customer',
  '05550002002',
  '2b000000-0000-4000-8000-000000000001'
);

insert into public.services(
  id,business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes,
  category,sort_order,price_minor,price_type,price_min_minor,price_max_minor,currency,active
) values (
  '2b400000-0000-4000-8000-000000000001',
  '2b100000-0000-4000-8000-000000000001',
  'IYZ-02A Race Service',
  30,0,0,'Genel',10,60000,'fixed',60000,60000,'TRY',true
);

set role authenticated;
select set_config('request.jwt.claim.sub','2b000000-0000-4000-8000-000000000001',false);
select set_config('request.jwt.claims','{"amr":[{"method":"password"}]}',false);

do $iyzconcprep$
declare
  v_ticket jsonb;
  v_attempt jsonb;
begin
  v_ticket := public.open_walk_in_ticket_guarded(
    '2b100000-0000-4000-8000-000000000001',
    '2b300000-0000-4000-8000-000000000001',
    'iyz02-conc-open',
    repeat('1',64)
  );
  v_ticket := public.add_ticket_service_line_guarded(
    '2b100000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    '2b400000-0000-4000-8000-000000000001',
    null,1,
    'iyz02-conc-add',
    repeat('2',64)
  );
  perform set_config('iyz02.conc_ticket',v_ticket->>'ticketId',false);

  v_attempt := public.reserve_iyzico_payment_attempt_guarded(
    '2b100000-0000-4000-8000-000000000001',
    (v_ticket->>'ticketId')::uuid,
    'sandbox-concurrency',
    'iyz02-conc-reserve',
    repeat('3',64)
  );
  perform set_config('iyz02.conc_attempt',v_attempt->>'attemptId',false);

  perform public.bind_iyzico_payment_checkout_guarded(
    '2b100000-0000-4000-8000-000000000001',
    (v_attempt->>'attemptId')::uuid,
    repeat('4',64),
    'v1:ciphertext-fixture-concurrency',
    repeat('5',64),
    now()+interval '30 minutes'
  );
end
$iyzconcprep$;

reset role;

do $iyzconcrace$
declare
  v_attempt uuid := current_setting('iyz02.conc_attempt')::uuid;
  v_ticket uuid := current_setting('iyz02.conc_ticket')::uuid;
  v_conn text;
  v_sql text;
  v_blocked integer := 0;
  v_result jsonb;
  v_rows integer;
  v_drain integer;
  v_finished integer := 0;
  v_done_a boolean := false;
  v_done_b boolean := false;
  v_applied integer := 0;
  v_replayed integer := 0;
  v_projection jsonb;
begin
  perform dblink_connect(
    'iyz02_blocker',
    'host=127.0.0.1 port=5432 dbname='||current_database()
      ||' user=postgres password=postgres application_name=iyz02_blocker'
  );
  perform dblink_exec('iyz02_blocker','begin');
  perform dblink_exec(
    'iyz02_blocker',
    format(
      'do $block$ begin perform 1 from public.iyzico_payment_attempts where id=%L::uuid for update; end $block$;',
      v_attempt
    )
  );

  for v_conn in select unnest(array['iyz02_cb_a','iyz02_cb_b']) loop
    perform dblink_connect(
      v_conn,
      'host=127.0.0.1 port=5432 dbname='||current_database()
        ||' user=postgres password=postgres application_name='||v_conn
    );
    perform dblink_exec(v_conn,'set statement_timeout=30000');
    perform dblink_exec(v_conn,'begin');
    perform dblink_exec(v_conn,'set local role anon');
  end loop;

  v_sql := format($q$
    select public.commit_iyzico_verified_payment(
      %L::uuid,%L,%L,%L,%L,%s,%L
    )
  $q$,
    v_attempt,
    'sandbox-concurrency',
    repeat('4',64),
    repeat('5',64),
    '9100001',
    60000,
    'TRY'
  );

  if dblink_send_query('iyz02_cb_a',v_sql)<>1
     or dblink_send_query('iyz02_cb_b',v_sql)<>1 then
    raise exception 'IYZ-02A could not start duplicate callback writers';
  end if;

  for i in 1..500 loop
    perform pg_stat_clear_snapshot();
    select count(*)::integer into v_blocked
    from pg_stat_activity
    where application_name in ('iyz02_cb_a','iyz02_cb_b')
      and wait_event_type='Lock';
    exit when v_blocked=2;
    perform pg_sleep(0.01);
  end loop;

  if v_blocked<>2 then
    raise exception 'IYZ-02A callbacks did not both park on attempt lock: %',v_blocked;
  end if;

  perform dblink_exec('iyz02_blocker','commit');
  perform dblink_disconnect('iyz02_blocker');

  while v_finished<2 loop
    v_conn:=null;
    for i in 1..6000 loop
      if not v_done_a and dblink_is_busy('iyz02_cb_a')=0 then
        v_conn:='iyz02_cb_a';
        exit;
      elsif not v_done_b and dblink_is_busy('iyz02_cb_b')=0 then
        v_conn:='iyz02_cb_b';
        exit;
      end if;
      perform pg_sleep(0.01);
    end loop;

    if v_conn is null then
      raise exception 'IYZ-02A timed out waiting for callback writer';
    end if;

    v_result:=null;
    v_rows:=0;
    begin
      select t.result into v_result
      from dblink_get_result(v_conn,false) as t(result jsonb);
      get diagnostics v_rows=row_count;
    exception when others then
      raise exception 'IYZ-02A callback writer failed on %: %',v_conn,dblink_error_message(v_conn);
    end;

    if v_rows<>1 then
      raise exception 'IYZ-02A callback writer returned % rows on %',v_rows,v_conn;
    end if;

    perform * from dblink_get_result(v_conn,false) as t(result jsonb);
    get diagnostics v_drain=row_count;
    if v_drain<>0 or dblink_is_busy(v_conn)<>0 then
      raise exception 'IYZ-02A callback writer had trailing async result on %',v_conn;
    end if;

    if v_result->>'kind'='applied' then
      v_applied:=v_applied+1;
    elsif v_result->>'kind'='already_applied' then
      v_replayed:=v_replayed+1;
    else
      raise exception 'IYZ-02A unexpected callback result on %: %',v_conn,v_result;
    end if;

    perform dblink_exec(v_conn,'commit');
    perform dblink_disconnect(v_conn);

    if v_conn='iyz02_cb_a' then v_done_a:=true; else v_done_b:=true; end if;
    v_finished:=v_finished+1;
  end loop;

  perform pg_temp.iyz_conc_assert(v_applied=1,'one callback applies');
  perform pg_temp.iyz_conc_assert(v_replayed=1,'one callback replays');

  perform pg_temp.iyz_conc_assert(
    (select count(*) from public.ticket_payment_events
     where business_id='2b100000-0000-4000-8000-000000000001'
       and ticket_id=v_ticket)=1,
    'concurrent callbacks create one payment event'
  );

  v_projection:=public.f14_ticket_projection(
    '2b100000-0000-4000-8000-000000000001',
    v_ticket
  );
  perform pg_temp.iyz_conc_assert((v_projection->>'paidMinor')::int=60000,'concurrent paid amount');
  perform pg_temp.iyz_conc_assert((v_projection->>'balanceMinor')::int=0,'concurrent balance');
  perform pg_temp.iyz_conc_assert(v_projection->>'paymentStatus'='paid','concurrent payment status');

  raise notice 'IYZ-02A duplicate callback race: one apply / one replay / one ledger event';
exception when others then
  begin perform dblink_exec('iyz02_blocker','rollback'); exception when others then null; end;
  begin perform dblink_disconnect('iyz02_blocker'); exception when others then null; end;
  for v_conn in select unnest(array['iyz02_cb_a','iyz02_cb_b']) loop
    begin perform dblink_exec(v_conn,'rollback'); exception when others then null; end;
    begin perform dblink_disconnect(v_conn); exception when others then null; end;
  end loop;
  raise;
end
$iyzconcrace$;
