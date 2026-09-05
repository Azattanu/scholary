import json, http.server
STATE = {"rpc": [], "due": [], "week": {}}
class H(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Type","application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _body(self):
        n = int(self.headers.get("Content-Length") or 0); return json.loads(self.rfile.read(n) or b"{}")
    def do_GET(self):
        if self.path == "/__state": return self._json(200, STATE)
        return self._json(404, {})
    def do_POST(self):
        b = self._body()
        if self.path.startswith("/supabase/rest/v1/rpc/"):
            fn = self.path.rsplit("/",1)[1]; STATE["rpc"].append((fn, b))
            if b.get("p_secret") != "rpcsecret": return self._json(401, {"error":"bad secret"})
            if fn == "tg_due": return self._json(200, {"ok": True, "items": STATE["due"]})
            if fn == "ws_digest_due":
                return self._json(200, STATE.get("ws", {"ok": True, "items": [], "milestone": 110, "week_start": "2026-09-07"}))
            if fn == "tg_week_due":
                w = STATE["week"].get(b.get("p_kind"), {"ok": True, "items": [], "milestone": 0, "week_start": "2026-09-07"})
                return self._json(200, w)
            return self._json(200, {"ok": True})
        if self.path == "/__set": STATE.update(b); return self._json(200, {"ok": True})
        if self.path == "/__reset": STATE["rpc"].clear(); STATE["due"]=[]; STATE["week"]={}; STATE["ws"]=None; return self._json(200, {"ok": True})
        return self._json(404, {})
http.server.ThreadingHTTPServer(("127.0.0.1", 8132), H).serve_forever()
