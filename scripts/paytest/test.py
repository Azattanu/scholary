# Локальные тесты Kaspi-оплаты: PHP на 8130, мок ApiPay+Supabase на 8131.
import json, hmac, hashlib, time, urllib.request, urllib.error, os, glob, shutil

API = "http://127.0.0.1:8130/api"
MOCK = "http://127.0.0.1:8131"
SECRET = b"whsecret"
PRIV = "/tmp/claude-0/paytest/root/private"
fails = 0
def ok(c, m):
    global fails
    print(("OK   " if c else "FAIL ") + m)
    if not c: fails += 1

def req(url, method="GET", body=None, headers=None, raw=None):
    h = {"Origin": "http://localhost:8123", "Content-Type": "application/json"}
    h.update(headers or {})
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    r = urllib.request.Request(url, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            t = resp.read().decode(); return resp.status, (json.loads(t) if t.strip().startswith("{") else t)
    except urllib.error.HTTPError as e:
        t = e.read().decode(); return e.code, (json.loads(t) if t.strip().startswith("{") else t)

def mock_set(**kw): req(MOCK + "/__set", "POST", kw)
def mock_reset():
    req(MOCK + "/__reset", "POST", {})
    for d in ["kaspi", "tiptop", "usage"]:
        shutil.rmtree(os.path.join(PRIV, d), ignore_errors=True)
def mock_state(): return req(MOCK + "/__state")[1]
def set_invoice(iid, **fields):
    st = mock_state()["state"]; inv = st["invoices"][str(iid)]; inv.update(fields)
    req(MOCK + "/__set", "POST", {"invoices": st["invoices"]})
def rpc_calls(name=None):
    calls = mock_state()["state"]["rpc"]
    return [c for c in calls if name is None or c[0] == name]

def webhook(payload, sig=None, raw=None, headers=None):
    raw = raw if raw is not None else json.dumps(payload, ensure_ascii=False).encode()
    if sig is None: sig = "sha256=" + hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
    h = {"X-Webhook-Signature": sig} if sig != "" else {}
    h.update(headers or {})
    return req(API + "/kaspi-webhook.php", "POST", raw=raw, headers=h)

def inv_event(iid, status, order, amount="4000.00", extra=None):
    inv = {"id": iid, "external_order_id": order, "amount": amount, "status": status, "description": "x", "kaspi_invoice_id": "1323" + str(iid), "client_phone": "87753831836", "is_sandbox": False}
    if extra: inv.update(extra)
    return {"event": "invoice.status_changed", "invoice": inv, "source": "key", "timestamp": "2026-09-04T12:00:00+00:00"}

def create(kind="report", phone="+7 775 383 18 36", email="buyer@example.com", lead="lead_abcdef12", account="", headers=None, name=""):
    return req(API + "/kaspi.php?a=create", "POST", {"kind": kind, "phone": phone, "email": email, "lead": lead, "account": account, "name": name}, headers=headers)
def set_secrets(**kw):
    base = {"APIPAY_ENABLED": True, "APIPAY_KEY": "testkey", "APIPAY_WEBHOOK_SECRET": "whsecret", "APIPAY_BASE": "http://127.0.0.1:8131/api/v1"}
    base.update(kw)
    body = ", ".join("'%s' => %s" % (k, ("true" if v is True else "false") if isinstance(v, bool) else "'%s'" % v) for k, v in base.items())
    open(os.path.join(PRIV, "apipay-secrets.php"), "w").write("<?php\nreturn [" + body + "];\n")
    time.sleep(4)   # opcache (cli-server) перечитывает файлы с задержкой
def status(order): return req(API + "/kaspi.php?a=status&o=" + order)
def order_file(order): return json.load(open(os.path.join(PRIV, "kaspi/orders", order + ".json")))

# ---------- 1. создание и опрос ----------
mock_reset()
c, j = create()
ok(c == 200 and j["ok"] and j["status"] == "processing" and j["amount"] == 4000, "create: счёт создан, processing " + str(j))
order = j["order"]; iid = order_file(order)["invoice_id"]
ok([l for l in mock_state()["log"] if l[1] == "/api/v1/invoices"][-1][2]["phone_number"] == "87753831836", "в ApiPay ушёл номер в формате 8XXXXXXXXXX")
c, s = status(order); ok(s["status"] == "processing" and not s["fulfilled"], "status: processing")
set_invoice(iid, status="pending", kaspi_invoice_id="9991")
time.sleep(4.2); c, s = status(order); ok(s["status"] == "pending", "status: pending после опроса ApiPay (не чаще раза в 4 с)")

# ---------- 2. вебхук paid ----------
c, w = webhook(inv_event(iid, "paid", order, extra={"paid_at": "2026-09-04T12:00:00+00:00"}))
ok(c == 200 and w.get("ok"), "webhook paid: 200 " + str(w))
time.sleep(1.5)
of = order_file(order)
ok(of["status"] == "paid" and of["fulfilled"] and of["fulfill_via"] == "webhook", "заказ оплачен и выдан через вебхук")
names = [x[0] for x in rpc_calls()]
ok(names.count("tiptop_mark_paid") == 1 and names.count("tiptop_issue_report") == 1 and "tiptop_mark_report_sent" in names and "tiptop_log_payment" in names, "RPC: mark_paid, log_payment, issue_report, mark_report_sent по одному разу " + str(names))
mp = rpc_calls("tiptop_mark_paid")[0][1]
ok(mp["p_txn"] == "kaspi_" + str(iid) and mp["p_amount"] == 4000 and mp["p_kind"] == "report" and mp["p_lead"] == "lead_abcdef12" and mp["p_test"] is False, "mark_paid с txn kaspi_<id>, суммой 4000, лидом")
c, s = status(order); ok(s["status"] == "paid" and s["fulfilled"], "status после оплаты: paid + fulfilled")

# ---------- 3. дубль вебхука ----------
c, w = webhook(inv_event(iid, "paid", order))
ok(c == 200 and w.get("dup"), "повтор того же вебхука → dup, без второй выдачи")
ok(len(rpc_calls("tiptop_issue_report")) == 1, "issue_report по-прежнему один раз")

# ---------- 4. подпись ----------
c, w = webhook(inv_event(iid, "paid", order), sig="sha256=" + "0" * 64); ok(c == 401, "неверная подпись → 401")
c, w = webhook(inv_event(iid, "paid", order), sig=""); ok(c == 401, "без подписи → 401")
raw = json.dumps(inv_event(iid, "paid", order)).encode(); good = "sha256=" + hmac.new(SECRET, raw, hashlib.sha256).hexdigest()
c, w = webhook(None, sig=good, raw=raw.replace(b'"4000.00"', b'"10.00"')); ok(c == 401, "подменённое тело с чужой подписью → 401")
c, w = webhook(None, sig=hmac.new(SECRET, raw, hashlib.sha256).hexdigest(), raw=raw); ok(c == 200, "подпись без префикса sha256= тоже принимается")
c, w = req(API + "/kaspi-webhook.php", "GET"); ok(c == 405, "GET на вебхук → 405")
c, w = webhook(None, raw=b"not json"); ok(c == 400, "не-JSON с верной подписью → 400")

# ---------- 5. оплата найдена опросом (вебхук не дошёл) ----------
mock_reset()
c, j = create(lead="lead_poll00001"); order2 = j["order"]; iid2 = order_file(order2)["invoice_id"]
set_invoice(iid2, status="paid", paid_at="2026-09-04T12:05:00+00:00")
time.sleep(4.2); c, s = status(order2)
ok(s["status"] == "paid", "poll: увидели paid без вебхука → paid (выдача в фоне)")
time.sleep(2.5)
c, s = status(order2); ok(s["fulfilled"], "poll: через 2 с заказ выдан фоновым самозапросом")
ok(order_file(order2)["fulfill_via"] == "poll" and not any("async_failed" in l for l in open(glob.glob(PRIV + "/kaspi/log-*.jsonl")[0])) and len(rpc_calls("tiptop_issue_report")) == 1, "выдано через poll, issue_report один раз")
c, w = webhook(inv_event(iid2, "paid", order2)); time.sleep(1)
ok(len(rpc_calls("tiptop_issue_report")) == 1, "поздний вебхук paid не выдаёт второй раз")

# ---------- 6. ошибки Kaspi ----------
mock_reset()
c, j = create(lead="lead_err0000001", phone="+7 700 000 00 00"); order3 = j["order"]; iid3 = order_file(order3)["invoice_id"]
c, w = webhook(inv_event(iid3, "error", order3, extra={"error_code": "client_not_found", "error_message": "Этот номер не зарегистрирован в Kaspi."}))
c, s = status(order3); ok(s["status"] == "error" and s["error_code"] == "client_not_found" and "Kaspi" in s["error_message"], "error client_not_found виден в статусе")
ok(len(rpc_calls()) == 0, "при ошибке в базу ничего не пишется")
c, j = create(lead="lead_err0000001", phone="+7 700 000 00 00"); ok(j["order"] != order3, "после error новый счёт (старый не переиспользуется)")
order3b = j["order"]; iid3b = order_file(order3b)["invoice_id"]
webhook(inv_event(iid3b, "expired", order3b)); c, s = status(order3b); ok(s["status"] == "expired", "expired виден")
webhook(inv_event(iid3b, "paid", order3b)); time.sleep(1.2); c, s = status(order3b)
ok(s["status"] == "paid" and s["fulfilled"], "оплата после expired побеждает и выдаёт")
c, j = create(lead="lead_cnc0000001"); o4 = j["order"]; i4 = order_file(o4)["invoice_id"]
webhook(inv_event(i4, "cancelled", o4)); c, s = status(o4); ok(s["status"] == "cancelled", "cancelled виден")

# ---------- 7. переиспользование живого счёта, валидация, лимит ----------
mock_reset()
c, j1 = create(lead="lead_reuse000001"); c, j2 = create(lead="lead_reuse000001")
ok(j1["order"] == j2["order"] and j2.get("reused"), "повторное нажатие → тот же счёт, не спамим Kaspi")
c, j3 = create(lead="lead_reuse000001", phone="+7 701 111 11 11"); ok(j3["order"] != j1["order"], "другой номер → новый счёт")
c, j = create(kind="school"); ok(c == 400 and j["why"] == "bad_kind", "неизвестный kind → 400")
c, j = create(phone="12345"); ok(c == 400 and j["why"] == "bad_phone", "кривой номер → 400")
c, j = create(lead="x"); ok(c == 400 and j["why"] == "bad_lead", "отчёт без лида → 400")
c, j = create(kind="pro_season", lead="", account="not-an-email"); ok(c == 400 and j["why"] == "bad_account", "Pro без почты аккаунта → 400")
c, j = create(email="bad@"); ok(c == 400 and j["why"] == "bad_email", "кривая почта → 400")
c, j = req(API + "/kaspi.php?a=create", "POST", {"kind": "report"}, headers={"Origin": "https://evil.example"}); ok(c == 403, "чужой Origin → 403")
c, j = req(API + "/kaspi.php?a=status&o=zzz"); ok(c == 400, "кривой order → 400")
c, j = req(API + "/kaspi.php?a=status&o=k0000000000000000"); ok(c == 404, "неизвестный order → 404")
n429 = 0
for i in range(8):
    c, j = create(lead="lead_rate%08d" % i)
    if c == 429: n429 += 1
ok(n429 == 3, "лимит 6 счетов в сутки на (IP, номер) → 429 (%d из 8 + 1 ранее)" % n429)
c, j = create(lead="lead_rate_other1", phone="+7 702 999 99 99"); ok(c == 200, "другой номер с того же IP — можно (операторы сажают многих на один IP)")
mock_set(no_id=True); c, j = create(lead="lead_noid0000001", phone="+7 702 999 99 98"); mock_set(no_id=False)
ok(c == 503 and j["why"] == "http_noid", "ApiPay ответил без номера счёта → 503, заказ не создаём")

# ---------- 8. ApiPay недоступен / отказал ----------
mock_reset()
mock_set(fail_create=[409, "kaspi_session_expired"])
c, j = create(); ok(c == 400 and j["why"] == "kaspi_session_expired", "кассир отвалился → понятный why " + str(j))
mock_set(fail_create=[503, "unavailable"]); c, j = create(); ok(c == 503, "ApiPay 5xx → 503")
mock_set(fail_create=None)
c, j = create(lead="lead_getfail0001"); o5 = j["order"]
mock_set(invoice_get_fail=True); time.sleep(4.2); c, s = status(o5); ok(c == 200 and s["status"] == "processing", "GET /invoices упал → отдаём последний известный статус, не 500")
mock_set(invoice_get_fail=False)

# ---------- 9. Pro-подписка ----------
mock_reset()
c, j = create(kind="pro_season", lead="", email="user@example.com", account="user@example.com"); o6 = j["order"]; i6 = order_file(o6)["invoice_id"]
ok(j["amount"] == 14900, "Pro сезон — 14 900")
webhook(inv_event(i6, "paid", o6, amount="14900.00")); time.sleep(1.2)
g = rpc_calls("tiptop_grant_pro")
ok(len(g) == 1 and g[0][1]["p_email"] == "user@example.com" and g[0][1]["p_plan"] == "season" and g[0][1]["p_amount"] == 14900 and g[0][1]["p_txn"] == "kaspi_" + str(i6), "grant_pro: почта аккаунта, план season, 14 900, txn kaspi_<id>")
ok(order_file(o6)["fulfilled"], "Pro выдан")
c, j = create(kind="pro_month", lead="", email="nouser@example.com", account="nouser@example.com"); o7 = j["order"]; i7 = order_file(o7)["invoice_id"]
webhook(inv_event(i7, "paid", o7, amount="4990.00")); time.sleep(1.2)
ok(order_file(o7)["fulfilled"] and rpc_calls("tiptop_grant_pro")[-1][1]["p_plan"] == "month", "Pro месяц: RPC вызван (аккаунта нет → владельцу «выдать вручную»)")

# ---------- 10. сумма не сходится, чужой счёт, тест-событие, возврат, песочница ----------
mock_reset()
c, j = create(lead="lead_mismatch001"); o8 = j["order"]; i8 = order_file(o8)["invoice_id"]
webhook(inv_event(i8, "paid", o8, amount="10.00")); time.sleep(1.2)
of = order_file(o8); ok(of["fulfilled"] and of.get("fulfill_note") == "mismatch" and len(rpc_calls("tiptop_issue_report")) == 0, "оплата 10 ₸ вместо 4000 → отчёт НЕ выдан, помечено mismatch")
c, w = webhook(inv_event(777777, "paid", "kabcdefabcdefabcd")); ok(c == 200 and w.get("unknown"), "оплата неизвестного счёта → 200 unknown (владельцу — письмо)")
c, w = webhook({"event": "webhook.test"}); ok(c == 200 and w.get("test"), "webhook.test → 200")
c, w = webhook({"event": "subscription.created", "subscription": {"id": 1}}); ok(c == 200 and w.get("ignored"), "чужое событие → 200 ignored")
c, w = webhook({"event": "invoice.refunded", "invoice": {"id": i8}, "refund": {"id": 5, "status": "completed", "amount": "4000.00"}}); time.sleep(1)
ok(c == 200 and rpc_calls("tiptop_refund")[0][1]["p_orig_txn"] == "kaspi_" + str(i8), "возврат → tiptop_refund по kaspi_<id>")
c, j = create(lead="lead_sandbox0001"); o9 = j["order"]; i9 = order_file(o9)["invoice_id"]
webhook(inv_event(i9, "paid", o9, extra={"is_sandbox": True})); time.sleep(1.2)
ok(rpc_calls("tiptop_mark_paid")[-1][1]["p_test"] is True, "песочница ApiPay → платёж помечен тестовым (отчёт клиенту не уходит)")

# ---------- 12. консультация и пакет с тарифов ----------
mock_reset()
c, j = create(kind="consult", lead="", name="Аида", email="aida@example.com", phone="+7 701 234 56 78"); oc = j["order"]; ic = order_file(oc)["invoice_id"]
ok(c == 200 and j["amount"] == 15000, "consult: счёт 15 000 создан")
ok([l for l in mock_state()["log"] if l[1] == "/api/v1/invoices"][-1][2]["description"] == "Scholary: разбор со специалистом", "описание счёта — разбор со специалистом")
c, j = create(kind="consult", lead="", name="Аида", email="aida@example.com", phone="+7 701 234 56 78"); ok(j.get("reused"), "повтор → тот же счёт (по почте+номеру)")
c, j = create(kind="consult", lead="", email="", phone="+7 701 234 56 78"); ok(c == 400 and j["why"] == "bad_email", "consult без почты → 400 (подтверждение идёт и на почту)")
c, j = create(kind="consult", lead="zzz", email="aida2@example.com", phone="+7 701 234 56 79"); ok(c == 200, "consult с кривым lead → lead игнорируется, счёт создан")
webhook(inv_event(ic, "paid", oc, amount="15000.00")); time.sleep(1.5)
st = mock_state()["state"]; of = order_file(oc)
ok(of["fulfilled"] and len(rpc_calls("tiptop_issue_report")) == 0, "consult оплачен: выдан без отчёта")
ok(rpc_calls("tiptop_log_payment")[-1][1]["p_kind"] == "consult" and rpc_calls("tiptop_log_payment")[-1][1]["p_amount"] == 15000, "журнал платежей: consult 15 000")
wa = [w for w in st["wa"] if w["chatId"] == "77012345678@c.us"]
ok(len(wa) == 1 and "Аида, спасибо" in wa[0]["message"] and "15 000 ₸" in wa[0]["message"] and "Профориентолог" in wa[0]["message"] and "aida@example.com" in wa[0]["message"], "покупателю ушёл WhatsApp: имя, сумма, «профориентолог напишет», почта")
ml = [m for m in st["mail"] if m["to"] == ["aida@example.com"]]
ok(len(ml) == 1 and "Оплата получена" in ml[0]["subject"] and "консультации" in ml[0]["text"], "покупателю ушло письмо «Оплата получена»")
own = [m for m in st["mail"] if m["to"] == ["owner@example.com"]]
ok(len(own) == 1 and "Аида" in own[0]["html"] and "+77012345678" in own[0]["html"] and "назначить дату" in own[0]["html"], "владельцу — письмо с именем, WhatsApp и «назначить дату»")
webhook(inv_event(ic, "paid", oc, amount="15000.00")); time.sleep(1.2)
ok(len([w for w in mock_state()["state"]["wa"] if w["chatId"] == "77012345678@c.us"]) == 1, "повтор вебхука → второго сообщения нет")
c, j = create(kind="package", lead="", name="Ерлан", email="erlan@example.com", phone="+7 702 000 00 01"); op = j["order"]; ip = order_file(op)["invoice_id"]
ok(j["amount"] == 35000, "package: счёт 35 000")
webhook(inv_event(ip, "paid", op, amount="35000.00", extra={"is_sandbox": True})); time.sleep(1.5)
st = mock_state()["state"]
ok(not [w for w in st["wa"] if w["chatId"] == "77020000001@c.us"] and [w for w in st["wa"] if w["chatId"] == "77024666852@c.us" and "ТЕСТОВЫЙ" in w["message"] and "Документы и подача" in w["message"]], "package в песочнице: подтверждение только владельцу, с пометкой ТЕСТ")
ok(rpc_calls("tiptop_log_payment")[-1][1]["p_test"] is True and rpc_calls("tiptop_log_payment")[-1][1]["p_kind"] == "package", "журнал: package, тестовый")
c, j = create(kind="consult", lead="", email="short@example.com", phone="+7 701 234 56 70"); o10 = j["order"]; i10 = order_file(o10)["invoice_id"]
webhook(inv_event(i10, "paid", o10, amount="4000.00")); time.sleep(1.2)
ok(order_file(o10).get("fulfill_note") == "mismatch" and not [w for w in mock_state()["state"]["wa"] if w["chatId"] == "77012345670@c.us"], "consult оплачен на 4 000 вместо 15 000 → подтверждение не уходит, владельцу «разобрать»")

# ---------- 12б. гонки и зависшая выдача ----------
import subprocess
o11 = oc
php = """<?php $_SERVER['DOCUMENT_ROOT']='%s/httpdocs'; require '%s/httpdocs/api/_kaspi.php';
$r = kaspi_order_load('%s'); $r['fulfilled'] = false; $r['status'] = 'pending'; $r = kaspi_order_save($r);
echo json_encode(['f' => $r['fulfilled'], 's' => $r['status']]);""" % (os.path.dirname(PRIV), os.path.dirname(PRIV), o11)
out = subprocess.run(["php", "-r", php.replace("<?php", "")], capture_output=True, text=True).stdout
ok('"f":true' in out and '"s":"paid"' in out, "сохранение не откатывает «оплачен» и «выдан» (гонка вебхук↔опрос) " + out)
ok(not glob.glob(os.path.join(PRIV, "kaspi/orders/*.tmp")), "временных файлов не осталось")
# зависшая выдача: замок стоит 12 минут, fulfilled нет → владельцу письмо «разобрать вручную»
c, j = create(kind="consult", lead="", name="Зависший", email="stuck@example.com", phone="+7 701 000 11 22"); os_ = j["order"]; is_ = order_file(os_)["invoice_id"]
rec = order_file(os_); rec["status"] = "paid"; rec["paid_amount"] = 15000; rec["fulfill_started"] = int(time.time()) - 720
json.dump(rec, open(os.path.join(PRIV, "kaspi/orders", os_ + ".json"), "w"))
import hashlib as _h
open(os.path.join(PRIV, "tiptop", "seen-" + _h.sha256(("kaspi-fulfill-" + os_).encode()).hexdigest()[:32] + ".flag"), "w").write("1")
mails_before = len(mock_state()["state"]["mail"])
c, s2 = status(os_); time.sleep(1.5)
own = [m for m in mock_state()["state"]["mail"][mails_before:] if m["to"] == ["owner@example.com"] and "зависла" in m["subject"]]
ok(len(own) == 1 and os_ in own[0]["html"], "выдача зависла >10 мин → владельцу письмо «проверить»")
ok(len([w for w in mock_state()["state"]["wa"] if w["chatId"] == "77010001122@c.us"]) == 1 and order_file(os_).get("fulfilled"), "…и выдача повторяется сама: клиенту ровно одно подтверждение, заказ выдан")

# ---------- 13. рубильник APIPAY_ENABLED ----------
set_secrets(APIPAY_ENABLED=False)
c, j = create(lead="lead_switch00001"); ok(c == 503 and j["why"] == "kaspi_off", "APIPAY_ENABLED=false → новые счета не выставляем (503 kaspi_off)")
c, s = status(oc); ok(c == 200 and s["status"] == "paid", "…но статус старых счетов отдаём")
c, w = webhook(inv_event(ip, "cancelled", op)); ok(c == 200, "…и вебхук принимаем")
set_secrets(APIPAY_ENABLED=True)
c, j = create(lead="lead_switch00002"); ok(c == 200 and j["ok"], "APIPAY_ENABLED=true → снова работает")

# ---------- 14. регрессия TipTop (карта) ----------
import base64, urllib.parse
def tt(type_, fields, sign=True):
    raw = urllib.parse.urlencode(fields).encode()
    h = {"Content-Type": "application/x-www-form-urlencoded"}
    if sign: h["Content-HMAC"] = base64.b64encode(hmac.new(b"ttsecret", raw, hashlib.sha256).digest()).decode()
    return req(API + "/tiptop.php?type=" + type_, "POST", raw=raw, headers=h)
mock_reset()
c, j = tt("check", {"TransactionId": "901", "Amount": "4000.00", "Currency": "KZT", "InvoiceId": "lead_card0000001"}); ok(c == 200 and j["code"] == 0, "TipTop check 4000 KZT → code 0")
c, j = tt("check", {"TransactionId": "902", "Amount": "999.00", "Currency": "KZT", "InvoiceId": "lead_card0000001"}); ok(c == 200 and j["code"] == 12, "TipTop check 999 ₸ → code 12 (не из прайса)")
c, j = tt("pay", {"TransactionId": "903", "Amount": "4000.00", "Currency": "KZT", "InvoiceId": "lead_card0000001", "Email": "card@example.com", "Status": "Completed", "TestMode": "0"}, sign=False); ok(c == 403, "TipTop pay без подписи → 403")
c, j = tt("pay", {"TransactionId": "903", "Amount": "4000.00", "Currency": "KZT", "InvoiceId": "lead_card0000001", "Email": "card@example.com", "Status": "Completed", "TestMode": "0"}); time.sleep(1)
mp = rpc_calls("tiptop_mark_paid"); ok(c == 200 and j["code"] == 0 and mp and mp[-1][1]["p_txn"] == "903" and mp[-1][1]["p_kind"] == "report", "TipTop pay → лид отмечен, kind report")
ok(len(rpc_calls("tiptop_issue_report")) == 1 and [w for w in mock_state()["state"]["wa"] if w["chatId"] == "77001112233@c.us"], "TipTop pay → отчёт выдан и ушёл на WhatsApp клиента")
c, j = tt("pay", {"TransactionId": "904", "Amount": "14900.00", "Currency": "KZT", "AccountId": "user@example.com", "Email": "user@example.com", "Status": "Completed", "TestMode": "1"}); time.sleep(1)
g = rpc_calls("tiptop_grant_pro"); ok(g and g[-1][1]["p_plan"] == "season" and g[-1][1]["p_test"] is True, "TipTop pay 14 900 → Pro сезон, тестовый")

# ---------- 15. сценарий 19: база молчит при выдаче → повтор, а не «выдано» ----------
mock_reset(); set_secrets()
mock_set(fail_rpc=True)
c, j = create(lead="lead_dbdown000001", phone="+7 705 100 20 30"); od = j["order"]; idd = order_file(od)["invoice_id"]
webhook(inv_event(idd, "paid", od)); time.sleep(1.8)
of = order_file(od)
ok(of["status"] == "paid" and not of.get("fulfilled") and of.get("fulfill_note") == "db_failed" and of.get("fulfill_attempts") == 1 and of.get("fulfill_retry_after", 0) > time.time(), "база молчит → заказ НЕ помечен выданным, стоит пауза на повтор " + str({k: of.get(k) for k in ("fulfilled", "fulfill_note", "fulfill_attempts")}))
c, s = status(od); ok(s["status"] == "paid" and not s["fulfilled"] and s.get("retrying") is True, "статус: paid, retrying=true (экран ждёт, не врёт «выдано»)")
ok(not [w for w in mock_state()["state"]["wa"] if w["chatId"] == "77051002030@c.us"], "клиенту ничего не ушло (отчёта нет)")
# база ожила: сдвигаем паузу назад и опрашиваем — выдача должна довыдать
rec = order_file(od); rec["fulfill_retry_after"] = int(time.time()) - 1; json.dump(rec, open(os.path.join(PRIV, "kaspi/orders", od + ".json"), "w"))
mock_set(fail_rpc=False)
c, s = status(od); time.sleep(2.2); of = order_file(od)
ok(of.get("fulfilled") and of.get("fulfill_via") == "poll" and of.get("report_token") == "tok_lead_dbdown000001", "база ожила → следующий опрос довыдал: fulfilled, токен отчёта сохранён в заказе")
ok(len(rpc_calls("tiptop_issue_report")) == 1 and len(rpc_calls("tiptop_mark_paid")) == 1, "RPC по одному разу после повтора")
c, s = status(od); ok(s["fulfilled"] and s["report_url"] == "https://scholary.kz/report/?t=tok_lead_dbdown000001" and s["delivered"] == {"wa": True, "mail": True}, "статус отдаёт ссылку на отчёт и флаги доставки " + str(s.get("report_url")))
ok([w for w in mock_state()["state"]["wa"] if w["chatId"] == "77001112233@c.us" and "tok_lead_dbdown000001" in w["message"]], "отчёт ушёл на WhatsApp из данных RPC")

# ---------- 16. сценарии 8–10: WhatsApp и почта лежат → ссылка на экране + повтор доставки ----------
mock_reset(); set_secrets()
mock_set(fail_wa=True, fail_mail=True)
c, j = create(lead="lead_nodeliver0001", phone="+7 705 100 20 31"); on = j["order"]; idn = order_file(on)["invoice_id"]
webhook(inv_event(idn, "paid", on)); time.sleep(1.8)
of = order_file(on)
ok(of.get("fulfilled") and of.get("deliver_pending") is True and of["deliver"]["attempts"] == 1 and not of["deliver"]["wa"] and not of["deliver"]["mail"], "оба канала упали → выдано, но deliver_pending " + str(of.get("deliver")))
c, s = status(on); ok(s["fulfilled"] and s["report_url"] and s["delivered"] == {"wa": False, "mail": False}, "статус: ссылка на отчёт есть (экран покажет кнопку), delivered = false/false")
ms = [m for m in rpc_calls("tiptop_mark_report_sent")]; ok(ms and ms[-1][1]["p_wa"] == "failed" and ms[-1][1]["p_email"] == "failed", "в базе отмечено: WhatsApp failed, почта failed (видно в админке)")
# повтор доставки не раньше чем через минуту: сдвигаем время, чиним WhatsApp
c, s = status(on); ok(order_file(on)["deliver"]["attempts"] == 1, "повтор не чаще раза в минуту — вторая попытка ещё не сделана")
rec = order_file(on); rec["deliver"]["at"] = int(time.time()) - 61; json.dump(rec, open(os.path.join(PRIV, "kaspi/orders", on + ".json"), "w"))
mock_set(fail_wa=False)
c, s = status(on); time.sleep(0.5); of = order_file(on)
ok(of["deliver"]["attempts"] == 2 and of["deliver"]["wa"] is True and of.get("deliver_pending") is False, "через минуту WhatsApp ожил → доставлено, deliver_pending снят " + str(of.get("deliver")))
ok([w for w in mock_state()["state"]["wa"] if w["chatId"] == "77001112233@c.us" and "tok_lead_nodeliver0001" in w["message"]], "клиент получил отчёт в WhatsApp со второй попытки")
ok(rpc_calls("tiptop_mark_report_sent")[-1][1]["p_wa"] == "sent", "в базе отметка обновлена: WhatsApp sent")
c, s = status(on); ok(order_file(on)["deliver"]["attempts"] == 2, "после доставки повторов больше нет")

# ---------- 17. сценарий 19б: замок стоит >10 мин → повторная выдача сама ----------
mock_reset(); set_secrets()
c, j = create(kind="consult", lead="", name="Повтор", email="retry@example.com", phone="+7 701 000 11 33"); os2 = j["order"]
rec = order_file(os2); rec["status"] = "paid"; rec["paid_amount"] = 15000; rec["fulfill_started"] = int(time.time()) - 720; rec["fulfill_attempts"] = 1
json.dump(rec, open(os.path.join(PRIV, "kaspi/orders", os2 + ".json"), "w"))
os.makedirs(os.path.join(PRIV, "tiptop"), exist_ok=True)
open(os.path.join(PRIV, "tiptop", "seen-" + _h.sha256(("kaspi-fulfill-" + os2).encode()).hexdigest()[:32] + ".flag"), "w").write("1")
c, s = status(os2); time.sleep(2)
of = order_file(os2)
ok(of.get("fulfilled") and of.get("fulfill_attempts") == 2, "зависшая выдача → замок снят, выдано со второй попытки " + str({k: of.get(k) for k in ("fulfilled", "fulfill_attempts")}))
ok([w for w in mock_state()["state"]["wa"] if w["chatId"] == "77010001133@c.us"], "клиент получил подтверждение консультации")
own = [m for m in mock_state()["state"]["mail"] if m["to"] == ["owner@example.com"] and "зависла" in m["subject"]]
ok(len(own) == 1, "владельцу одно письмо «зависла — проверить»")

# ---------- 18. сценарий 11/5: повторное нажатие после оплаты не выставляет второй счёт ----------
mock_reset(); set_secrets()
c, j = create(lead="lead_twice000001", phone="+7 705 100 20 32"); ot = j["order"]; idt = order_file(ot)["invoice_id"]
webhook(inv_event(idt, "paid", ot)); time.sleep(1.8)
c, j2 = create(lead="lead_twice000001", phone="+7 705 100 20 32")
ok(c == 200 and j2["order"] == ot and j2.get("paid_before") and j2["status"] == "paid" and j2["fulfilled"] and "tok_lead_twice000001" in (j2.get("report_url") or ""), "отчёт по этой заявке уже оплачен → тот же заказ, статус paid и ссылка, второго счёта нет " + str(j2))
ok(len([l for l in mock_state()["log"] if l[1] == "/api/v1/invoices" and l[0] == "POST"]) == 1, "в ApiPay ушёл только один POST /invoices")
c, j3 = create(kind="consult", lead="", email="twice@example.com", phone="+7 705 100 20 33"); oc2 = j3["order"]; idc2 = order_file(oc2)["invoice_id"]
webhook(inv_event(idc2, "paid", oc2, amount="15000.00")); time.sleep(1.5)
c, j4 = create(kind="consult", lead="", email="twice@example.com", phone="+7 705 100 20 33")
ok(j4["order"] != oc2 and not j4.get("paid_before"), "консультация — отдельная покупка: после оплаты новый счёт выставляется")

# ---------- 19. ttclid и браузер покупателя попадают в заказ (для TikTok CompletePayment) ----------
c, j = req(API + "/kaspi.php?a=create", "POST", {"kind": "report", "phone": "+7 705 100 20 34", "email": "", "lead": "lead_ttclid000001", "ttclid": "E.C.P.abc-123"}, headers={"User-Agent": "TestBrowser/1.0", "Cookie": "ttclid=E.C.P.cookie"})
of = order_file(j["order"]); ok(of.get("ttclid") == "E.C.P.abc-123" and of.get("ua") == "TestBrowser/1.0", "ttclid из тела и User-Agent сохранены в заказе " + str({k: of.get(k) for k in ("ttclid", "ua")}))
c, j = req(API + "/kaspi.php?a=create", "POST", {"kind": "report", "phone": "+7 705 100 20 35", "email": "", "lead": "lead_ttclid000002"}, headers={"Cookie": "ttclid=E.C.P.cookie"})
ok(order_file(j["order"]).get("ttclid") == "E.C.P.cookie", "без ttclid в теле берётся cookie")


# ---------- 20. серверное событие TikTok CompletePayment: уходит с ttclid, ответ пишется в журнал ----------
mock_reset()
c, j = req(API + "/kaspi.php?a=create", "POST", {"kind": "report", "phone": "+7 705 100 20 36", "email": "tt@example.com", "lead": "lead_ttclid000003", "ttclid": "E.C.P.live-777"}, headers={"User-Agent": "BuyerPhone/2.0"})
o20 = j["order"]; i20 = order_file(o20)["invoice_id"]
c, w = webhook(inv_event(i20, "paid", o20)); time.sleep(1.5)
tt = mock_state()["state"].get("tt", [])
ok(len(tt) == 1 and tt[0]["data"][0]["event"] == "CompletePayment" and tt[0]["event_source_id"] and "test_event_code" not in tt[0], "после оплаты в TikTok ушло одно CompletePayment без test_event_code")
u = tt[0]["data"][0]["user"] if tt else {}
ok(u.get("ttclid") == "E.C.P.live-777" and u.get("user_agent") == "BuyerPhone/2.0" and len(u.get("email", "")) == 64 and len(u.get("phone", "")) == 64 and "tt@example.com" not in json.dumps(tt), "в событии ttclid и браузер покупателя, почта/телефон только SHA-256")
pr = tt[0]["data"][0]["properties"] if tt else {}
ok(pr.get("value") == 4000 and pr.get("currency") == "KZT" and pr.get("contents", [{}])[0].get("content_id") == "report", "value 4000 KZT, contents.content_id=report")
ok(tt[0]["data"][0]["event_id"] == "pay_kaspi_" + str(i20), "event_id = pay_<txn> — дедуп с браузерным событием")
logs = glob.glob(PRIV + "/tiktok/events-*.log")
rows = [json.loads(l) for l in open(logs[0])] if logs else []
last = rows[-1] if rows else {}
ok(bool(rows) and last.get("event") == "CompletePayment" and last.get("code") == 0 and last.get("ttclid") == 1 and last.get("test") == 0 and "tt@example.com" not in open(logs[0]).read(), "журнал /private/tiktok: CompletePayment code 0, ttclid=1, без персональных данных")
c, w = webhook(inv_event(i20, "paid", o20)); time.sleep(1.0)
ok(len(mock_state()["state"].get("tt", [])) == 1, "повтор вебхука → второго события в TikTok нет")
mock_set(fail_tt=True)
c, j = create(phone="+7 705 100 20 37", lead="lead_ttclid000004"); o21 = j["order"]; i21 = order_file(o21)["invoice_id"]
c, w = webhook(inv_event(i21, "paid", o21)); time.sleep(1.5)
of21 = order_file(o21); rows = [json.loads(l) for l in open(glob.glob(PRIV + "/tiktok/events-*.log")[0])]
ok(of21["fulfilled"] and rows[-1].get("code") == 50000 and rows[-1].get("http") == 500, "TikTok упал → отчёт всё равно выдан, в журнале ошибка 50000")
mock_set(fail_tt=False)

# ---------- 11. чистота: ключ API не утекает ----------
c, s = status(o9); ok("testkey" not in json.dumps(s) and "whsecret" not in json.dumps(s), "в ответах нет ключей")
print("\n" + ("FAILS: %d" % fails if fails else "ALL PASSED"))
raise SystemExit(1 if fails else 0)
