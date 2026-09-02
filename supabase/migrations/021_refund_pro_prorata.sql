-- ============================================================
-- Scholary 021: частичный возврат Pro снимает дни пропорционально
--
-- В 018 частичный возврат вообще не трогал доступ. Оферта же
-- обещает возврат «пропорционально неиспользованным дням» —
-- значит и доступ должен уменьшаться на ту же долю, иначе можно
-- вернуть половину денег и пользоваться сезоном целиком.
-- Разовые покупки (отчёт, консультация, пакет) при частичном
-- возврате доступ сохраняют: там нечего делить.
-- Идемпотентно.
-- ============================================================

create or replace function tiptop_refund(
  p_secret text, p_orig_txn text, p_refund_txn text, p_amount numeric
) returns jsonb
language plpgsql security definer set search_path = public, auth
as $$
declare
  v_secret text; v_pay payments%rowtype; v_days int; v_uid uuid; v_share numeric;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 then raise exception 'not_configured'; end if;
  if p_secret is null or p_secret <> v_secret then raise exception 'forbidden'; end if;

  select * into v_pay from payments where txn = p_orig_txn;
  if not found then
    insert into payments (txn, amount, kind, status, refunded_at, refund_txn, refund_amount)
    values (p_refund_txn, p_amount, 'refund', 'refunded', now(), p_refund_txn, p_amount)
    on conflict (txn) do nothing;
    return jsonb_build_object('ok', false, 'why', 'unknown_payment');
  end if;
  if v_pay.status = 'refunded' then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  v_days := case when v_pay.kind = 'pro_season' then 183 when v_pay.kind = 'pro_month' then 31 else 0 end;
  v_share := case when coalesce(v_pay.amount, 0) > 0 then least(1, coalesce(p_amount, 0) / v_pay.amount) else 1 end;

  -- Частичный возврат
  if v_share < 1 then
    update payments set refund_amount = coalesce(refund_amount, 0) + coalesce(p_amount, 0),
                        refund_txn = p_refund_txn, refunded_at = now()
     where txn = p_orig_txn;
    if v_days > 0 then
      select u.id into v_uid from auth.users u where lower(u.email) = lower(coalesce(v_pay.user_email, '')) limit 1;
      if v_uid is not null then
        update profiles set pro_until = pro_until - round(v_days * v_share)::int, updated_at = now()
         where user_id = v_uid and pro_until is not null;
      end if;
      return jsonb_build_object('ok', true, 'partial', true, 'kind', v_pay.kind,
                                'days_revoked', round(v_days * v_share)::int);
    end if;
    return jsonb_build_object('ok', true, 'partial', true, 'kind', v_pay.kind);
  end if;

  -- Полный возврат
  update payments set status = 'refunded', refunded_at = now(),
                      refund_txn = p_refund_txn, refund_amount = p_amount
   where txn = p_orig_txn;

  if v_days > 0 then
    select u.id into v_uid from auth.users u where lower(u.email) = lower(coalesce(v_pay.user_email, '')) limit 1;
    if v_uid is not null then
      update profiles set pro_until = pro_until - v_days, updated_at = now()
       where user_id = v_uid and pro_until is not null;
    end if;
    return jsonb_build_object('ok', true, 'kind', v_pay.kind, 'days_revoked', v_days, 'user', v_uid);
  end if;

  if v_pay.lead_id is not null then
    update leads set paid = false, tiptop_status = 'refunded', updated_at = now()
     where id = v_pay.lead_id;
  end if;
  return jsonb_build_object('ok', true, 'kind', v_pay.kind, 'lead', v_pay.lead_id);
end $$;
revoke all on function tiptop_refund(text, text, text, numeric) from public;
grant execute on function tiptop_refund(text, text, text, numeric) to anon;

select 'возвраты уточнены' as status;
