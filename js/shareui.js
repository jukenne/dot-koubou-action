// 友達のステージファイルを開く画面まわり（ボタン・ドラッグ&ドロップ）
window.DK = window.DK || {};

(function () {
  function $(id) { return document.getElementById(id); }

  // 結果の知らせは、遊び終わってステージ選択にもどったときに読めるよう、ステージ選択画面に置く（プレイ画面には何も出さない）
  function msg(text, bad) { if (DK.selectScreen) DK.selectScreen.message(text, bad); }

  function openText(text, name) {
    var r = DK.importStageText(text);
    if (!r.ok) { DK.showScreen("select"); msg("⚠ 開けなかったよ：" + r.error, true); return; }
    var d = r.data, ac = r.authorClear;
    DK.playStage(d, "select", {
      note: function (info) {
        return ac ? "作者のタイム " + DK.formatTime(ac.time) + "　あなたは " + DK.formatTime(info.time) : "";
      }
    });
    msg("さっき遊んだのは「" + (d.title || name || "ステージ") + "」" + (d.author ? "（" + d.author + " さん作）" : "") +
      (r.newParts ? "　部品を " + r.newParts + " 個、あなたの部品に追加したよ。" : "") +
      (ac ? "　作者のクリアタイムは " + DK.formatTime(ac.time) + "。" : "") +
      (d.timeLimit ? "　制限時間は " + d.timeLimit + "秒。" : ""));
  }

  function openFile(file) {
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () { openText(String(reader.result), file.name.replace(/\.dotkoubou\.json$|\.json$/i, "")); };
    reader.onerror = function () { DK.showScreen("select"); msg("⚠ ファイルを読めなかったよ。", true); };
    reader.readAsText(file);
  }

  function init() {
    $("sel-open").addEventListener("click", function () { $("sel-file").click(); });
    $("sel-file").addEventListener("change", function () { openFile(this.files[0]); this.value = ""; });

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
