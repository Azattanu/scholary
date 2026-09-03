-- 034 · Строгая проверка 10-значного номера.
-- Нашли тестом: «8775383183» (10 цифр, человек потерял одну) превращалось
-- в «+78775383183» — правдоподобный, но ЧУЖОЙ номер. Отчёт ушёл бы
-- постороннему. Все казахстанские номера в 10-значной записи начинаются
-- на 7 (мобильные 70x/74x/77x, городские 727/717…), поэтому 10 цифр,
-- начинающиеся не с 7, достраивать нельзя — честнее вернуть null.
-- Те же правила теперь в js/app.js (ScholaryPhone) и api/_lib.php (wa_digits).

create or replace function norm_phone(p text)
returns text
language plpgsql immutable
as $$
declare
  raw text := btrim(coalesce(p, ''));
  d text := regexp_replace(raw, '\D', '', 'g');
begin
  if d = '' then return null; end if;
  if length(d) = 12 and left(d, 2) = '78' then d := '7' || substr(d, 3); end if;
  if length(d) = 10 and left(raw, 1) <> '+' then
    if left(d, 1) <> '7' then return null; end if;   -- потеряна цифра, не достраиваем
    d := '7' || d;
  elsif length(d) = 11 and left(d, 1) = '8' then
    d := '7' || substr(d, 2);
  elsif length(d) = 11 and left(d, 1) = '7' then
    null;
  elsif left(raw, 1) = '+' and length(d) between 11 and 15 then
    null;
  else
    return null;
  end if;
  return '+' || d;
end $$;

-- Самопроверка: первые пять → +77753831836, последние два → NULL
select norm_phone('87753831836') a, norm_phone('+7 775 383 18 36') b,
       norm_phone('7753831836') c, norm_phone('775 383 18 36') d,
       norm_phone('+7 8 775 383 18 36') e,
       norm_phone('8775383183') f_null, norm_phone('775383183') g_null;

-- Кого могла испортить старая версия: 12 цифр вида +78XXXXXXXXXX.
-- Такие номера раньше собирались из 10-значного ввода с потерянной цифрой.
-- Если строки найдутся — им отчёт слать нельзя, нужен ручной контакт.
select id, name, whatsapp, email, updated_at
  from leads
 where whatsapp ~ '^\+78[0-9]{10}$'
 order by updated_at desc
 limit 50;
