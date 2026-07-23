/* 汎用 確認アンケート レンダラ（案件非依存・フレームワーク不要）
 * manifest（survey.json）を読み、1問ずつ提示して回答をlocalStorageに保持。
 * 最後にGitHubのIssue新規作成画面へ全回答をprefillする（フロントにtokenを置かない）。
 * manifestは ?manifest=<url> で差し替え可能。既定は同ディレクトリの survey.json。
 */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const manifestUrl = params.get("manifest") || "survey.json";

  const state = { survey: null, index: 0, answers: {} }; // answers[id] = { key, note }
  let storageKey = "decision-survey";

  const load = () => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) state.answers = JSON.parse(raw) || {};
    } catch (_) { state.answers = {}; }
  };
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify(state.answers)); } catch (_) {}
  };

  const showError = (msg) => {
    for (const s of ["intro-screen", "q-screen", "done-screen"]) $(s).hidden = true;
    $("error").textContent = msg;
    $("error-screen").hidden = false;
  };

  const setProgress = () => {
    const total = state.survey.items.length;
    const answered = Object.keys(state.answers).filter(
      (id) => state.survey.items.some((it) => it.id === id),
    ).length;
    $("bar").style.width = `${Math.round((answered / total) * 100)}%`;
    $("count").textContent = `回答 ${answered} / ${total}`;
  };

  const screen = (name) => {
    for (const s of ["intro-screen", "q-screen", "done-screen", "error-screen"]) {
      $(s).hidden = s !== name;
    }
  };

  const renderQuestion = () => {
    const items = state.survey.items;
    if (state.index >= items.length) return renderDone();
    const it = items[state.index];
    $("prompt").textContent = it.prompt;
    if (it.context) { $("context").textContent = it.context; $("context").hidden = false; }
    else $("context").hidden = true;

    const box = $("options");
    box.innerHTML = "";
    const current = state.answers[it.id];
    it.options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "opt" + (current && current.key === opt.key ? " selected" : "");
      btn.innerHTML = "";
      const k = document.createElement("span");
      k.className = "opt-key";
      k.textContent = opt.key;
      const label = document.createElement("span");
      label.textContent = opt.label;
      btn.append(k, label);
      if (it.recommended && it.recommended === opt.key) {
        const tag = document.createElement("span");
        tag.className = "rec-tag";
        tag.textContent = "推奨";
        btn.append(tag);
      }
      btn.addEventListener("click", () => choose(it, opt.key));
      box.append(btn);
    });

    const noteWrap = $("note-wrap");
    if (it.allow_note) {
      noteWrap.hidden = false;
      $("note").value = (current && current.note) || "";
    } else noteWrap.hidden = true;

    $("back").disabled = state.index === 0;
    setProgress();
    screen("q-screen");
  };

  const captureNote = () => {
    const it = state.survey.items[state.index];
    if (!it || !it.allow_note) return;
    const note = $("note").value.trim();
    if (state.answers[it.id]) state.answers[it.id].note = note;
    else if (note) state.answers[it.id] = { key: "", note };
    save();
  };

  const choose = (it, key) => {
    const note = it.allow_note ? $("note").value.trim() : "";
    state.answers[it.id] = { key, note };
    save();
    state.index += 1;
    renderQuestion();
  };

  const renderDone = () => {
    const total = state.survey.items.length;
    const answered = state.survey.items.filter((it) => state.answers[it.id] && state.answers[it.id].key).length;
    $("done-summary").textContent = `回答済み ${answered} / ${total}。未回答は「未指定」として送信されます。`;
    setProgress();
    screen("done-screen");
  };

  const buildIssueUrl = () => {
    const s = state.survey;
    const lines = [];
    lines.push(`<!-- survey-answer:v1 id=${s.survey_id} -->`);
    lines.push("");
    lines.push(`## 確認アンケート回答: ${s.survey_id}`);
    const answered = s.items.filter((it) => state.answers[it.id] && state.answers[it.id].key).length;
    lines.push(`回答 ${answered} / ${s.items.length}`);
    lines.push("");
    for (const it of s.items) {
      const a = state.answers[it.id];
      const key = a && a.key ? a.key : "-";
      const opt = it.options.find((o) => o.key === key);
      const label = opt ? opt.label : "（未指定）";
      let line = `- ${it.id} => ${key} | ${label}`;
      if (a && a.note) line += ` | 補足: ${a.note.replace(/\n/g, " ")}`;
      lines.push(line);
    }
    lines.push("");
    lines.push("> 内容を確認して「Submit new issue」を押してください。反映はAIが別PRで行います。");
    const body = lines.join("\n");

    const ans = s.answer || {};
    const prefix = ans.issue_title_prefix || "[調査回答]";
    const labels = (ans.labels && ans.labels.length ? ans.labels : ["survey-answer"]).join(",");
    const q = new URLSearchParams({
      title: `${prefix} ${s.survey_id}`,
      labels,
      body,
    });
    return { url: `https://github.com/${ans.repo}/issues/new?${q.toString()}`, length: body.length };
  };

  const wire = () => {
    $("start").addEventListener("click", () => { state.index = firstUnanswered(); renderQuestion(); });
    $("back").addEventListener("click", () => {
      captureNote();
      if (state.index > 0) { state.index -= 1; renderQuestion(); }
    });
    $("skip").addEventListener("click", () => {
      captureNote();
      state.index += 1; renderQuestion();
    });
    $("submit").addEventListener("click", () => {
      const { url } = buildIssueUrl();
      window.open(url, "_blank", "noopener");
    });
    $("review").addEventListener("click", () => { state.index = 0; renderQuestion(); });
    $("reset").addEventListener("click", () => {
      if (!confirm("この端末の回答を消して最初からやり直しますか？")) return;
      state.answers = {}; save(); state.index = 0; renderQuestion();
    });
  };

  const firstUnanswered = () => {
    const i = state.survey.items.findIndex((it) => !(state.answers[it.id] && state.answers[it.id].key));
    return i < 0 ? state.survey.items.length : i;
  };

  const validate = (s) => {
    if (!s || typeof s !== "object") return "manifestが読めません";
    if (!s.survey_id || !Array.isArray(s.items) || !s.items.length) return "survey_id / items が不正です";
    if (!s.answer || !s.answer.repo) return "answer.repo が未指定です";
    for (const it of s.items) {
      if (!it.id || !it.prompt || !Array.isArray(it.options) || it.options.length < 2) {
        return `設問が不正です: ${it && it.id}`;
      }
    }
    return null;
  };

  fetch(manifestUrl, { cache: "no-store" })
    .then((r) => { if (!r.ok) throw new Error(`manifest取得失敗 (${r.status})`); return r.json(); })
    .then((s) => {
      const err = validate(s);
      if (err) return showError(err);
      state.survey = s;
      storageKey = `decision-survey:${s.survey_id}`;
      load();
      $("title").textContent = s.title || "確認アンケート";
      document.title = s.title || "確認アンケート";
      wire();
      if (s.intro) { $("intro").textContent = s.intro; }
      const startIndex = firstUnanswered();
      setProgress();
      if (Object.keys(state.answers).length === 0 && s.intro) screen("intro-screen");
      else { state.index = startIndex; renderQuestion(); }
    })
    .catch((e) => showError(`読み込みエラー: ${e.message}\nmanifest: ${manifestUrl}`));
})();
