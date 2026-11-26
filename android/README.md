# 펀드 모의고사 Android 앱 (WebView 래퍼)

`https://fund-exam-app.onrender.com` 을 그대로 감싸는 안드로이드 앱입니다.
웹 서비스(`backend/`, `frontend/`, `Dockerfile`)와는 완전히 분리되어 있어서
이 폴더가 추가되어도 Render/Docker 웹 배포에는 영향이 없습니다.

## 앱 정보

| 항목 | 값 |
|---|---|
| 앱 이름 | 펀드 모의고사 |
| applicationId | `com.donsik.fundexam` |
| minSdk / targetSdk / compileSdk | 24 / 34 / 34 |
| versionCode / versionName | 3 / `1.0.2` |
| 빌드 | Gradle 8.7 · AGP 8.5.1 · Kotlin 1.9.24 · JDK 17 |
| 서명 | 고정 릴리스 키 (CN=BadaToeic, O=Donsik, C=KR) · 키 없으면 debug 폴백 |

## 동작

- 앱을 켜면 곧바로 내장 로딩 화면(`app/src/main/assets/loading.html`)이 뜬다
  - 다크 네이비(`#061124`) 미니멀 화면 — `F` 마크 + `펀드 모의고사` 제목
    + `펀드투자권유자문인력 · 실전 모의고사` 부제 + **얇은 슬림 프로그레스 바** + `서버 연결 중…`
  - 서버가 깨어나기 전까지 약 45초에 걸쳐 92%까지 차오르고, `window.finishLoading()` 호출 시 0.4초 만에 100%
  - 92%에 닿은 뒤에도 반짝임(shimmer)·호흡 애니메이션이 계속 살아 있고,
    15초·30초·50초(90초) 경과 시 안내 문구가 바뀐다
  - `window.stopLoadingAnimation()` 으로 오버레이가 걷힌 뒤 애니메이션을 멈춘다(배터리 절약)
- Render 무료 플랜 콜드 스타트 동안 메인 페이지를 바로 열지 않고,
  백그라운드 스레드에서 `GET /api/health` 를 **2초 간격·최대 2분(120초)** 두드린다
  - health 는 **200 이면서 본문에 `"ok":true`** 가 있어야 "깨어남"으로 판정한다(반쯤 뜬 응답 무시)
  - 502/503 과 **응답 지연(`SocketTimeoutException`, `HEALTH_SERVER_WAKING`)** 은 Render 가 깨어나는 중이므로
    실패 횟수에 넣지 않고 오류 화면 없이 계속 재시도 (연결 10초·읽기 12초)
  - 200(+`ok:true`) 이 오면 그때 `https://fund-exam-app.onrender.com` 을 메인 WebView 로 연다
  - 메인 페이지가 503/타임아웃으로 실패해도 로딩 화면이 떠 있는 동안(총 2분 이내)에는
    로딩 오버레이·프로그레스 바를 **그대로 둔 채**(0% 리셋 없음) 2초 뒤 health 부터 다시 확인한다
  - 503 페이지의 `onPageFinished` 는 `attemptFailed` 플래그로 걸러 "다 그려짐"으로 처리하지 않는다
  - **메인 로드 워치독(25초)**: `loadUrl()` 뒤 25초 안에 화면이 뜨지 않으면 `stopLoading()` 후 재시도한다
  - `onPageFinished` 뒤에는 실제 DOM 이 비어 있지 않은지 확인한 다음에만 로딩을 마무리한다
  - 로딩 오버레이 페이드아웃이 취소돼도 오버레이는 반드시 걷히도록 안전장치가 있다
  - 메인 페이지 `onPageFinished` 후(로딩 화면 최소 1.5초 노출) 바를 100%로 채우고 오버레이를 페이드아웃
  - 오류 화면은 네트워크가 계속 끊겨 있을 때(연속 6회 실패≈12초) 또는 로딩 화면을 띄운 지 2분을 넘겼을 때만
- `localStorage`(`domStorageEnabled`, 키 `fundExam.v1`), 쿠키, 혼합 콘텐츠 허용
- 학습 기록을 `SharedPreferences`(`fund_exam_store`)에도 `commit()` 동기 저장
  (`BadaToeicAndroid.saveStore`/`loadStore` — 웹앱 `app.js` 의 브리지 이름과 동일)
- 오프라인·서버 오류 시 재시도 화면
- 뒤로가기: 웹 히스토리가 있으면 뒤로, 없으면 앱 종료
- 외부 링크는 기본 브라우저/해당 앱으로, `mailto:`·`tel:` 등도 외부 앱으로
- `confirm()`/`alert()` 는 네이티브 다이얼로그로 표시
- 학습 기록 JSON 내보내기(`blob:`)는 안드로이드 파일 저장 화면으로 이어짐

## 빌드

GitHub Actions 가 `.github/workflows/build-apk.yml` 로 자동 빌드합니다.
(Actions 탭 → **Build Android APK** → Run workflow, 또는 `android/**` 변경 push)

산출물: `fund-exam-v1.0.2.apk`
- Actions 실행의 Artifacts(`fund-exam-v1.0.2-apk`)
- Release 태그 `v1.0.2` 에도 첨부

## 서명 (고정 키)

Repository Secret 4개가 있으면 워크플로우가 `$RUNNER_TEMP/fund-exam-release.p12` 로
키스토어를 복원하고 **release** 빌드를 그 키로 서명합니다.

| Secret | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `bada-toeic-release.p12` 를 base64 로 인코딩한 한 줄 |
| `ANDROID_KEYSTORE_PASSWORD` | 키스토어 비밀번호 |
| `ANDROID_KEY_ALIAS` | `badatoeic` |
| `ANDROID_KEY_PASSWORD` | 키 비밀번호 |

로컬에서 같은 키로 빌드하려면:

```bash
export ANDROID_KEYSTORE_PATH=/경로/bada-toeic-release.p12
export ANDROID_KEYSTORE_PASSWORD=...
export ANDROID_KEY_ALIAS=badatoeic
export ANDROID_KEY_PASSWORD=...
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

키스토어 원본은 저장소에 커밋하지 않습니다(백업: 워크스페이스 `work/bada_toeic_keystore/`).
바다토익과 같은 고정 키를 쓰므로, 이 앱도 이후 업데이트를 삭제 없이 덮어쓰기 설치할 수 있습니다.

## 아이콘

런처 아이콘은 다크 네이비 배경 + 스카이블루 `F` 마크(기둥·가로획 두께 동일) + 아래 슬림 프로그레스 바.
워크플로우도 빌드 직전에 같은 스크립트를 실행하므로, 스크립트만 고치면 APK 아이콘까지 함께 바뀝니다.

```bash
pip install pillow
python3 android/tools/make_icons.py    # mipmap-* + icon_preview.png / mark_preview.png 재생성
```
