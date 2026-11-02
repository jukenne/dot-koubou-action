// ステージエディタ：マス目に部品を置く・消す・スタート位置を決める・すぐテストプレイする・自動保存する
//
// 置くとき、重なる部品は置き換わる（後から置いたものが勝つ）。
// 大きい部品は、カーソルのマスを左上にして、占めるマスぜんぶに置かれる。ステージからはみ出す置き方はできない。
window.DK = window.DK || {};

(function () {
  var T = DK.config.TILE, W = DK.config.STAGE_W;
  var ES = 2;                 // エディタでの表示倍率（ゲーム本編は3倍。全体を見渡せるよう小さめ）
  var EFFECT_NAME = { solid: "足場", deadly: "即死", goal: "ゴール", push: "押せる" };

  function $(id) { return document.getElementById(id); }
  function active() { return $("screen-stage").classList.contains("active"); }

  var cur = null;             // 編集中のステージ { title, start, cells }
  var tool = "place";         // "place" | "erase" | "start"
  var selId = "grass";        // 選んでいる部品
  var hover = null;           // マウスが乗っているマス
  var stroke = null;          // ドラッグ中 { erase, last, changed }
  var history = [], redoStack = [];
  var saveTimer = null;
  var palRefs = {};

  // ---- 変更の記録・保存 ----
  function snapshot() { return JSON.stringify({ h: cur.h, start: cur.start, cells: cur.cells }); }
  function restore(json) { var d = JSON.parse(json); cur.h = d.h; cur.start = d.start; cur.cells = d.cells; syncHeight(); }

  function pushHistory() {
    history.push(snapshot());
    if (history.length > 60) history.shift();
    redoStack = [];
    updateUndo();
  }
  function undo() {
    if (!history.length) return;
    redoStack.push(snapshot()); restore(history.pop()); changed(true);
  }
  function redo() {
    if (!redoStack.length) return;
    history.push(snapshot()); restore(redoStack.pop()); changed(true);
  }
  function updateUndo() { $("st-undo").disabled = !history.length; $("st-redo").disabled = !redoStack.length; }

  function scheduleSave() {
    $("st-save").textContent = "保存中…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      $("st-save").textContent = DK.saveStageData(cur) ? "保存しました ✓" : "⚠ このブラウザでは保存できません";
    }, 300);
  }

  function changed(skipHistory) {
    updateUndo(); draw(); renderStatus(); scheduleSave();
  }

  // ---- 部品の調べもの ----
  function hasEffect(part, effect, depth) {
    if (depth > DK.MAX_DEPTH + 1) return false;
    if (part.effect === effect && part.pixels.some(function (v) { return v > 0; })) return true;
    return part.children.some(function (c) { return DK.parts[c.partId] && hasEffect(DK.parts[c.partId], effect, (depth || 0) + 1); });
  }

  // いまのステージが「作者がクリア済み」か（クリアしたあとに何も変えていないか）
  function isCleared() { return !!cur.cleared && cur.cleared.sig === DK.stageSignature(cur); }

  function renderStatus() {
    var goals = 0;
    cur.cells.forEach(function (c) { if (hasEffect(DK.parts[c.partId], "goal", 0)) goals++; });
    var el = $("st-status");
    el.textContent = goals
      ? "部品 " + cur.cells.length + " 個。ゴールあり ✓　「▶ テストプレイ」で遊んで確かめよう。"
      : "部品 " + cur.cells.length + " 個。⚠ ゴールがまだないよ。「ゴールの旗」を置こう（ゴールがないとクリアできない）。";
    el.style.borderLeftColor = goals ? "" : "#f4a261";

    var ok = isCleared();
    renderLimit();
    $("st-export").disabled = !ok;
    $("st-share-note").textContent = ok
      ? "✓ 自分でクリアできたよ（タイム " + DK.formatTime(cur.cleared.time) + "）。共有ファイルを書き出せる。"
      : (cur.cleared
        ? "ステージか部品を変えたので、もう一度テストプレイでクリアすると共有できるよ。"
        : "共有するには、まず自分で「▶ テストプレイ」してゴールまでクリアしてね（クリアできないステージを渡さないため）。");
  }

  // ---- 時間制限 ----
  function renderLimit() {
    var on = cur.timeLimit > 0;
    $("st-limit-on").checked = on;
    $("st-limit").disabled = !on;
    if (on && document.activeElement !== $("st-limit")) $("st-limit").value = cur.timeLimit;
    var note = "";
    if (!on) note = "付けると、時間が終わったときにミスになるよ。";
    else if (cur.cleared && cur.cleared.sig === DK.stageSignature(cur)) {
      var t = cur.cleared.time / DK.config.FPS;
      note = "自分のクリアタイムは " + t.toFixed(2) + "秒。友達には余裕を持たせて、" + Math.ceil(t * 1.5) + "秒くらいが目安だよ。";
    } else note = DK.TIME_LIMIT_MIN + "〜" + DK.TIME_LIMIT_MAX + "秒の間で決めてね。テストプレイでクリアできる時間にしよう。";
    $("st-limit-note").textContent = note;
  }
  function setLimit(v) {
    var n = DK.sanitizeTimeLimit(v);
    if (n === cur.timeLimit) return;
    cur.timeLimit = n;
    renderStatus(); scheduleSave();
  }

  // ---- 描画 ----
  function draw() {
    var cv = $("st-canvas"), H = cur.h;
    if (cv.width !== W * T * ES || cv.height !== H * T * ES) { cv.width = W * T * ES; cv.height = H * T * ES; }
    var ctx = cv.getContext("2d"), x, y;
    ctx.setTransform(ES, 0, 0, ES, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#101224";
    ctx.fillRect(0, 0, W * T, H * T);
    // マス目（市松模様のごく薄い色）
    ctx.fillStyle = "rgba(255,255,255,0.035)";
    for (y = 0; y < H; y++) for (x = 0; x < W; x++) if ((x + y) % 2) ctx.fillRect(x * T, y * T, T, T);

    cur.cells.forEach(function (c) {
      var part = DK.parts[c.partId];
      if (!part) return;
      ctx.save();
      ctx.translate(c.x * T, c.y * T);
      DK.drawPartTree(ctx, part, 0);   // 動く部品も、ここでは止めた姿で見せる
      ctx.restore();
    });

    // 1画面（20マス）の区切り
    ctx.lineWidth = 1 / ES;
    ctx.strokeStyle = "rgba(72,149,239,0.7)";
    ctx.beginPath();
    for (x = DK.config.SCREEN_W; x < W; x += DK.config.SCREEN_W) { ctx.moveTo(x * T, 0); ctx.lineTo(x * T, H * T); }
    for (y = DK.config.SCREEN_H; y < H; y += DK.config.SCREEN_H) { ctx.moveTo(0, y * T); ctx.lineTo(W * T, y * T); }
    ctx.stroke();
    // マスの線
    ctx.strokeStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    for (x = 1; x < W; x++) { ctx.moveTo(x * T, 0); ctx.lineTo(x * T, H * T); }
    for (y = 1; y < H; y++) { ctx.moveTo(0, y * T); ctx.lineTo(W * T, y * T); }
    ctx.stroke();

    // スタート位置：キャラの絵と枠
    var s = cur.start;
    DK.drawPixels(ctx, DK.playerFrames.idle, s.x * T, (s.y + 1) * T - T, 1, false);
    ctx.strokeStyle = "#ffd166"; ctx.lineWidth = 2 / ES;
    ctx.strokeRect(s.x * T + 0.5, s.y * T + 0.5, T - 1, T - 1);
    ctx.fillStyle = "#ffd166"; ctx.font = "8px DotGothic16, sans-serif";   // 8px × 倍率2 = 16px でくっきり ctx.textAlign = "left";
    ctx.fillText("START", s.x * T + 1, s.y * T - 2);

    // 置く前のプレビュー（ゴースト）
    if (hover && !stroke) {
      if (tool === "place" && DK.parts[selId]) {
        var part = DK.parts[selId], ok = DK.fitsStage(part, hover.x, hover.y, cur.h), t = DK.tilesOf(part);
        ctx.save();
        ctx.globalAlpha = ok ? 0.6 : 0.3;
        ctx.translate(hover.x * T, hover.y * T);
        DK.drawPartTree(ctx, part, 0);
        ctx.restore();
        ctx.strokeStyle = ok ? "#ffffff" : "#e63946"; ctx.lineWidth = 2 / ES;
        ctx.strokeRect(hover.x * T + 0.5, hover.y * T + 0.5, t.w * T - 1, t.h * T - 1);
      } else if (tool === "erase") {
        var i = DK.cellIndexAt(cur.cells, hover.x, hover.y);
        ctx.strokeStyle = "#e63946"; ctx.lineWidth = 2 / ES;
        if (i >= 0) {
          var c = cur.cells[i], tt = DK.tilesOf(DK.parts[c.partId]);
          ctx.strokeRect(c.x * T + 0.5, c.y * T + 0.5, tt.w * T - 1, tt.h * T - 1);
        } else ctx.strokeRect(hover.x * T + 0.5, hover.y * T + 0.5, T - 1, T - 1);
      } else if (tool === "start") {
        ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2 / ES;
        ctx.strokeRect(hover.x * T + 0.5, hover.y * T + 0.5, T - 1, T - 1);
      }
    }
  }

  function cellAt(e) {
    var H = cur.h, r = $("st-canvas").getBoundingClientRect();
    var x = Math.floor((e.clientX - r.left) / r.width * W), y = Math.floor((e.clientY - r.top) / r.height * H);
    return x >= 0 && x < W && y >= 0 && y < H ? { x: x, y: y } : null;
  }

  // ---- 置く・消す ----
  function putAt(c) {
    var part = DK.parts[selId];
    if (!part || !DK.fitsStage(part, c.x, c.y, cur.h)) return false;
    var before = cur.cells;
    var same = before.some(function (o) { return o.x === c.x && o.y === c.y && o.partId === selId; });
    if (same) return false;                       // 同じものが同じ場所にあるなら何もしない
    cur.cells = DK.placeCell(before, { x: c.x, y: c.y, partId: selId });
    return true;
  }
  function eraseAt(c) {
    var i = DK.cellIndexAt(cur.cells, c.x, c.y);
    if (i < 0) return false;
    cur.cells = cur.cells.slice(0, i).concat(cur.cells.slice(i + 1));
    return true;
  }

  function bindCanvas() {
    var cv = $("st-canvas");
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      var c = cellAt(e);
      if (!c) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      var erase = e.button === 2 || tool === "erase";
      if (tool === "start" && e.button === 0) {
        if (cur.start.x === c.x && cur.start.y === c.y) return;
        pushHistory(); cur.start = { x: c.x, y: c.y }; changed();
        return;
      }
      pushHistory();
      stroke = { erase: erase, last: c, changed: false };
      if (erase ? eraseAt(c) : putAt(c)) { stroke.changed = true; DK.sound.play(erase ? "erase" : "place"); }
      changed();
    });
    cv.addEventListener("pointermove", function (e) {
      var c = cellAt(e);
      hover = c;
      if (stroke && c && (c.x !== stroke.last.x || c.y !== stroke.last.y)) {
        stroke.last = c;
        if (stroke.erase ? eraseAt(c) : putAt(c)) { stroke.changed = true; DK.sound.play(stroke.erase ? "erase" : "place"); changed(); return; }
      }
      draw();
    });
    cv.addEventListener("pointerleave", function () { if (!stroke) { hover = null; draw(); } });
    function end() {
      if (stroke && !stroke.changed) { history.pop(); updateUndo(); }   // 何も変わらなかった操作は履歴に残さない
      stroke = null;
    }
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
  }

  // ---- 部品パレット ----
  function paintThumb(cv, part, size) {
    cv.width = part.w; cv.height = part.h;
    var m = Math.max(part.w, part.h);
    cv.style.width = Math.round(part.w * size / m) + "px";
    cv.style.height = Math.round(part.h * size / m) + "px";
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, part.w, part.h);
    DK.drawPartTree(ctx, part, 0);
  }

  function renderPalette() {
    var box = $("st-palette");
    box.textContent = "";
    palRefs = {};
    var users = DK.partOrder.filter(function (id) { return !DK.parts[id].builtin; }).reverse();
    var builtins = DK.partOrder.filter(function (id) { return DK.parts[id].builtin; });
    users.concat(builtins).forEach(function (id) {
      var part = DK.parts[id];
      var b = document.createElement("button");
      b.className = "pe-item"; b.type = "button";
      var cv = document.createElement("canvas");
      paintThumb(cv, part, 40);
      var info = document.createElement("div");
      var nm = document.createElement("div"); nm.className = "nm"; nm.textContent = part.name;
      var tags = document.createElement("div");
      var e = document.createElement("span"); e.className = "tag " + part.effect; e.textContent = EFFECT_NAME[part.effect];
      tags.appendChild(e);
      if (part.motion.type !== "static") {
        var m = document.createElement("span"); m.className = "tag move"; m.textContent = part.motion.type === "slide" ? "往復" : "回転";
        tags.appendChild(m);
      }
      if (part.w !== T || part.h !== T) {
        var s = document.createElement("span"); s.className = "tag size"; s.textContent = part.w / T + "×" + part.h / T + "マス";
        tags.appendChild(s);
      }
      info.appendChild(nm); info.appendChild(tags);
      b.appendChild(cv); b.appendChild(info);
      b.addEventListener("click", function () { selId = id; setTool("place"); markPalette(); });
      palRefs[id] = b;
      box.appendChild(b);
    });
    if (!DK.parts[selId]) selId = DK.partOrder[0];
    markPalette();
  }

  function markPalette() {
    Object.keys(palRefs).forEach(function (id) { palRefs[id].classList.toggle("selected", id === selId); });
    var p = DK.parts[selId];
    $("st-sel").textContent = p ? "　選択中：" + p.name : "";
  }

  // ---- 道具・ボタン ----
  function setTool(t) {
    tool = t;
    document.querySelectorAll("#st-tools [data-stool]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.stool === t);
    });
    $("st-canvas").style.cursor = t === "erase" ? "not-allowed" : "crosshair";
    draw();
  }

  // ---- ステージの高さ ----
  function syncHeight() { $("st-height").value = cur.h; }
  // 高さを変える。下端をそろえる（地面が下に残る）ので、部品は上下にずれる。
  // 縮めて上からはみ出す部品は消えるので、数を伝えて確認する
  function setHeight(nh) {
    nh = DK.sanitizeStageHeight(nh);
    if (nh === cur.h) return;
    var shift = nh - cur.h;
    var moved = cur.cells.map(function (c) { return { x: c.x, y: c.y + shift, partId: c.partId }; });
    var kept = moved.filter(function (c) { return c.y >= 0; });
    var lost = moved.length - kept.length;
    if (lost && !window.confirm("縮めると、上にある部品が " + lost + " 個消えるよ。いい？（「戻す」で元に戻せるよ）")) { syncHeight(); return; }
    pushHistory();
    cur.h = nh; cur.cells = kept;
    cur.start = { x: cur.start.x, y: Math.max(0, Math.min(nh - 1, cur.start.y + shift)) };
    changed();
    // 下端を見せる（広げたときに空っぽの上ばかり見えないように）
    var wrap = document.querySelector(".st-canvas-wrap");
    wrap.scrollTop = wrap.scrollHeight;
  }

  function loadCells(cells) { pushHistory(); cur.cells = cells; changed(); }

  function bindUI() {
    document.querySelectorAll("#st-tools [data-stool]").forEach(function (b) {
      b.addEventListener("click", function () { setTool(b.dataset.stool); });
    });
    $("st-undo").addEventListener("click", undo);
    $("st-redo").addEventListener("click", redo);
    $("st-clear").addEventListener("click", function () {
      if (!cur.cells.length) return;
      if (window.confirm("部品を全部消すよ。いい？（「戻す」で元に戻せるよ）")) loadCells([]);
    });
    [["st-sample1", DK.tutorialStage], ["st-sample2", DK.sampleStage], ["st-sample3", DK.towerStage]].forEach(function (pair) {
      $(pair[0]).addEventListener("click", function () {
        if (cur.cells.length && !window.confirm("いまのステージは見本に置き換わるよ。いい？（「戻す」で元に戻せるよ）")) return;
        var s = pair[1]();
        pushHistory(); cur.h = s.h; cur.cells = s.cells; cur.start = s.start; cur.timeLimit = s.timeLimit || 0; syncHeight(); changed();
      });
    });
    $("st-limit-on").addEventListener("change", function () {
      if (this.checked) { var v = parseInt($("st-limit").value, 10); setLimit(v > 0 ? v : 60); }
      else setLimit(0);
      renderLimit();
    });
    $("st-limit").addEventListener("input", function () {
      var v = parseInt(this.value, 10);
      if (v > 0) setLimit(v);
    });
    $("st-limit").addEventListener("change", function () {   // 入力を終えたら、丸めた値を欄にも反映する
      var v = parseInt(this.value, 10);
      setLimit(v > 0 ? v : (cur.timeLimit || 60));
      this.value = cur.timeLimit || 60;
    });
    $("st-height").addEventListener("change", function () { setHeight(parseInt(this.value, 10)); });
    $("st-title").addEventListener("input", function () { cur.title = this.value.slice(0, 24); scheduleSave(); });
    $("st-test").addEventListener("click", function () {
      clearTimeout(saveTimer); DK.saveStageData(cur);
      var sig = DK.stageSignature(cur);
      DK.playStage(cur, "stage", {
        onClear: function (info) {
          // 同じ内容のまま、よいタイムで更新する
          var prev = cur.cleared && cur.cleared.sig === sig ? cur.cleared : null;
          if (!prev || info.time < prev.time) cur.cleared = { sig: sig, time: info.time, deaths: info.deaths };
          DK.saveStageData(cur); renderStatus();
        },
        note: function () { return "✓ このステージを共有できるようになったよ！"; }
      });
    });
    $("st-export").addEventListener("click", function () {
      if (!isCleared()) return;
      var text = DK.exportStageText(cur, cur.cleared);
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      a.download = DK.exportFileName(cur);
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      $("st-save").textContent = "書き出したよ（ダウンロードのフォルダを見てね）";
    });
    $("st-author").addEventListener("input", function () { cur.author = this.value.slice(0, 16); scheduleSave(); });
    $("play-back").addEventListener("click", function () { DK.showScreen("stage"); });

    document.addEventListener("keydown", function (e) {
      if (!active()) return;
      var t = e.target && e.target.tagName;
      if (t === "INPUT" || t === "TEXTAREA") return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        var k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (k === "y") { e.preventDefault(); redo(); }
        return;
      }
      if (e.key === "1") setTool("place");
      else if (e.key === "2") setTool("erase");
      else if (e.key === "3") setTool("start");
    });

    // 画面が開かれるたびに、部品の増減（削除・名前・絵の変更）を反映する
    new MutationObserver(function () { if (active()) refresh(); })
      .observe($("screen-stage"), { attributes: true, attributeFilter: ["class"] });
  }

  // 部品の削除などで使えなくなった置き方を取り除き、パレット・描画を更新する
  function refresh() {
    var before = cur.cells.length;
    cur.cells = DK.sanitizeCells(cur.cells, cur.h);
    renderPalette();
    draw(); renderStatus();
    if (cur.cells.length !== before) scheduleSave();
  }

  function init() {
    var saved = DK.loadStageData();
    if (saved) cur = saved;
    else { var s = DK.sampleStage(); cur = { title: "", author: "", h: s.h, start: s.start, cells: s.cells, timeLimit: 0, cleared: null }; }
    $("st-title").value = cur.title;
    $("st-author").value = cur.author || "";
    syncHeight();
    bindCanvas(); bindUI();
    renderPalette(); updateUndo(); draw(); renderStatus();
  }

  DK.stageEditor = { current: function () { return cur; }, refresh: refresh };
  window.addEventListener("DOMContentLoaded", init);
})();
