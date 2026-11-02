// 友達のステージファイルを開く画面まわり（ボタン・ドラッグ&ドロップ）
window.DK = window.DK || {};

(function () {
  function $(id) { return document.getElementById(id); }

  function msg(text, bad) {
    var el = $("play-msg");
    el.textContent = text;
    el.style.color = bad ? "#f4a261" : "";
  }

  function openText(text, name) {
    var r = DK.importStageText(text);
    if (!r.ok) { DK.showScreen("play"); msg("⚠ 開けなかったよ：" + r.error, true); return; }
    var d = r.data, ac = r.authorClear;
    DK.playStage(d, null, {
      note: function (info) {
        return ac ? "作者のタイム " + DK.formatTime(ac.time) + "　あなたは " + DK.formatTime(info.time) : "";
      }
    });
    msg("「" + (d.title || name || "ステージ") + "」" + (d.author ? "（" + d.author + " さん作）" : "") +
      (r.newParts ? "　部品を " + r.newParts + " 個、あなたの部品に追加したよ。" : "") +
      (ac ? "　作者のクリアタイムは " + DK.formatTime(ac.time) + "。" : "") +
      (d.timeLimit ? "　制限時間は " + d.timeLimit + "秒！" : ""));
  }

  function openFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { openText(String(reader.result), file.name.replace(/\.dotkoubou\.json$|\.json$/i, "")); };
    reader.onerror = function () { DK.showScreen("play"); msg("⚠ ファイルを読めなかったよ。", true); };
    reader.readAsText(file);
  }

  function init() {
    [["play-sample1", DK.tutorialStage], ["play-sample2", DK.sampleStage], ["play-sample3", DK.towerStage]].forEach(function (pair) {
      $(pair[0]).addEventListener("click", function () {
        var s = pair[1]();
        DK.playStage({ title: s.title, h: s.h, start: s.start, cells: s.cells, timeLimit: s.timeLimit });
        msg("見本ステージ「" + s.title + "」");
      });
    });
    $("play-open").addEventListener("click", function () { $("play-file").click(); });
    $("play-file").addEventListener("change", function () { openFile(this.files[0]); this.value = ""; });

    // どの画面でも、ファイルをウィンドウに落とすと開く
    window.addEventListener("dragover", function (e) {
      if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) e.preventDefault();
    });
    window.addEventListener("drop", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
      e.preventDefault();
      openFile(e.dataTransfer.files[0]);
    });
  }

  DK.shareUI = { openText: openText };
  window.addEventListener("DOMContentLoaded", init);
})();
