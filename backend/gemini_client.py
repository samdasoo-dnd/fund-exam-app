#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
⚡ Gemini 호출 모듈 — 펀드 모의고사 'AI 유사 문제' 생성
=========================================================
- 서버 환경변수 GEMINI_API_KEY 가 있으면 그것을 쓰고, 없으면 사용자가 보낸 키를 쓴다.
- 키는 요청 처리 중에만 메모리에 있고 로그·디스크에 남기지 않는다.

모델 폴백 (2026-11-26 정비):
- 후보를 '살아 있고 빠른' 순서로만 둔다(폐기된 gemini-2.5-*, 불안정한 3.1-flash-lite-preview 제외).
- 404·429·5xx·타임아웃·네트워크 오류면 같은 모델을 붙잡고 재시도하지 않고 **즉시 다음 모델**로 넘어간다.
- 요청 1회 25초, 전체 시도 예산 50초로 제한해 Render 게이트웨이 타임아웃 전에 끝낸다.
- 모든 모델이 실패했을 때 404가 503(과부하)을 덮어쓰지 않는다 → 503이 있었으면 '사용량이 몰리고 있습니다' 안내.
"""

from __future__ import annotations

import json
import os
import re
import socket
import time
import urllib.error
import urllib.request

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# 앞에서부터 시도 — 2026-11-26 실측(200 OK, 1초 내외) 순서
MODEL_CANDIDATES = [
    os.environ.get("GEMINI_MODEL", "").strip(),
    "gemini-3.5-flash-lite",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash",
    "gemini-3.6-flash",
    "gemini-flash-latest",
    "gemini-3.7-flash",
    "gemini-3.8-flash",
]
MODEL_CANDIDATES = [m for m in MODEL_CANDIDATES if m]

REQUEST_TIMEOUT = 25   # 모델 1회 호출 제한
TOTAL_BUDGET = 50      # 모든 후보를 합쳐 쓸 시간


class AIError(Exception):
    def __init__(self, message: str, status: int = 502, code: int = 0,
                 retryable: bool = False, busy: bool = False):
        super().__init__(message)
        self.status = status      # 클라이언트에 돌려줄 HTTP 상태
        self.code = code          # Gemini가 준 HTTP 상태(없으면 0)
        self.retryable = retryable  # True면 같은 모델 재시도 없이 다음 모델로
        self.busy = busy            # 과부하·한도(503/429) — 최종 안내 우선순위


PROMPT = """너는 한국 금융투자협회 '펀드투자권유자문인력' 자격시험의 출제위원이다.
아래 [원문제]와 **같은 출제 포인트**(같은 법조문·개념·계산식)를 다루되, 숫자·사례·선지 표현을 바꾼 **새 4지선다 문제 {count}개**를 만들어라.

[원문제]
과목: {subject}
영역: {unit}
발문: {stem}
선지: {options}
정답: {answer}번
해설: {explanation}

[조건]
1. 원문제와 같은 개념을 묻되 발문·선지를 그대로 베끼지 마라. 계산 문제는 숫자를 바꿔 정답이 유일하게 나오게 하고 풀이를 해설에 써라.
2. 선지는 정확히 4개, 정답은 1개. 오답 선지는 명백히 틀리되 그럴듯하게.
3. 현행 법령 기준을 지켜라(부동산 처분제한은 국내 주택·주택 외 모두 취득 후 1년).
4. 해설은 1~4문장으로 간결하게, 정답 근거를 밝혀라.
5. 정답 번호를 1~4에 고르게.
6. 확실하지 않은 법조문·수치를 지어내지 마라.

