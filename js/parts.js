// 部品データ：絵 × 動き × 効果 ＋ 子部品（他の部品を呼び出して組み立てる）
// 部品 = { id, name, w, h, pixels[w*h], motion, effect, children, enabled, speedScale, builtin, ver }
//   w, h    : 絵の大きさ（ドット）。16 / 32 / 48 / 64 / 80 のどれか。16ドット＝ステージの1マス
//   motion  : { type: "static" } / { type: "slide", dx, dy, speed } / { type: "rotate", dir, speed }
//   effect  : "solid"（足場）/ "deadly"（即死）/ "goal"（ゴール）/ "push"（押せる＝木箱）。この部品自身の絵に対する効果
//             "push" の部品は、動き「静止」・くみたてなし（読み込み時にそう直す）。ゲーム中は塗った範囲を囲む長方形として動く
//   children: [{ partId, x, y }] …この部品の中に置いた他の部品（リンク。元の部品を直すと全部に反映される）
//             x, y は親の絵の左上からのドット。子は自分の動き・効果を保ったまま親の動きに乗る。
//             後ろの子ほど手前に描く。入れ子は最大 DK.MAX_DEPTH 段、自分自身を呼ぶ（循環）のは禁止
//   enabled / speedScale は回路機能の布石。初期版は常に true / 1
window.DK = window.DK || {};

DK.parts = {};        // id → 部品
DK.partOrder = [];    // 一覧の並び順
DK.PART_SIZES = [16, 32, 48, 64, 80];
DK.MAX_DEPTH = 3;     // 入れ子の段数の上限（親→子→孫で 3）
DK.CHILD_MIN = -80;   // 子の置き場所（親の左上からのドット）の範囲
DK.CHILD_MAX = 160;

DK.addPart = function (def) {
  var w = def.w || DK.config.TILE, h = def.h || DK.config.TILE;
  var part = {
    id: def.id,
    name: def.name,
    w: w,
    h: h,
    pixels: def.pixels,
    motion: def.motion || { type: "static" },
    effect: def.effect || "solid",
    children: (def.children || []).map(function (c) { return { partId: c.partId, x: c.x, y: c.y }; }),
    enabled: true,
    speedScale: 1,
    builtin: !!def.builtin,   // 見本部品（編集すると自動でコピーが作られる）
    ver: 0
  };
  DK.parts[part.id] = part;
  if (DK.partOrder.indexOf(part.id) < 0) DK.partOrder.push(part.id);
  return part;
};

// 効果のビット（1つの点に重なった部品の効果をまとめて持てる）
DK.EFFECT_BIT = { solid: 1, deadly: 2, goal: 4, push: 8 };

// 動きの状態。経過フレーム t のときの { ox, oy, ang }（置いた場所からのずれ(ドット)と回転角(ラジアン)）
//   往復 slide : { type, dx, dy（マス）, speed（マス/秒） } …行ったり来たり（三角波）
//   回転 rotate: { type, dir: "cw"|"ccw", speed（回転/秒） } …部品の中心まわり
// 位置は整数ドットに丸める（ドット絵がにじまず、判定も安定する）
var ZERO_MOTION = { ox: 0, oy: 0, ang: 0 };
DK.motionAt = function (part, t) {
  var m = part.motion, T = DK.config.TILE, sp = (m.speed || 0) * part.speedScale;
  if (!part.enabled || !sp) return ZERO_MOTION;
  if (m.type === "slide") {
    var len = Math.sqrt(m.dx * m.dx + m.dy * m.dy) * T;
    if (!len) return ZERO_MOTION;
    var ph = (sp * T / DK.config.FPS * t) % (2 * len);
    var u = ph < len ? ph / len : 2 - ph / len;
    return { ox: Math.round(m.dx * T * u), oy: Math.round(m.dy * T * u), ang: 0 };
  }
  if (m.type === "rotate") {
    return { ox: 0, oy: 0, ang: (m.dir === "ccw" ? -1 : 1) * 2 * Math.PI * sp * t / DK.config.FPS };
  }
  return ZERO_MOTION;
};

