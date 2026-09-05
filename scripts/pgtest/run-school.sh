#!/bin/bash
# Стенд кабинета школы: shim → 035–038 → 042–044 → 045 дважды → test045
set -e
cd "$(dirname "$0")"
M=../../supabase/migrations
sudo -u postgres psql -q -c "drop database if exists sc_test" -c "create database sc_test" >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d sc_test -f shim.sql >/dev/null
for m in 035_schools 036_counselor_workspace; do sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d sc_test -f $M/$m.sql >/dev/null; done
sudo -u postgres psql -q -d sc_test -f $M/037_counselor_admin.sql >/dev/null 2>&1 || true
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d sc_test -f $M/038_ws_grants.sql >/dev/null
for m in 042_cabinet_retention 043_cabinet_grants 044_workspace2; do sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d sc_test -f $M/$m.sql >/dev/null; done
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d sc_test -f $M/045_school_cabinet2.sql
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d sc_test -f $M/045_school_cabinet2.sql >/dev/null
sudo -u postgres psql -q -v ON_ERROR_STOP=1 -d sc_test -f test045.sql