JSON 배열로만 답하라:
[{{"stem":"...","options":["...","...","...","..."],"answer":1,"explanation":"...","topic":"..."}}]"""


def _post(model: str, key: str, body: dict, timeout: int = REQUEST_TIMEOUT) -> dict:
    req = urllib.request.Request(
        ENDPOINT.format(model=model),
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = ""
        try:
            detail = exc.read().decode("utf-8", "replace")
        except Exception:
            pass
        msg = ""
        try:
            msg = json.loads(detail).get("error", {}).get("message", "")
        except Exception:
            msg = detail[:200]
        if exc.code in (401, 403):
            raise AIError("Gemini 키가 올바르지 않거나 권한이 없습니다. %s" % msg,
                          401, code=exc.code) from exc
        if exc.code == 400:
            bad_key = "api key" in msg.lower() or "API_KEY" in msg.upper()
            raise AIError("Gemini 키가 올바르지 않거나 권한이 없습니다. %s" % msg if bad_key
                          else "AI 요청이 거부되었습니다. %s" % msg,
                          401 if bad_key else 502, code=400, retryable=not bad_key) from exc
        if exc.code == 404:      # 폐기·미지원 모델 → 다음 후보
            raise AIError("AI 모델을 찾지 못했습니다.", 404, code=404, retryable=True) from exc
        if exc.code == 429:      # 한도 초과 → 다음 후보(다른 모델은 여유가 있을 수 있음)
            raise AIError("AI 사용량이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.", 429,
                          code=429, retryable=True, busy=True) from exc
        if exc.code >= 500:      # 503 high demand 등 → 다음 후보
            raise AIError("AI 사용량이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.", 503,
                          code=exc.code, retryable=True, busy=True) from exc
        raise AIError("AI 호출에 실패했습니다. (%d)" % exc.code, 502, code=exc.code) from exc
    except urllib.error.URLError as exc:
        if isinstance(getattr(exc, "reason", None), (TimeoutError, socket.timeout)):
            raise AIError("AI 응답이 너무 늦습니다. 잠시 후 다시 시도해 주세요.", 504,
                          retryable=True) from exc
        raise AIError("AI 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", 503,
                      retryable=True) from exc
    except TimeoutError as exc:
        raise AIError("AI 응답이 너무 늦습니다. 잠시 후 다시 시도해 주세요.", 504,
                      retryable=True) from exc
    except AIError:
        raise
    except Exception as exc:  # SSL/연결 끊김 등
        raise AIError("AI 연결 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.", 503,
                      retryable=True) from exc


def _extract_json(text: str):
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\[[\s\S]*\]", text)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    raise AIError("AI 응답을 해석하지 못했습니다.", 502, retryable=True)


def _final_error(errors: list[AIError]) -> AIError:
    """여러 모델이 실패했을 때의 안내. 404가 503(과부하)을 덮어쓰지 않게 한다."""
    if not errors:
        return AIError("AI 호출 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", 504)
    if any(e.busy for e in errors):
        return AIError("AI 사용량이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.", 429, busy=True)
    if all(e.code == 404 for e in errors):
        return AIError("AI 모델을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.", 502)
    slow = [e for e in errors if e.status == 504]
    if len(slow) == len(errors):
        return AIError("AI 응답이 너무 늦습니다. 잠시 후 다시 시도해 주세요.", 504)
    return AIError(str(errors[-1]), errors[-1].status, code=errors[-1].code)


def generate_similar(api_key: str, q: dict, count: int = 3) -> dict:
    count = max(1, min(5, int(count or 3)))
    options = q.get("options") or []
    opt_txt = "\n".join(f"{i + 1}. {o}" for i, o in enumerate(options))
    prompt = PROMPT.format(
        count=count,
        subject=q.get("subject") or "제1과목 펀드일반",
        unit=q.get("unit") or "",
        stem=q.get("stem") or "",
        options=opt_txt,
        answer=q.get("answer") or 1,
        explanation=(q.get("explanation") or "")[:600],
    )
    body = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.9, "responseMimeType": "application/json",
                             "maxOutputTokens": 8192},
    }

    def parse(text: str) -> list[dict]:
        arr = _extract_json(text)
        if isinstance(arr, dict):
            arr = arr.get("questions", [])
        items = []
        for it in arr or []:
            if not isinstance(it, dict):
                continue
            opts = it.get("options") or it.get("선지") or []
            ans = it.get("answer", it.get("정답"))
            if len(opts) != 4 or ans not in (1, 2, 3, 4):
                continue
            items.append({
                "stem": str(it.get("stem") or it.get("발문") or "").strip(),
                "options": [str(o).strip() for o in opts],
                "answer": int(ans),
                "explanation": str(it.get("explanation") or it.get("해설") or "").strip(),
                "topic": str(it.get("topic") or "").strip(),
                "unit": q.get("unit") or "",
                "subject": q.get("subject") or "",
                "source_no": q.get("no"),
                "source_exam": q.get("exam"),
            })
        if not items:
            raise AIError("유효한 문제를 받지 못했습니다. 다시 시도해 주세요.", 502, retryable=True)
        return items[:count]

    deadline = time.monotonic() + TOTAL_BUDGET
    errors: list[AIError] = []
    for model in MODEL_CANDIDATES:
        left = deadline - time.monotonic()
        if left < 2.5:
            break
        try:
            data = _post(model, api_key, body, timeout=min(REQUEST_TIMEOUT, max(2.5, left)))
            cands = data.get("candidates") or []
            if not cands:
                raise AIError("AI가 응답을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", 502,
                              retryable=True)
            txt = "".join(p.get("text", "") for p in (cands[0].get("content") or {}).get("parts") or [])
            if not txt.strip():
                raise AIError("AI 응답이 비어 있습니다. 잠시 후 다시 시도해 주세요.", 502,
                              retryable=True)
            if cands[0].get("finishReason") == "MAX_TOKENS":   # 잘린 JSON은 쓰지 않고 다음 모델로
                raise AIError("AI 응답이 길어 잘렸습니다. 잠시 후 다시 시도해 주세요.", 502,
                              retryable=True)
            return {"items": parse(txt), "model": model}
        except AIError as exc:
            if not exc.retryable:
                raise
            errors.append(exc)   # 같은 모델 재시도 없이 즉시 다음 모델
    raise _final_error(errors)


def check_key(api_key: str) -> dict:
    """키가 실제로 동작하는지 가볍게 확인한다 (모델 목록 조회)."""
    req = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        headers={"x-goog-api-key": api_key},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return {"ok": True, "models": len(data.get("models", []))}