// ---- 入れ子の部品の座標変換 ----
// 部品の「置かれた枠」の座標 (x, y) ⇔ 部品自身の絵の座標、を動きぶんだけ変換する。
//   子の枠は、親の絵の座標から子の置き場所 (c.x, c.y) を引いたもの。これを入れ子の数だけ繰り返す。
var _x = 0, _y = 0;   // 戻り値用（毎回オブジェクトを作らないため）
function invMotion(part, x, y, t) {
  var mo = DK.motionAt(part, t);
  x -= mo.ox; y -= mo.oy;
  if (mo.ang) {
    var cx = part.w / 2, cy = part.h / 2, c = Math.cos(mo.ang), s = Math.sin(mo.ang), rx = x - cx, ry = y - cy;
    x = rx * c + ry * s + cx;
    y = -rx * s + ry * c + cy;
  }
  _x = x; _y = y;
}
function fwdMotion(part, x, y, t) {
  var mo = DK.motionAt(part, t);
  if (mo.ang) {
    var cx = part.w / 2, cy = part.h / 2, c = Math.cos(mo.ang), s = Math.sin(mo.ang), rx = x - cx, ry = y - cy;
    x = rx * c - ry * s + cx;
    y = rx * s + ry * c + cy;
  }
  _x = x + mo.ox; _y = y + mo.oy;
}

// 点 (x, y)（部品が置かれた枠の左上が原点）に重なる効果のビットの和。子部品も含めて調べる
DK.hitBits = function (part, x, y, t, depth) {
  depth = depth || 0;
  if (depth > 5 || !part.enabled) return 0;
  invMotion(part, x, y, t);
  var qx = _x, qy = _y, bits = 0, lx = Math.floor(qx), ly = Math.floor(qy);
  if (lx >= 0 && lx < part.w && ly >= 0 && ly < part.h && part.pixels[ly * part.w + lx] > 0) {
    bits |= DK.EFFECT_BIT[part.effect];
  }
  for (var i = 0; i < part.children.length; i++) {
    var c = part.children[i], cp = DK.parts[c.partId];
    if (cp) bits |= DK.hitBits(cp, qx - c.x, qy - c.y, t, depth + 1);
  }
  return bits;
};

// 点 (x, y) に重なる「足場（solid）の塗りマス」を探す。見つかれば、どの子をたどったかの道筋と、
// その部品の絵の中での位置を返す（乗っている足場と一緒に運ばれるための追跡に使う）。なければ null
DK.solidTrace = function (part, x, y, t) { return traceNode(part, x, y, t, 0, 0, [], 0); };
function traceNode(part, x, y, t, ox, oy, path, depth) {
  if (depth > 5 || !part.enabled) return null;
  invMotion(part, x, y, t);
  var qx = _x, qy = _y, lx = Math.floor(qx), ly = Math.floor(qy);
  path.push({ part: part, ox: ox, oy: oy });
  if (part.effect === "solid" && lx >= 0 && lx < part.w && ly >= 0 && ly < part.h && part.pixels[ly * part.w + lx] > 0) {
    return { path: path, qx: qx, qy: qy };
  }
  for (var i = 0; i < part.children.length; i++) {
    var c = part.children[i], cp = DK.parts[c.partId];
    if (!cp) continue;
    var r = traceNode(cp, qx - c.x, qy - c.y, t, c.x, c.y, path, depth + 1);
    if (r) return r;
  }
  path.pop();
  return null;
}
// solidTrace で見つけた点が、時刻 t ではどこにあるか（部品が置かれた枠の左上が原点）
DK.traceForward = function (tr, t) {
  var x = tr.qx, y = tr.qy;
  for (var i = tr.path.length - 1; i >= 0; i--) {
    var n = tr.path[i];
    fwdMotion(n.part, x, y, t);
    x = _x + n.ox; y = _y + n.oy;
  }
  return { x: x, y: y };
};

// 部品（子・孫を含む）が、どんな動きをしても収まる円の半径。円の中心は部品の絵の中心。
// ステージ上で「この部品が関係しそうな範囲」を大まかに絞るために使う
DK.extentOf = function (part, depth) {
  depth = depth || 0;
  var cx = part.w / 2, cy = part.h / 2, r = Math.sqrt(cx * cx + cy * cy);
  if (depth < 5) {
    part.children.forEach(function (c) {
      var cp = DK.parts[c.partId];
      if (!cp) return;
      var dx = c.x + cp.w / 2 - cx, dy = c.y + cp.h / 2 - cy;
      r = Math.max(r, Math.sqrt(dx * dx + dy * dy) + DK.extentOf(cp, depth + 1));
    });
  }
  if (part.motion.type === "slide") {
    r += Math.sqrt(part.motion.dx * part.motion.dx + part.motion.dy * part.motion.dy) * DK.config.TILE;
  }
  return r;
};

