// プレイ中の TAB メニュー：つづける / あきらめる（スタートにもどる）/ もどる（来た画面へ）
// プレイ画面には余計なものを出さず、必要なときだけ TAB で出す。ひとりで遊ぶときはゲームを止める。
// みんなで遊ぶとき（ひろば・対戦）は、ほかの人の時間は止まらないので止めない（操作だけ受け付けない）。
window.DK = window.DK || {};

(function () {
  function $(id) { return document.getElementById(id); }
  DK.menuOpen = false;     // メニューが開いている（ゲームの操作を受け付けない）
  DK.menuPause = false;    // ゲームの進行を止める

  var LEAVE = {
    select: { text: "ステージ選択に戻る", go: function () { DK.showScreen("select"); } },
    stage:  { text: "ステージエディタに戻る", go: function () { DK.showScreen("stage"); } },
    multi:  { text: "ロビーにもどる", go: function () { $("play-lobby").click(); } }
  };

  function buttons() { return [$("pm-resume"), $("pm-giveup"), $("pm-leave")].filter(function (b) { return !b.hidden && !b.disabled; }); }

  DK.openPlayMenu = function () {
    var leave = LEAVE[DK.playFrom] || LEAVE.select;
    // 対戦中は途中で抜けられない（ひろばなら、ロビーにもどる）
    var inMatch = DK.playFrom === "multi" && $("play-lobby").hidden;
    $("pm-leave-text").textContent = leave.text;
    $("pm-leave").hidden = inMatch;
    $("pm-giveup").disabled = !!(DK.noRestart && DK.mode === "clear");    // 対戦でゴールしたあとはやり直せない
    DK.keys = {};
    DK.menuOpen = true;
    DK.menuPause = DK.playFrom !== "multi";
    $("play-menu").hidden = false;
    $("pm-resume").focus();
    if (DK.sound) DK.sound.play("pick");
  };

  DK.closePlayMenu = function () {
    if (!DK.menuOpen && $("play-menu").hidden) return;
    DK.menuOpen = false; DK.menuPause = false;
    $("play-menu").hidden = true;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };

  function toggle() { if (DK.menuOpen) DK.closePlayMenu(); else DK.openPlayMenu(); }

  function giveUp() {
    // R キーと同じ：遊び中なら失敗に数える。クリア後ならカウントを戻して最初から
    if (DK.mode === "clear") DK.deaths = 0; else if (DK.mode === "play") DK.deaths++;
    DK.respawn();
    DK.closePlayMenu();
  }

  window.addEventListener("DOMContentLoaded", function () {
    $("pm-resume").addEventListener("click", DK.closePlayMenu);
    $("pm-giveup").addEventListener("click", giveUp);
    $("pm-leave").addEventListener("click", function () { (LEAVE[DK.playFrom] || LEAVE.select).go(); });

    window.addEventListener("keydown", function (e) {
      if (!$("screen-play").classList.contains("active")) return;
      if (e.code === "Tab") { e.preventDefault(); if (!e.repeat) toggle(); return; }       // TAB は画面のボタン移動に使わせない
      if (!DK.menuOpen) return;
      if (e.code === "ArrowDown" || e.code === "ArrowUp") {
        var bs = buttons(), i = bs.indexOf(document.activeElement);
        i = e.code === "ArrowDown" ? (i + 1) % bs.length : (i <= 0 ? bs.length - 1 : i - 1);
        bs[i].focus(); e.preventDefault();
      }
    });
  });
})();
