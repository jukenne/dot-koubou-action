// ドット工房アクション：起動と画面切り替え
// ES Modules は file:// で動かないため、全体を window.DK にまとめる
window.DK = window.DK || {};

DK.config = {
  TILE: 16,          // 1マスのドット数
  SCALE: 3,          // 表示倍率
  SCREEN_W: 20,      // 1画面の横マス数
  SCREEN_H: 12,      // 1画面の縦マス数
  STAGE_W: 80,       // ステージの横マス数（4画面分）
  STAGE_H: 12,
  FPS: 60,
  PALETTE: ["#1a1c2c", "#f4f4f4", "#e63946", "#f4a261", "#ffd166", "#52b788", "#4895ef", "#8d99ae"]
};

DK.screens = ["home", "parts", "stage", "play"];

DK.showScreen = function (name) {
  if (DK.screens.indexOf(name) < 0) name = "home";
  DK.screens.forEach(function (s) {
    document.getElementById("screen-" + s).classList.toggle("active", s === name);
  });
  document.querySelectorAll("#tabs button").forEach(function (b) {
    b.classList.toggle("active", b.dataset.screen === name);
  });
};

DK.init = function () {
  document.querySelectorAll("#tabs button").forEach(function (b) {
    b.addEventListener("click", function () { DK.showScreen(b.dataset.screen); });
  });
  document.querySelectorAll("[data-go]").forEach(function (b) {
    b.addEventListener("click", function () { DK.showScreen(b.dataset.go); });
  });
  DK.showScreen("home");
};

window.addEventListener("DOMContentLoaded", DK.init);
