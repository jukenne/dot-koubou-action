// ドット工房アクション：起動と画面切り替え
// ES Modules は file:// で動かないため、全体を window.DK にまとめる
window.DK = window.DK || {};

DK.config = {
  TILE: 16,          // 1マスのドット数
  SCALE: 3,          // 表示倍率
  SCREEN_W: 20,      // 1画面の横マス数
  SCREEN_H: 12,      // 1画面の縦マス数
  STAGE_W: 80,       // ステージの横マス数（4画面分）
  STAGE_H: 12,       // ステージの縦マス数の基本（高さの指定がない昔のステージはこれ）
  STAGE_HEIGHTS: [12, 24, 36, 48],   // 作り手が選べる縦マス数（1〜4画面分）
  FPS: 60,
  PALETTE: ["#1a1c2c", "#f4f4f4", "#e63946", "#f4a261", "#ffd166", "#52b788", "#4895ef", "#8d99ae"]
};

DK.screens = ["home", "select", "parts", "stage", "play", "multi"];

// 画面ごとの見出しと、「もどる」の行き先（ホームには「もどる」がない）
DK.screenInfo = {
  home:   { title: "メインメニュー", back: null },
  select: { title: "ステージをえらぶ", back: "home" },
  parts:  { title: "部品をつくる", back: "home" },
  stage:  { title: "ステージをつくる", back: "select" },
  multi:  { title: "みんなで あそぶ", back: "home" },
  play:   { title: "", back: null }
};

DK.showScreen = function (name) {
  if (DK.screens.indexOf(name) < 0) name = "home";
  if (name !== "play" && DK.closePlayMenu) DK.closePlayMenu();
  DK.screens.forEach(function (s) {
    document.getElementById("screen-" + s).classList.toggle("active", s === name);
  });
  var info = DK.screenInfo[name];
  document.body.dataset.screen = name;                       // CSS が画面ごとの見た目を切り替えるのに使う（プレイ中はヘッダーを消す）
  document.getElementById("screen-title").textContent = info.title;
  var back = document.getElementById("back-btn");
  back.hidden = !info.back;
  back.dataset.to = info.back || "";
  if (info.back) document.getElementById("back-label").textContent = DK.screenInfo[info.back].title.replace("ステージをえらぶ", "ステージ選択");
  window.scrollTo(0, 0);
};

DK.init = function () {
  document.getElementById("back-btn").addEventListener("click", function () { DK.showScreen(this.dataset.to); });
  document.querySelectorAll("[data-go]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (b.dataset.tab && DK.selectScreen) DK.selectScreen.setTab(b.dataset.tab);
      DK.showScreen(b.dataset.go);
    });
  });
  // メインメニューのキー操作（↑↓で選んで Enter）
  document.addEventListener("keydown", function (e) {
    if (document.body.dataset.screen !== "home" || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    var rows = Array.prototype.filter.call(document.querySelectorAll("#screen-home .menu-row"), function (r) { return !r.hidden; });
    var i = rows.indexOf(document.activeElement);
    i = e.key === "ArrowDown" ? (i + 1) % rows.length : (i <= 0 ? rows.length - 1 : i - 1);
    rows[i].focus(); e.preventDefault();
  });
  var hero = document.getElementById("home-hero");
  if (hero && DK.drawPixels && DK.playerFrames) {
    var hc = hero.getContext("2d"); hc.imageSmoothingEnabled = false;
    DK.drawPixels(hc, DK.playerFrames.idle, 0, 0, 4, false);
  }
  DK.showScreen("home");
};

window.addEventListener("DOMContentLoaded", DK.init);