// 部品を子・孫ごと ctx に描く。原点は部品が置かれた枠の左上。t は経過フレーム
DK.drawPartTree = function (ctx, part, t, depth) {
  depth = depth || 0;
  if (depth > 5 || !part.enabled) return;
  var mo = DK.motionAt(part, t);
  ctx.save();
  if (mo.ang) {
    ctx.translate(mo.ox + part.w / 2, mo.oy + part.h / 2);
    ctx.rotate(mo.ang);
    ctx.translate(-part.w / 2, -part.h / 2);
  } else {
    ctx.translate(mo.ox, mo.oy);
  }
  ctx.drawImage(DK.partCanvas(part), 0, 0);
  part.children.forEach(function (c) {
    var cp = DK.parts[c.partId];
    if (!cp) return;
    ctx.save();
    ctx.translate(c.x, c.y);
    DK.drawPartTree(ctx, cp, t, depth + 1);
    ctx.restore();
  });
  ctx.restore();
};

// ---- 呼び出しの関係（循環・深さ）----
function depthOf(part, stack) {
  if (stack.indexOf(part.id) >= 0) return Infinity;   // 自分を呼び返している（循環）
  stack.push(part.id);
  var d = 1;
  part.children.forEach(function (c) {
    var cp = DK.parts[c.partId];
    if (cp) d = Math.max(d, 1 + depthOf(cp, stack));
  });
  stack.pop();
  return d;
}
DK.partDepth = function (part) { return depthOf(part, []); };

// 全部品で、循環がなく入れ子が上限以内か
DK.graphOk = function () {
  return DK.partOrder.every(function (id) { return DK.partDepth(DK.parts[id]) <= DK.MAX_DEPTH; });
};

// parent に child を呼び出して置けるか（自分自身・循環・深すぎる入れ子はだめ）
DK.canAddChild = function (parent, child) {
  if (parent === child) return false;
  parent.children.push({ partId: child.id, x: 0, y: 0 });
  var ok = DK.graphOk();
  parent.children.pop();
  return ok;
};

// id の部品を（孫以降も含めて）使っている部品のid一覧
DK.partUsers = function (id) {
  function reaches(part, depth) {
    if (depth > 6) return false;
    return part.children.some(function (c) {
      var cp = DK.parts[c.partId];
      return c.partId === id || (cp && reaches(cp, depth + 1));
    });
  }
  return DK.partOrder.filter(function (pid) { return pid !== id && reaches(DK.parts[pid], 0); });
};

// 壊れた呼び出し（存在しない部品・循環・深すぎる入れ子）を、リンクを外して直す。
// 保存データや友達のファイルから読み込んだあとに必ず呼ぶ
DK.fixGraph = function () {
  DK.partOrder.forEach(function (id) {
    var p = DK.parts[id];
    p.children = p.children.filter(function (c) { return DK.parts[c.partId]; });
  });
  for (var guard = 0; guard < 1000 && !DK.graphOk(); guard++) {
    for (var i = 0; i < DK.partOrder.length; i++) {
      var p = DK.parts[DK.partOrder[i]];
      if (DK.partDepth(p) > DK.MAX_DEPTH && p.children.length) { p.children.pop(); break; }
    }
  }
};

