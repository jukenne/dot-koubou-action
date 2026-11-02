// ステージ選択画面：「チュートリアル」と「作ったステージ」のタブを切り替えて、ステージを選んで遊ぶ。
// 画面にはステージのカード（ミニ画像・なまえ・情報・ボタン）を並べる。
window.DK = window.DK || {};

(function () {
  var T = DK.config.TILE;
  var TAB_KEY = "dk.ui.selTab";
  var BEST_KEY = "dk.best.";       // チュートリアルのベスト記録（dk.best.<key>）
  var tab = "tutorial";

  function $(id) { return document.getElementById(id); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) {} return null; }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  // チュートリアルの3面。説明文はカードに出す
  var TUTORIALS = [
    { key: "tutorial", make: function () { return DK.tutorialStage(); }, desc: "走る・ジャンプ・穴・トゲだけのやさしい面。まずはここから。" },
    { key: "sample2",  make: function () { return DK.sampleStage(); },   desc: "動く足場・回転ノコギリなど、いろいろな部品を使った面。" },
    { key: "tower",    make: function () { return DK.towerStage(); },    desc: "木箱を押して踏み台にし、壁キックで縦穴を登る縦長の面。" }
  ];

  function getBest(key) { try { return JSON.parse(store(BEST_KEY + key) || "null"); } catch (e) { return null; } }
  function setBest(key, info) {
    var b = getBest(key);
    if (!b || info.time < b.time) store(BEST_KEY + key, JSON.stringify({ time: info.time, deaths: info.deaths }));
  }

  // ステージ全体を小さな絵にする（遊ぶ画面と同じ暗い背景で、部品の絵をそのまま縮小）
  function thumb(st) {
    var S = 0.25, w = DK.config.STAGE_W * T * S, h = st.h * T * S;
    var cv = el("canvas", "sel-thumb"); cv.width = w; cv.height = h;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#101224"; ctx.fillRect(0, 0, w, h);
    ctx.scale(S, S);
    st.cells.forEach(function (c) {
      var part = DK.parts[c.partId];
      if (part) ctx.drawImage(DK.partCanvas(part), c.x * T, c.y * T);
    });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    DK.drawPixels(ctx, DK.playerFrames.idle, Math.round(st.start.x * T * S), Math.round((st.start.y + 1) * T * S) - 4, 0.25, false);
    return cv;
  }

  function badge(text, cls) { return el("span", "badge" + (cls ? " " + cls : ""), text); }

  function info(st) {
    var box = el("div", "sel-info");
    box.appendChild(badge("高さ " + st.h / DK.config.SCREEN_H + "画面"));
    box.appendChild(badge("部品 " + st.cells.length));
    box.appendChild(badge(st.timeLimit ? "制限 " + st.timeLimit + "秒" : "制限なし"));
    return box;
  }

  function card(st, titleText, bodyText) {
    var c = el("article", "sel-card");
    c.appendChild(thumb(st));
    var side = el("div", "sel-side");
    side.appendChild(el("h3", "sel-title", titleText));
    if (bodyText) side.appendChild(el("p", "sel-desc", bodyText));
    side.appendChild(info(st));
    c.appendChild(side);
    c._side = side;
    return c;
  }

  function actions(c) { var a = el("div", "sel-actions"); c._side.appendChild(a); return a; }
  function btn(text, cls, fn) { var b = el("button", "btn " + cls, text); b.addEventListener("click", fn); return b; }

  function playData(st) { return { title: st.title, h: st.h, start: st.start, cells: st.cells, timeLimit: st.timeLimit }; }

  function renderTutorial(list) {
    TUTORIALS.forEach(function (t, i) {
      var st = t.make(), c = card(st, (i + 1) + ". " + st.title, t.desc), best = getBest(t.key);
      c._side.insertBefore(badge(best ? "クリア済み ✓ ベスト " + DK.formatTime(best.time) : "まだクリアしていない", best ? "ok" : ""), c._side.querySelector(".sel-info"));
      actions(c).appendChild(btn("▶ あそぶ", "play corner", function () {
        DK.playStage(playData(st), "select", { onClear: function (r) { setBest(t.key, r); } });
      }));
      list.appendChild(c);
    });
  }

  function renderMine(list) {
    var stages = DK.listStages();
    var add = el("button", "sel-new corner");
    add.appendChild(el("span", "plus", "＋"));
    add.appendChild(el("span", "", stages.length >= DK.STAGES_MAX ? "これ以上は作れないよ（" + DK.STAGES_MAX + "個まで）。いらないものを消してね" : "あたらしいステージをつくる"));
    add.disabled = stages.length >= DK.STAGES_MAX;
    add.addEventListener("click", function () { DK.stageEditor.open(null); DK.showScreen("stage"); });
    list.appendChild(add);

    stages.forEach(function (st) {
      var cleared = st.cleared && st.cleared.sig === DK.stageSignature(st);
      var c = card(st, st.title || "なまえなし", st.author ? st.author + " さん作" : "");
      c._side.insertBefore(badge(cleared ? "自分でクリア済み ✓ " + DK.formatTime(st.cleared.time) : "まだクリアしていない（共有するには自分でクリア）", cleared ? "ok" : ""), c._side.querySelector(".sel-info"));
      var a = actions(c);
      a.appendChild(btn("▶ あそぶ", "play corner", function () {
        var sig = DK.stageSignature(st);
        DK.playStage(playData(st), "select", { onClear: function (r) {      // ここでクリアしても作者クリアになる（同じ内容のまま）
          var prev = st.cleared && st.cleared.sig === sig ? st.cleared : null;
          if (!prev || r.time < prev.time) { st.cleared = { sig: sig, time: r.time, deaths: r.deaths }; DK.saveStageData(st); }
        } });
      }));
      a.appendChild(btn("✎ へんしゅう", "", function () { DK.stageEditor.open(st.id); DK.showScreen("stage"); }));
      a.appendChild(btn("けす", "danger", function () {
        if (!window.confirm("「" + (st.title || "なまえなし") + "」を消すよ。もとには戻せないけど、いい？")) return;
        DK.deleteStage(st.id); render();
      }));
      list.appendChild(c);
    });
    if (!stages.length) list.appendChild(el("p", "hint", "まだステージがないよ。「あたらしいステージをつくる」から始めよう。"));
  }

  function render() {
    document.querySelectorAll(".sel-tab").forEach(function (b) {
      var on = b.dataset.seltab === tab;
      b.classList.toggle("active", on); b.setAttribute("aria-selected", on ? "true" : "false");
    });
    $("sel-msg").hidden = !$("sel-msg").textContent;
    var list = $("sel-list"); list.textContent = "";
    if (tab === "mine") renderMine(list); else renderTutorial(list);
  }

  function setTab(name) {
    tab = name === "mine" ? "mine" : "tutorial";
    store(TAB_KEY, tab);
    if (document.body.dataset.screen === "select") render();
  }

  // 画面に出た・もどってきたときに作り直す（クリア記録・ステージの増減・部品の絵の変更を反映する）
  function init() {
    var saved = store(TAB_KEY);
    if (saved === "mine" || saved === "tutorial") tab = saved;
    document.querySelectorAll(".sel-tab").forEach(function (b) { b.addEventListener("click", function () { setTab(b.dataset.seltab); }); });
    new MutationObserver(function () { if ($("screen-select").classList.contains("active")) render(); })
      .observe($("screen-select"), { attributes: true, attributeFilter: ["class"] });
  }

  DK.selectScreen = { setTab: setTab, render: render, message: function (text, bad) { var m = $("sel-msg"); m.textContent = text; m.classList.toggle("bad", !!bad); m.hidden = !text; } };
  window.addEventListener("DOMContentLoaded", init);
})();
