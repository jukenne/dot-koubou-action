// 部品エディタ：ドット絵を描く・大きさを決める・他の部品を呼び出して組み立てる・
// 動きと効果を決める・動きをプレビューする・一覧で選ぶ・自動保存する
//
// 見本部品（builtin）をいじると、最初の1回で自動的にコピーが作られて、以後はコピーが編集される。
// 白紙から始めなくていい／見本を壊さない、のための仕組み。
window.DK = window.DK || {};

(function () {
  var T = DK.config.TILE;
  var CANVAS_MAX = 400;    // ドット絵キャンバスの長い辺の最大(px)
  var COLOR_NAMES = ["黒", "白", "赤", "オレンジ", "黄", "緑", "青", "灰"];
  var EFFECT_NAME = { solid: "足場", deadly: "即死", goal: "ゴール", push: "押せる" };
  var EFFECT_HELP = {
    solid: "乗れる・ぶつかる足場になるよ（塗ったマスだけが固い）",
    deadly: "触るとミスになるよ（トゲやノコギリ向き）",
    goal: "触るとクリアになるよ（ゴール旗向き）",
    push: "横から押して動かせる箱になるよ（重力で落ちる・積める。トゲは床になる）。動きとくみたては使えないよ"
  };
  var MOTION_NAME = { slide: "往復", rotate: "回転" };
  var MOTION_DEFAULT = {
    static: { type: "static" },
    slide: { type: "slide", dx: 3, dy: 0, speed: 1.5 },
    rotate: { type: "rotate", dir: "cw", speed: 0.6 }
  };

  function $(id) { return document.getElementById(id); }
  function active() { return $("screen-parts").classList.contains("active"); }

  var sel = null;          // いま選んでいる部品
  var tool = "pen";        // "pen" | "eraser" | "fill"
  var color = 4;           // 選んでいる色（パレット番号+1）。最初はオレンジ
  var mode = "draw";       // "draw"（絵をかく）| "build"（くみたて）
  var selChild = -1;       // くみたてで選んでいる子（sel.children の番号）
  var SC = 20;             // ドット絵キャンバスの1ドットの大きさ(px)。部品の大きさで変わる
  var history = [], redoStack = [];
  var saveTimer = null;
  var listRefs = {};       // 部品id → 一覧の中の表示部品（サムネイルなど）
  var hover = null;        // マウスが乗っているドット
  var stroke = null;       // ドラッグ中の描き込み { tool, last, changed }
  var childDrag = null;    // ドラッグ中の子 { index, gx, gy, moved }

  // ---- 部品の作成・複製 ----
  function clipName(s) { return String(s).slice(0, 16); }

  function makePart(name, src) {
    return DK.addPart({
      id: DK.newPartId(),
      name: clipName(name),
      w: src ? src.w : T,
      h: src ? src.h : T,
      pixels: src ? src.pixels.slice() : new Array(T * T).fill(0),
      motion: src ? JSON.parse(JSON.stringify(src.motion)) : { type: "static" },
      effect: src ? src.effect : "solid",
      children: src ? src.children : []
    });
  }

  // 編集できる部品を返す。見本部品なら、ここでコピーを作ってそちらを選ぶ
  function ensureEditable() {
    if (!sel.builtin) return sel;
    var copy = makePart(sel.name + "のコピー", sel);
    sel = copy;
    history = []; redoStack = [];
    renderList();
    syncAll();
    return sel;
  }

  // ---- 変更の記録・保存 ----
  function scheduleSave() {
    $("pe-save").textContent = "保存中…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      $("pe-save").textContent = DK.saveUserParts() ? "保存しました ✓" : "⚠ このブラウザでは保存できません";
    }, 300);
  }

  // この部品と、この部品を呼び出している部品の、一覧のサムネイルを描き直す
  function refreshItems(part) {
    updateItem(part);
    DK.partUsers(part.id).forEach(function (id) { updateItem(DK.parts[id]); });
  }

  function pixelsChanged() {
    sel.ver++;
    drawCanvas();
    refreshItems(sel);
    updateUndoButtons();
    scheduleSave();
  }

  function settingsChanged() {
    refreshItems(sel);
    scheduleSave();
  }

  function pushHistory() {
    history.push(sel.pixels.slice());
    if (history.length > 60) history.shift();
    redoStack = [];
    updateUndoButtons();
  }

  function undo() {
    if (!history.length) return;
    var p = ensureEditable();
    if (!history.length) return;
    redoStack.push(p.pixels.slice());
    p.pixels = history.pop();
    pixelsChanged();
  }

  function redo() {
    if (!redoStack.length) return;
    var p = ensureEditable();
    history.push(p.pixels.slice());
    p.pixels = redoStack.pop();
    pixelsChanged();
  }

  function updateUndoButtons() {
    $("pe-undo").disabled = !history.length;
    $("pe-redo").disabled = !redoStack.length;
  }

  // ---- 描画（ドット絵キャンバス）----
  function scaleFor(part) { return Math.min(20, Math.floor(CANVAS_MAX / Math.max(part.w, part.h))); }

  function childBox(c) {
    var cp = DK.parts[c.partId];
    return cp ? { x: c.x, y: c.y, w: cp.w, h: cp.h } : null;
  }

  function drawCanvas() {
    var cv = $("pe-canvas"), W = sel.w, H = sel.h;
    SC = scaleFor(sel);
    if (cv.width !== W * SC || cv.height !== H * SC) { cv.width = W * SC; cv.height = H * SC; }
    var ctx = cv.getContext("2d"), x, y, i;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    for (y = 0; y < H; y++) {
      for (x = 0; x < W; x++) {
        ctx.fillStyle = (x + y) % 2 ? "#2a2e4a" : "#20233a";
        ctx.fillRect(x * SC, y * SC, SC, SC);
        var v = sel.pixels[y * W + x];
        if (v) { ctx.fillStyle = DK.config.PALETTE[v - 1]; ctx.fillRect(x * SC, y * SC, SC, SC); }
      }
    }

    // 呼び出した部品（動かない姿で描く）。絵をかくモードでは薄く
    sel.children.forEach(function (c) {
      var cp = DK.parts[c.partId];
      if (!cp) return;
      ctx.save();
      ctx.globalAlpha = mode === "build" ? 1 : 0.45;
      ctx.scale(SC, SC);
      ctx.translate(c.x, c.y);
      ctx.imageSmoothingEnabled = false;
      DK.drawPartTree(ctx, cp, 0);
      ctx.restore();
    });

    // 格子：1ドットごと（大きいときだけ）と、1マス(16ドット)ごと
    ctx.lineWidth = 1;
    if (SC >= 8) {
      ctx.strokeStyle = "rgba(255,255,255,0.10)";
      ctx.beginPath();
      for (i = 1; i < W; i++) { ctx.moveTo(i * SC + 0.5, 0); ctx.lineTo(i * SC + 0.5, H * SC); }
      for (i = 1; i < H; i++) { ctx.moveTo(0, i * SC + 0.5); ctx.lineTo(W * SC, i * SC + 0.5); }
      ctx.stroke();
    }
    ctx.strokeStyle = "rgba(255,255,255,0.30)";
    ctx.beginPath();
    for (i = T; i < W; i += T) { ctx.moveTo(i * SC + 0.5, 0); ctx.lineTo(i * SC + 0.5, H * SC); }
    for (i = T; i < H; i += T) { ctx.moveTo(0, i * SC + 0.5); ctx.lineTo(W * SC, i * SC + 0.5); }
    ctx.stroke();

    if (mode === "build") {
      sel.children.forEach(function (c, idx) {
        var b = childBox(c);
        if (!b) return;
        var outside = b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H;
        ctx.lineWidth = idx === selChild ? 3 : 1;
        ctx.strokeStyle = idx === selChild ? "#ffd166" : (outside ? "#f4a261" : "rgba(255,255,255,0.6)");
        ctx.strokeRect(b.x * SC + 0.5, b.y * SC + 0.5, b.w * SC - 1, b.h * SC - 1);
      });
    } else if (hover) {
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 2;
      ctx.strokeRect(hover.x * SC + 1, hover.y * SC + 1, SC - 2, SC - 2);
    }
    cv.classList.toggle("build", mode === "build");
  }

  function cellAt(e) {
    var r = $("pe-canvas").getBoundingClientRect();
    var x = Math.floor((e.clientX - r.left) / r.width * sel.w), y = Math.floor((e.clientY - r.top) / r.height * sel.h);
    return x >= 0 && x < sel.w && y >= 0 && y < sel.h ? { x: x, y: y } : null;
  }

  // 2つのドットの間を線でつなぐ（速くドラッグしても点線にならない）
  function line(a, b, fn) {
    var dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y), sx = a.x < b.x ? 1 : -1, sy = a.y < b.y ? 1 : -1;
    var err = dx - dy, x = a.x, y = a.y;
    for (;;) {
      fn(x, y);
      if (x === b.x && y === b.y) break;
      var e2 = 2 * err;
      if (e2 > -dy) { err -= dy; x += sx; }
      if (e2 < dx) { err += dx; y += sy; }
    }
  }

  function setPixel(x, y, v) {
    var i = y * sel.w + x;
    if (sel.pixels[i] === v) return false;
    sel.pixels[i] = v;
    return true;
  }

  function floodFill(c, v) {
    var W = sel.w, H = sel.h, target = sel.pixels[c.y * W + c.x], changed = false;
    if (target === v) return false;
    var stack = [c];
    while (stack.length) {
      var p = stack.pop();
      if (p.x < 0 || p.x >= W || p.y < 0 || p.y >= H) continue;
      if (sel.pixels[p.y * W + p.x] !== target) continue;
      sel.pixels[p.y * W + p.x] = v; changed = true;
      stack.push({ x: p.x + 1, y: p.y }, { x: p.x - 1, y: p.y }, { x: p.x, y: p.y + 1 }, { x: p.x, y: p.y - 1 });
    }
    return changed;
  }

  // 絵をかくモードのマウス操作
  function paintDown(e, c) {
    var t = e.button === 2 ? "eraser" : tool;
    ensureEditable();
    pushHistory();
    if (t === "fill") {
      if (floodFill(c, color)) pixelsChanged(); else { history.pop(); updateUndoButtons(); }
      return;
    }
    stroke = { tool: t, last: c, changed: false };
    if (setPixel(c.x, c.y, t === "eraser" ? 0 : color)) stroke.changed = true;
    pixelsChanged();
  }

  // くみたてモードのマウス操作：いちばん手前の子をつかんで動かす
  function buildDown(c) {
    var found = -1;
    for (var i = sel.children.length - 1; i >= 0; i--) {
      var b = childBox(sel.children[i]);
      if (b && c.x >= b.x && c.x < b.x + b.w && c.y >= b.y && c.y < b.y + b.h) { found = i; break; }
    }
    selChild = found;
    if (found >= 0) {
      ensureEditable();
      var ch = sel.children[found];
      childDrag = { index: found, gx: c.x - ch.x, gy: c.y - ch.y, moved: false };
    }
    renderChildren();
    drawCanvas();
  }

  function bindCanvas() {
    var cv = $("pe-canvas");
    cv.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    cv.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 && e.button !== 2) return;
      e.preventDefault();
      var c = cellAt(e);
      if (!c) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) {}
      if (mode === "build") buildDown(c); else paintDown(e, c);
    });
    cv.addEventListener("pointermove", function (e) {
      var c = cellAt(e);
      hover = c;
      if (childDrag && c) {
        var ch = sel.children[childDrag.index];
        setChildPos(ch, c.x - childDrag.gx, c.y - childDrag.gy);
        childDrag.moved = true;
        syncChildInputs();
        drawCanvas();
      } else if (stroke && c) {
        var v = stroke.tool === "eraser" ? 0 : color;
        line(stroke.last, c, function (x, y) { if (setPixel(x, y, v)) stroke.changed = true; });
        stroke.last = c;
        pixelsChanged();
      } else {
        drawCanvas();
      }
    });
    cv.addEventListener("pointerleave", function () { if (!stroke && !childDrag) { hover = null; drawCanvas(); } });
    function end() {
      if (childDrag) {
        if (childDrag.moved) { refreshItems(sel); scheduleSave(); }
        childDrag = null;
      }
      if (stroke) {
        if (!stroke.changed) { history.pop(); updateUndoButtons(); }   // 何も変わらなかった操作は履歴に残さない
        stroke = null;
      }
    }
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
  }

  // ---- 道具・パレット・ボタン ----
  function bindTools() {
    document.querySelectorAll("#pe-tools [data-tool]").forEach(function (b) {
      b.addEventListener("click", function () { setTool(b.dataset.tool); });
    });
    document.querySelectorAll("#pe-mode [data-mode]").forEach(function (b) {
      b.addEventListener("click", function () { setMode(b.dataset.mode); });
    });
    var pal = $("pe-palette");
    DK.config.PALETTE.forEach(function (hex, i) {
      var b = document.createElement("button");
      b.className = "swatch"; b.style.background = hex; b.title = COLOR_NAMES[i];
      b.setAttribute("aria-label", COLOR_NAMES[i]);
      b.addEventListener("click", function () { color = i + 1; if (tool === "eraser") setTool("pen"); updatePalette(); });
      pal.appendChild(b);
    });
    updatePalette();

    $("pe-undo").addEventListener("click", undo);
    $("pe-redo").addEventListener("click", redo);
    $("pe-flip-h").addEventListener("click", function () { transform(function (x, y, W) { return [W - 1 - x, y]; }); });
    $("pe-flip-v").addEventListener("click", function () { transform(function (x, y, W, H) { return [x, H - 1 - y]; }); });
    $("pe-clear").addEventListener("click", function () { transform(function () { return null; }); });
    $("pe-new").addEventListener("click", function () {
      var p = makePart("新しい部品");
      renderList(); selectPart(p); scheduleSave();
    });
    $("pe-dup").addEventListener("click", function () {
      var p = makePart(sel.name + (sel.builtin ? "のコピー" : "（2）"), sel);
      renderList(); selectPart(p); scheduleSave();
    });
    $("pe-del").addEventListener("click", function () {
      if (sel.builtin) return;
      var users = DK.partUsers(sel.id).length;
      var msg = "「" + sel.name + "」を削除する？\nこの部品を使ったステージからも消えるよ。" +
        (users ? "\nこの部品を呼び出している部品が " + users + " 個あるよ。それらからも外れるよ。" : "") + "\n元には戻せないよ。";
      if (!window.confirm(msg)) return;
      var usersBefore = DK.partUsers(sel.id);
      DK.removePart(sel.id);
      var next = firstUserPart() || DK.parts.saw;
      renderList(); selectPart(next); scheduleSave();
      usersBefore.forEach(function (id) { if (DK.parts[id]) updateItem(DK.parts[id]); });
    });

    document.addEventListener("keydown", function (e) {
      if (!active()) return;
      var t = e.target && e.target.tagName;
      if (t === "INPUT" && (e.target.type === "text" || e.target.type === "number")) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        var k = e.key.toLowerCase();
        if (k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
        else if (k === "y") { e.preventDefault(); redo(); }
        return;
      }
      if (mode === "build" && selChild >= 0 && sel.children[selChild]) {
        var step = e.shiftKey ? 8 : 1, dx = 0, dy = 0;
        if (e.key === "ArrowLeft") dx = -step; else if (e.key === "ArrowRight") dx = step;
        else if (e.key === "ArrowUp") dy = -step; else if (e.key === "ArrowDown") dy = step;
        if (dx || dy) {
          e.preventDefault();
          ensureEditable();
          var ch = sel.children[selChild];
          setChildPos(ch, ch.x + dx, ch.y + dy);
          syncChildInputs(); drawCanvas(); refreshItems(sel); scheduleSave();
        }
        return;
      }
      if (e.key === "1") setTool("pen");
      else if (e.key === "2") setTool("eraser");
      else if (e.key === "3") setTool("fill");
    });
  }

  function setTool(t) {
    tool = t;
    document.querySelectorAll("#pe-tools [data-tool]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tool === t);
    });
  }

  function setMode(m) {
    mode = m;
    document.querySelectorAll("#pe-mode [data-mode]").forEach(function (b) {
      b.classList.toggle("active", b.dataset.mode === m);
    });
    $("pe-draw-tools").style.display = m === "draw" ? "block" : "none";
    $("pe-build").style.display = m === "build" ? "block" : "none";
    $("pe-picker").style.display = "none";
    drawCanvas();
  }

  function updatePalette() {
    document.querySelectorAll("#pe-palette .swatch").forEach(function (b, i) {
      b.classList.toggle("active", i + 1 === color);
    });
  }

  // 全ドットを並べ替える（反転・全消し）。fn が null を返したドットは消える
  function transform(fn) {
    var p = ensureEditable(), W = p.w, H = p.h;
    pushHistory();
    var out = new Array(W * H).fill(0);
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      var to = fn(x, y, W, H);
      if (to) out[to[1] * W + to[0]] = p.pixels[y * W + x];
    }
    p.pixels = out;
    pixelsChanged();
  }

  // ---- 大きさ ----
  function buildSizeButtons() {
    [["pe-size-w", "w"], ["pe-size-h", "h"]].forEach(function (pair) {
      var box = $(pair[0]);
      DK.PART_SIZES.forEach(function (n) {
        var b = document.createElement("button");
        b.type = "button"; b.textContent = n; b.dataset.size = n; b.dataset.axis = pair[1];
        b.addEventListener("click", function () { resize(pair[1], n); });
        box.appendChild(b);
      });
    });
  }

  function resize(axis, n) {
    var nw = axis === "w" ? n : sel.w, nh = axis === "h" ? n : sel.h;
    if (nw === sel.w && nh === sel.h) return;
    // 小さくして、塗ったドットがはみ出して消えるなら確認する
    var losing = false;
    for (var y = 0; y < sel.h && !losing; y++) for (var x = 0; x < sel.w; x++) {
      if ((x >= nw || y >= nh) && sel.pixels[y * sel.w + x]) { losing = true; break; }
    }
    if (losing && !window.confirm("小さくすると、はみ出した部分の絵が消えるよ。いい？")) return;
    var p = ensureEditable();
    var np = new Array(nw * nh).fill(0);
    for (var yy = 0; yy < Math.min(p.h, nh); yy++) for (var xx = 0; xx < Math.min(p.w, nw); xx++) {
      np[yy * nw + xx] = p.pixels[yy * p.w + xx];
    }
    p.w = nw; p.h = nh; p.pixels = np; p.ver++;
    history = []; redoStack = [];   // 大きさが変わると、前の履歴は使えない
    hover = null;
    syncAll();
    refreshItems(p);
    scheduleSave();
  }

  // ---- くみたて（他の部品を呼び出す）----
  function clampPos(v) { return Math.max(DK.CHILD_MIN, Math.min(DK.CHILD_MAX, Math.round(v))); }
  function setChildPos(c, x, y) { c.x = clampPos(x); c.y = clampPos(y); }

  // 部品を小さな Canvas に描く（子・孫ごと、動かない姿で）。いちばん長い辺が size px になる
  function paintThumb(cv, part, size) {
    cv.width = part.w; cv.height = part.h;
    var m = Math.max(part.w, part.h);
    cv.style.width = Math.round(part.w * size / m) + "px";
    cv.style.height = Math.round(part.h * size / m) + "px";
    var ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, part.w, part.h);
    DK.drawPartTree(ctx, part, 0);
  }

  function renderChildren() {
    var box = $("pe-children");
    box.textContent = "";
    if (!sel.children.length) {
      var h = document.createElement("p");
      h.className = "hint"; h.textContent = "まだ呼び出した部品はないよ。";
      box.appendChild(h);
    }
    sel.children.forEach(function (c, i) {
      var cp = DK.parts[c.partId];
      var row = document.createElement("div");
      row.className = "pe-child" + (i === selChild ? " selected" : "");
      row.addEventListener("click", function () { selChild = i; renderChildren(); drawCanvas(); });

      var cv = document.createElement("canvas");
      if (cp) paintThumb(cv, cp, 32);
      row.appendChild(cv);

      var nm = document.createElement("div");
      nm.className = "cname";
      nm.textContent = cp ? cp.name + "（" + cp.w + "×" + cp.h + "）" : "（見つからない部品）";
      row.appendChild(nm);

      [["x", "x"], ["y", "y"]].forEach(function (ax) {
        var lb = document.createElement("label");
        lb.textContent = ax[0] + " ";
        var inp = document.createElement("input");
        inp.type = "number"; inp.min = DK.CHILD_MIN; inp.max = DK.CHILD_MAX; inp.step = 1; inp.value = c[ax[1]];
        inp.dataset.axis = ax[1];
        inp.addEventListener("focus", function () { if (selChild !== i) { selChild = i; row.parentNode.querySelectorAll(".pe-child").forEach(function (r, k) { r.classList.toggle("selected", k === i); }); drawCanvas(); } });
        inp.addEventListener("input", function () {
          if (inp.value === "" || isNaN(Number(inp.value))) return;
          ensureEditable();
          var ch = sel.children[i];
          ch[ax[1]] = clampPos(Number(inp.value));
          drawCanvas(); refreshItems(sel); scheduleSave();
        });
        lb.appendChild(inp);
        row.appendChild(lb);
      });

      function btn(text, title, fn) {
        var b = document.createElement("button");
        b.type = "button"; b.className = "btn"; b.textContent = text; b.title = title;
        b.addEventListener("click", function (e) { e.stopPropagation(); fn(); });
        row.appendChild(b);
      }
      btn("中央", "親の中央に置く", function () {
        if (!cp) return;
        ensureEditable();
        setChildPos(sel.children[i], (sel.w - cp.w) / 2, (sel.h - cp.h) / 2);
        childrenChanged();
      });
      btn("▲", "手前に出す", function () { moveChild(i, 1); });
      btn("▼", "奥へ下げる", function () { moveChild(i, -1); });
      btn("✕", "呼び出しを外す", function () {
        ensureEditable();
        sel.children.splice(i, 1);
        if (selChild >= sel.children.length) selChild = sel.children.length - 1;
        childrenChanged();
      });

      var b = childBox(c);
      if (b && (b.x < 0 || b.y < 0 || b.x + b.w > sel.w || b.y + b.h > sel.h)) {
        var w = document.createElement("div");
        w.className = "warn"; w.textContent = "⚠ この部品の枠からはみ出しているよ（見た目と当たり判定は出た分も有効。ステージでは枠のマスしか使わないので注意）";
        row.appendChild(w);
      }
      box.appendChild(row);
    });
  }

  function syncChildInputs() {
    document.querySelectorAll("#pe-children .pe-child").forEach(function (row, i) {
      var c = sel.children[i];
      if (!c) return;
      row.querySelectorAll("input[type=number]").forEach(function (inp) { inp.value = c[inp.dataset.axis]; });
    });
  }

  function moveChild(i, d) {
    var j = i + d;
    if (j < 0 || j >= sel.children.length) return;
    ensureEditable();
    var t = sel.children[i]; sel.children[i] = sel.children[j]; sel.children[j] = t;
    selChild = j;
    childrenChanged();
  }

  function childrenChanged() {
    renderChildren(); drawCanvas(); refreshItems(sel); scheduleSave();
    renderBanner(); syncPreviewNote();
  }

  function openPicker() {
    var box = $("pe-picker");
    if (box.style.display === "block") { box.style.display = "none"; return; }
    box.textContent = "";
    var title = document.createElement("p");
    title.className = "hint"; title.textContent = "呼び出す部品を選んでね（自分自身や、入れ子が深くなるものは選べないよ）";
    box.appendChild(title);
    var cur = sel;
    DK.partOrder.slice().reverse().forEach(function (id) {   // 自分の部品が上に来るように
      var part = DK.parts[id];
      var can = part !== cur && DK.canAddChild(cur, part);
      var b = document.createElement("button");
      b.type = "button"; b.className = "pe-pick"; b.disabled = !can;
      b.title = can ? "" : (part === cur ? "自分自身は呼び出せないよ" : "循環になるか、入れ子が深すぎるよ");
      var cv = document.createElement("canvas");
      paintThumb(cv, part, 32);
      var label = document.createElement("span");
      label.textContent = part.name + "（" + part.w + "×" + part.h + (part.builtin ? "・見本" : "") + "）";
      b.appendChild(cv); b.appendChild(label);
      b.addEventListener("click", function () { addChild(part); });
      box.appendChild(b);
    });
    box.style.display = "block";
  }

  function addChild(part) {
    var p = ensureEditable();
    if (!DK.canAddChild(p, part)) return;
    // 親の中央に置く（親より大きければ左上）
    var x = Math.max(0, Math.round((p.w - part.w) / 2)), y = Math.max(0, Math.round((p.h - part.h) / 2));
    p.children.push({ partId: part.id, x: x, y: y });
    selChild = p.children.length - 1;
    $("pe-picker").style.display = "none";
    childrenChanged();
  }

  // ---- 動き・効果・なまえ ----
  function bindSettings() {
    $("pe-name").addEventListener("input", function () {
      var p = ensureEditable();
      p.name = clipName(this.value);
      settingsChanged();
    });
    $("pe-name").addEventListener("blur", function () {
      if (!this.value.trim()) { sel.name = "なまえなし"; this.value = sel.name; settingsChanged(); }
    });

    document.querySelectorAll("input[name=pe-motion]").forEach(function (r) {
      r.addEventListener("change", function () {
        var p = ensureEditable();
        if (p.motion.type !== r.value) p.motion = JSON.parse(JSON.stringify(MOTION_DEFAULT[r.value]));
        syncControls(); settingsChanged();
      });
    });
    document.querySelectorAll("input[name=pe-dir]").forEach(function (r) {
      r.addEventListener("change", function () { var p = ensureEditable(); p.motion.dir = r.value; settingsChanged(); });
    });
    document.querySelectorAll("input[name=pe-effect]").forEach(function (r) {
      r.addEventListener("change", function () {
        if (r.value === "push" && (sel.motion.type !== "static" || sel.children.length) &&
            !window.confirm("「押せる」にすると、動きは静止になって、呼び出した部品は外れるよ。いい？")) { syncControls(); return; }
        var p = ensureEditable(); p.effect = r.value;
        if (r.value === "push") { p.motion = { type: "static" }; p.children = []; selChild = -1; renderChildren(); drawCanvas(); }
        syncControls(); settingsChanged();
      });
    });
    function slider(id, apply) {
      $(id).addEventListener("input", function () {
        var p = ensureEditable(); apply(p, Number(this.value)); syncControls(); settingsChanged();
      });
    }
    slider("pe-dx", function (p, v) { p.motion.dx = v; });
    slider("pe-dy", function (p, v) { p.motion.dy = v; });
    slider("pe-sspeed", function (p, v) { p.motion.speed = v; });
    slider("pe-rspeed", function (p, v) { p.motion.speed = v; });
  }

  function dirText(v, neg, pos) { return v === 0 ? "動かない" : (v < 0 ? neg : pos) + Math.abs(v) + "マス"; }

  function renderBanner() {
    var users = DK.partUsers(sel.id).length;
    var text = sel.builtin
      ? "見本部品だよ。絵や設定をいじると、自動でコピーが作られて、そっちが編集されるよ。"
      : "あなたの部品。変更は自動で、このブラウザの中に保存されるよ。";
    if (users) text += "　※この部品は " + users + " 個の部品の中で使われているよ。直すと、それらにも反映されるよ。";
    $("pe-banner").textContent = text;
  }

  function syncPreviewNote() {
    $("pe-effect-help").textContent = EFFECT_HELP[sel.effect] +
      (sel.children.length ? "（この効果は、この部品自身の絵だけに効くよ。呼び出した部品は、それぞれの効果のまま）" : "");
  }

  // 選んでいる部品の内容を、画面の部品（ラジオ・つまみ）に反映する
  function syncControls() {
    var m = sel.motion;
    $("pe-name").value = sel.name;
    document.querySelectorAll("input[name=pe-motion]").forEach(function (r) { r.checked = r.value === m.type; });
    document.querySelectorAll("input[name=pe-effect]").forEach(function (r) { r.checked = r.value === sel.effect; });
    var pushing = sel.effect === "push";   // 押せる部品は動き・くみたてが使えない
    document.querySelectorAll("input[name=pe-motion]").forEach(function (r) { r.disabled = pushing; });
    document.querySelector("#pe-mode [data-mode=build]").disabled = pushing;
    if (pushing && mode === "build") setMode("draw");
    $("pe-opt-slide").style.display = m.type === "slide" ? "block" : "none";
    $("pe-opt-rotate").style.display = m.type === "rotate" ? "block" : "none";
    if (m.type === "slide") {
      $("pe-dx").value = m.dx; $("pe-dy").value = m.dy; $("pe-sspeed").value = m.speed;
      $("pe-dx-text").textContent = dirText(m.dx, "← 左へ", "→ 右へ");
      $("pe-dy-text").textContent = dirText(m.dy, "↑ 上へ", "↓ 下へ");
      $("pe-sspeed-text").textContent = m.speed + " マス/秒";
    } else if (m.type === "rotate") {
      document.querySelectorAll("input[name=pe-dir]").forEach(function (r) { r.checked = r.value === m.dir; });
      $("pe-rspeed").value = m.speed;
      $("pe-rspeed-text").textContent = m.speed + " 回転/秒";
    }
    document.querySelectorAll("#pe-size-w button, #pe-size-h button").forEach(function (b) {
      b.classList.toggle("active", Number(b.dataset.size) === (b.dataset.axis === "w" ? sel.w : sel.h));
    });
    $("pe-size-note").textContent = sel.w + "×" + sel.h + " ドット（ステージでは " + sel.w / T + "×" + sel.h / T + " マス）";
    syncPreviewNote();
    renderBanner();
    $("pe-del").disabled = sel.builtin;
  }

  function syncAll() {
    syncControls();
    renderChildren();
    drawCanvas();
    updateUndoButtons();
    markSelected();
  }

  function selectPart(p) {
    sel = p; history = []; redoStack = []; hover = null; selChild = -1;
    $("pe-save").textContent = "";
    $("pe-picker").style.display = "none";
    syncAll();
  }

  // ---- 部品の一覧 ----
  function firstUserPart() {
    var ids = DK.partOrder.filter(function (id) { return !DK.parts[id].builtin; });
    return ids.length ? DK.parts[ids[ids.length - 1]] : null;
  }

  function fillTags(box, part) {
    box.textContent = "";
    var e = document.createElement("span");
    e.className = "tag " + part.effect; e.textContent = EFFECT_NAME[part.effect];
    box.appendChild(e);
    if (part.motion.type !== "static") {
      var m = document.createElement("span");
      m.className = "tag move"; m.textContent = MOTION_NAME[part.motion.type];
      box.appendChild(m);
    }
    if (part.w !== T || part.h !== T) {
      var s = document.createElement("span");
      s.className = "tag size"; s.textContent = part.w + "×" + part.h;
      box.appendChild(s);
    }
    if (part.children.length) {
      var k = document.createElement("span");
      k.className = "tag build"; k.textContent = "組立";
      box.appendChild(k);
    }
  }

  function makeItem(part) {
    var b = document.createElement("button");
    b.className = "pe-item"; b.type = "button";
    var cv = document.createElement("canvas");
    var info = document.createElement("div");
    var nm = document.createElement("div"); nm.className = "nm";
    var tags = document.createElement("div");
    info.appendChild(nm); info.appendChild(tags);
    b.appendChild(cv); b.appendChild(info);
    b.addEventListener("click", function () { selectPart(part); });
    listRefs[part.id] = { btn: b, cv: cv, nm: nm, tags: tags };
    updateItem(part);
    return b;
  }

  function updateItem(part) {
    var r = listRefs[part.id];
    if (!r) return;
    paintThumb(r.cv, part, 40);
    r.nm.textContent = part.name;
    fillTags(r.tags, part);
  }

  function markSelected() {
    Object.keys(listRefs).forEach(function (id) { listRefs[id].btn.classList.toggle("selected", !!sel && id === sel.id); });
  }

  function renderList() {
    var body = $("pe-list-body");
    body.textContent = "";
    listRefs = {};
    var users = DK.partOrder.filter(function (id) { return !DK.parts[id].builtin; }).reverse();
    var builtins = DK.partOrder.filter(function (id) { return DK.parts[id].builtin; });
    function section(title, ids, emptyText) {
      var h = document.createElement("h4"); h.textContent = title; body.appendChild(h);
      if (!ids.length) { var p = document.createElement("p"); p.className = "hint"; p.textContent = emptyText; body.appendChild(p); }
      ids.forEach(function (id) { body.appendChild(makeItem(DK.parts[id])); });
    }
    section("じぶんの部品", users, "まだないよ。見本をいじると、ここにコピーができるよ。");
    section("見本部品", builtins, "");
    markSelected();
  }

  // ---- 動きのプレビュー ----
  var PV_W = 288, PV_H = 224;
  var pvStart = performance.now();

  function drawPreview(now) {
    requestAnimationFrame(drawPreview);
    if (!active() || !sel) return;
    var cv = $("pe-preview"), ctx = cv.getContext("2d");
    var t = (now - pvStart) / 1000 * DK.config.FPS;
    var m = sel.motion;
    // 子・孫の動きも含めて、どこまで動くかの半径に合わせて拡大率を決める
    var r = DK.extentOf(sel);
    var s = Math.max(1, Math.min(8, Math.floor(Math.min(PV_W, PV_H) / (2 * r + 8) * 2) / 2));
    var cx = sel.w / 2, cy = sel.h / 2;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#101224";
    ctx.fillRect(0, 0, PV_W, PV_H);
    ctx.setTransform(s, 0, 0, s, PV_W / 2 - cx * s, PV_H / 2 - cy * s);   // 部品の中心を、画面の中心に
    ctx.imageSmoothingEnabled = false;

    // 1マス(16ドット)の格子
    ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1 / s;
    ctx.beginPath();
    var x0 = -PV_W / s, x1 = PV_W / s + sel.w, y0 = -PV_H / s, y1 = PV_H / s + sel.h;
    for (var gx = Math.floor(x0 / T) * T; gx < x1; gx += T) { ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); }
    for (var gy = Math.floor(y0 / T) * T; gy < y1; gy += T) { ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); }
    ctx.stroke();

    // 動く範囲の目印
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = "#a9b0cc"; ctx.lineWidth = 1 / s; ctx.setLineDash([3 / s, 3 / s]);
    if (m.type === "slide") {
      var ex = m.dx * T, ey = m.dy * T, cvPart = DK.partCanvas(sel);
      ctx.drawImage(cvPart, 0, 0);
      ctx.drawImage(cvPart, ex, ey);
      ctx.globalAlpha = 0.6;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + ex, cy + ey); ctx.stroke();
    } else if (m.type === "rotate") {
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.arc(cx, cy, Math.sqrt(cx * cx + cy * cy), 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.globalAlpha = 0.5;
      ctx.strokeRect(0, 0, sel.w, sel.h);
    }
    ctx.restore();

    DK.drawPartTree(ctx, sel, t);
  }

  // ---- 起動 ----
  function init() {
    buildSizeButtons();
    bindCanvas(); bindTools(); bindSettings();
    $("pe-add-child").addEventListener("click", openPicker);
    renderList();
    selectPart(DK.parts.saw);   // 最初から動くノコギリを見せて「いじるところから始める」
    requestAnimationFrame(drawPreview);
  }

  DK.editor = {
    select: function (id) { if (DK.parts[id]) selectPart(DK.parts[id]); },
    current: function () { return sel; },
    mode: function () { return mode; },
    setMode: setMode
  };
  window.addEventListener("DOMContentLoaded", init);
})();