// ---- 見本部品（色の数字: 1黒 2白 3赤 4オレンジ 5黄 6緑 7青 8灰）----
(function () {
  function speck(x, y) { return (x * 7 + y * 5) % 13 === 0; }   // 土のつぶつぶ

  DK.addPart({ id: "grass", name: "草ブロック", pixels: DK.pixelsFromFn(function (x, y) {
    if (y < 3) return 6;
    return speck(x, y) ? 1 : 4;
  }) });

  DK.addPart({ id: "dirt", name: "土ブロック", pixels: DK.pixelsFromFn(function (x, y) {
    return speck(x, y) ? 1 : 4;
  }) });

  // 薄い床：上の4ドットぶんだけ塗る → 下の12ドットは空間になる（塗った部分には下から頭が当たる）
  DK.addPart({ id: "thin", name: "薄い足場", pixels: DK.pixelsFromFn(function (x, y) {
    if (y >= 4) return 0;
    return y < 2 ? 5 : 4;
  }) });

  // 半ブロック：下の半分だけ塗る
  DK.addPart({ id: "half", name: "半ブロック", pixels: DK.pixelsFromFn(function (x, y) {
    if (y < 8) return 0;
    return y === 8 ? 2 : 8;
  }) });

  // 山：45度の斜面。てっぺんに雪
  DK.addPart({ id: "hill", name: "山", pixels: DK.pixelsFromFn(function (x, y) {
    var h = Math.min(x, 15 - x) + 1, top = 16 - h;
    if (y < top) return 0;
    if (h >= 6 && y < top + 2) return 2;
    return 6;
  }) });

  // 丸石：円の形に当たる
  DK.addPart({ id: "round", name: "丸石", pixels: DK.pixelsFromFn(function (x, y) {
    var dx = x - 7.5, dy = y - 7.5;
    if (dx * dx + dy * dy > 56.25) return 0;
    return (x === 4 || x === 5) && (y === 4 || y === 5) ? 2 : 7;
  }) });

  // ---- 動きと効果を使う見本部品 ----
  // トゲ（即死・静止）
  DK.addPart({ id: "spike", name: "トゲ", effect: "deadly", pixels: DK.pixelsFromFn(function (x, y) {
    var k = x % 8, h = k < 4 ? 2 * k + 2 : 2 * (7 - k) + 2, top = 16 - h;
    if (y < top) return 0;
    if (y >= 14) return 1;
    return y === top ? 2 : 8;
  }) });

  // ノコギリ（即死・時計回りに回転）。赤い歯が回る
  DK.addPart({ id: "saw", name: "ノコギリ", effect: "deadly", motion: { type: "rotate", dir: "cw", speed: 0.6 },
    pixels: DK.pixelsFromFn(function (x, y) {
      var dx = x - 7.5, dy = y - 7.5, r = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
      var limit = 5 + (Math.cos(8 * a) > 0 ? 2.8 : 0);
      if (r > limit) return 0;
      if (r <= 1.8) return 1;
      if (r <= 3.2) return 2;
      return r > 5 ? 3 : 8;
    }) });

  // 動く足場（足場・横に3マス往復）／ 昇降する足場（縦に3マス往復）
  function platformPixels() {
    return DK.pixelsFromFn(function (x, y) {
      if (y >= 6) return 0;
      if (y === 5) return 8;
      return y < 2 ? 5 : 4;
    });
  }
  DK.addPart({ id: "mplat", name: "動く足場（横）", effect: "solid", pixels: platformPixels(),
    motion: { type: "slide", dx: 3, dy: 0, speed: 1.5 } });
  DK.addPart({ id: "vplat", name: "動く足場（縦）", effect: "solid", pixels: platformPixels(),
    motion: { type: "slide", dx: 0, dy: -3, speed: 1.5 } });

  // ゴール旗
  DK.addPart({ id: "flag", name: "ゴール旗", effect: "goal", pixels: DK.pixelsFromFn(function (x, y) {
    if (y === 0 && (x === 7 || x === 8)) return 5;
    if (x === 7 || x === 8) return 8;
    var w = 6 - Math.abs(y - 3.5) * 2;
    if (y >= 1 && y <= 6 && x >= 9 && x < 9 + w) return 3;
    return 0;
  }) });

  // 木箱（押せる）。押すと動き、重力で落ち、積める。箱にとってトゲは床
  DK.addPart({ id: "crate", name: "木箱", effect: "push", pixels: DK.pixelsFromFn(function (x, y) {
    var e = Math.min(x, y, 15 - x, 15 - y);
    if (e === 0) return 1;
    if (Math.abs(x - y) <= 1 || Math.abs(x + y - 15) <= 1) return 1;
    return e === 1 ? 5 : 4;
  }) });

  // 組み立ての見本：往復する台車の上で、ノコギリ（他の部品）が回る。「他の部品を呼び出す」の例
  DK.addPart({ id: "sawcart", name: "ノコギリ台車", w: 32, h: 32, effect: "solid",
    pixels: DK.pixelsFromFn(function (x, y) {
      if (y < 26) return 0;
      if (y < 28) return 5;
      return y < 30 ? 4 : 8;
    }, 32, 32),
    motion: { type: "slide", dx: 3, dy: 0, speed: 1 },
    children: [{ partId: "saw", x: 8, y: 10 }] });
})();

// ここまでの見本部品に印をつける
DK.partOrder.forEach(function (id) { DK.parts[id].builtin = true; });

