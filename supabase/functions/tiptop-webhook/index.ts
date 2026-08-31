// ============================================================
// Edge Function: tiptop-webhook
// Принимает Pay-уведомление TipTop Pay, проверяет подпись,
// помечает лид оплаченным и запускает генерацию отчёта.
//
// Настройка в ЛК TipTop: Сайт → Уведомления → Pay →
//   https://<PROJECT>.functions.supabase.co/tiptop-webhook
//   (метод POST, кодировка UTF-8, формат form-encoded)
// Secrets (supabase secrets set):
//   TIPTOP_API_SECRET  — «Пароль для API» из ЛК TipTop
//   SB_URL, SB_SERVICE_KEY — проект и service_role ключ
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const enc = new TextEncoder();

async function hmacValid(rawBody: string, headerSig: string | null, secret: string): Promise<boolean> {
  if (!headerSig) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const b64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return b64 === headerSig;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("TIPTOP_API_SECRET") ?? "";
  const raw = await req.text();

  // Подпись: TipTop (как CloudPayments) шлёт HMAC-SHA256 тела в заголовке Content-HMAC.
  // ⚠ ПРОВЕРИТЬ при первом тестовом платеже: точное имя заголовка видно в логах —
  // смотрим и Content-HMAC, и X-Content-HMAC.
  const sig = req.headers.get("Content-HMAC") ?? req.headers.get("X-Content-HMAC");
  if (secret && !(await hmacValid(raw, sig, secret))) {
    console.error("HMAC mismatch");
    return Response.json({ code: 13 }); // отвергнуть платёж нельзя постфактум, но фиксируем
  }

  const p = new URLSearchParams(raw);
  // externalId, который мы передавали в widget.start(), возвращается в уведомлении.
  // ⚠ ПРОВЕРИТЬ имя поля на тестовом платеже: ExternalId / InvoiceId / OrderId.
  const leadId = p.get("ExternalId") ?? p.get("InvoiceId") ?? p.get("OrderId") ?? "";
  const txId = p.get("TransactionId") ?? "";
  const status = (p.get("Status") ?? "").toLowerCase();
  const amount = p.get("Amount") ?? "";
  console.log("pay notification:", { leadId, txId, status, amount });

  if (!leadId) return Response.json({ code: 0 }); // нечего обновлять, но провайдеру отвечаем ok

  const db = createClient(Deno.env.get("SB_URL")!, Deno.env.get("SB_SERVICE_KEY")!);
  const { error } = await db.from("leads").update({
    paid: true,
    paid_at: new Date().toISOString(),
    tiptop_transaction_id: txId
  }).eq("id", leadId);
  if (error) console.error("lead update failed:", error.message);

  await db.from("events").insert({ lead_id: leadId, event: "pay_webhook", data: { txId, status, amount }, ts: new Date().toISOString(), page: "webhook" });

  // Генерация отчёта — отдельной функцией, чтобы вебхук отвечал провайдеру мгновенно
  fetch(`${Deno.env.get("SB_URL")!.replace(".supabase.co", ".functions.supabase.co")}/generate-report`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SB_SERVICE_KEY")}` },
    body: JSON.stringify({ lead_id: leadId })
  }).catch((e) => console.error("generate-report trigger failed:", e));

  return Response.json({ code: 0 }); // обязательный ответ TipTop: платёж принят
});
