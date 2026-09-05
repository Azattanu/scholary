# Мок ApiPay + Supabase RPC для локальных тестов оплаты Kaspi.
import json, http.server, threading, time, sys, os
STATE = {"invoices": {}, "next": 100, "rpc": [], "fail_create": None, "invoice_get_fail": False}
LOG = []
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type","application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"{}")
    def do_GET(self):
        LOG.append(("GET", self.path))
        if self.path.startswith("/api/v1/invoices/"):
            if STATE["invoice_get_fail"]: return self._json(500, {"error":"boom"})
            iid = int(self.path.rsplit("/",1)[1]); inv = STATE["invoices"].get(iid)
            return self._json(200, inv) if inv else self._json(404, {"error":"not_found"})
        if self.path == "/__state": return self._json(200, {"state": STATE, "log": LOG[-50:]})
        return self._json(404, {})
    def do_POST(self):
        b = self._body(); LOG.append(("POST", self.path, b))
        if self.path == "/api/v1/invoices":
            if self.headers.get("X-API-Key") != "testkey": return self._json(401, {"error":"unauthorized"})
            if STATE["fail_create"]: code, err = STATE["fail_create"]; return self._json(code, {"error_code": err, "message": "simulated"})
            if STATE.get("no_id"): return self._json(201, {"status": "processing"})
            iid = STATE["next"]; STATE["next"] += 1
            inv = {"id": iid, "amount": "%.2f" % float(b["amount"]), "status": "processing", "phone_number": b["phone_number"], "external_order_id": b.get("external_order_id"), "is_sandbox": False, "description": b.get("description")}
            STATE["invoices"][iid] = inv
            return self._json(201, inv)
        if self.path.startswith("/supabase/rest/v1/rpc/"):
            fn = self.path.rsplit("/",1)[1]
            if STATE.get("fail_rpc"): STATE.setdefault("rpc_failed", []).append(fn); return self._json(503, {"error":"db down"})
            STATE["rpc"].append((fn, b))
            if b.get("p_secret") != "rpcsecret": return self._json(401, {"error":"bad secret"})
            if fn == "tiptop_grant_pro": return self._json(200, {"ok": b["p_email"] != "nouser@example.com", "pro_until": "2027-03-01"})
            if fn == "tiptop_issue_report": return self._json(200, {"ok": True, "token": "tok_" + b["p_lead"], "name": "Тест", "whatsapp": "77001112233", "email": "buyer@example.com"})
            if fn == "tiptop_refund": return self._json(200, {"ok": True, "kind": "report", "lead": "lead_x"})
            return self._json(200, {"ok": True})
        if self.path.startswith("/green/waInstance"):
            if STATE.get("fail_wa"): STATE.setdefault("wa_failed", []).append(b); return self._json(500, {"error":"wa down"})
            STATE.setdefault("wa", []).append(b); return self._json(200, {"idMessage": "m1"})
        if self.path == "/resend/emails":
            if STATE.get("fail_mail"): STATE.setdefault("mail_failed", []).append(b); return self._json(500, {"error":"mail down"})
            STATE.setdefault("mail", []).append(b); return self._json(200, {"id": "e1"})
        if self.path == "/__set":
            if "invoices" in b: b["invoices"] = {int(k): v for k, v in b["invoices"].items()}
            STATE.update(b); return self._json(200, {"ok": True})
        if self.path == "/__reset":
            STATE["invoices"].clear(); STATE["rpc"].clear(); LOG.clear(); STATE["fail_create"]=None; STATE["fail_rpc"]=False; STATE["fail_wa"]=False; STATE["fail_mail"]=False; STATE["rpc_failed"]=[]; STATE["wa_failed"]=[]; STATE["mail_failed"]=[]; STATE["invoice_get_fail"]=False; STATE["wa"]=[]; STATE["mail"]=[]; STATE["no_id"]=False; return self._json(200, {"ok": True})
        return self._json(404, {})
http.server.ThreadingHTTPServer(("127.0.0.1", 8131), H).serve_forever()
