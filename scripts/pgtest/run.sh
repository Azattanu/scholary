#!/bin/bash
# Локальный прогон миграции 042 на копии структуры: shim (auth, базовые таблицы) → миграция → гранты → функциональные тесты
set -e
cd "$(dirname "$0")"   # запускать из любого места: скрипт сам переходит в scripts/pgtest
sudo -u postgres psql -q -c "drop database if exists scholary_test" -c "create database scholary_test" >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d scholary_test -f shim.sql >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d scholary_test -f ../../supabase/migrations/042_cabinet_retention.sql >/dev/null
# идемпотентность: второй прогон без ошибок
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d scholary_test -f ../../supabase/migrations/042_cabinet_retention.sql >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d scholary_test -f ../../supabase/migrations/043_cabinet_grants.sql
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d scholary_test -f ../../supabase/migrations/043_cabinet_grants.sql >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d scholary_test -f test042.sql
