-- 031 · Один формат номера WhatsApp в базе.
-- Проблема: люди набирают «8 775…», «+7 775…», «7775…», «775…». Всё это один
-- номер, но в базе он лежал как прислали, а GREEN-API нужен 77753831836 —
-- «8775…» уходил в никуда, и клиент не получал отчёт на WhatsApp.
-- Решение: norm_phone() — те же правила, что в js/app.js (ScholaryPhone) и
-- api/_lib.php (wa_digits); триггеры на leads/profiles приводят номер при
-- любой записи (upsert_lead, claim_lead, кабинет); бэкфилл существующих строк.

create or replace function norm_phone(p text)
returns text
language plpgsql immutable
as $$
declare
  raw text := btrim(coalesce(p, ''));
  d text := regexp_replace(raw, '\D', '', 'g');
begin
  if d = '' then return null; end if;
  if length(d) = 12 and left(d, 2) = '78' then d := '7' || substr(d, 3); end if; -- «+7 8 775…»
  if length(d) = 10 and left(raw, 1) <> '+' then
    d := '7' || d;
  elsif length(d) = 11 and left(d, 1) = '8' then
    d := '7' || substr(d, 2);
  elsif length(d) = 11 and left(d, 1) = '7' then
    null; -- уже верно
  elsif left(raw, 1) = '+' and length(d) between 11 and 15 then
    null; -- другой код страны, набран явно через «+»
  else
    return null; -- не похоже на номер: оставляем как есть (см. триггер)
  end if;
  return '+' || d;
end $$;

-- Триггер: нормализуем при записи; если не распознали — не портим, что прислали
create or replace function trg_norm_whatsapp()
returns trigger
language plpgsql
as $$
begin
  if new.whatsapp is not null then
    new.whatsapp := coalesce(norm_phone(new.whatsapp), left(new.whatsapp, 32));
  end if;
  return new;
end $$;

-- default privileges после 030 ничего не дают анону/пользователю — а триггер
-- срабатывает под их ролью (upsert_lead — security definer, кабинет — нет)
grant execute on function norm_phone(text) to anon, authenticated, service_role;
grant execute on function trg_norm_whatsapp() to anon, authenticated, service_role;

drop trigger if exists leads_norm_whatsapp on leads;
create trigger leads_norm_whatsapp
  before insert or update of whatsapp on leads
  for each row execute function trg_norm_whatsapp();

drop trigger if exists profiles_norm_whatsapp on profiles;
create trigger profiles_norm_whatsapp
  before insert or update of whatsapp on profiles
  for each row execute function trg_norm_whatsapp();

-- Бэкфилл: только там, где нормализованный номер отличается
update leads set whatsapp = norm_phone(whatsapp)
 where whatsapp is not null and norm_phone(whatsapp) is not null and norm_phone(whatsapp) <> whatsapp;

update profiles set whatsapp = norm_phone(whatsapp)
 where whatsapp is not null and norm_phone(whatsapp) is not null and norm_phone(whatsapp) <> whatsapp;

-- Самопроверка (должно вернуть 6 строк с ok = true)
select v, norm_phone(v) as n, norm_phone(v) = '+77753831836' as ok
from unnest(array['87753831836', '+7 775 383 18 36', '7753831836', '77753831836', '+7 8 775 383 18 36', '8 (775) 383-18-36']) as v;
