// プレイ画面：ゲームループ・入力・プレイヤーの物理・動く部品・ミスとクリア・描画
// 世界の判定は effectsAt(x, y)（そのドットに重なっている部品の効果）に集約。
// 動く部品は「経過フレーム DK.time」から位置と角度が決まる（同じ操作なら毎回同じ動き）
window.DK = window.DK || {};

(function () {
  var C = DK.config, T = C.TILE, EB = DK.EFFECT_BIT;

  // ---- 物理の調整値（単位: ドット / 1フレーム=1/60秒）。手触りはここをいじる ----
  var P = {
    RUN_MAX: 2.2,        // 最高速度
    ACCEL_GROUND: 0.35,  // 地上の加速
    ACCEL_AIR: 0.25,     // 空中の加速
    TURN_BONUS: 2,       // 逆向きに切り返すときの加速倍率（キビキビ曲がる）
    FRICTION_GROUND: 0.4,// 地上で離したときの減速
    FRICTION_AIR: 0.12,
    GRAVITY: 0.4,
    FALL_MAX: 9,
    JUMP_V: 7.2,         // ジャンプの初速（最大で約4マスの高さ）
    JUMP_CUT: 3.2,       // ボタンを離したとき上昇速度をこれまで落とす（小ジャンプ）
    COYOTE: 6,           // 足場を離れてからジャンプできる猶予フレーム数
    BUFFER: 6,           // 着地前にジャンプボタンを押しておける先行入力フレーム数
    STEP_UP: 3,          // 地上で自動で乗り越える段差のドット数（斜面を歩けるように）
    DEAD_FRAMES: 50,     // ミスしてからやり直しまでのフレーム数
    WALL_SLIDE: 0.8,     // 壁に張り付いているときの落下速度の上限（ゆっくりずり落ちる）
    WALL_COYOTE: 6,      // 壁を離れてから壁キックできる猶予フレーム数
    WALL_JUMP_V: 6.6,    // 壁キックの上向きの初速（通常ジャンプより少し低い）
    WALL_JUMP_VX: 2.2,   // 壁キックで壁と反対側へ飛ぶ横速度
    WALL_LOCK: 10,       // 壁キック直後、横の入力が効きにくいフレーム数（すぐ壁に戻ってしまわないように）
    WALL_LOCK_ACCEL: 0.3,// そのあいだの加速の倍率
    PUSH_MAX: 1.0,       // 木箱を押しているときの最高速度（重たい感じ）
    SQUEEZE_MAX: 10,     // 動く部品に押されたとき、押し出して避けられる最大ドット数（これ以上は潰される）
    STOMP_MIN: 2.4,      // 他の人の頭に着地したとき、これ以上の落下速度なら「踏みつけ」
    STOMP_V: 5.0,        // 踏みつけで跳ね返る初速（ジャンプを押していなければ約2マス）
    STOMP_V_HELD: 7.0,   // ジャンプを押しながら踏むと、ほぼフルジャンプで跳ねる
    STOMP_COOLDOWN: 30,  // 同じ相手を続けて踏める間隔（フレーム）
    STOMP_SLOW: 18,      // 踏まれた人が鈍るフレーム数（0.3秒）
    STOMP_SLOW_RUN: 0.5, // そのあいだの最高速度の倍率
    STOMP_SLOW_ACCEL: 0.6 // そのあいだの加速の倍率
  };
  DK.physics = P;

  // ---- ステージと判定 ----
  DK.stage = DK.tutorialStage();
  DK.time = 0;   // 今の挑戦が始まってからのフレーム数

  // 動く部品は、経過フレーム DK.time だけで位置・角度が決まる
  // みんなで遊ぶときは DK.clockFn（全員で共通の時計）が時間を決める。ふだん（1人用）は引数のとおり
  function setClock(t) { DK.time = DK.clockFn ? DK.clockFn(t, DK.time) : t; }

  // ドット (px, py)（整数）に重なっている部品の効果のビット（EFFECT_BIT の和）
  function effectsAt(px, py, skipCrates) {
    if (!skipCrates && crateAtPixel(px, py)) return EB.solid;
    var s = DK.stage, tx = Math.floor(px / T), ty = Math.floor(py / T), bits = 0, i;
    if (tx < 0 || tx >= s.w) return EB.solid;   // 左右の端は壁（上は空、下は穴）
    if (ty >= 0 && ty < s.h) {
      var inst = s.grid[ty * s.w + tx];
      if (inst && inst.part.enabled) {
        var part = inst.part;
        if (part.pixels[(py - inst.y * T) * part.w + (px - inst.x * T)] > 0) bits |= EB[part.effect];
      }
    }
    for (i = 0; i < s.movers.length; i++) {
      var m = s.movers[i], dx = px + 0.5 - m.cx, dy = py + 0.5 - m.cy;
      if (dx * dx + dy * dy > m.r * m.r) continue;   // 届かない範囲は調べない
      bits |= DK.hitBits(m.part, px + 0.5 - m.x * T, py + 0.5 - m.y * T, DK.time);
    }
    return bits;
  }
  DK.effectsAt = effectsAt;

  // ---- 木箱（押せる部品）----
  // 木箱は「塗ったドットを囲む長方形」として動く（当たり判定も長方形）。縦は整数ドット、横は押した分だけ小数
  //   押すと、その先に並んだ箱もまとめて動く（先頭が壁などにぶつかれば全体が止まる）
  //   c = { part, x, y, vy, fall, bx, by, bw, bh, dead }  x, y は部品の左上、bx..bh は絵の中の塗った範囲
  DK.crates = [];
  function makeCrates() {
    DK.crates = [];
    DK.stage.crateDefs.forEach(function (d) {
      var part = d.part, x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (var i = 0; i < part.pixels.length; i++) {
        if (!part.pixels[i]) continue;
        var x = i % part.w, y = (i / part.w) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      if (x1 < 0) return;   // 何も塗られていない箱は出さない
      DK.crates.push({ part: part, x: d.x * T, y: d.y * T, vy: 0, fall: 0, cdx: 0, cdy: 0, bx: x0, by: y0, bw: x1 - x0 + 1, bh: y1 - y0 + 1, dead: false });
    });
  }
  DK.makeCrates = makeCrates;
  function cl(c) { return c.x + c.bx; }
  function ct(c) { return c.y + c.by; }
  // ドット (px, py) の中心が箱の長方形に入っているか
  function crateAtPixel(px, py) {
    for (var i = 0; i < DK.crates.length; i++) {
      var c = DK.crates[i];
      if (c.dead) continue;
      var l = cl(c), t = ct(c);
      if (px + 0.5 >= l && px + 0.5 < l + c.bw && py + 0.5 >= t && py + 0.5 < t + c.bh) return c;
    }
    return null;
  }
  // プレイヤーの箱(HB)が (x, y) にあるとき重なっている木箱の一覧
  // （collides と同じ判定点で調べるので、「ぶつかった」と「押せる箱がある」が食い違わない）
  function cratesTouching(x, y) {
    var out = [], l = x + HB.x, t = y + HB.y, i;
    function probe(px, py) {
      var c = crateAtPixel(Math.floor(px), Math.floor(py));
      if (c && out.indexOf(c) < 0) out.push(c);
    }
    for (i = 0; i < XS.length; i++) { probe(l + XS[i], t); probe(l + XS[i], t + HB.h - 0.01); }
    for (i = 0; i < YS.length; i++) { probe(l, t + YS[i]); probe(l + HB.w - 0.01, t + YS[i]); }
    return out;
  }
  // 箱 c を (nx, ny) に置いたとき世界（足場・動く部品。トゲも床）に当たるか。縁を細かく調べる
  function crateHitsWorld(c, nx, ny) {
    var l = nx + c.bx, t = ny + c.by;
    var i0 = Math.ceil(l - 0.5), i1 = Math.ceil(l + c.bw - 0.5) - 1, j0 = Math.ceil(t - 0.5), j1 = Math.ceil(t + c.bh - 0.5) - 1, k;
    var FLOOR = EB.solid | EB.deadly;
    for (k = i0; ; k = Math.min(k + 4, i1)) {
      if ((effectsAt(k, j0, true) | effectsAt(k, j1, true)) & FLOOR) return true;
      if (k >= i1) break;
    }
    for (k = j0; ; k = Math.min(k + 4, j1)) {
      if ((effectsAt(i0, k, true) | effectsAt(i1, k, true)) & FLOOR) return true;
      if (k >= j1) break;
    }
    return false;
  }
  function overlap(al, at, aw, ah, bl, bt, bw, bh) { return al < bl + bw && bl < al + aw && at < bt + bh && bt < at + ah; }
  // 箱 c を (nx, ny) に置けないか。世界・ほかの箱（group に入っているものは除く）・プレイヤー(px, py)にぶつかる
  function crateBlocked(c, nx, ny, group, px, py) {
    if (crateHitsWorld(c, nx, ny)) return true;
    var l = nx + c.bx, t = ny + c.by, i;
    for (i = 0; i < DK.crates.length; i++) {
      var o = DK.crates[i];
      if (o.dead || o === c || (group && group.indexOf(o) >= 0)) continue;
      if (overlap(l, t, c.bw, c.bh, cl(o), ct(o), o.bw, o.bh)) return true;
    }
    if (DK.mode === "play") {
      // 押している最中の「ぴったり接している」状態を邪魔と思わないよう、少し甘く見る
      if (overlap(l, t, c.bw, c.bh, px + HB.x + 0.6, py + HB.y + 0.6, HB.w - 1.2, HB.h - 1.2)) return true;
    }
    var bs = DK.bodies;                    // 他の人（みんなで遊ぶとき）。箱は他の人の体も通り抜けない
    if (bs) for (i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (!b.m && overlap(l, t, c.bw, c.bh, b.x + HB.x + 0.6, b.y + HB.y + 0.6, HB.w - 1.2, HB.h - 1.2)) return true;
    }
    return false;
  }
  // 箱 b が箱 a の真上に乗っているか
  function restsOn(b, a) {
    return b !== a && Math.abs(ct(a) - (ct(b) + b.bh)) <= 1 && cl(b) < cl(a) + a.bw && cl(a) < cl(b) + b.bw;
  }
  // 箱 o が、箱 g を step の向きに押したとき先にある（すぐ隣にくっついている）か
  function nextTo(o, g, step) {
    var gap = step > 0 ? cl(o) - (cl(g) + g.bw) : cl(g) - (cl(o) + o.bw);
    return gap > -0.6 && gap < 1 && ct(o) < ct(g) + g.bh && ct(g) < ct(o) + o.bh;
  }
  // 箱たちを横に step ずらす。その上に乗っている箱と、進む向きのすぐ隣にある箱（連なっていればその先も）も
  // いっしょに押す。どれか1つでもぶつかるなら何も動かさず false
  function moveCratesX(list, step, px, py) {
    var group = list.slice(), i, j;
    for (i = 0; i < group.length; i++) {
      for (j = 0; j < DK.crates.length; j++) {
        var o = DK.crates[j];
        if (!o.dead && group.indexOf(o) < 0 && (restsOn(o, group[i]) || nextTo(o, group[i], step))) group.push(o);
      }
    }
    if (DK.crateNet && DK.crateNet.active && !DK.crateNet.gate(group)) return false;   // みんなで遊ぶとき：箱の持ち主でなければ（権利が取れるまで）動かせない
    for (i = 0; i < group.length; i++) if (crateBlocked(group[i], group[i].x + step, group[i].y, group, px, py)) return false;
    group.forEach(function (c) { c.x += step; });
    return true;
  }
  // 重力で落とす（下の箱から先に）。穴に落ちた箱は消える
  function updateCrates() {
    var p = DK.player, order = DK.crates.filter(function (c) { return !c.dead && !c.net; })      // c.net＝他の人が持ち主の箱（位置は受信して追従する）
      .sort(function (a, b) { return (ct(b) + b.bh) - (ct(a) + a.bh); });
    order.forEach(function (c) {
      c.vy = Math.min(c.vy + P.GRAVITY, P.FALL_MAX);
      c.fall += c.vy;                 // 縦は整数ドットで動かすので、端数はためておく
      var n = Math.floor(c.fall);
      c.fall -= n;
      while (n-- > 0) {
        if (crateBlocked(c, c.x, c.y + 1, null, p.x, p.y)) { c.vy = 0; c.fall = 0; break; }
        c.y += 1;
      }
      if (c.y > DK.stage.h * T + 32) c.dead = true;
    });
  }
  // ---- 動く足場に乗った箱を運ぶ ----
  // 箱の底のすぐ下にある、動く部品の「点」を探す（プレイヤーが足場に運ばれるのと同じ仕組み）
  function findCrateRiders() {
    var out = [], movers = DK.stage.movers;
    if (!movers.length) return out;
    DK.crates.forEach(function (c) {
      if (c.dead || c.net) return;
      var row = Math.ceil(ct(c) + c.bh - 0.5), i0 = Math.ceil(cl(c) - 0.5), i1 = Math.ceil(cl(c) + c.bw - 0.5) - 1, k, i;
      for (k = i0; ; k = Math.min(k + 4, i1)) {
        for (i = 0; i < movers.length; i++) {
          var m = movers[i], wx = k + 0.5, wy = row + 0.5, dx = wx - m.cx, dy = wy - m.cy;
          if (dx * dx + dy * dy > m.r * m.r) continue;
          var tr = DK.solidTrace(m.part, wx - m.x * T, wy - m.y * T, DK.time);
          if (tr) { out.push({ c: c, tr: tr, t0: DK.time }); return; }
        }
        if (k >= i1) break;
      }
    });
    return out;
  }
  // 箱 c と、その上に積んである箱を、(dx, dy) ぶん運ぶ（1ドットずつ。ぶつかったらそこまで）。実際に動いたぶんを cdx, cdy に残す
  function shiftCrates(c, dx, dy) {
    var group = [c], i, j;
    for (i = 0; i < group.length; i++) {
      for (j = 0; j < DK.crates.length; j++) {
        var o = DK.crates[j];
        if (!o.dead && group.indexOf(o) < 0 && restsOn(o, group[i])) group.push(o);
      }
    }
    var p = DK.player;
    function step(sx, sy) {
      for (var g = 0; g < group.length; g++) if (crateBlocked(group[g], group[g].x + sx, group[g].y + sy, group, p.x, p.y)) return false;
      group.forEach(function (o) { o.x += sx; o.y += sy; o.cdx += sx; o.cdy += sy; });
      return true;
    }
    var n, sg;
    for (n = Math.abs(dx), sg = dx < 0 ? -1 : 1; n > 0; n--) if (!step(sg, 0)) break;
    for (n = Math.abs(dy), sg = dy < 0 ? -1 : 1; n > 0; n--) if (!step(0, sg)) break;
  }
  // プレイヤーが足を乗せている箱（なければ null）
  function findStandCrate(p) {
    if (!p.onGround) return null;
    var l = p.x + HB.x, row = Math.floor(p.y + HB.y + HB.h - 0.01) + 1;
    for (var j = 0; j < XS.length; j++) {
      var c = crateAtPixel(Math.floor(l + XS[j]), row);
      if (c) return c;
    }
    return null;
  }

  // 動く部品にめり込まれた箱は、近い空きへ押し出す。逃げ場がなければ消える
  function unstickCrates() {
    DK.crates.forEach(function (c) {
      if (c.dead || c.net || !crateHitsWorld(c, c.x, c.y)) return;
      for (var k = 1; k <= P.SQUEEZE_MAX; k++) {
        var tries = [[0, -k], [k, 0], [-k, 0]];
        for (var i = 0; i < tries.length; i++) {
          if (!crateHitsWorld(c, c.x + tries[i][0], c.y + tries[i][1])) { c.x += tries[i][0]; c.y += tries[i][1]; return; }
        }
      }
      c.dead = true;
    });
  }

  // ---- プレイヤー ----
  var HB = DK.PLAYER_HITBOX;                     // 12x10
  var XS = [0, 4, 8, HB.w - 0.01];               // 足場の判定点（箱の外周に等間隔）
  var YS = [0, 3, 6, HB.h - 0.01];
  var TXS = [0, 3, 6, 9, HB.w - 0.01];           // トゲ・ゴールの判定点（箱の中も含めて細かく）
  var TYS = [0, 3, 6, HB.h - 0.01];

  function collides(x, y, skipCrates) {
    var l = x + HB.x, t = y + HB.y, i;
    for (i = 0; i < XS.length; i++) {
      if (effectsAt(Math.floor(l + XS[i]), Math.floor(t), skipCrates) & EB.solid) return true;
      if (effectsAt(Math.floor(l + XS[i]), Math.floor(t + HB.h - 0.01), skipCrates) & EB.solid) return true;
    }
    for (i = 0; i < YS.length; i++) {
      if (effectsAt(Math.floor(l), Math.floor(t + YS[i]), skipCrates) & EB.solid) return true;
      if (effectsAt(Math.floor(l + HB.w - 0.01), Math.floor(t + YS[i]), skipCrates) & EB.solid) return true;
    }
    return false;
  }

  function touching(x, y) {
    var l = x + HB.x, t = y + HB.y, bits = 0;
    for (var i = 0; i < TXS.length; i++) {
      for (var j = 0; j < TYS.length; j++) bits |= effectsAt(Math.floor(l + TXS[i]), Math.floor(t + TYS[j]));
    }
    return bits;
  }

  // ---- 他のプレイヤー（みんなで遊ぶとき。DK.bodies は multi.js が毎フレーム更新する [{n,x,y,dx,dy,m}]）----
  // 体は自分と同じ大きさ(HB)の箱。ミス中・ゴール後の人（m≠0）には当たらない。
  // 「いま重なっている相手」は邪魔しない（ラウンドの開始やラグで重なっても動けなくならないように）。押し合いはしない（ぶつかって止まるだけ）
  function hitsBody(x, y, b) { return overlap(x + HB.x, y + HB.y, HB.w, HB.h, b.x + HB.x, b.y + HB.y, HB.w, HB.h); }
  // 横に動くとき、すでに重なっている相手でも「もっと深く入る」動きは止める（離れる動きは通す）。
  // 相手は0.1秒前の位置で見えているので、向かい合って走ると相手の過去の位置が自分に追いついて重なる。
  // そのとき「重なっている相手は邪魔しない」だけだと、そのまま通り抜けてしまう（実機テストで発覚）。
  // 横の重なりが浅い（頭に乗った直後など、上から見て3ドット未満）ときは、通り道をふさがない
  function playerBlock(p, nx, ny, axis) {
    var bs = DK.bodies;
    if (!bs) return null;
    for (var i = 0; i < bs.length; i++) {
      var b0 = bs[i];
      if (b0.m) continue;
      var b = axis === "x" && b0.ax !== undefined ? { x: b0.ax, y: b0.y } : b0;     // 横の動きは、相手の「いまの位置の予想」にぶつかる
      if (!hitsBody(nx, ny, b)) continue;
      if (!hitsBody(p.x, p.y, b)) return b0;
      if (axis === "x") {
        var oy = Math.min(p.y + HB.y + HB.h, b.y + HB.y + HB.h) - Math.max(p.y + HB.y, b.y + HB.y);
        if (oy >= 3 && Math.abs(nx - b.x) < Math.abs(p.x - b.x)) return b0;     // 中心どうしが近づく動き → 止める
      }
    }
    return null;
  }
  function standingBody(p) {      // 足の下にいる他の人
    var bs = DK.bodies;
    if (!bs) return null;
    for (var i = 0; i < bs.length; i++) { var b = bs[i]; if (!b.m && hitsBody(p.x, p.y + 1, b) && !hitsBody(p.x, p.y, b)) return b; }
    return null;
  }
  function bodyByN(n) {
    var bs = DK.bodies || [];
    for (var i = 0; i < bs.length; i++) if (bs[i].n === n) return bs[i];
    return null;
  }
  // 重なってしまったときの押し分け：頭にめり込んだら持ち上げ、横に重なったら左右へ少しずつ離す（毎フレーム、両方の画面で同じ向きに働く）
  function separate(p) {
    var bs = DK.bodies;
    if (!bs) return;
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (b.m || !hitsBody(p.x, p.y, b)) continue;
      var ox = Math.min(p.x + HB.x + HB.w, b.x + HB.x + HB.w) - Math.max(p.x + HB.x, b.x + HB.x);
      var oy = Math.min(p.y + HB.y + HB.h, b.y + HB.y + HB.h) - Math.max(p.y + HB.y, b.y + HB.y);
      if (oy <= ox) {
        if (p.y < b.y && !collides(p.x, p.y - 1)) { p.y -= 1; if (p.vy > 0) p.vy = 0; }   // 相手の頭の上にめり込んだ → 持ち上げる（下にめり込まれた側は相手が持ち上がる）
      } else {
        var d = (p.x + HB.w / 2) - (b.x + HB.w / 2);
        moveAxis(p, (d > 0 ? 1 : d < 0 ? -1 : (DK.myN < b.n ? -1 : 1)) * 0.5, "x");      // ぴったり重なっているときは、番号の小さい人が左へ
      }
    }
  }
  var stepCount = 0, stompHit = null, stompCool = {};

  DK.deaths = 0;
  DK.mode = "play";        // "play"（遊び中）/ "dead"（ミス演出中）/ "clear"（クリア）
  DK.modeTimer = 0;
  DK.clearInfo = null;     // クリアしたときの { time, deaths }

  DK.respawn = function () {
    var st = DK.stage.start;
    DK.mode = "play"; DK.clearInfo = null;
    setClock(0);
    // 箱の下端がマスの下端にそろう位置（スプライトの下端=箱の下端）
    DK.player = {
      x: st.x * T, y: (st.y + 1) * T - (HB.y + HB.h), vx: 0, vy: 0,
      onGround: false, facing: 1, coyote: 0, buffer: 0, cutArmed: false, anim: 0,
      wallDir: 0, wallGrace: 0, lock: 0, clinging: false, kickBan: 0
    };
    if (!(DK.crateNet && DK.crateNet.active && DK.crates.length)) makeCrates();    // 木箱は最初の位置に戻る（みんなで遊ぶときは共有物なので、ミスしても戻らない）
    DK.cam = null;   // カメラは次の描画でプレイヤーに合わせて置き直す
  };
  DK.respawn();

  // ステージ（編集中のデータ {title,start,cells}）を最初から遊ぶ。from="stage" なら「もどる」ボタンを出す
  //   opts.onClear(info) : クリアしたときに呼ばれる／ opts.note(info) : クリア画面に出す一行（文字列）
  DK.playStage = function (data, from, opts) {
    DK.playOpts = opts || null;
    DK.stage = DK.makeStage({ title: data.title, h: data.h, start: { x: data.start.x, y: data.start.y }, cells: data.cells.slice(), timeLimit: data.timeLimit });
    DK.deaths = 0;
    DK.keys = {};
    DK.crates = [];
    DK.respawn();
    document.getElementById("play-back").style.display = from === "stage" ? "inline-block" : "none";
    DK.showScreen("play");
  };

  // 制限時間（フレーム数）。無制限なら 0
  function limitFrames() { return (DK.stage.timeLimit || 0) * C.FPS; }

  DK.die = function (reason) {
    if (DK.mode !== "play") return;
    DK.missReason = reason || "miss";   // "miss"（ふつうのミス）/ "time"（時間切れ）
    DK.mode = "dead"; DK.modeTimer = P.DEAD_FRAMES; DK.deaths++;
    if (DK.sound) DK.sound.play("die");
    DK.player.vx = 0; DK.player.vy = -5.5;   // ぴょんと跳ね上がって落ちる演出
  };

  DK.clear = function () {
    if (DK.mode !== "play") return;
    DK.mode = "clear";
    DK.clearInfo = { time: DK.time, deaths: DK.deaths };
    if (DK.sound) DK.sound.play("clear");
    if (DK.playOpts && DK.playOpts.onClear) DK.playOpts.onClear(DK.clearInfo);
  };

  // 他の人に踏まれた：しばらく動きが鈍る（ミス中・ゴール後は無視）
  DK.stomped = function () { if (DK.mode === "play" && DK.player) DK.player.slow = P.STOMP_SLOW; };

  // ---- 入力 ----
  DK.keys = {};
  var prevJump = false;
  var GAME_KEYS = { ArrowLeft: 1, ArrowRight: 1, ArrowUp: 1, ArrowDown: 1, Space: 1, KeyA: 1, KeyD: 1, KeyW: 1, KeyZ: 1, KeyR: 1 };
  function playActive() { return document.getElementById("screen-play").classList.contains("active"); }
  window.addEventListener("keydown", function (e) {
    if (!GAME_KEYS[e.code] || !playActive()) return;
    e.preventDefault();
    if (document.activeElement && document.activeElement.blur && document.activeElement !== document.body) document.activeElement.blur();   // スペースでボタンが押されないように
    DK.keys[e.code] = true;
    if (e.code === "KeyR" && !e.repeat && !(DK.noRestart && DK.mode === "clear")) {      // 対戦中、ゴールしたあとはやり直せない（ほかの人に当たってしまうため）
      if (DK.mode === "clear") DK.deaths = 0;        // クリア後のRは最初からやり直し
      else if (DK.mode === "play") DK.deaths++;       // 遊び中のRは失敗に数える
      DK.respawn();
    }
  });
  window.addEventListener("keyup", function (e) { DK.keys[e.code] = false; });
  window.addEventListener("blur", function () { DK.keys = {}; });

  // ---- 1フレーム分の更新 ----
  function moveAxis(p, amount, axis) {
    while (amount !== 0) {
      var step = Math.abs(amount) >= 1 ? (amount > 0 ? 1 : -1) : amount;
      var nx = axis === "x" ? p.x + step : p.x, ny = axis === "y" ? p.y + step : p.y;
      var pb = playerBlock(p, nx, ny, axis);                // 他の人の体にぶつかるなら、そこで止まる
      if (pb) { if (axis === "y" && step > 0 && p.vy >= P.STOMP_MIN) stompHit = pb; return true; }   // 速く落ちて頭に着地 → 踏みつけ（このあと update で処理）
      if (collides(nx, ny)) {
        // 地上で横から木箱に当たったら、押す（世界の壁にも挟まれているときは押せない）
        if (axis === "x" && p.onGround && !collides(nx, ny, true)) {
          var cs = cratesTouching(nx, ny);
          if (cs.length && moveCratesX(cs, step, nx, ny)) { p.x = nx; amount -= step; continue; }
        }
        // 地上で横に進むとき、小さな段差（斜面など）は乗り越える
        if (axis === "x" && p.onGround) {
          var up = 1;
          while (up <= P.STEP_UP && collides(nx, p.y - up)) up++;
          if (up <= P.STEP_UP) { p.y -= up; p.x = nx; amount -= step; continue; }
        }
        return true;
      }
      p.x = nx; p.y = ny;
      amount -= step;
    }
    return false;
  }

  // いま足の下にある、動く足場の「点」を探す。見つかれば、その点が次のフレームでどこへ動くかを後で調べられる
  // （往復・回転・入れ子の動きがどれでも、乗っている点の移動ぶんだけ運ぶ）
  function findRider(p) {
    if (!p.onGround) return null;
    var row = Math.floor(p.y + 1 + HB.y + HB.h - 0.01), l = p.x + HB.x;
    var movers = DK.stage.movers;
    for (var i = 0; i < movers.length; i++) {
      var m = movers[i];
      for (var j = 0; j < XS.length; j++) {
        var wx = Math.floor(l + XS[j]) + 0.5, wy = row + 0.5, dx = wx - m.cx, dy = wy - m.cy;
        if (dx * dx + dy * dy > m.r * m.r) continue;
        var tr = DK.solidTrace(m.part, wx - m.x * T, wy - m.y * T, DK.time);
        if (tr) return { m: m, tr: tr, t0: DK.time };
      }
    }
    return null;
  }

  // 動く部品にめり込まれたら、近い空きへ押し出す（上を優先）。逃げ場がなければ false（潰された）
  function unstick(p) {
    if (!collides(p.x, p.y)) return true;
    for (var k = 1; k <= P.SQUEEZE_MAX; k++) {
      var tries = [[0, -k], [k, 0], [-k, 0], [0, k]];
      for (var i = 0; i < tries.length; i++) {
        if (!collides(p.x + tries[i][0], p.y + tries[i][1])) { p.x += tries[i][0]; p.y += tries[i][1]; return true; }
      }
    }
    return false;
  }

  DK.update = function () {
    if (DK.freeze) return;      // 対戦のカウントダウン中・結果表示中は動かない
    var k = DK.keys, p = DK.player;
    stepCount++; stompHit = null;
    var standOn = standingBody(p);                       // 動く前に足の下にいた他の人（その人が動いたら、いっしょに運ばれる）
    if (DK.stepOthers) DK.stepOthers();                  // 他の人の位置を1フレーム進める（みんなで遊ぶとき）

    if (DK.mode === "dead") {                    // ミス演出：跳ねて落ちて、時間が来たらやり直し
      setClock(DK.time + 1);
      p.vy = Math.min(p.vy + P.GRAVITY, P.FALL_MAX); p.y += p.vy;
      if (--DK.modeTimer <= 0) DK.respawn();
      return;
    }
    if (DK.mode === "clear") return;

    var left = k.ArrowLeft || k.KeyA, right = k.ArrowRight || k.KeyD;
    var jumpHeld = !!(k.Space || k.KeyZ || k.ArrowUp || k.KeyW);
    var jumpPressed = jumpHeld && !prevJump;
    prevJump = jumpHeld;

    // 動く部品を1フレーム進める。乗っている足場があればプレイヤーも一緒に運ぶ
    var rider = findRider(p);
    var crateRiders = findCrateRiders(), standCrate = findStandCrate(p);
    DK.crates.forEach(function (c) { c.cdx = 0; c.cdy = 0; });
    setClock(DK.time + 1);
    crateRiders.forEach(function (r) {   // 動く足場に乗っている箱は、足場の動きぶん運ばれる
      var from = DK.traceForward(r.tr, r.t0), to = DK.traceForward(r.tr, DK.time);
      if (to.x - from.x || to.y - from.y) shiftCrates(r.c, to.x - from.x, to.y - from.y);
    });
    if (DK.crateNet && DK.crateNet.active) DK.crateNet.step();   // 他の人が持ち主の箱を、受け取った位置へ動かす（cdx, cdy も残る）
    if (standCrate && (standCrate.cdx || standCrate.cdy)) {   // 運ばれる箱に乗っているプレイヤーも、いっしょに運ぶ
      if (standCrate.cdx) moveAxis(p, standCrate.cdx, "x");
      if (standCrate.cdy) moveAxis(p, standCrate.cdy, "y");
    }
    if (rider) {
      var from = DK.traceForward(rider.tr, rider.t0), to = DK.traceForward(rider.tr, DK.time);
      var dx = to.x - from.x, dy = to.y - from.y;
      if (dx) moveAxis(p, dx, "x");
      if (dy) moveAxis(p, dy, "y");
    }
    if (standOn) {                                       // 他の人の頭に乗っている：その人の動きぶん運ぶ
      var nb = bodyByN(standOn.n);
      if (nb && !nb.m) { if (nb.dx) moveAxis(p, nb.dx, "x"); if (nb.dy) moveAxis(p, nb.dy, "y"); }
    }
    unstickCrates();
    if (!unstick(p)) { DK.die(); return; }
    separate(p);

    var dir = (right ? 1 : 0) - (left ? 1 : 0);

    // 壁：空中で足場の壁に触れているか。壁の方向へキーを押しながら落ちていると張り付く
    var touchR = !p.onGround && collides(p.x + 1, p.y), touchL = !p.onGround && collides(p.x - 1, p.y);
    var wallDir = dir === 1 && touchR ? 1 : dir === -1 && touchL ? -1 : touchR ? 1 : touchL ? -1 : 0;
    p.clinging = !!wallDir && dir === wallDir && p.vy >= 0;
    if (wallDir) { p.wallDir = wallDir; p.wallGrace = P.WALL_COYOTE; } else p.wallGrace = Math.max(0, p.wallGrace - 1);
    if (p.lock > 0) p.lock--;
    var slowed = p.slow > 0;                             // 踏まれて鈍っている間
    if (slowed) p.slow--;
    // 同じ側の壁を続けてキックすることはできない（反対側の壁に触れるか、着地するとまた蹴れる）。左右の壁の間を交互に登る形になる
    if (p.onGround || (wallDir && wallDir === -p.kickBan)) p.kickBan = 0;

    if (dir) {
      var a = p.onGround ? P.ACCEL_GROUND : P.ACCEL_AIR;
      if (p.vx * dir < 0) a *= P.TURN_BONUS;
      if (p.lock > 0) a *= P.WALL_LOCK_ACCEL;
      if (slowed) a *= P.STOMP_SLOW_ACCEL;
      p.vx += dir * a;
      var runMax = slowed ? P.RUN_MAX * P.STOMP_SLOW_RUN : P.RUN_MAX;
      if (Math.abs(p.vx) > runMax) p.vx = dir * runMax;
      if (p.lock <= 0) p.facing = dir;
    } else {
      var f = p.onGround ? P.FRICTION_GROUND : P.FRICTION_AIR;
      p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
    }

    // ジャンプ（コヨーテタイムと先行入力）
    p.coyote = p.onGround ? P.COYOTE : Math.max(0, p.coyote - 1);
    if (jumpPressed) p.buffer = P.BUFFER;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = -P.JUMP_V; p.buffer = 0; p.coyote = 0; p.onGround = false;
      if (DK.sound) DK.sound.play("jump");
      p.cutArmed = jumpHeld;   // 着地前に離していた先行入力なら、小ジャンプにせず全力で跳ぶ
    }
    else if (p.buffer > 0 && p.wallGrace > 0 && !p.onGround && p.wallDir !== p.kickBan) {   // 壁キック：壁と反対側の斜め上へ
      p.vy = -P.WALL_JUMP_V; p.vx = -p.wallDir * P.WALL_JUMP_VX; p.facing = -p.wallDir;
      p.buffer = 0; p.wallGrace = 0; p.lock = P.WALL_LOCK; p.clinging = false; p.kickBan = p.wallDir;
      if (DK.sound) DK.sound.play("jump");
      p.cutArmed = jumpHeld;
    }
    if (p.buffer > 0) p.buffer--;
    if (p.cutArmed && !jumpHeld && p.vy < -P.JUMP_CUT) {        // 上昇中に離すと低く跳ぶ
      p.vy = -P.JUMP_CUT; p.cutArmed = false;
    }

    p.vy = Math.min(p.vy + P.GRAVITY, P.FALL_MAX);
    if (p.clinging) p.vy = Math.min(p.vy, P.WALL_SLIDE);

    if (p.onGround && p.vx !== 0 && cratesTouching(p.x + Math.sign(p.vx), p.y).length && !collides(p.x + Math.sign(p.vx), p.y, true)) {
      p.vx = Math.max(-P.PUSH_MAX, Math.min(P.PUSH_MAX, p.vx));   // 木箱を押すときはゆっくり
    }
    if (moveAxis(p, p.vx, "x")) p.vx = 0;
    if (moveAxis(p, p.vy, "y")) p.vy = 0;
    if (stompHit) {                                      // 踏みつけ：跳ね返り、相手には「踏まれた」を知らせる
      var sb = stompHit; stompHit = null;
      if (stepCount - (stompCool[sb.n] === undefined ? -99 : stompCool[sb.n]) > P.STOMP_COOLDOWN) {
        stompCool[sb.n] = stepCount;
        p.vy = -(jumpHeld ? P.STOMP_V_HELD : P.STOMP_V); p.cutArmed = jumpHeld; p.buffer = 0;
        if (DK.sound) DK.sound.play("jump");
        if (DK.onStomp) DK.onStomp(sb.n);
      }
    }
    p.onGround = p.vy >= 0 && (collides(p.x, p.y + 1) || !!standingBody(p));
    updateCrates();

    // 歩きアニメ
    if (p.onGround && p.vx !== 0) p.anim++; else if (!p.onGround) p.anim = 8; else p.anim = 0;

    // 効果：ゴール（優先）→ トゲなど（即死）→ 穴に落ちた
    var bits = touching(p.x, p.y);
    if (bits & EB.goal) DK.clear();
    else if ((bits & EB.deadly) || p.y > DK.stage.h * T + 32) DK.die();
    else if (limitFrames() && DK.time >= limitFrames()) DK.die("time");   // 時間切れもミス（ゴールと同じフレームならゴールが先）
  };

  // 検証用：ある瞬間の状態を保存・復元する（自動テストで先読みするため。ゲームの動作には使わない）
  DK.debug = {
    snapshot: function () {
      return { p: Object.assign({}, DK.player), crates: DK.crates.map(function (c) { return Object.assign({}, c); }), time: DK.time, mode: DK.mode, deaths: DK.deaths, prevJump: prevJump };
    },
    restore: function (s) {
      DK.player = Object.assign({}, s.p); DK.crates = s.crates.map(function (c) { return Object.assign({}, c); }); DK.mode = s.mode; DK.deaths = s.deaths; prevJump = s.prevJump;
      setClock(s.time);
    }
  };

  // ---- 描画 ----
  var VIEW_W = C.SCREEN_W * T, VIEW_H = C.SCREEN_H * T;   // 320x192（3倍で960x576）

  function drawMovers(ctx, cx, cy) {
    DK.stage.movers.forEach(function (m) {
      ctx.save();
      ctx.translate(m.x * T - cx, m.y * T - cy);
      DK.drawPartTree(ctx, m.part, DK.time);
      ctx.restore();
    });
  }

  function formatTime(frames) { return (frames / C.FPS).toFixed(2) + "秒"; }
  DK.formatTime = formatTime;

  function drawCenterText(ctx, lines, color) {
    ctx.textAlign = "center";
    lines.forEach(function (ln) {
      ctx.font = ln.size + "px DotGothic16, sans-serif";
      ctx.lineWidth = 6; ctx.strokeStyle = "#101224"; ctx.strokeText(ln.text, ln.x || 480, ln.y);
      ctx.fillStyle = ln.color || color; ctx.fillText(ln.text, ln.x || 480, ln.y);
    });
  }

  // カメラの縦位置。プレイヤーが画面の中ほど（上から35%〜60%）にいる間は動かさず、はみ出したぶんだけ追う。
  // ジャンプのたびに画面が揺れないようにするため。ステージの上下端で止まる
  function cameraY(p, s) {
    var maxY = Math.max(0, s.h * T - VIEW_H), py = p.y + 8;
    if (!DK.cam) DK.cam = { y: py - VIEW_H * 0.5 };
    var top = DK.cam.y + VIEW_H * 0.35, bottom = DK.cam.y + VIEW_H * 0.6;
    if (py < top) DK.cam.y -= top - py; else if (py > bottom) DK.cam.y += py - bottom;
    DK.cam.y = Math.max(0, Math.min(DK.cam.y, maxY));
    return Math.round(DK.cam.y);
  }

  // いまのキャラのコマ（"idle" / "walk" / "cling"）
  function playerFrameName(p) { return p.clinging ? "cling" : (p.onGround && p.vx !== 0 && ((p.anim >> 3) & 1)) || !p.onGround ? "walk" : "idle"; }
  DK.playerFrameName = playerFrameName;

  DK.render = function () {
    var canvas = document.getElementById("game"), ctx = canvas.getContext("2d");
    var p = DK.player, s = DK.stage;
    ctx.setTransform(C.SCALE, 0, 0, C.SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#101224";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);

    // カメラ：プレイヤーを画面中央に。ステージの端では止める
    var cx = Math.round(p.x + 8 - VIEW_W / 2);
    cx = Math.max(0, Math.min(cx, s.w * T - VIEW_W));
    var cy = cameraY(p, s);

    s.statics.forEach(function (inst) {
      var x = inst.x * T - cx, y = inst.y * T - cy;
      if (x + inst.part.w < 0 || x > VIEW_W || y + inst.part.h < 0 || y > VIEW_H) return;   // 画面の外は描かない
      ctx.drawImage(DK.partCanvas(inst.part), x, y);
    });
    drawMovers(ctx, cx, cy);
    DK.crates.forEach(function (c) {
      if (!c.dead) ctx.drawImage(DK.partCanvas(c.part), Math.round(c.x) - cx, Math.round(c.y) - cy);
    });

    var fname = DK.playerFrameName(p);
    if (DK.renderOthers) DK.renderOthers(ctx, cx, cy, "world");   // 他の人（みんなで遊ぶとき）。自分は一番手前に描く
    if (p.slow > 0 && ((p.slow >> 2) & 1)) ctx.globalAlpha = 0.5;   // 踏まれて鈍っている間は点滅
    if (DK.playerColor) ctx.drawImage(DK.playerSprite(fname, DK.playerColor, p.facing < 0), Math.round(p.x) - cx, Math.round(p.y) - cy);
    else DK.drawPixels(ctx, DK.playerFrames[fname], Math.round(p.x) - cx, Math.round(p.y) - cy, 1, p.facing < 0);
    ctx.globalAlpha = 1;

    // HUD（文字は倍率をかけずに描く）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (DK.renderOthers) { ctx.save(); DK.renderOthers(ctx, cx, cy, "names"); ctx.restore(); }   // 頭の上の名前
    ctx.font = "16px DotGothic16, sans-serif";
    ctx.lineWidth = 4; ctx.strokeStyle = "#101224"; ctx.fillStyle = "#f4f4f4";
    ctx.textAlign = "left";
    ctx.strokeText("失敗 " + DK.deaths, 14, 28); ctx.fillText("失敗 " + DK.deaths, 14, 28);
    ctx.textAlign = "right";
    var shown = DK.mode === "clear" ? DK.clearInfo.time : DK.time;
    if (limitFrames()) {                        // 制限時間つき：残り時間を出す（10秒を切ったら赤）
      var left = Math.max(0, limitFrames() - shown), txt = "残り " + formatTime(left);
      if (left <= 10 * C.FPS) ctx.fillStyle = "#e63946";
      ctx.strokeText(txt, 946, 28); ctx.fillText(txt, 946, 28);
    } else {
      ctx.strokeText(formatTime(shown), 946, 28); ctx.fillText(formatTime(shown), 946, 28);
    }

    if (DK.mode === "dead") {
      drawCenterText(ctx, [{ text: DK.missReason === "time" ? "時間切れ！" : "ミス！", size: 48, y: 280 }], "#e63946");
    } else if (DK.mode === "clear") {
      ctx.fillStyle = "rgba(16,18,36,0.6)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawCenterText(ctx, [
        { text: "クリア！", size: 48, y: 230, color: "#ffd166" },
        { text: "タイム " + formatTime(DK.clearInfo.time) + "　失敗 " + DK.clearInfo.deaths + "回", size: 32, y: 290, color: "#f4f4f4" },
        { text: DK.noRestart ? "みんなのゴールを待っているよ" : "R キーでもう一度", size: 16, y: 340, color: "#a9b0cc" }
      ].concat(DK.playOpts && DK.playOpts.note ? [{ text: DK.playOpts.note(DK.clearInfo), size: 16, y: 392, color: "#52b788" }] : []), "#f4f4f4");
    }
  };

  // ---- ループ（60Hz固定。表示が速い/遅いPCでも挙動を同じにする） ----
  var STEP = 1000 / C.FPS, acc = 0, last = 0;
  DK.paused = false;   // 検証用
  function frame(t) {
    requestAnimationFrame(frame);
    if (!playActive() || DK.paused) { last = t; return; }
    acc += Math.min(t - last, 100);
    last = t;
    while (acc >= STEP) { DK.update(); acc -= STEP; }
    DK.render();
    if (DK.onFrame) DK.onFrame();     // みんなで遊ぶとき、自分の位置を送る
  }
  window.addEventListener("DOMContentLoaded", function () { requestAnimationFrame(frame); });
})();