DK.removePart = function (id) {
  delete DK.parts[id];
  var i = DK.partOrder.indexOf(id);
  if (i >= 0) DK.partOrder.splice(i, 1);
  // この部品を呼び出していた部品からは、呼び出しを外す
  DK.partOrder.forEach(function (pid) {
    var p = DK.parts[pid];
    p.children = p.children.filter(function (c) { return c.partId !== id; });
    p.ver++;
  });
};

DK.newPartId = function () {
  return "u" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
};

// ---- 安全チェック ----
// 保存データや、友達から受け取ったファイルの部品を読むときに必ず通す。
// 形が正しいものだけを、範囲内に丸めて返す。ダメなら null
// （呼び出し先が存在するか・循環していないかは、全部読んだあとに DK.fixGraph で直す）
DK.sanitizePart = function (raw) {
  if (!raw || typeof raw !== "object") return null;
  var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  if (typeof raw.id !== "string" || !ID_RE.test(raw.id)) return null;
  var w = raw.w === undefined ? DK.config.TILE : raw.w, h = raw.h === undefined ? DK.config.TILE : raw.h;
  if (DK.PART_SIZES.indexOf(w) < 0 || DK.PART_SIZES.indexOf(h) < 0) return null;
  var N = w * h;
  if (!Array.isArray(raw.pixels) || raw.pixels.length !== N) return null;
  var pixels = [];
  for (var i = 0; i < N; i++) {
    var v = raw.pixels[i];
    if (typeof v !== "number" || v !== Math.floor(v) || v < 0 || v > DK.config.PALETTE.length) return null;
    pixels.push(v);
  }
  function num(x, min, max, def) {
    x = Number(x);
    return isFinite(x) ? Math.min(max, Math.max(min, x)) : def;
  }
  var m = raw.motion || {}, motion;
  if (m.type === "slide") {
    motion = { type: "slide", dx: Math.round(num(m.dx, -6, 6, 0)), dy: Math.round(num(m.dy, -6, 6, 0)), speed: num(m.speed, 0.1, 6, 1.5) };
  } else if (m.type === "rotate") {
    motion = { type: "rotate", dir: m.dir === "ccw" ? "ccw" : "cw", speed: num(m.speed, 0.1, 3, 0.6) };
  } else {
    motion = { type: "static" };
  }
  var effect = raw.effect === "deadly" || raw.effect === "goal" || raw.effect === "push" ? raw.effect : "solid";
  var name = typeof raw.name === "string" ? raw.name.replace(/[\r\n\t]/g, " ").trim().slice(0, 16) : "";
  var children = [];
  if (Array.isArray(raw.children)) {
    raw.children.slice(0, 24).forEach(function (c) {
      if (!c || typeof c.partId !== "string" || !ID_RE.test(c.partId)) return;
      children.push({
        partId: c.partId,
        x: Math.round(num(c.x, DK.CHILD_MIN, DK.CHILD_MAX, 0)),
        y: Math.round(num(c.y, DK.CHILD_MIN, DK.CHILD_MAX, 0))
      });
    });
  }
  if (effect === "push") { motion = { type: "static" }; children = []; }   // 押せる部品は動かない・組み立てない
  return { id: raw.id, name: name || "なまえなし", w: w, h: h, pixels: pixels, motion: motion, effect: effect, children: children };
};

// ---- 自作部品の保存（このブラウザの localStorage）----
DK.USER_PARTS_KEY = "dk.userParts";

DK.partToData = function (part) {
  return {
    id: part.id, name: part.name, w: part.w, h: part.h, pixels: part.pixels.slice(),
    motion: JSON.parse(JSON.stringify(part.motion)), effect: part.effect,
    children: part.children.map(function (c) { return { partId: c.partId, x: c.x, y: c.y }; })
  };
};

DK.saveUserParts = function () {
  var list = DK.partOrder.filter(function (id) { return !DK.parts[id].builtin; })
    .map(function (id) { return DK.partToData(DK.parts[id]); });
  try {
    localStorage.setItem(DK.USER_PARTS_KEY, JSON.stringify(list));
    return true;
  } catch (e) { return false; }
};

DK.loadUserParts = function () {
  var list = [];
  try { list = JSON.parse(localStorage.getItem(DK.USER_PARTS_KEY) || "[]"); } catch (e) { list = []; }
  if (!Array.isArray(list)) return;
  list.forEach(function (raw) {
    var def = DK.sanitizePart(raw);
    if (def && !DK.parts[def.id]) DK.addPart(def);
  });
  DK.fixGraph();
};
DK.loadUserParts();
