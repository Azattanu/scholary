// ============================================================
// Edge Function: generate-report
// Вход: { lead_id }. Делает ВЕСЬ путь после оплаты:
//   1) берёт ответы лида из leads;
//   2) считает отчёт движком (та же логика, что превью на сайте);
//   3) просит Claude API написать человеческие тексты (числа — только из движка);
//   4) сохраняет отчёт в reports (секретный token в ссылке);
//   5) шлёт ссылку на WhatsApp (Green API) и почту (Resend);
//   6) пишет статусы доставки в лид. Любой сбой доставки не роняет остальное.
//
// Secrets: SB_URL, SB_SERVICE_KEY, ANTHROPIC_API_KEY,
//          RESEND_API_KEY, EMAIL_FROM (напр. "Scholary <report@scholary.kz>"),
//          GREEN_ID, GREEN_TOKEN (instance Green API), SITE_URL (https://scholary.kz)
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";
import Engine from "../_shared/report-engine.mjs";

function answersFromLead(l: Record<string, unknown>) {
  const split = (v: unknown) => (typeof v === "string" && v ? v.split(",") : []);
  return {
    level: l.level, year: l.year, gpa_band: l.gpa_band, school_type: l.school_type,
    gpa_uni: l.gpa_uni, gpa_phd: l.gpa_phd, uni_type: l.uni_type, phd_topic: l.phd_topic,
    lang_status: l.lang_status, ielts_band: l.ielts_band, sat: l.sat,
    field: split(l.field), achievements: split(l.achievements),
    budget: l.budget, priority: l.priority, target_countries: split(l.target_countries),
    p2_gpa_exact: l.p2_gpa_exact, p2_blocked_account: l.p2_blocked_account
  };
}

async function claudeTexts(result: unknown, name: string): Promise<Record<string, unknown> | null> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) return null;
  const prompt = `Ты — опытный консультант по поступлению за границу для казахстанских абитуриентов. Ниже JSON расчёта для клиента по имени ${name}: профиль по 6 осям (0–10), портфель программ с двумя вероятностями (adm — поступление, sch — стипендия, null = стипендии нет, бесплатное обучение), бустеры с приростом в п.п., pAtLeastOne — вероятность хотя бы одного оффера.
Напиши на русском, обращаясь на «ты», без воды и без гарантий. Верни СТРОГО JSON без пояснений, ключи:
"verdict" — вердикт одним предложением;
"point_b" — «Точка Б»: кем человек будет в сентябре 2027, 2 предложения;
"programs" — массив {"id","comment"} — по 1 предложению на каждую программу портфеля: почему она в списке и на что смотреть (используй поле note);
"boosters_text" — абзац «что усилить» по бустерам с их точными +пп;
"next_step" — тёплый финальный абзац: следующий шаг — документы, большинство отказов из-за формальностей.
Проценты трактуй: >55 «хороший шанс», 30–55 «реальный при широкой подаче», <30 «амбициозный».
JSON расчёта: ${JSON.stringify(result)}`;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-4-5", max_tokens: 2000, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) { console.error("claude api:", res.status, await res.text()); return null; }
  const j = await res.json();
  const text = j.content?.[0]?.text ?? "";
  try { return JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); }
  catch { console.error("claude json parse failed"); return null; }
}

async function sendEmail(to: string, name: string, link: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key || !to) return "skipped";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("EMAIL_FROM") ?? "Scholary <onboarding@resend.dev>",
      to: [to],
      subject: `${name}, твой отчёт Scholary готов`,
      html: `<p>${name}, привет!</p><p>Твой персональный отчёт о вероятности поступления готов:</p><p><a href="${link}">Открыть отчёт</a></p><p>Вопросы — просто ответь на это письмо или напиши в WhatsApp +7 775 383 18 36.</p><p>— Scholary · scholary.kz</p>`
    })
  });
  return res.ok ? "sent" : `error:${res.status}`;
}

async function sendWhatsApp(phone: string, name: string, link: string) {
  const id = Deno.env.get("GREEN_ID"), token = Deno.env.get("GREEN_TOKEN");
  if (!id || !token || !phone) return "skipped";
  const chatId = phone.replace(/\D/g, "") + "@c.us";
  const res = await fetch(`https://api.green-api.com/waInstance${id}/sendMessage/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatId, message: `${name}, твой отчёт Scholary готов 📄\n${link}\n\nВопросы по отчёту — просто ответь на это сообщение.` })
  });
  return res.ok ? "sent" : `error:${res.status}`;
}

Deno.serve(async (req) => {
  // вызывается только с service-ключом (вебхук/админка)
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.includes(Deno.env.get("SB_SERVICE_KEY")!)) return new Response("forbidden", { status: 403 });

  const { lead_id } = await req.json();
  const db = createClient(Deno.env.get("SB_URL")!, Deno.env.get("SB_SERVICE_KEY")!);
  const { data: lead, error } = await db.from("leads").select("*").eq("id", lead_id).single();
  if (error || !lead) return Response.json({ error: "lead not found" }, { status: 404 });

  // 1–2. Расчёт той же логикой, что на сайте
  const answers = answersFromLead(lead);
  const result = Engine.evaluate(answers);
  // исходные данные расчёта сохраняются в отчёте: каждый документ индивидуален и это видно
  (result as Record<string, unknown>).answers = answers;
  (result as Record<string, unknown>).generatedAt = new Date().toISOString();

  // 3. Тексты (не блокируют: без Claude отчёт уходит с типовыми формулировками)
  const texts = await claudeTexts(result, lead.name ?? "друг");

  // 4. Сохранение
  const { data: rep, error: repErr } = await db.from("reports")
    .insert({ lead_id, data: result, texts }).select("id, token").single();
  if (repErr) return Response.json({ error: repErr.message }, { status: 500 });

  const link = `${Deno.env.get("SITE_URL") ?? "https://scholary.kz"}/r.html?t=${rep.token}`;

  // 5. Доставка (каждый канал независимо)
  const emailStatus = await sendEmail(lead.email, lead.name ?? "", link).catch((e) => `error:${e}`);
  const waStatus = await sendWhatsApp(lead.whatsapp, lead.name ?? "", link).catch((e) => `error:${e}`);

  // 6. Статусы
  await db.from("leads").update({
    report_id: rep.id, report_sent_at: new Date().toISOString(),
    email_status: emailStatus, wa_status: waStatus
  }).eq("id", lead_id);
  await db.from("events").insert({ lead_id, event: "report_sent", data: { emailStatus, waStatus }, ts: new Date().toISOString(), page: "backend" });

  if (String(emailStatus).startsWith("error") && String(waStatus).startsWith("error"))
    console.error("ОБА канала доставки упали — нужен ручной разбор", lead_id);

  return Response.json({ ok: true, link, emailStatus, waStatus });
});
