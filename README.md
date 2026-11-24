# 📝 펀드 모의고사 (펀드투자권유자문인력 실전 4회분 400제)

펀드투자권유자문인력 자격시험(100문항·120분·4지선다·과목별 50% 과락·총 70점 합격) 기준의
실전 모의고사 **4회분 400문항**과 **AI 약점 공략**을 담은 웹앱입니다.

- **1·2회 200문항** — 해커스 「적중 실전모의고사 1·2회」 스캔 원본(76쪽)에서 문항·정답·해설을 그대로 추출
- **3·4회 200문항** — 같은 출제 비율(1과목 60 / 2과목 25 / 3과목 15)과 난이도로 새로 출제한 문항
  (요약 교재 원문을 근거로 생성하고, 별도 감수 모델이 근거 원문을 인용해 정답을 검증한 문항만 수록)

## 구성

```
fund_exam_app/
├── backend/
│   ├── server.py          # 표준 라이브러리 http.server (의존성 없음)
│   └── gemini_client.py   # Gemini 호출 (AI 유사 문제 생성)
├── data/questions.json    # 400문항 (정답·해설 포함)
├── frontend/
│   ├── index.html         # 스플래시 없음 — 접속 즉시 학습 화면
│   ├── styles.css         # 다크 네이비(#061124) + 시안(#38bdf8)
│   ├── app.js             # 시험·오답노트·AI·설정 (프레임워크 없음)
│   └── icon.svg / manifest.webmanifest
├── Dockerfile / render.yaml / requirements.txt
├── ui_test.py             # PC·390px 스크린샷 테스트 (Playwright)
└── func_test.py           # 기능 테스트 (즉시채점·이어풀기·저장·AI·브리지)
```

## 실행

```bash
# 서버 AI 키를 쓰려면 환경변수로 (없어도 설정에서 개인 키 입력 가능)
export GEMINI_API_KEY="발급받은 키"

python backend/server.py          # PORT 기본 8770
# → http://127.0.0.1:8770
```

Docker:

```bash
docker build -t fund-exam .
docker run -p 8080:8080 -e GEMINI_API_KEY=... fund-exam
```

Render: `render.yaml`(Docker) 그대로 배포하고 `GEMINI_API_KEY`만 넣으면 됩니다.
`GEMINI_MODEL`로 모델을 바꿀 수 있습니다(기본 `gemini-3.1-flash-lite-preview`).

## 기능

- **실전 모의고사 1~4회** — 120분 타이머, 과목별 OMR 답안지(1과목 60·2과목 25·3과목 15),
  실전 모드(끝나고 채점) / 즉시 채점 모드 선택, 새로고침해도 이어서 풀기
- **채점** — 과목별 50% 과락(30/13/8) + 총 70점 합격 판정, 영역별(법규·직무윤리·펀드평가 등) 성적 분석
- **오답노트** — 틀린 문제·북마크를 과목/영역으로 모아 보고 해설 확인
- **⚡ AI 유사 문제 계속 풀기** — `/api/generate-similar`가 같은 출제 포인트(법규·계산·숫자·선지 변형)의
  새 4지선다 문제를 실시간 생성, 바로 풀고 채점·해설 확인, 계속 생성 가능
- **AI 키** — 서버 `GEMINI_API_KEY`가 있으면 입력 없이 동작(`/api/health`는 `hasServerKey`만 노출,
  키 값은 클라이언트로 전송하지 않음). 없으면 설정에서 개인 키를 `localStorage`에 저장해 사용
- **기록** — `localStorage(fundExam.v1)` + `window.BadaToeicAndroid.saveStore/loadStore` 브리지(앱 WebView 대응),
  기록 내보내기/가져오기/초기화. 비밀번호·PIN 잠금 없음

## API

| 경로 | 설명 |
|---|---|
| `GET /api/health` | `{ok, hasServerKey, version, questions}` — 키 값은 절대 포함하지 않음 |
| `GET /api/questions` | 400문항 (id·과목·영역·발문·선지·정답·해설) |
| `POST /api/generate-similar` | `{question:{...}, count:3}` → 같은 출제 포인트의 새 문항 3개 |
| `GET /api/ai/check` | 개인 키 동작 확인 (`X-Gemini-Key` 헤더) |

## 검증 결과 (2026-11-24)

- 400문항: 4회분 × 100, 번호 1~100 연속, 선지 4개·정답 1~4·해설 전부 존재
- 영역 문항 수: 1과목 60(법규13·윤리15·영업8·구성16·운용4·평가4) / 2과목 25(법규7·영업8·투자10) / 3과목 15(법규5·영업10)
- 기출 1·2회: 정답표(교재 인쇄본)와 대조, 2개 모델 교차 OCR로 200문항 전수 대조
- AI 테스트: `/api/generate-similar` 실제 호출 성공(약 6초), PC 1280px·모바일 390px 스크린샷 무오류
