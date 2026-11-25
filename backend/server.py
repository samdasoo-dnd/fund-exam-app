#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
📝 펀드 모의고사 서버 (펀드투자권유자문인력 실전 4회분 400제)
============================================================
- 표준 라이브러리 http.server 기반 초경량 서버 (의존성 없음)
- 정적 프론트엔드 + 문제은행 + AI 유사문제 생성 중계
- 개인 학습 기록은 브라우저 localStorage(fundExam.v1)에만 저장 (서버 저장·로그 없음)
- Gemini 키: 서버는 환경변수 GEMINI_API_KEY 를 쓰고 **존재 여부만** 알려 준다.
  키 자체는 어떤 응답에도 담지 않는다.
"""

from __future__ import annotations

import json
import os
import threading
import time
from collections import OrderedDict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import gemini_client

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(BASE_DIR, "frontend")
DATA_DIR = os.path.join(BASE_DIR, "data")
QUESTIONS_PATH = os.path.join(DATA_DIR, "questions.json")
GAP_PATH = os.path.join(DATA_DIR, "gap_questions.json")
PORT = int(os.environ.get("PORT") or 8770)
SERVER_KEY = (os.environ.get("GEMINI_API_KEY") or "").strip()
APP_VERSION = "1.1.1"

_questions_cache = {"mtime": 0, "data": None, "lock": threading.Lock()}
_gap_cache = {"mtime": 0, "data": None, "lock": threading.Lock()}

MIME = {
    ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
    ".webmanifest": "application/manifest+json", ".woff2": "font/woff2",
}


class RateLimiter:
    def __init__(self, limit=30, window=60):
        self.limit = limit
        self.window = window
        self.hits: "OrderedDict[str, list]" = OrderedDict()
        self.lock = threading.Lock()

    def allow(self, key: str) -> bool:
        now = time.time()
        with self.lock:
            arr = [t for t in self.hits.get(key, []) if now - t < self.window]
            if len(arr) >= self.limit:
                self.hits[key] = arr
                return False
            arr.append(now)
            self.hits[key] = arr
            return True


AI_LIMIT = RateLimiter(limit=20, window=60)


def load_questions():
    with _questions_cache["lock"]:
        try:
            mtime = os.path.getmtime(QUESTIONS_PATH)
        except OSError:
            return []
        if _questions_cache["data"] is None or mtime != _questions_cache["mtime"]:
            with open(QUESTIONS_PATH, encoding="utf-8") as f:
                _questions_cache["data"] = json.load(f)
            _questions_cache["mtime"] = mtime
        return _questions_cache["data"]


def load_gap_questions():
    """틈새문제 300제 — 모의고사 1~4회와 분리된 문제은행."""
    with _gap_cache["lock"]:
        try:
            mtime = os.path.getmtime(GAP_PATH)
        except OSError:
            return []
        if _gap_cache["data"] is None or mtime != _gap_cache["mtime"]:
            try:
                with open(GAP_PATH, encoding="utf-8") as f:
                    _gap_cache["data"] = json.load(f)
            except (OSError, ValueError):
                return []
            _gap_cache["mtime"] = mtime
        return _gap_cache["data"]


class Handler(BaseHTTPRequestHandler):
    server_version = "FundExam/" + APP_VERSION
    protocol_version = "HTTP/1.1"

    # ------------------------------------------------------------------ util
    def log_message(self, fmt, *args):  # 로그에 개인정보·키를 남기지 않는다
        pass

    def _json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _fail(self, message, status=400, **extra):
        payload = {"ok": False, "error": message}
        payload.update(extra)
        self._json(payload, status)

    def _read_json(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except Exception:
            return {}
        try:
            if length <= 0:
                return {}
            raw = self.rfile.read(length)
            return json.loads(raw.decode("utf-8"))
        except Exception:
            return {}

    def _serve_file(self, path):
        safe = os.path.normpath(path).lstrip("/")
        full = os.path.join(FRONTEND_DIR, safe)
        if not os.path.abspath(full).startswith(os.path.abspath(FRONTEND_DIR)):
            self._fail("잘못된 경로입니다.", 403)
            return
        if not os.path.isfile(full):
            self._fail("파일을 찾을 수 없습니다.", 404)
            return
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache" if ext in (".html", ".js", ".css") else "public, max-age=3600")
        self.end_headers()
        self.wfile.write(body)

    # ------------------------------------------------------------------ routes
    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        if path == "/api/health":
            self._json({
                "ok": True,
                "hasServerKey": bool(SERVER_KEY),
                "version": APP_VERSION,
                "questions": len(load_questions()),
                "gapQuestions": len(load_gap_questions()),
                "time": time.strftime("%Y-%m-%dT%H:%M:%S"),
            })
            return
        if path == "/api/questions":
            qs = load_questions()
            if not qs:
                self._fail("문제은행을 불러오지 못했습니다.", 500)
                return
            self._json({"ok": True, "count": len(qs), "questions": qs})
            return
        if path == "/api/gap-questions":
            gq = load_gap_questions()
            if not gq:
                self._fail("틈새문제를 불러오지 못했습니다.", 500)
                return
            self._json({"ok": True, "count": len(gq), "questions": gq})
            return
        if path == "/api/ai/check":
            key = (self.headers.get("X-Gemini-Key") or "").strip() or SERVER_KEY
            if not key:
                self._json({"ok": False, "error": "키가 없습니다."}, 400)
                return
            try:
                self._json({"ok": True, "info": gemini_client.check_key(key)})
            except Exception:
                self._fail("키를 확인하지 못했습니다.", 400)
            return
        if path.startswith("/api/"):
            self._fail("없는 API 주소입니다.", 404)
            return
        if path in ("", "/"):
            path = "/index.html"
        self._serve_file(path)

    def do_POST(self):  # noqa: N802
        path = urlparse(self.path).path
        if path != "/api/generate-similar":
            self._fail("없는 API 주소입니다.", 404)
            return
        if not AI_LIMIT.allow(self.client_address[0]):
            self._fail("AI 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.", 429)
            return
        data = self._read_json()
        client_key = (self.headers.get("X-Gemini-Key") or data.get("api_key") or "").strip()
        key = SERVER_KEY or client_key
        if not key:
            self._fail("AI 키가 설정되지 않았습니다. 설정에서 본인 키를 입력해 주세요.", 401,
                       needsKey=True)
            return
        q = data.get("question") or {}
        if not isinstance(q, dict) or not q.get("stem"):
            self._fail("문제 정보가 없습니다.", 400)
            return
        try:
            result = gemini_client.generate_similar(key, q, int(data.get("count") or 3))
        except gemini_client.AIError as exc:
            self._fail(str(exc), exc.status)
            return
        except Exception:
            self._fail("AI 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.", 502)
            return
        self._json({"ok": True, "count": len(result["items"]), "items": result["items"],
                    "model": result["model"]})


def main():
    qs = load_questions()
    print(f"📝 펀드 모의고사 서버 v{APP_VERSION} — 모의고사 {len(qs)}문항, "
          f"틈새문제 {len(load_gap_questions())}문항, 포트 {PORT}, "
          f"서버 키 {'있음' if SERVER_KEY else '없음'}")
    httpd = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    httpd.daemon_threads = True
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n종료합니다.")


if __name__ == "__main__":
    main()
