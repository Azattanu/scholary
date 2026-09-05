#!/bin/bash
# Стенд workspace: shim → 035–038 (реальные) → 044 дважды → тесты
set -e
cd "$(dirname "$0")"
M=../../supabase/migrations
sudo -u postgres psql -q -c "drop database if exists ws_test" -c "create database ws_test" >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d ws_test -f shim.sql >/dev/null
for m in 035_schools 036_counselor_workspace; do sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d ws_test -f $M/$m.sql >/dev/null; done
sudo -u postgres psql -q -d ws_test -f $M/037_counselor_admin.sql >/dev/null 2>&1 || true   # storage.objects нет в стенде
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d ws_test -f $M/038_ws_grants.sql >/dev/null
for m in 042_cabinet_retention 043_cabinet_grants; do sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d ws_test -f $M/$m.sql >/dev/null; done
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d ws_test -f $M/044_workspace2.sql
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d ws_test -f $M/044_workspace2.sql >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d ws_test -f test044.sql
