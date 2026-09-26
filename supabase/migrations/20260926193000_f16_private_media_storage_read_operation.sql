begin;

-- F16-03 hosted compatibility repair.
--
-- Supabase Storage's authenticated private-object download performs an
-- operation-aware metadata lookup using object.get_authenticated_info before
-- serving bytes. Older policy code pinned one raw storage.operation string and
-- therefore hid a real uploaded object from the same authorized member.
--
-- Use the platform helper so the optional "storage." prefix is normalized while
-- still admitting ONLY the two authenticated direct-read operations. Listing,
-- signing, copy/move, rendering and signed-object reads remain excluded.
create or replace function public.appointment_private_media_read_allowed(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_business_id uuid;
begin
  perform public.f10_require_standard_session();
  if not storage.allow_any_operation(array[
    'object.get_authenticated_info',
    'object.get_authenticated'
  ]::text[]) then
    return false;
  end if;

  select m.business_id into v_business_id
  from public.appointment_private_media m
  where m.storage_path = p_name and m.status = 'ready';

  return v_business_id is not null and public.is_active_member(v_business_id);
exception when others then
  return false;
end
$$;

revoke all on function public.appointment_private_media_read_allowed(text) from public, anon, authenticated;
grant execute on function public.appointment_private_media_read_allowed(text) to authenticated;

commit;
