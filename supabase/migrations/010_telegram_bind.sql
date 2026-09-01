-- ============================================================
-- Scholary · 010: привязка Telegram к аккаунту
-- Бот не имеет права читать таблицу: он вызывает только эту функцию
-- и только по одноразовому коду, который человек видит в кабинете.
-- Код после привязки стирается, поэтому подобрать его повторно нельзя.
-- Идемпотентно.
-- ============================================================

create or replace function tg_bind(p_code text, p_chat_id text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_code is null or length(btrim(p_code)) < 6 or p_chat_id is null or length(p_chat_id) > 40 then
    return false;
  end if;
  update tg_links
     set chat_id   = p_chat_id,
         linked_at = now(),
         code      = null
   where code = upper(btrim(p_code))
     and chat_id is null;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke all on function tg_bind(text,text) from public;
grant execute on function tg_bind(text,text) to anon, authenticated;

-- Отвязка: чат перестаёт получать уведомления, инициатор — сам Telegram.
create or replace function tg_unbind(p_chat_id text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update tg_links set chat_id = null, linked_at = null where chat_id = p_chat_id;
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function tg_unbind(text) from public;
grant execute on function tg_unbind(text) to anon, authenticated;

select 'tg_bind и tg_unbind готовы' as ok;
