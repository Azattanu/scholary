-- ============================================================
-- Scholary 018: возвраты
--
-- Раньше возврат денег никак не отражался на доступе: человек мог
-- вернуть оплату и продолжать пользоваться отчётом или Pro.
-- Теперь уведомление Refund от шлюза снимает ровно то, что выдал
-- соответствующий платёж.
--
-- Частичный возврат доступ НЕ снимает — только записывается: вернуть
-- половину денег и отобрать всё было бы нечестно по отношению к человеку.
-- Идемпотентно.
-- ============================================================

alter table if exists payments
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_txn  text,
  add column if not exists refund_amount numeric;

create or replace function tiptop_refund(
  p_secret     text,
  p_orig_txn   text,   -- PaymentTransactionId: транзакция исходной оплаты
  p_refund_txn text,   -- TransactionId: транзакция самого возврата
  p_amount     numeric
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_secret text;
  v_pay    payments%rowtype;
  v_days   int;
  v_uid    uuid;
begin
  select value into v_secret from app_secrets where name = 'tiptop_webhook';
  if v_secret is null or length(v_secret) < 24 then raise exception 'not_configured'; end if;
  if p_secret is null or p_secret <> v_secret then raise exception 'forbidden'; end if;

  select * into v_pay from payments where txn = p_orig_txn;
  if not found then
    -- Оплаты в журнале нет: она прошла до подключения журнала или мимо него.
    -- Записываем сам возврат, чтобы деньги не потерялись, и зовём человека.
    insert into payments (txn, amount, kind, status, refunded_at, refund_txn, refund_amount)
    values (p_refund_txn, p_amount, 'refund', 'refunded', now(), p_refund_txn, p_amount)
    on conflict (txn) do nothing;
    return jsonb_build_object('ok', false, 'why', 'unknown_payment');
  end if;

  if v_pay.status = 'refunded' then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;

  -- Частичный возврат: фиксируем сумму, доступ оставляем.
  if p_amount is not null and v_pay.amount is not null and p_amount < v_pay.amount then
    update payments set refund_amount = coalesce(refund_amount, 0) + p_amount,
                        refund_txn = p_refund_txn, refunded_at = now()
     where txn = p_orig_txn;
    return jsonb_build_object('ok', true, 'partial', true, 'kind', v_pay.kind);
  end if;

  update payments set status = 'refunded', refunded_at = now(),
                      refund_txn = p_refund_txn, refund_amount = p_amount
   where txn = p_orig_txn;

  if v_pay.kind like 'pro_%' then
    v_days := case when v_pay.kind = 'pro_season' then 183 else 31 end;
    select u.id into v_uid from auth.users u where lower(u.email) = lower(coalesce(v_pay.user_email, '')) limit 1;
    if v_uid is not null then
      -- Снимаем ровно выданные дни: если до покупки подписка уже была,
      -- она сохранится.
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
