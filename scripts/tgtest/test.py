import json, urllib.request, sys
M="http://127.0.0.1:8132"; P="http://127.0.0.1:8133/api/tg-send.php"
def post(path, obj):
    r=urllib.request.Request(M+path, data=json.dumps(obj).encode(), headers={"Content-Type":"application/json"}); return json.loads(urllib.request.urlopen(r).read())
def get(url): return json.loads(urllib.request.urlopen(url).read())
fails=0
def ok(c,m):
    global fails; print(("OK   " if c else "FAIL ")+m); fails+= (0 if c else 1)
U1="11111111-1111-1111-1111-111111111111"; U2="22222222-2222-2222-2222-222222222222"
week_items=[{"chat_id":"1001","user_id":U1,"name":"Айгерим Сейткали","week":2,"apps_open":3,"apps_total":4,"docs_ready":2,"docs_total":7,"tasks_done":0,"tasks_done_prev":2,"next_program":"KAIST Undergraduate (Fall 2027)","next_deadline":"2026-09-18","next_days":13,"progress_days":1},
            {"chat_id":"1002","user_id":U2,"name":"","week":2,"apps_open":0,"apps_total":0,"docs_ready":0,"docs_total":0,"tasks_done":0,"tasks_done_prev":0,"next_program":None,"next_deadline":None,"next_days":None,"progress_days":0}]
