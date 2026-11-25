/* ============================================================
   📝 펀드 모의고사 — 프론트엔드
   - 학습 기록은 이 브라우저 localStorage(fundExam.v1)에만 저장
   - window.BadaToeicAndroid.saveStore/loadStore 브리지가 있으면 함께 저장
   - 접속 즉시 학습 화면 (스플래시 없음)
   ============================================================ */
(function () {
  "use strict";

  var KEY = "fundExam.v1";
  var QKEY = "fundExam.questions.v1";
  var GAPKEY = "fundExam.gap.v1";
  var EXAM_MIN = 120;
  var SUBJECTS = [
    { name: "제1과목 펀드일반", short: "1과목", total: 60, pass: 30 },
    { name: "제2과목 파생상품펀드", short: "2과목", total: 25, pass: 13 },
    { name: "제3과목 부동산펀드", short: "3과목", total: 15, pass: 8 }
  ];
  var UNITS = {
    "제1과목 펀드일반": ["법규", "직무윤리·투자자분쟁예방", "펀드영업실무", "펀드 구성·이해", "펀드운용", "펀드평가"],
    "제2과목 파생상품펀드": ["법규", "영업", "투자·리스크관리"],
    "제3과목 부동산펀드": ["법규", "영업실무"]
  };
  var ALLOWED = { TABLE: 1, TBODY: 1, THEAD: 1, TR: 1, TD: 1, TH: 1, BR: 1, B: 1, STRONG: 1, I: 1, EM: 1, U: 1, SPAN: 1, DIV: 1, P: 1, UL: 1, OL: 1, LI: 1, SMALL: 1 };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var app = $("#app");

  /* ---------------- 저장소 ---------------- */
  function defaultStore() {
    return {
      attempts: [], wrong: {}, bookmarks: {}, settings: { immediate: false, geminiKey: "", showUnit: true },
      ai: { solved: 0, generated: 0, lastAt: null }, active: null,
      gap: { ans: {}, pos: {}, order: {}, last: null, updatedAt: null },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    };
  }
  function normalize(raw) {
    var d = defaultStore();
    if (!raw || typeof raw !== "object") return d;
    ["attempts", "wrong", "bookmarks", "settings", "ai", "active", "gap"].forEach(function (k) {
      if (raw[k] != null && typeof raw[k] === typeof d[k]) d[k] = raw[k];
    });
    d.gap = Object.assign({ ans: {}, pos: {}, order: {}, last: null, updatedAt: null }, raw.gap || {});
    if (!d.gap.ans || typeof d.gap.ans !== "object") d.gap.ans = {};
    if (!d.gap.pos || typeof d.gap.pos !== "object") d.gap.pos = {};
    // 무작위 순서(신규 필드) — 구버전 저장값에는 없으므로 빈 객체로 보완
    if (!d.gap.order || typeof d.gap.order !== "object") d.gap.order = {};
    Object.keys(d.gap.order).forEach(function (k) {
      if (!Array.isArray(d.gap.order[k])) delete d.gap.order[k];
    });
    d.settings = Object.assign(defaultStore().settings, raw.settings || {});
    d.ai = Object.assign(defaultStore().ai, raw.ai || {});
    if (raw.createdAt) d.createdAt = raw.createdAt;
    if (raw.updatedAt) d.updatedAt = raw.updatedAt;
    return d;
  }
  function nativeBridge() {
    var b = window.BadaToeicAndroid;
    return b && typeof b.saveStore === "function" ? b : null;
  }
  function loadStore() {
    var local = null;
    try {
      var raw = localStorage.getItem(KEY);
      local = raw ? normalize(JSON.parse(raw)) : null;
    } catch (e) { local = null; }
    var native = null;
    try {
      var b = window.BadaToeicAndroid;
      if (b && typeof b.loadStore === "function") {
        var s = b.loadStore();
        if (s && typeof s === "string") native = normalize(JSON.parse(s));
      }
    } catch (e) { native = null; }
    var chosen = local || native || defaultStore();
    if (native && local) {
      var tn = Date.parse(native.updatedAt || 0), tl = Date.parse(local.updatedAt || 0);
      if (tn > tl) chosen = native;
    }
    return chosen;
  }
  var D = loadStore();
  function save() {
    D.updatedAt = new Date().toISOString();
    if (D.attempts.length > 200) D.attempts = D.attempts.slice(-200);
    var s = null;
    try { s = JSON.stringify(D); } catch (e) { return; }
    try { localStorage.setItem(KEY, s); } catch (e) { toast("브라우저 저장 공간이 부족합니다."); }
    var b = nativeBridge();
    if (b) { try { b.saveStore(s); } catch (e) { } }
  }

  /* ---------------- 유틸 ---------------- */
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function safeHtml(html) {
    var t = document.createElement("div");
    t.innerHTML = String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<styleグ?[\s\S]*?<\/style>/gi, "");
    (function walk(node) {
      var kids = Array.prototype.slice.call(node.childNodes);
      kids.forEach(function (n) {
        if (n.nodeType === 1) {
          if (!ALLOWED[n.tagName]) { node.replaceChild(document.createTextNode(n.textContent || ""), n); return; }
          Array.prototype.slice.call(n.attributes).forEach(function (a) {
            if (!/^(colspan|rowspan)$/i.test(a.name)) n.removeAttribute(a.name);
          });
          walk(n);
        }
      });
    })(t);
    return t.innerHTML;
  }
  function toast(msg) {
    var layer = $("#toasts");
    var el = document.createElement("div");
    el.className = "toast";
    el.textContent = msg;
    layer.appendChild(el);
    setTimeout(function () { el.style.opacity = "0"; el.style.transition = "opacity .25s"; }, 2300);
    setTimeout(function () { el.remove(); }, 2650);
  }
  function clock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function dateLabel(iso) {
    try {
      var d = new Date(iso);
      return (d.getMonth() + 1) + "/" + d.getDate() + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    } catch (e) { return ""; }
  }
  function pct(a, b) { return b ? Math.round((a / b) * 100) : 0; }
  function examList() { return [1, 2, 3, 4]; }
  function byExam(n) { return QS.filter(function (q) { return q.exam === n; }); }
  function qById(id) {
    var q = QS.filter(function (x) { return x.id === id; })[0];
    return q || GAP.filter(function (x) { return x.id === id; })[0];
  }
  function subjectNo(name) {
    var s = SUBJECTS.filter(function (x) { return x.name === name; })[0];
    return s ? SUBJECTS.indexOf(s) + 1 : 0;
  }
  function isGap(q) { return !!(q && q.gap); }
  function subjectTail(name) { return String(name || "").replace(/^제\d과목\s*/, "").trim(); }
  function subjectShort(name) {
    var s = SUBJECTS.filter(function (x) { return x.name === name; })[0];
    return s ? s.short : name;
  }
  function unitLabel(q) {
    if (q.subject === "제2과목 파생상품펀드" || q.subject === "제3과목 부동산펀드") return subjectShort(q.subject) + " " + q.unit;
    return q.unit;
  }

  /* ---------------- 문제은행 ---------------- */
  var QS = [];
  var GAP = [];
  var SERVER = { hasServerKey: false, checked: false };

  function cachedQuestions() {
    try {
      var raw = localStorage.getItem(QKEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && o.length ? o : null;
    } catch (e) { return null; }
  }
  function loadQuestions() {
    var cached = cachedQuestions();
    if (cached) { QS = cached; render(); }
    return fetch("/api/questions").then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && d.questions && d.questions.length) {
        QS = d.questions;
        try { localStorage.setItem(QKEY, JSON.stringify(QS)); } catch (e) { }
        render();
      } else if (!QS.length) {
        throw new Error("문제은행 없음");
      }
    }).catch(function () {
      if (!QS.length) {
        app.innerHTML = '<div class="card empty" style="margin-top:26px">문제은행을 불러오지 못했습니다. 네트워크를 확인한 뒤 새로고침해 주세요.</div>';
      }
    });
  }
  function cachedGap() {
    try {
      var raw = localStorage.getItem(GAPKEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      return o && o.length ? o : null;
    } catch (e) { return null; }
  }
  function loadGapQuestions() {
    var cached = cachedGap();
    if (cached) { GAP = cached; render(); }
    return fetch("/api/gap-questions").then(function (r) { return r.json(); }).then(function (d) {
      if (d && d.ok && d.questions && d.questions.length) {
        GAP = d.questions;
        try { localStorage.setItem(GAPKEY, JSON.stringify(GAP)); } catch (e) { }
        render();
      }
    }).catch(function () {
      if (!GAP.length) server.gapError = true;
    });
  }
  function checkHealth() {
    return fetch("/api/health").then(function (r) { return r.json(); }).then(function (d) {
      SERVER = { hasServerKey: !!d.hasServerKey, checked: true, count: d.questions };
      return d;
    }).catch(function () { SERVER = { hasServerKey: false, checked: true }; });
  }
  function aiKeyHeader() {
    var k = (D.settings.geminiKey || "").trim();
    return k ? { "X-Gemini-Key": k } : {};
  }

  /* ---------------- 라우팅 ---------------- */
  var view = "home";
  var exam = null;      // 진행 중 시험 상태
  var ui = { filterSubject: "all", filterUnit: "all", booksOnly: false, ai: null };
  var timerId = null;

  function setView(v) {
    view = v;
    Array.prototype.forEach.call(document.querySelectorAll("#nav button"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-view") === v);
    });
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  document.getElementById("nav").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-view]");
    if (!b) return;
    if (exam && !exam.submitted && b.getAttribute("data-view") !== "exam") {
      if (!confirm("시험을 나가면 답안이 사라집니다. 나갈까요?")) return;
      exam = null; D.active = null; save(); stopTimer();
    }
    setView(b.getAttribute("data-view"));
  });

  /* ---------------- 홈 ---------------- */
  function bestByExam(n) {
    var arr = D.attempts.filter(function (a) { return a.exam === n; });
    if (!arr.length) return null;
    return arr.reduce(function (m, a) { return a.score > m.score ? a : m; }, arr[0]);
  }
  function weakUnits(limit) {
    var agg = {};
    Object.keys(D.wrong).forEach(function (id) {
      var q = qById(id);
      if (!q) return;
      var k = q.subject + "|" + q.unit;
      agg[k] = agg[k] || { subject: q.subject, unit: q.unit, n: 0 };
      agg[k].n += 1;
    });
    return Object.keys(agg).map(function (k) { return agg[k]; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, limit || 3);
  }
  function gapHomeSection() {
    if (!GAP.length) return "";
    var cards = SUBJECTS.map(function (s) {
      var st = gapStats(s.name);
      var p = st.total ? pct(st.done, st.total) : 0;
      return '<button class="card gapmini" data-gap-open="' + esc(s.name) + '" data-gap-idx="' + gapNextIndex(s.name) + '">' +
        '<div class="row between"><b>' + s.short + ' 틈새문제</b><span class="row" style="gap:5px">' +
        (gapIsShuffled(s.name) ? '<span class="pill warn">🔀 무작위</span>' : '') +
        '<span class="pill">' + st.done + '/' + st.total + '</span></span></div>' +
        '<div class="bar"><i style="width:' + p + '%"></i></div>' +
        '<span class="small muted">' + (st.done ? '정답률 ' + st.rate + '% · ' + (st.done < st.total ? '이어 풀기' : '다시 보기') : '가볍게 시작하기') + '</span></button>';
    }).join("");
    return '<div class="section-title"><h2>틈새문제</h2><span class="small muted">시험 전 가볍게 · 바로 해설</span></div>' +
      '<div class="gapminigrid">' + cards + '</div>';
  }

  function renderHome() {
    var solved = D.attempts.length;
    var totalWrong = Object.keys(D.wrong).length;
    var avg = solved ? Math.round(D.attempts.reduce(function (s, a) { return s + a.score; }, 0) / solved) : 0;
    var weak = weakUnits(3);

    var cards = examList().map(function (n) {
      var best = bestByExam(n);
      return '' +
        '<div class="card examcard">' +
        '<div class="row between"><h3>제' + n + '회 실전 모의고사</h3>' +
        (n <= 2 ? '<span class="pill">기출</span>' : '<span class="pill warn">AI</span>') + '</div>' +
        '<div class="meta"><span class="pill">100문항</span><span class="pill">120분</span><span class="pill">과락 50%</span></div>' +
        '<div class="best">' + (best ? '최고 <b>' + best.score + '점</b> · ' + dateLabel(best.at) : '아직 응시하지 않았습니다') + '</div>' +
        '<div class="row" style="gap:8px">' +
        '<button class="btn primary grow" data-start="' + n + '" data-mode="' + (D.settings.immediate ? 'instant' : 'exam') + '">' + (best ? '다시 풀기' : '시험 시작') + '</button>' +
        '<button class="btn small" data-start="' + n + '" data-mode="instant">즉시 채점</button>' +
        '</div></div>';
    }).join("");

    var weakHtml = weak.length
      ? weak.map(function (w) {
        var p = Math.min(100, w.n * 12 + 8);
        return '<button class="weakrow" data-weak="' + esc(w.subject + "|" + w.unit) + '">' +
          '<span class="small" style="min-width:132px;text-align:left;color:var(--ink)">' + esc(unitLabel(w)) + '</span>' +
          '<span class="bar"><i style="width:' + p + '%"></i></span>' +
          '<span class="tiny muted">' + w.n + '문항</span></button>';
      }).join("")
      : '<div class="empty">아직 오답 기록이 없습니다. 모의고사를 풀면 약점 영역이 여기에 쌓입니다.</div>';

    app.innerHTML = '' +
      '<section class="hero">' +
      '<h1>펀드투자권유자문인력 <span style="color:var(--accent)">실전 4회분</span></h1>' +
      '<p>기출 2회분 200 + AI 신규 200 + 틈새문제 300문항 · 문항을 고르면 바로 시작합니다.</p>' +
      '<div class="statgrid">' +
      '<div class="stat"><b>' + ((QS.length || 400) + (GAP.length || 0)) + '</b><span>총 문항</span></div>' +
      '<div class="stat"><b>' + (solved || 0) + '</b><span>응시 기록</span></div>' +
      '<div class="stat"><b>' + (solved ? avg + '점' : '-') + '</b><span>평균 점수</span></div>' +
      '</div></section>' +
      '<div class="section-title"><h2>실전 모의고사</h2><span class="small muted">과목별 50% · 총 70점 이상 합격</span></div>' +
      '<div class="examgrid">' + cards + '</div>' +
      gapHomeSection() +
      '<div class="section-title"><h2>약점 공략</h2><span class="small muted">틀린 문항이 많은 영역 · 틈새문제 포함</span></div>' +
      '<div class="weaklist">' + weakHtml + '</div>' +
      '<div class="section-title"><h2>바로가기</h2></div>' +
      '<div class="quickgrid">' +
      '<button class="card quick" data-go="wrong"><span class="ic">📕</span><span><b>오답노트</b><span>틀린 문제 ' + totalWrong + '개 · 북마크 모아보기</span></span></button>' +
      '<button class="card quick" data-go="wrong"><span class="ic">⚡</span><span><b>AI 약점 공략</b><span>같은 출제 포인트의 새 문제를 계속 생성</span></span></button>' +
      '<button class="card quick" data-go="settings"><span class="ic">⚙️</span><span><b>설정</b><span>즉시 채점 · AI 키 · 기록 관리</span></span></button>' +
      '</div>';

    app.querySelectorAll("[data-start]").forEach(function (b) {
      b.addEventListener("click", function () { startExam(parseInt(b.dataset.start, 10), b.dataset.mode); });
    });
    app.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.dataset.go); });
    });
    app.querySelectorAll("[data-gap-open]").forEach(function (b) {
      b.addEventListener("click", function () { gapOpen(b.dataset.gapOpen, parseInt(b.dataset.gapIdx, 10)); });
    });
    app.querySelectorAll("[data-weak]").forEach(function (b) {
      b.addEventListener("click", function () {
        var parts = b.dataset.weak.split("|");
        ui.filterSubject = parts[0]; ui.filterUnit = parts[1]; ui.booksOnly = false;
        setView("wrong");
      });
    });
  }

  /* ---------------- 시험 ---------------- */
  function startExam(n, mode) {
    var qs = byExam(n).slice().sort(function (a, b) { return a.no - b.no; });
    if (!qs.length) { toast("문제를 불러오는 중입니다."); return; }
    exam = {
      exam: n, mode: mode === "instant" ? "instant" : "exam", answers: {}, idx: 0,
      endsAt: Date.now() + EXAM_MIN * 60 * 1000, startedAt: new Date().toISOString(),
      submitted: false, result: null, locked: {}
    };
    D.active = { exam: n, mode: exam.mode, answers: {}, idx: 0, endsAt: exam.endsAt, startedAt: exam.startedAt };
    save();
    setView("exam");
    startTimer();
  }
  function resumeExam() {
    if (!D.active) return false;
    var a = D.active;
    if (!a.endsAt || a.endsAt < Date.now()) { D.active = null; save(); return false; }
    exam = { exam: a.exam, mode: a.mode, answers: a.answers || {}, idx: a.idx || 0, endsAt: a.endsAt,
      startedAt: a.startedAt, submitted: false, result: null, locked: {} };
    setView("exam");
    startTimer();
    return true;
  }
  function persistActive() {
    if (!exam || exam.submitted) return;
    D.active = { exam: exam.exam, mode: exam.mode, answers: exam.answers, idx: exam.idx,
      endsAt: exam.endsAt, startedAt: exam.startedAt };
    save();
  }
  function startTimer() {
    stopTimer();
    timerId = setInterval(function () {
      if (!exam || exam.submitted) { stopTimer(); return; }
      var left = (exam.endsAt - Date.now()) / 1000;
      var el = $("#timer");
      if (el) {
        el.textContent = clock(left);
        el.className = "timer" + (left < 300 ? " danger" : left < 900 ? " warn" : "");
      }
      if (left <= 0) { stopTimer(); toast("시험 시간이 끝났습니다. 자동 채점합니다."); submitExam(true); }
    }, 500);
  }
  function stopTimer() { if (timerId) { clearInterval(timerId); timerId = null; } }

  function examQuestions() { return byExam(exam.exam); }
  function answeredCount() { return Object.keys(exam.answers).filter(function (k) { return exam.answers[k]; }).length; }

  function renderExam() {
    if (!exam) { setView("home"); return; }
    var qs = examQuestions();
    var q = qs[exam.idx];
    var picked = exam.answers[q.id];
    var showAnswer = exam.mode === "instant" && picked;
    var marked = !!D.bookmarks[q.id];

    var omr = SUBJECTS.map(function (s) {
      var rows = qs.filter(function (x) { return x.subject === s.name; }).map(function (x) {
        var ans = exam.answers[x.id];
        var cls = "cell";
        if (exam.submitted) cls += ans ? (ans === x.answer ? " right" : " wrong") : " wrong";
        else if (ans) cls += " answered";
        if (x.id === q.id) cls += " current";
        return '<button class="' + cls + '" data-jump="' + x.id + '">' + x.no + '</button>';
      }).join("");
      return '<div class="subj"><h4>' + s.short + ' <span class="tiny muted">' + s.total + '문항</span></h4><div class="grid">' + rows + '</div></div>';
    }).join("");

    var opts = q.options.map(function (o, i) {
      var n = i + 1, cls = "opt";
      if (showAnswer) {
        if (n === q.answer) cls += " correct";
        else if (n === picked) cls += " wrong";
      } else if (picked === n) cls += " picked";
      return '<button class="' + cls + '" data-opt="' + n + '"><span class="num">' + n + '</span><span>' + safeHtml(o) + '</span></button>';
    }).join("");

    var explain = showAnswer
      ? '<div class="explain"><span class="tag">정답 ' + q.answer + '번 · ' + esc(unitLabel(q)) + '</span>' +
        '<div>' + safeHtml(q.explanation) + '</div>' +
        (picked !== q.answer ? '<div class="small" style="margin-top:8px;color:var(--bad)">내 답 ' + picked + '번 — 오답노트에 기록했습니다.</div>' : '<div class="small" style="margin-top:8px;color:var(--ok)">정답입니다.</div>') +
        '</div>'
      : "";

    app.innerHTML = '' +
      '<div class="exam-top">' +
      '<div class="row"><button class="btn small" id="exitExam">← 나가기</button>' +
      '<span class="pill">제' + exam.exam + '회</span>' +
      '<span class="pill ' + (exam.mode === "instant" ? "warn" : "") + '">' + (exam.mode === "instant" ? "즉시 채점" : "실전 모드") + '</span>' +
      '<span class="small muted" id="progressTxt">' + answeredCount() + '/100 응답</span></div>' +
      '<div class="row"><span class="timer" id="timer">' + clock((exam.endsAt - Date.now()) / 1000) + '</span>' +
      '<button class="btn small mobile-omr-btn" id="omrToggle">답안지</button>' +
      '<button class="btn primary small" id="submitExam">채점하기</button></div>' +
      '</div>' +
      '<div class="examlayout">' +
      '<div class="card qcard">' +
      '<div class="qhead"><div class="qno"><span class="badge">' + q.no + '</span>' +
      '<span class="small dim">' + esc(unitLabel(q)) + '</span></div>' +
      '<button class="btn small ghost" id="bm">' + (marked ? '★ 북마크' : '☆ 북마크') + '</button></div>' +
      '<div class="stem">' + safeHtml(q.stem) + '</div>' +
      '<div class="options">' + opts + '</div>' +
      explain +
      '<div class="qfoot"><div class="navbtns">' +
      '<button class="btn small" id="prev"' + (exam.idx === 0 ? " disabled" : "") + '>← 이전</button>' +
      '<button class="btn small" id="next"' + (exam.idx === qs.length - 1 ? " disabled" : "") + '>다음 →</button>' +
      '</div><span class="tiny muted">' + (exam.idx + 1) + ' / ' + qs.length + '</span></div>' +
      '</div>' +
      '<aside class="card omr" id="omrPanel"><div class="omr-drag"></div><h4>답안지 (OMR)</h4>' + omr +
      '<div class="stats"><span>응답 <b>' + answeredCount() + '</b></span><span>남은 <b>' + (100 - answeredCount()) + '</b></span></div></aside>' +
      '</div>';

    app.querySelectorAll("[data-opt]").forEach(function (b) {
      b.addEventListener("click", function () { pickOption(parseInt(b.dataset.opt, 10)); });
    });
    app.querySelectorAll("[data-jump]").forEach(function (b) {
      b.addEventListener("click", function () {
        exam.idx = qs.findIndex(function (x) { return x.id === b.dataset.jump; });
        persistActive(); renderExam();
        var p = $("#omrPanel"); if (p) p.classList.remove("open");
      });
    });
    $("#prev").addEventListener("click", function () { if (exam.idx > 0) { exam.idx--; persistActive(); renderExam(); } });
    $("#next").addEventListener("click", function () { if (exam.idx < qs.length - 1) { exam.idx++; persistActive(); renderExam(); } });
    $("#bm").addEventListener("click", function () {
      if (D.bookmarks[q.id]) delete D.bookmarks[q.id]; else D.bookmarks[q.id] = { at: new Date().toISOString() };
      save(); renderExam();
    });
    $("#submitExam").addEventListener("click", function () {
      var un = 100 - answeredCount();
      if (un > 0 && !confirm("아직 " + un + "문항이 비어 있습니다. 그래도 채점할까요?")) return;
      submitExam(false);
    });
    var exitBtn = $("#exitExam");
    if (exitBtn) exitBtn.addEventListener("click", function () {
      if (!confirm("시험을 나가면 답안이 사라집니다. 나갈까요?")) return;
      exam = null; D.active = null; save(); stopTimer(); setView("home");
    });
    var omrT = $("#omrToggle");
    if (omrT) omrT.addEventListener("click", function () { $("#omrPanel").classList.toggle("open"); });
  }

  function pickOption(n) {
    var qs = examQuestions();
    var q = qs[exam.idx];
    if (exam.submitted) return;
    if (exam.mode === "instant" && exam.answers[q.id]) return;  // 즉시 채점은 1회 응답
    exam.answers[q.id] = n;
    if (exam.mode === "instant") {
      if (n !== q.answer) {
        D.wrong[q.id] = { at: new Date().toISOString(), count: ((D.wrong[q.id] || {}).count || 0) + 1, exam: exam.exam, no: q.no };
      } else if (D.wrong[q.id]) {
        delete D.wrong[q.id];
      }
    }
    persistActive();
    renderExam();
  }

  function submitExam(auto) {
    var qs = examQuestions();
    var per = {}, units = {};
    SUBJECTS.forEach(function (s) { per[s.name] = { total: 0, correct: 0 }; });
    qs.forEach(function (q) {
      var ans = exam.answers[q.id];
      per[q.subject].total++;
      if (ans === q.answer) per[q.subject].correct++;
      var uk = q.subject + "|" + q.unit;
      units[uk] = units[uk] || { subject: q.subject, unit: q.unit, total: 0, correct: 0 };
      units[uk].total++;
      if (ans === q.answer) units[uk].correct++;
      if (exam.mode !== "instant") {
        if (ans && ans !== q.answer) {
          D.wrong[q.id] = { at: new Date().toISOString(), count: ((D.wrong[q.id] || {}).count || 0) + 1, exam: exam.exam, no: q.no };
        } else if (ans === q.answer && D.wrong[q.id]) {
          delete D.wrong[q.id];
        }
      }
    });
    var score = Object.keys(per).reduce(function (s, k) { return s + per[k].correct; }, 0);
    var fails = SUBJECTS.filter(function (s) { return per[s.name].correct < s.pass; })
      .map(function (s) { return s.short + " " + per[s.name].correct + '/' + s.total; });
    var passed = fails.length === 0 && score >= 70;
    var attempt = {
      at: new Date().toISOString(), exam: exam.exam, score: score, passed: passed, fails: fails,
      subjects: per, units: units, mode: exam.mode, auto: !!auto,
      answers: Object.assign({}, exam.answers)
    };
    D.attempts.push(attempt);
    exam.submitted = true;
    exam.result = attempt;
    D.active = null;
    save(); stopTimer();
    setView("result");
  }

  /* ---------------- 결과 ---------------- */
  function renderResult() {
    var r = exam && exam.result;
    if (!r) { setView("home"); return; }
    var subjectRows = SUBJECTS.map(function (s) {
      var p = r.subjects[s.name];
      var failed = p.correct < s.pass;
      return '<div class="subjectrow' + (failed ? " fail" : "") + '">' +
        '<div class="t"><span>' + s.short + ' <span class="tiny muted">' + subjectTail(s.name) + '</span></span>' +
        '<span>' + p.correct + '/' + p.total + ' ' + (failed ? '<span class="pill bad">과락</span>' : '<span class="pill ok">통과</span>') + '</span></div>' +
        '<div class="bar"><i style="width:' + pct(p.correct, p.total) + '%"></i></div>' +
        '<div class="tiny muted">과락 기준 ' + s.pass + '문항 · 획득 ' + pct(p.correct, p.total) + '%</div></div>';
    }).join("");

    var unitRows = Object.keys(r.units).sort().map(function (k) {
      var u = r.units[k];
      return '<div class="unitrow"><div class="t"><span>' + esc(unitLabel({ subject: u.subject, unit: u.unit })) + '</span>' +
        '<span>' + u.correct + '/' + u.total + '</span></div>' +
        '<div class="bar"><i style="width:' + pct(u.correct, u.total) + '%"></i></div></div>';
    }).join("");

    var wrongIds = Object.keys(r.answers).filter(function (id) {
      var q = qById(id); return q && r.answers[id] !== q.answer;
    });
    var unanswered = 100 - Object.keys(r.answers).length;

    app.innerHTML = '' +
      '<div class="card result-head" style="margin-top:16px">' +
      '<div class="row between wrapflex">' +
      '<div><div class="small muted">제' + r.exam + '회 실전 모의고사 · ' + (r.mode === "instant" ? "즉시 채점" : "실전 모드") + '</div>' +
      '<div class="score-big">' + r.score + '<small>/100점</small></div>' +
      '<div class="row" style="margin-top:8px">' + (r.passed ? '<span class="pill ok">합격권</span>' : '<span class="pill bad">불합격</span>') +
      (r.fails.length ? '<span class="small" style="color:var(--bad)">과락: ' + esc(r.fails.join(", ")) + '</span>' : '<span class="small dim">과목별 50% 충족</span>') +
      '</div></div>' +
      '<div style="text-align:right"><div class="small muted">오답 ' + wrongIds.length + ' · 미응답 ' + unanswered + '</div>' +
      '<div class="small muted">합격 기준 70점 · 과목별 50%</div></div>' +
      '</div>' +
      '<div class="subjectgrid">' + subjectRows + '</div>' +
      '</div>' +
      '<div class="section-title"><h2>영역별 성적</h2><span class="small muted">틀린 영역은 오답노트에서 AI 문제로 보강하세요</span></div>' +
      '<div class="unitgrid">' + unitRows + '</div>' +
      '<div class="row wrapflex" style="margin-top:18px;gap:8px">' +
      '<button class="btn primary" id="toWrong">오답노트 보기 (' + wrongIds.length + ')</button>' +
      '<button class="btn" id="reviewAll">전체 문항 다시 보기</button>' +
      (r.exam < 4 ? '<button class="btn" id="nextExam">제' + (r.exam + 1) + '회 풀기</button>' : '') +
      '<button class="btn ghost" id="homeBtn">홈으로</button>' +
      '</div>';

    $("#toWrong").addEventListener("click", function () { ui.filterSubject = "all"; ui.filterUnit = "all"; ui.booksOnly = false; setView("wrong"); });
    $("#reviewAll").addEventListener("click", function () { exam.idx = 0; exam.submitted = true; exam.mode = "review"; setView("review"); });
    $("#homeBtn").addEventListener("click", function () { exam = null; setView("home"); });
    var ne = $("#nextExam");
    if (ne) ne.addEventListener("click", function () { startExam(r.exam + 1, "exam"); });
  }

  function renderReview() {
    var qs = examQuestions();
    var q = qs[exam.idx];
    var picked = exam.answers[q.id];
    var opts = q.options.map(function (o, i) {
      var n = i + 1, cls = "opt";
      if (n === q.answer) cls += " correct";
      else if (n === picked) cls += " wrong";
      return '<button class="' + cls + '"><span class="num">' + n + '</span><span>' + safeHtml(o) + '</span></button>';
    }).join("");
    app.innerHTML = '<div class="exam-top"><div class="row"><button class="btn small" id="backResult">← 결과</button>' +
      '<span class="pill">제' + exam.exam + '회 복기</span><span class="small muted">' + (picked ? "내 답 " + picked : "미응답") + ' · 정답 ' + q.answer + '</span></div></div>' +
      '<div class="card qcard"><div class="qhead"><div class="qno"><span class="badge">' + q.no + '</span>' +
      '<span class="small dim">' + esc(unitLabel(q)) + '</span></div>' +
      '<button class="btn small ghost" id="bm2">' + (D.bookmarks[q.id] ? '★' : '☆') + '</button></div>' +
      '<div class="stem">' + safeHtml(q.stem) + '</div><div class="options">' + opts + '</div>' +
      '<div class="explain"><span class="tag">정답 ' + q.answer + '번</span><div>' + safeHtml(q.explanation) + '</div></div>' +
      '<div class="qfoot"><div class="navbtns"><button class="btn small" id="prev2"' + (exam.idx === 0 ? " disabled" : "") + '>← 이전</button>' +
      '<button class="btn small" id="next2"' + (exam.idx === qs.length - 1 ? " disabled" : "") + '>다음 →</button></div>' +
      '<span class="tiny muted">' + (exam.idx + 1) + ' / ' + qs.length + '</span></div></div>';
    $("#backResult").addEventListener("click", function () { setView("result"); });
    $("#prev2").addEventListener("click", function () { if (exam.idx > 0) { exam.idx--; renderReview(); } });
    $("#next2").addEventListener("click", function () { if (exam.idx < qs.length - 1) { exam.idx++; renderReview(); } });
    $("#bm2").addEventListener("click", function () {
      if (D.bookmarks[q.id]) delete D.bookmarks[q.id]; else D.bookmarks[q.id] = { at: new Date().toISOString() };
      save(); renderReview();
    });
  }

  /* ---------------- 오답노트 ---------------- */
  function wrongItems() {
    var ids = Object.keys(D.wrong).concat(Object.keys(D.bookmarks));
    var uniq = ids.filter(function (v, i) { return ids.indexOf(v) === i; });
    var items = uniq.map(function (id) { return qById(id); }).filter(Boolean);
    if (ui.filterSubject !== "all") items = items.filter(function (q) { return q.subject === ui.filterSubject; });
    if (ui.filterUnit !== "all") items = items.filter(function (q) { return q.unit === ui.filterUnit; });
    if (ui.booksOnly) items = items.filter(function (q) { return !!D.wrong[q.id]; });
    items.sort(function (a, b) { return ((b.exam || 0) - (a.exam || 0)) || ((b.no || 0) - (a.no || 0)); });
    return items;
  }
  function renderWrong() {
    var items = wrongItems();
    var subjChips = [{ k: "all", t: "전체" }].concat(SUBJECTS.map(function (s) { return { k: s.name, t: s.short }; }));
    var units = ui.filterSubject !== "all" ? UNITS[ui.filterSubject] : [];
    var unitChips = [{ k: "all", t: "영역 전체" }].concat(units.map(function (u) { return { k: u, t: u }; }));

    var list = items.length ? items.map(function (q) {
      var mine = D.wrong[q.id];
      var last = lastAnswerOf(q.id);
      var opts = q.options.map(function (o, i) {
        var n = i + 1, cls = "o";
        if (n === q.answer) cls += " cor";
        else if (last === n) cls += " sel";
        return '<div class="' + cls + '"><b>' + n + '</b><span>' + safeHtml(o) + '</span></div>';
      }).join("");
      return '<div class="card wrongitem" data-qid="' + q.id + '">' +
        '<div class="row between wrapflex" style="margin-bottom:8px">' +
        '<div class="row"><span class="pill">' + (isGap(q) ? '틈새 · ' + subjectShort(q.subject) : q.id) + '</span><span class="pill">' + esc(unitLabel(q)) + '</span>' +
        (D.bookmarks[q.id] ? '<span class="pill warn">북마크</span>' : '') +
        (mine ? '<span class="pill bad">' + (mine.count || 1) + '회 오답</span>' : '') + '</div>' +
        '<div class="row"><button class="btn small ghost" data-bm="' + q.id + '">' + (D.bookmarks[q.id] ? '★' : '☆') + '</button></div>' +
        '</div>' +
        '<div class="q">' + safeHtml(q.stem) + '</div>' +
        '<div class="opts">' + opts + '</div>' +
        '<div class="explain"><span class="tag">정답 ' + q.answer + '번</span><div>' + safeHtml(q.explanation) + '</div></div>' +
        '<div class="row wrapflex" style="margin-top:10px"><button class="btn primary small" data-ai="' + q.id + '">⚡ AI 유사 문제 계속 풀기</button>' +
        '<span class="tiny muted">' + (last ? "내 최근 답 " + last + "번" : "기록된 답 없음") + '</span></div>' +
        '</div>';
    }).join("") : '<div class="card empty">조건에 맞는 문항이 없습니다. 모의고사를 풀면 틀린 문제가 여기에 쌓입니다.</div>';

    app.innerHTML = '' +
      '<div class="section-title"><h2>오답노트 & AI 약점 공략</h2><span class="small muted">' + items.length + '문항</span></div>' +
      '<div class="toolbar">' + subjChips.map(function (c) {
        return '<button class="chip' + (ui.filterSubject === c.k ? " active" : "") + '" data-fs="' + esc(c.k) + '">' + esc(c.t) + '</button>';
      }).join("") + '</div>' +
      (units.length ? '<div class="toolbar">' + unitChips.map(function (c) {
        return '<button class="chip' + (ui.filterUnit === c.k ? " active" : "") + '" data-fu="' + esc(c.k) + '">' + esc(c.t) + '</button>';
      }).join("") + '</div>' : "") +
      '<div class="toolbar"><button class="chip' + (ui.booksOnly ? " active" : "") + '" id="booksOnly">내가 틀린 것만</button>' +
      (ui.filterUnit !== "all" && items.length ? '<button class="btn small primary" id="unitAi">⚡ 이 영역 AI 문제 계속 풀기</button>' : '') +
      '<span class="tiny muted">서버 AI 키 ' + (SERVER.hasServerKey ? "연결됨" : "없음 — 설정에서 내 키 입력 가능") + '</span></div>' +
      list +
      '<div id="aiZone"></div>';

    app.querySelectorAll("[data-fs]").forEach(function (b) {
      b.addEventListener("click", function () { ui.filterSubject = b.dataset.fs; ui.filterUnit = "all"; renderWrong(); });
    });
    app.querySelectorAll("[data-fu]").forEach(function (b) {
      b.addEventListener("click", function () { ui.filterUnit = b.dataset.fu; renderWrong(); });
    });
    var bo = $("#booksOnly");
    if (bo) bo.addEventListener("click", function () { ui.booksOnly = !ui.booksOnly; renderWrong(); });
    var ua = $("#unitAi");
    if (ua) ua.addEventListener("click", function () { openAi(items[Math.floor(Math.random() * items.length)].id); });
    app.querySelectorAll("[data-bm]").forEach(function (b) {
      b.addEventListener("click", function () {
        var id = b.dataset.bm;
        if (D.bookmarks[id]) delete D.bookmarks[id]; else D.bookmarks[id] = { at: new Date().toISOString() };
        save(); renderWrong();
      });
    });
    app.querySelectorAll("[data-ai]").forEach(function (b) {
      b.addEventListener("click", function () { openAi(b.dataset.ai); });
    });
    if (ui.ai) renderAiZone();
  }
  function lastAnswerOf(id) {
    if (D.gap.ans[id]) return D.gap.ans[id];
    for (var i = D.attempts.length - 1; i >= 0; i--) {
      if (D.attempts[i].answers && D.attempts[i].answers[id]) return D.attempts[i].answers[id];
    }
    return null;
  }

  /* ---------------- AI 유사 문제 ---------------- */
  function openAi(id) {
    var q = qById(id);
    if (!q) return;
    ui.ai = { q: q, items: [], idx: 0, answers: {}, loading: false, err: null, done: false };
    renderWrong();
    var zone = $("#aiZone");
    if (zone) zone.scrollIntoView({ behavior: "smooth", block: "start" });
    generateMore();
  }
  function generateMore() {
    var st = ui.ai;
    if (!st || st.loading) return;
    st.loading = true; st.err = null;
    renderAiZone();
    fetch("/api/generate-similar", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, aiKeyHeader()),
      body: JSON.stringify({ question: st.q, count: 3 })
    }).then(function (r) { return r.json().then(function (d) { return { status: r.status, d: d }; }); })
      .then(function (res) {
        st.loading = false;
        if (res.d && res.d.ok && res.d.items && res.d.items.length) {
          st.items = st.items.concat(res.d.items);
          st.done = false;
          D.ai.generated = (D.ai.generated || 0) + res.d.items.length;
          D.ai.lastAt = new Date().toISOString();
          save();
        } else {
          st.err = (res.d && res.d.error) || "AI 문제를 만들지 못했습니다.";
        }
        renderAiZone();
      }).catch(function () {
        st.loading = false; st.err = "서버에 연결하지 못했습니다."; renderAiZone();
      });
  }
  function renderAiZone() {
    var st = ui.ai;
    var zone = $("#aiZone");
    if (!zone || !st) return;
    var head = '<div class="card ai-panel"><div class="row between wrapflex">' +
      '<div><b>⚡ AI 약점 공략</b><div class="ai-status">' + esc(st.q.id) + ' · ' + esc(unitLabel(st.q)) + ' 같은 출제 포인트의 새 문제</div></div>' +
      '<div class="row"><button class="btn small ghost" id="aiClose">닫기</button>' +
      '<button class="btn small" id="aiMore"' + (st.loading ? " disabled" : "") + '>' + (st.loading ? '<span class="spinner"></span> 생성 중' : '계속 생성') + '</button></div></div>';

    if (!st.items.length) {
      zone.innerHTML = head + (st.loading ? '<div class="ai-status" style="padding:16px 0"><span class="spinner"></span> 같은 출제 포인트로 문제를 만들고 있습니다…</div>' :
        '<div class="ai-status" style="padding:12px 0;color:var(--bad)">' + esc(st.err || "") + '</div>') + '</div>';
      bindAiHead();
      return;
    }
    var cur = st.items[Math.min(st.idx, st.items.length - 1)];
    var picked = st.answers[st.idx];
    var revealed = !!picked;
    var opts = cur.options.map(function (o, i) {
      var n = i + 1, cls = "opt";
      if (revealed) { if (n === cur.answer) cls += " correct"; else if (n === picked) cls += " wrong"; }
      else if (picked === n) cls += " picked";
      return '<button class="' + cls + '" data-aiopt="' + n + '"><span class="num">' + n + '</span><span>' + safeHtml(o) + '</span></button>';
    }).join("");
    var body = '<div class="ai-q"><div class="row between"><span class="small muted">AI 문제 ' + (st.idx + 1) + ' / ' + st.items.length + '</span>' +
      (cur.topic ? '<span class="pill">' + esc(cur.topic) + '</span>' : '') + '</div>' +
      '<div class="stem" style="margin-top:8px;font-size:15px">' + safeHtml(cur.stem) + '</div>' +
      '<div class="options">' + opts + '</div>' +
      (revealed ? '<div class="explain"><span class="tag">정답 ' + cur.answer + '번</span><div>' + safeHtml(cur.explanation) + '</div></div>' : '') +
      '<div class="qfoot"><div class="navbtns">' +
      (st.idx > 0 ? '<button class="btn small" id="aiPrev">← 이전</button>' : '') +
      (revealed && st.idx < st.items.length - 1 ? '<button class="btn small primary" id="aiNext">다음 문제 →</button>' : '') +
      (revealed && st.idx === st.items.length - 1 ? '<button class="btn small primary" id="aiMore2">계속 만들기</button>' : '') +
      '</div><span class="tiny muted">' + (st.err ? esc(st.err) : "") + '</span></div></div>';
    zone.innerHTML = head + body + '</div>';
    bindAiHead();
    zone.querySelectorAll("[data-aiopt]").forEach(function (b) {
      b.addEventListener("click", function () {
        if (st.answers[st.idx]) return;
        st.answers[st.idx] = parseInt(b.dataset.aiopt, 10);
        D.ai.solved = (D.ai.solved || 0) + 1;
        save(); renderAiZone();
      });
    });
    var p = $("#aiPrev"), nx = $("#aiNext"), m2 = $("#aiMore2");
    if (p) p.addEventListener("click", function () { st.idx--; renderAiZone(); });
    if (nx) nx.addEventListener("click", function () { st.idx++; renderAiZone(); });
    if (m2) m2.addEventListener("click", function () { generateMore(); });
  }
  function bindAiHead() {
    var zone = $("#aiZone");
    if (!zone) return;
    var close = $("#aiClose"), more = $("#aiMore");
    if (close) close.addEventListener("click", function () { ui.ai = null; renderWrong(); });
    if (more) more.addEventListener("click", function () { generateMore(); });
  }


  /* ---------------- 틈새문제 (과목별 100제 · 즉시 해설) ---------------- */
  var gapUi = { subject: null, idx: 0, showJump: false };

  function gapBaseList(subject) { return GAP.filter(function (q) { return q.subject === subject; }); }
  function gapOrderKey(subject) { return String(subjectNo(subject)); }
  function gapIsShuffled(subject) {
    var arr = D.gap.order && D.gap.order[gapOrderKey(subject)];
    return !!(arr && arr.length);
  }
  function gapIndexById(subject, id) {
    var qs = gapList(subject);
    for (var i = 0; i < qs.length; i++) { if (qs[i].id === id) return i; }
    return -1;
  }
  /* D.gap.order[과목]에 저장된 ID 순서로 반환. 저장된 순서에 없는 문항은 뒤에 보충. */
  function gapList(subject) {
    var base = gapBaseList(subject);
    var arr = D.gap.order && D.gap.order[gapOrderKey(subject)];
    if (!arr || !arr.length) return base;
    var byId = {}, used = {}, out = [];
    base.forEach(function (q) { byId[q.id] = q; });
    arr.forEach(function (id) {
      var q = byId[id];
      if (q && !used[id]) { used[id] = 1; out.push(q); }
    });
    base.forEach(function (q) { if (!used[q.id]) out.push(q); });
    return out;
  }
  /* 과목 전체 순서를 무작위로 섞거나(켜기) 원래 단원 순서로 복귀(끄기).
     D.gap.ans·D.wrong(문제 ID 키)는 건드리지 않는다 — 풀이 기록 무손실. */
  function gapShuffle(subject) {
    var subj = subject || gapUi.subject;
    if (!subj) return;
    var k = gapOrderKey(subj);
    if (!D.gap.order || typeof D.gap.order !== "object") D.gap.order = {};
    var onView = gapUi.subject === subj;
    var holdId = null;
    if (onView) {
      var cur = gapList(subj)[gapUi.idx];
      if (cur) holdId = cur.id;
    } else {
      var sp = D.gap.pos[k], sq = gapList(subj);
      if (typeof sp === "number" && sq[sp]) holdId = sq[sp].id;
    }
    var turningOn = !gapIsShuffled(subj);
    if (turningOn) {
      var ids = gapBaseList(subj).map(function (q) { return q.id; });
      for (var i = ids.length - 1; i > 0; i--) {           // Fisher-Yates
        var j = Math.floor(Math.random() * (i + 1));
        var t = ids[i]; ids[i] = ids[j]; ids[j] = t;
      }
      D.gap.order[k] = ids;
    } else {
      delete D.gap.order[k];
    }
    var target = turningOn
      ? gapNextIndex(subj)                                  // 아직 안 푼 첫 문제
      : (holdId ? gapIndexById(subj, holdId) : -1);        // 보던 문제의 원래 인덱스
    if (target < 0) target = gapNextIndex(subj);
    D.gap.pos[k] = target;
    if (onView) gapUi.idx = target;
    D.gap.updatedAt = new Date().toISOString();
    save();
    toast(turningOn
      ? "무작위 순서로 섞었습니다. 기존 풀이 기록은 그대로 유지됩니다."
      : "원래 단원 순서로 돌아왔습니다.");
    if (onView) renderGap(); else renderGapHome();
  }
  function gapStats(subject) {
    var qs = gapList(subject), done = 0, right = 0;
    qs.forEach(function (q) {
      var p = D.gap.ans[q.id];
      if (p) { done++; if (p === q.answer) right++; }
    });
    return { total: qs.length, done: done, right: right, wrong: done - right, rate: done ? Math.round((right / done) * 100) : 0 };
  }
  function gapNextIndex(subject) {
    var qs = gapList(subject);
    for (var i = 0; i < qs.length; i++) { if (!D.gap.ans[qs[i].id]) return i; }
    return 0;
  }
  function gapOpen(subject, idx) {
    gapUi.subject = subject;
    gapUi.showJump = false;
    var qs = gapList(subject);
    var saved = D.gap.pos[String(subjectNo(subject))];
    gapUi.idx = typeof idx === "number" ? idx : (typeof saved === "number" && saved < qs.length ? saved : 0);
    D.gap.last = subject;
    D.gap.updatedAt = new Date().toISOString();
    save();
    setView("gap");
  }
  function gapGo(delta) {
    var qs = gapList(gapUi.subject);
    var next = gapUi.idx + delta;
    if (next < 0 || next >= qs.length) return;
    gapUi.idx = next;
    D.gap.pos[String(subjectNo(gapUi.subject))] = next;
    D.gap.updatedAt = new Date().toISOString();
    save();
    renderGap();
  }
  function gapPick(n) {
    var qs = gapList(gapUi.subject);
    var q = qs[gapUi.idx];
    if (!q) return;
    if (D.gap.ans[q.id] === n) return;
    D.gap.ans[q.id] = n;
    if (n !== q.answer) {
      D.wrong[q.id] = { at: new Date().toISOString(), count: ((D.wrong[q.id] || {}).count || 0) + 1, gap: true };
    } else if (D.wrong[q.id]) {
      delete D.wrong[q.id];
    }
    D.gap.pos[String(subjectNo(gapUi.subject))] = gapUi.idx;
    D.gap.updatedAt = new Date().toISOString();
    save();
    renderGap();
  }
  function gapReset() {
    var subj = gapUi.subject;
    if (!subj) return;
    var st = gapStats(subj);
    if (!confirm(subj + " 틈새문제 풀이 기록(" + st.done + "문항)을 초기화할까요? 오답노트의 틈새문제 기록도 함께 지워집니다.")) return;
    gapList(subj).forEach(function (q) {
      delete D.gap.ans[q.id];
      if (D.wrong[q.id]) delete D.wrong[q.id];
    });
    delete D.gap.pos[String(subjectNo(subj))];
    D.gap.updatedAt = new Date().toISOString();
    save();
    gapUi.idx = 0;
    toast("틈새문제 기록을 초기화했습니다.");
    renderGap();
  }

  function renderGapHome() {
    if (!GAP.length) {
      app.innerHTML = '<div class="card empty" style="margin-top:26px">' + (SERVER.gapError ? "틈새문제를 불러오지 못했습니다. 새로고침해 주세요." : '<span class="spinner"></span> 틈새문제 300제를 불러오는 중…') + '</div>';
      return;
    }
    var cards = SUBJECTS.map(function (s) {
      var st = gapStats(s.name);
      var p = st.total ? pct(st.done, st.total) : 0;
      return '<div class="card examcard gapcard">' +
        '<div class="row between"><h3>' + s.name + '</h3><div class="row" style="gap:6px">' +
        (gapIsShuffled(s.name) ? '<button class="pill warn gapshuf" data-gap-shuffle="' + esc(s.name) + '" title="누르면 원래 단원 순서로 돌아갑니다">🔀 무작위 ON</button>' : '') +
        '<span class="pill">' + st.total + '문제</span></div></div>' +
        '<div class="gapprog"><div class="bar"><i style="width:' + p + '%"></i></div>' +
        '<div class="row between"><span class="small">' + st.done + ' / ' + st.total + '</span>' +
        '<span class="small ' + (st.done >= 60 ? "ok" : "muted") + '">' + (st.done ? "정답률 " + st.rate + "%" : "아직 시작 전") + '</span></div></div>' +
        '<div class="row" style="gap:8px">' +
        '<button class="btn primary grow" data-gap-open="' + esc(s.name) + '" data-gap-idx="' + gapNextIndex(s.name) + '">' + (st.done ? "이어 풀기" : "시작하기") + '</button>' +
        '<button class="btn small" data-gap-open="' + esc(s.name) + '" data-gap-idx="0">처음부터</button>' +
        '</div></div>';
    }).join("");

    var total = gapStatsAll();
    app.innerHTML = '' +
      '<div class="section-title"><h2>틈새문제</h2><span class="small muted">시험 전 가볍게 · 문제마다 바로 해설</span></div>' +
      '<div class="card" style="padding:16px;margin-bottom:14px">' +
      '<div class="row between wrapflex"><div><b>1·2·3과목 기출 변형 300제</b>' +
      '<div class="small muted">120분 타이머 없이 한 문제씩. 틀린 문제는 오답노트와 AI 약점 공략에 그대로 쌓입니다.</div></div>' +
      '<div class="row" style="gap:12px"><div class="stat" style="padding:10px 14px"><b>' + total.done + '</b><span>/ ' + total.total + ' 풀이</span></div>' +
      '<div class="stat" style="padding:10px 14px"><b>' + (total.done ? total.rate + "%" : "-") + '</b><span>정답률</span></div></div></div></div>' +
      '<div class="examgrid">' + cards + '</div>' +
      '<div class="section-title"><h2>이어서 볼까요</h2></div>' +
      '<div class="quickgrid">' +
      (D.gap.last ? '<button class="card quick" data-gap-last="1"><span class="ic">⏳</span><span><b>마지막으로 본 과목</b><span>' + esc(D.gap.last) + ' · 이어 풀기</span></span></button>' : '') +
      '<button class="card quick" data-go="wrong"><span class="ic">📕</span><span><b>오답노트</b><span>틈새문제 포함 ' + Object.keys(D.wrong).length + '개</span></span></button>' +
      '<button class="card quick" data-go="home"><span class="ic">📝</span><span><b>실전 모의고사</b><span>1~4회 400문항 · 120분</span></span></button>' +
      '</div>';

    app.querySelectorAll("[data-gap-open]").forEach(function (b) {
      b.addEventListener("click", function () { gapOpen(b.dataset.gapOpen, parseInt(b.dataset.gapIdx, 10)); });
    });
    app.querySelectorAll("[data-gap-shuffle]").forEach(function (b) {
      b.addEventListener("click", function () { gapShuffle(b.dataset.gapShuffle); });
    });
    app.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () { setView(b.dataset.go); });
    });
    var last = app.querySelector("[data-gap-last]");
    if (last) last.addEventListener("click", function () { gapOpen(D.gap.last, gapNextIndex(D.gap.last)); });
  }

  function gapStatsAll() {
    var done = 0, right = 0, total = 0;
    SUBJECTS.forEach(function (s) {
      var st = gapStats(s.name);
      done += st.done; right += st.right; total += st.total;
    });
    return { total: total || 300, done: done, right: right, rate: done ? Math.round((right / done) * 100) : 0 };
  }

  function renderGap() {
    if (!GAP.length) { renderGapHome(); return; }
    if (!gapUi.subject) { renderGapHome(); return; }
    var qs = gapList(gapUi.subject);
    if (!qs.length) { renderGapHome(); return; }
    if (gapUi.idx >= qs.length) gapUi.idx = qs.length - 1;
    var shuffled = gapIsShuffled(gapUi.subject);
    var q = qs[gapUi.idx];
    var picked = D.gap.ans[q.id];
    var revealed = !!picked;
    var st = gapStats(gapUi.subject);

    var opts = q.options.map(function (o, i) {
      var n = i + 1, cls = "opt";
      if (revealed) {
        if (n === q.answer) cls += " correct";
        else if (n === picked) cls += " wrong";
      }
      return '<button class="' + cls + '" data-gopt="' + n + '"><span class="num">' + n + '</span><span>' + safeHtml(o) + '</span></button>';
    }).join("");

    var cells = qs.map(function (x, i) {
      var p = D.gap.ans[x.id], cls = "cell";
      if (p) cls += (p === x.answer ? " right" : " wrong");
      if (i === gapUi.idx) cls += " current";
      return '<button class="' + cls + '" data-gjump="' + i + '">' + (i + 1) + '</button>';
    }).join("");

    var explain = picked
      ? '<div class="explain"><span class="tag">정답 ' + q.answer + '번 · ' + esc(unitLabel(q)) + '</span>' +
        '<div>' + safeHtml(q.explanation) + '</div>' +
        (picked !== q.answer
          ? '<div class="small" style="margin-top:8px;color:var(--bad)">내 답 ' + picked + '번 — 오답노트에 담았습니다.</div>'
          : '<div class="small" style="margin-top:8px;color:var(--ok)">정답입니다.</div>') +
        '</div>'
      : '<div class="gap-hint small muted">선지를 고르면 정답과 해설이 바로 나옵니다. 틀려도 부담 없이 넘어가세요.</div>';

    app.innerHTML = '' +
      '<div class="exam-top">' +
      '<div class="row wrapflex"><button class="btn small" id="gapBack">← 과목 선택</button>' +
      '<span class="pill">' + esc(subjectShort(gapUi.subject)) + '</span>' +
      '<span class="small muted" id="gapProg">' + st.done + '/' + st.total + ' 풀이 · 정답률 ' + (st.done ? st.rate + '%' : '-') + '</span></div>' +
      '<div class="row gapbtns">' +
      '<button class="btn small' + (shuffled ? ' primary' : '') + '" id="gapShuffleBtn" aria-pressed="' + (shuffled ? 'true' : 'false') + '" title="누를 때마다 무작위 순서 ↔ 원래 단원 순서">🔀 무작위' + (shuffled ? ' ON' : '') + '</button>' +
      '<button class="btn small" id="gapJumpBtn">번호 점프</button>' +
      '<button class="btn small ghost" id="gapResetBtn" style="color:var(--bad)">기록 초기화</button></div>' +
      '</div>' +
      '<div class="gaplayout">' +
      '<div class="card qcard">' +
      '<div class="qhead"><div class="qno"><span class="badge">' + (gapUi.idx + 1) + '</span>' +
      '<span class="small dim">' + esc(unitLabel(q)) + '</span>' +
      '<span class="pill">틈새</span><span class="tiny muted">' + (st.done ? '정답률 ' + st.rate + '%' : '') + '</span></div>' +
      (D.bookmarks[q.id] ? '<span class="pill warn">북마크</span>' : '') + '</div>' +
      '<div class="stem">' + safeHtml(q.stem) + '</div>' +
      '<div class="options">' + opts + '</div>' +
      explain +
      '<div class="qfoot"><div class="navbtns">' +
      '<button class="btn small" id="gapPrev"' + (gapUi.idx === 0 ? " disabled" : "") + '>← 이전</button>' +
      '<button class="btn small" id="gapNext"' + (gapUi.idx === qs.length - 1 ? " disabled" : "") + '>다음 →</button>' +
      '</div><span class="tiny muted">' + (gapUi.idx + 1) + ' / ' + qs.length + '</span></div>' +
      '</div>' +
      '<aside class="card omr gapjump' + (gapUi.showJump ? " open" : "") + '" id="gapJumpPanel"><div class="omr-drag"></div><h4>번호 점프</h4>' +
      '<div class="grid">' + cells + '</div>' +
      '<div class="stats"><span>풀이 <b>' + st.done + '</b></span><span>정답 <b>' + st.right + '</b></span><span>오답 <b>' + st.wrong + '</b></span></div></aside>' +
      '</div>';

    app.querySelectorAll("[data-gopt]").forEach(function (b) {
      b.addEventListener("click", function () { gapPick(parseInt(b.dataset.gopt, 10)); });
    });
    app.querySelectorAll("[data-gjump]").forEach(function (b) {
      b.addEventListener("click", function () {
        gapUi.idx = parseInt(b.dataset.gjump, 10);
        D.gap.pos[String(subjectNo(gapUi.subject))] = gapUi.idx;
        gapUi.showJump = false;
        save(); renderGap();
      });
    });
    $("#gapBack").addEventListener("click", function () { gapUi.subject = null; renderGapHome(); });
    $("#gapPrev").addEventListener("click", function () { gapGo(-1); });
    $("#gapNext").addEventListener("click", function () { gapGo(1); });
    $("#gapJumpBtn").addEventListener("click", function () {
      gapUi.showJump = !gapUi.showJump;
      var p = $("#gapJumpPanel"); if (p) p.classList.toggle("open", gapUi.showJump);
    });
    $("#gapShuffleBtn").addEventListener("click", function () { gapShuffle(gapUi.subject); });
    $("#gapResetBtn").addEventListener("click", gapReset);
  }

  /* ---------------- 설정 ---------------- */
  function renderSettings() {
    app.innerHTML = '' +
      '<div class="section-title"><h2>설정</h2></div>' +
      '<div class="card" style="padding:18px">' +
      '<div class="switchrow"><div><b class="small">즉시 채점</b><div class="tiny muted">문항을 고르면 바로 정답·해설을 보여 줍니다. (기본은 시험 종료 후 채점)</div></div>' +
      '<label class="switch"><input type="checkbox" id="immediate"' + (D.settings.immediate ? " checked" : "") + '><i></i></label></div>' +
      '<div class="switchrow"><div><b class="small">영역 표시</b><div class="tiny muted">문항마다 세부 영역(법규·펀드평가 등)을 표시합니다.</div></div>' +
      '<label class="switch"><input type="checkbox" id="showUnit"' + (D.settings.showUnit ? " checked" : "") + '><i></i></label></div>' +
      '</div>' +
      '<div class="section-title"><h2>AI 연결</h2></div>' +
      '<div class="card" style="padding:18px">' +
      '<div class="row between wrapflex" style="margin-bottom:10px"><b class="small">서버 Gemini 키</b>' +
      '<span class="pill ' + (SERVER.hasServerKey ? "ok" : "warn") + '">' + (SERVER.hasServerKey ? "연결됨" : "없음") + '</span></div>' +
      '<p class="tiny muted">서버에 키가 설정되어 있으면 입력 없이 바로 AI 문제가 생성됩니다. 키 값은 화면에 표시되지 않습니다.</p>' +
      '<div class="field" style="margin-top:14px"><label>내 Gemini API 키 (선택 · 이 브라우저에만 저장)</label>' +
      '<input class="input" id="gkey" type="password" placeholder="AIza... 또는 AQ..." value="' + esc(D.settings.geminiKey || "") + '" autocomplete="off" />' +
      '<div class="row" style="gap:8px"><button class="btn small" id="saveKey">저장</button>' +
      '<button class="btn small ghost" id="testKey">연결 테스트</button><span class="tiny muted" id="keyMsg"></span></div></div>' +
      '</div>' +
      '<div class="section-title"><h2>학습 기록</h2></div>' +
      '<div class="card" style="padding:18px">' +
      '<div class="small dim">응시 ' + D.attempts.length + '회 · 오답 ' + Object.keys(D.wrong).length + '문항 · 북마크 ' + Object.keys(D.bookmarks).length + '문항 · AI 문제 ' + (D.ai.solved || 0) + '개 풀이 · 틈새문제 ' + gapStatsAll().done + '/' + gapStatsAll().total + ' 풀이</div>' +
      '<p class="tiny muted" style="margin:8px 0 12px">기록은 이 브라우저(fundExam.v1)에만 저장됩니다. 서버로 전송되지 않습니다.</p>' +
      '<div class="row wrapflex" style="gap:8px"><button class="btn small" id="exportBtn">기록 내보내기</button>' +
      '<button class="btn small" id="importBtn">가져오기</button>' +
      '<button class="btn small ghost" id="gapResetAll" style="color:var(--bad)">틈새문제만 초기화</button>' +
      '<button class="btn small ghost" id="resetBtn" style="color:var(--bad)">기록 초기화</button></div>' +
      '<input type="file" id="importFile" accept="application/json" class="hide" />' +
      '</div>' +
      '<p class="tiny muted" style="margin-top:18px;text-align:center">펀드 모의고사 v1.1.2 · 모의고사 ' + (QS.length || 400) + '문항 + 틈새문제 ' + (GAP.length || 300) + '문항 · 펀드투자권유자문인력 100문항/120분 기준</p>';

    $("#immediate").addEventListener("change", function (e) { D.settings.immediate = e.target.checked; save(); toast("즉시 채점 " + (e.target.checked ? "켜짐" : "꺼짐")); });
    $("#showUnit").addEventListener("change", function (e) { D.settings.showUnit = e.target.checked; save(); });
    $("#saveKey").addEventListener("click", function () {
      D.settings.geminiKey = $("#gkey").value.trim(); save();
      toast(D.settings.geminiKey ? "키를 이 브라우저에 저장했습니다." : "키를 지웠습니다.");
    });
    $("#testKey").addEventListener("click", function () {
      var k = $("#gkey").value.trim();
      $("#keyMsg").textContent = "확인 중…";
      fetch("/api/ai/check", { headers: k ? { "X-Gemini-Key": k } : {} })
        .then(function (r) { return r.json(); })
        .then(function (d) { $("#keyMsg").textContent = d.ok ? "정상 동작합니다." : "키를 확인해 주세요."; })
        .catch(function () { $("#keyMsg").textContent = "서버에 연결하지 못했습니다."; });
    });
    $("#exportBtn").addEventListener("click", function () {
      var blob = new Blob([JSON.stringify(D, null, 1)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "fundExam-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    });
    $("#importBtn").addEventListener("click", function () { $("#importFile").click(); });
    $("#importFile").addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          D = normalize(JSON.parse(reader.result));
          save(); toast("기록을 가져왔습니다."); setView("settings");
        } catch (err) { toast("파일을 읽을 수 없습니다."); }
      };
      reader.readAsText(f);
    });
    $("#gapResetAll").addEventListener("click", function () {
      var st = gapStatsAll();
      if (!confirm("틈새문제 풀이 기록(" + st.done + "문항)을 초기화할까요? 오답노트의 틈새문제 기록도 함께 지워집니다.")) return;
      GAP.forEach(function (q) { delete D.gap.ans[q.id]; if (D.wrong[q.id]) delete D.wrong[q.id]; });
      D.gap.pos = {}; D.gap.updatedAt = new Date().toISOString();
      save(); toast("틈새문제 기록을 초기화했습니다."); setView("settings");
    });
    $("#resetBtn").addEventListener("click", function () {
      if (!confirm("응시 기록·오답노트·북마크를 모두 지울까요? 되돌릴 수 없습니다.")) return;
      D = defaultStore(); save(); toast("기록을 초기화했습니다."); setView("home");
    });
  }

  /* ---------------- 렌더 ---------------- */
  function render() {
    if (!QS.length) { app.innerHTML = '<div class="card empty" style="margin-top:26px"><span class="spinner"></span> 문제은행을 불러오는 중…</div>'; return; }
    if (view === "exam") { renderExam(); return; }
    if (view === "result") { renderResult(); return; }
    if (view === "review") { renderReview(); return; }
    if (view === "wrong") { renderWrong(); return; }
    if (view === "gap") { renderGap(); return; }
    if (view === "settings") { renderSettings(); return; }
    renderHome();
  }

  window.addEventListener("keydown", function (e) {
    if (view !== "exam" || !exam || exam.submitted) return;
    if (e.target && /input|textarea/i.test(e.target.tagName)) return;
    if (e.key === "ArrowLeft") { if (exam.idx > 0) { exam.idx--; persistActive(); renderExam(); } }
    if (e.key === "ArrowRight") { var qs = examQuestions(); if (exam.idx < qs.length - 1) { exam.idx++; persistActive(); renderExam(); } }
    if (/^[1-4]$/.test(e.key)) { pickOption(parseInt(e.key, 10)); }
  });

  /* ---------------- 시작 ---------------- */
  checkHealth().then(function () {
    loadQuestions().then(function () {
      if (D.active && resumeExam()) return;
      render();
    });
    loadGapQuestions();
  });
})();
