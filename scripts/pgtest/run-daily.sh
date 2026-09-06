#!/bin/bash
# Стенд ежедневной аналитики: shim → 035 → 046 дважды → test046
set -e
cd "$(dirname "$0")"
M=../../supabase/migrations
sudo -u postgres psql -q -c "drop database if exists da_test" -c "create database da_test" >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d da_test -f shim.sql >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d da_test -f $M/035_schools.sql >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d da_test -f $M/046_daily_analytics.sql
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d da_test -f $M/046_daily_analytics.sql >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d da_test -f test046.sql