# 1. digest, no deadlines
post("/__reset",{}); post("/__set",{"week":{"digest":{"ok":True,"items":week_items,"milestone":100,"week_start":"2026-09-07"}}})
j=get(P+"?key=cronkey&kind=digest&dry=1")
ok(j["ok"] and j["people"]==2 and j["sent"]==2 and j["week"]["kind"]=="digest" and j["week"]["people"]==2, "digest: 2 people, dry")
pv=j["preview"]; print("----\n"+pv+"\n----")
ok(pv.startswith("Айгерим, план на неделю 2 сезона готов."), "digest: имя и номер недели")
ok("Открытых подач: <b>3</b> · документов готово: <b>2 из 7</b>" in pv, "digest: подачи и документы")
ok("KAIST Undergraduate (Fall 2027)</b> — через 13 дней" in pv, "digest: ближайший дедлайн, склонение «дней»")
ok("закрыто 2 задачи" in pv, "digest: прошлая неделя 2 задачи")
ok("cabinet/?tab=today&from=tg" in pv and "/stop" in pv and pv.count("/stop")==1, "digest: ссылка и /stop один раз")
st=get(M+"/__state"); kinds=[r[0] for r in st["rpc"]]
ok(kinds==["tg_due","tg_week_due"] and st["rpc"][1][1]["p_kind"]=="digest", "digest: RPC tg_due + tg_week_due(digest)")
ok(not any(k=="tg_mark_sent" for k in kinds), "dry: tg_mark_sent не вызывается")
# 2. nudge
post("/__reset",{}); post("/__set",{"week":{"nudge":{"ok":True,"items":week_items[:1],"milestone":101,"week_start":"2026-09-07"}}})
j=get(P+"?key=cronkey&kind=nudge&dry=1"); pv=j["preview"]; print("----\n"+pv+"\n----")
ok(j["week"]["kind"]=="nudge" and j["people"]==1, "nudge: 1 человек")
ok(pv.startswith("Айгерим, на этой неделе в кабинете пока тихо") and "неделя засчитывается за одну закрытую задачу" in pv, "nudge: текст")
ok("через 13 дней" in pv and "одна задача на 10 минут" in pv and pv.count("/stop")==1, "nudge: дедлайн, ссылка, /stop")
# 3. digest merged with deadline reminder for same chat + user without name
due=[{"chat_id":"1001","user_id":U1,"program_id":"kaist-ug","program":"KAIST Undergraduate","deadline":"18.09.2026","milestone":14,"name":"Айгерим Сейткали"}]
post("/__reset",{}); post("/__set",{"due":due,"week":{"digest":{"ok":True,"items":week_items,"milestone":100,"week_start":"2026-09-07"}}})
j=get(P+"?key=cronkey&kind=digest&dry=1"); pv=j["preview"]; print("----\n"+pv+"\n----")
ok(j["people"]==2 and j["items"]==1 and j["sent"]==2, "merge: 2 письма (1 с дедлайном+дайджест, 1 только дайджест)")
ok(pv.startswith("Айгерим, напоминаю про дедлайн:") and "— — —" in pv and "\n\nПлан на неделю 2 сезона готов." in pv and pv.count("Айгерим")==1, "merge: дедлайн + недельная часть в одном письме")
ok(pv.count("cabinet/?tab=today&from=tg")==1 and pv.count("/stop")==1, "merge: ссылка и /stop по одному разу")
# 4. no forced kind on Saturday → no week part
post("/__reset",{}); post("/__set",{"due":due})
j=get(P+"?key=cronkey&dry=1"); ok(j["week"]["kind"]=="" and j["people"]==1, "без kind в субботу: только дедлайны, tg_week_due не зовём")
st=get(M+"/__state"); ok([r[0] for r in st["rpc"]] in (["tg_due"], ["tg_due","founder_digest_due"]), "без kind: только tg_due (+ founder_digest_due после 9:00 по Алматы)")
# 5. week RPC failure → still sends deadlines
post("/__reset",{}); post("/__set",{"due":due,"week":{"digest":{"ok":False}}})
j=get(P+"?key=cronkey&kind=digest&dry=1"); ok(j["ok"] and j["people"]==1 and j["week"]["people"]==0 and "напоминаю про дедлайн" in j["preview"], "сбой tg_week_due: дедлайны идут, недельной части нет")
# 6. plural
post("/__reset",{}); wi=dict(week_items[0]); wi["next_days"]=1; wi["tasks_done_prev"]=5; wi2=dict(week_items[0]); wi2["next_days"]=21; wi2["tasks_done_prev"]=1
post("/__set",{"week":{"digest":{"ok":True,"items":[wi],"milestone":100,"week_start":"2026-09-07"}}})
pv=get(P+"?key=cronkey&kind=digest&dry=1")["preview"]; ok("через 1 день" in pv and "закрыто 5 задач" in pv, "склонение: 1 день, 5 задач")
post("/__set",{"week":{"digest":{"ok":True,"items":[wi2],"milestone":100,"week_start":"2026-09-07"}}})
pv=get(P+"?key=cronkey&kind=digest&dry=1")["preview"]; ok("через 21 день" in pv and "закрыто 1 задача" in pv, "склонение: 21 день, 1 задача")
# 7. HTML escaping of program name
wi3=dict(week_items[0]); wi3["next_program"]="A <b>&</b> B"
post("/__set",{"week":{"digest":{"ok":True,"items":[wi3],"milestone":100,"week_start":"2026-09-07"}}})
pv=get(P+"?key=cronkey&kind=digest&dry=1")["preview"]; ok("A &lt;b&gt;&amp;&lt;/b&gt; B" in pv, "экранирование HTML в названии программы")
# 8. ws digest (профориентолог) — отдельно и склейка с дайджестом ученика на том же чате
post("/__reset",{}); post("/__set",{"ws":{"ok":True,"items":[{"chat_id":"2001","user_id":"33333333-3333-3333-3333-333333333333","name":"Айгуль Сериковна","students":14,"deadlines_7":2,"deadlines_45":6,"overdue":1,"meetings":2,"no_step":3,"idle":1}],"milestone":110,"week_start":"2026-09-07"}})
j=get(P+"?key=cronkey&kind=ws&dry=1"); pv=j["preview"]; print("----\n"+pv+"\n----")
ok(j["ws"]["on"] and j["ws"]["people"]==1 and j["people"]==1, "ws digest: 1 профориентолог")
ok(pv.startswith("Айгуль, план недели по workspace (14 учеников):") and "Дедлайнов на этой неделе: <b>2</b> · в 45 дней: 6" in pv and "Просроченных задач: <b>1</b>" in pv and "Без следующего шага: <b>3</b>" in pv and "prof/cabinet/?from=tg#/week" in pv and pv.count("/stop")==1, "ws digest: состав")
post("/__set",{"week":{"digest":{"ok":True,"items":[dict(week_items[0],chat_id="2001",user_id="33333333-3333-3333-3333-333333333333")],"milestone":100,"week_start":"2026-09-07"}}})
j=get(P+"?key=cronkey&kind=ws&dry=1"); ok(j["people"]==1 and "— — —" not in (j["preview"] or "") , "ws: kind=ws не тянет ученический дайджест")
st=get(M+"/__state"); ok(not any(r[0]=="tg_mark_sent" for r in st["rpc"]), "ws dry: без tg_mark_sent")
# 9. founder digest (web-77): отдельное сообщение админу, дедуп founder:<день>, kind=founder принудительно
FST={"visits":143,"visitors":131,"pages_per_visit":1.8,"avg_active_s":74,"bounce":46,"mobile_share":82,"quiz_open":61,"quiz_start":44,"quiz_done":27,"paywall":25,"contacts":12,"pay_click":9,"kaspi_click":6,"pro_click":3,"payments":3,"revenue":12000,"pro_paid":1,"cab_open":8,"cab_signup":2,"school_demo":4,"prof_demo":1,"schools_page":9,"prof_page":5,"school_apply":1,"prof_apply":0,"wa_click":5,"tg_click":1}
FPR=dict(FST); FPR.update({"visits":100,"quiz_done":30,"contacts":12,"payments":1,"revenue":4000,"cab_signup":2})
post("/__reset",{}); post("/__set",{"founder":{"ok":True,"day":"2026-09-05","milestone":120,"stats":FST,"prev":FPR,"top_channels":[{"label":"TikTok · реклама","visits":71},{"label":"WhatsApp · школам","visits":30},{"label":"A <b>&</b> B","visits":2}],"recipients":[{"user_id":U1,"chat_id":"777"}]}})
j=get(P+"?key=cronkey&kind=founder&dry=1"); pv=j["founder"]["preview"]; print("----\n"+pv+"\n----")
ok(j["founder"]["on"] and j["founder"]["people"]==1 and j["founder"]["sent"]==1 and j["people"]==0, "founder: 1 получатель, отдельно от ученических писем")
ok(pv.startswith("📊 <b>Scholary · вчера, 5 сентября, сб</b>") and "Заходов: <b>143</b> (+43)" in pv and "1 м 14 с" in pv and "1,8 стр./визит" in pv, "founder: заголовок, заходы с дельтой, время, страницы")
ok("открыли <b>61</b> → начали <b>44</b> → дошли <b>27</b> (−3)" in pv and "контактов 12" in pv and "контактов 12 (" not in pv, "founder: квиз с дельтой, нулевая дельта не пишется")
ok("«купить» <b>9</b> (Kaspi 6) · оплат <b>3</b> (+2) · <b>12 000 ₸</b> (+8 000 ₸) · Pro 1" in pv, "founder: деньги")
ok("регистраций <b>2</b>" in pv and "демо школ 4, профориентологов 1 · заявок <b>1</b> · WhatsApp-кликов 5" in pv, "founder: кабинет и B2B")
ok("📣 Каналы: TikTok · реклама 71 · WhatsApp · школам 30 · A &lt;b&gt;&amp;&lt;/b&gt; B 2" in pv and "scholary.kz/admin/" in pv, "founder: каналы, экранирование, ссылка")
st=get(M+"/__state"); ok(not any(r[0]=="tg_mark_sent" for r in st["rpc"]), "founder dry: без tg_mark_sent")
j=get(P+"?key=cronkey&kind=ws&dry=1"); ok(j["founder"]["on"]==False and j["founder"]["people"]==0, "kind=ws не трогает founder")
post("/__set",{"founder":{"ok":True,"day":"2026-09-05","milestone":120,"stats":{},"prev":{},"top_channels":[],"recipients":[{"user_id":U1,"chat_id":"777"}]}})
pv=get(P+"?key=cronkey&kind=founder&dry=1")["founder"]["preview"]; ok("Заходов: <b>0</b>" in pv and "Заходов не было" in pv, "founder: пустой день — предупреждение")
post("/__set",{"founder":{"ok":False,"why":"forbidden"}})
j=get(P+"?key=cronkey&kind=founder&dry=1"); ok(j["ok"] and j["founder"]["people"]==0, "founder: сбой RPC не ломает рассылку")
print("FAILED %d"%fails if fails else "ALL OK"); sys.exit(1 if fails else 0)
