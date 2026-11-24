#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
⚡ Gemini 호출 모듈 — 펀드 모의고사 'AI 유사 문제' 생성
=========================================================
- 서버 환경변수 GEMINI_API_KEY 가 있으면 그것을 쓰고, 없으면 사용자가 보낸 키를 쓴다.
- 키는 요청 처리 중에만 메모리에 있고 로그·디스크에 남기지 않는다.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.request

ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# 앞에서부터 시도 (지원 종료/과부하 모델은 다음 후보로)
MODEL_CANDIDATES = [
    os.environ.get("GEMINI_MODEL", "").strip(),
    "gemini-3.1-flash-lite-preview",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest",
    "gemini-2.5-flash",
]
MODEL_CANDIDATES = [m for m in MODEL_CANDIDATES if m]


class AIError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


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


def _post(model: str, key: str, body: dict, timeout: int = 90) -> dict:
    req = urllib.request.Request(
        ENDPOINT.format(model=model),
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _extract_json(text: str):
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r"\[[\s\S]*\]", text)
    if m:
        return json.loads(m.group(0))
    raise AIError("AI 응답을 해석하지 못했습니다.", 502)


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
    last = None
    for model in MODEL_CANDIDATES:
        for attempt in range(2):
            try:
                data = _post(model, api_key, body)
                cands = data.get("candidates") or []
                if not cands:
                    last = AIError("AI가 응답을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", 502)
                    break
                txt = "".join(p.get("text", "") for p in cands[0]["content"]["parts"])
                arr = _extract_json(txt)
                if isinstance(arr, dict):
                    arr = arr.get("questions", [])
                items = []
                for it in arr:
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
                if items:
                    return {"items": items[:count], "model": model}
                last = AIError("유효한 문제를 받지 못했습니다. 다시 시도해 주세요.", 502)
                break
            except urllib.error.HTTPError as exc:
                detail = ""
                try:
                    detail = exc.read().decode("utf-8")[:200]
                except Exception:
                    pass
                if exc.code == 404:      # 모델 미지원 → 다음 후보
                    last = AIError("AI 모델을 찾지 못했습니다.", 502)
                    break
                if exc.code in (429, 503):
                    last = AIError("AI 사용량이 몰리고 있습니다. 잠시 후 다시 시도해 주세요.", 429)
                    time.sleep(1.5)
                    continue
                last = AIError(f"AI 호출에 실패했습니다. ({exc.code})", 502)
                break
            except Exception as exc:  # noqa: BLE001
                last = AIError(f"AI 호출에 실패했습니다. ({type(exc).__name__})", 502)
                time.sleep(1.0)
    raise last or AIError("AI 호출에 실패했습니다.", 502)


def check_key(api_key: str) -> dict:
    """키가 실제로 동작하는지 가볍게 확인한다 (모델 목록 조회)."""
    req = urllib.request.Request(
        "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
        headers={"x-goog-api-key": api_key},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    return {"ok": True, "models": len(data.get("models", []))}
