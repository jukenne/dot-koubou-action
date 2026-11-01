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
    SQUEEZE_MAX: 10      // 動く部品に押されたとき、押し出して避けられる最大ドット数（これ以上は潰される）
  };
  DK.physics = P;

  // ---- ステージと判定 ----
  DK.stage = DK.tutorialStage();
  DK.time = 0;   // 今の挑戦が始まってからのフレーム数

  // 動く部品は、経過フレーム DK.time だけで位置・角度が決まる
  function setClock(t) { DK.time = t; }

  // ドット (px, py)（整数）に重なっている部品の効果のビット（EFFECT_BIT の和）
  function effectsAt(px, py) {
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

  // ---- プレイヤー ----
  var HB = DK.PLAYER_HITBOX;                     // 12x10
  var XS = [0, 4, 8, HB.w - 0.01];               // 足場の判定点（箱の外周に等間隔）
  var YS = [0, 3, 6, HB.h - 0.01];
  var TXS = [0, 3, 6, 9, HB.w - 0.01];           // トゲ・ゴールの判定点（箱の中も含めて細かく）
  var TYS = [0, 3, 6, HB.h - 0.01];

  function collides(x, y) {
    var l = x + HB.x, t = y + HB.y, i;
    for (i = 0; i < XS.length; i++) {
      if (effectsAt(Math.floor(l + XS[i]), Math.floor(t)) & EB.solid) return true;
      if (effectsAt(Math.floor(l + XS[i]), Math.floor(t + HB.h - 0.01)) & EB.solid) return true;
    }
    for (i = 0; i < YS.length; i++) {
      if (effectsAt(Math.floor(l), Math.floor(t + YS[i])) & EB.solid) return true;
      if (effectsAt(Math.floor(l + HB.w - 0.01), Math.floor(t + YS[i])) & EB.solid) return true;
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
      onGround: false, facing: 1, coyote: 0, buffer: 0, cutArmed: false, anim: 0
    };
  };
  DK.respawn();

  // ステージ（編集中のデータ {title,start,cells}）を最初から遊ぶ。from="stage" なら「もどる」ボタンを出す
  //   opts.onClear(info) : クリアしたときに呼ばれる／ opts.note(info) : クリア画面に出す一行（文字列）
  DK.playStage = function (data, from, opts) {
    DK.playOpts = opts || null;
    DK.stage = DK.makeStage({ title: data.title, start: { x: data.start.x, y: data.start.y }, cells: data.cells.slice() });
    DK.deaths = 0;
    DK.keys = {};
    DK.respawn();
    document.getElementById("play-back").style.display = from === "stage" ? "inline-block" : "none";
    DK.showScreen("play");
  };

  DK.die = function () {
    if (DK.mode !== "play") return;
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
    if (e.code === "KeyR" && !e.repeat) {
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
      if (collides(nx, ny)) {
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
    var k = DK.keys, p = DK.player;

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
    setClock(DK.time + 1);
    if (rider) {
      var from = DK.traceForward(rider.tr, rider.t0), to = DK.traceForward(rider.tr, DK.time);
      var dx = to.x - from.x, dy = to.y - from.y;
      if (dx) moveAxis(p, dx, "x");
      if (dy) moveAxis(p, dy, "y");
    }
    if (!unstick(p)) { DK.die(); return; }

    var dir = (right ? 1 : 0) - (left ? 1 : 0);
    if (dir) {
      var a = p.onGround ? P.ACCEL_GROUND : P.ACCEL_AIR;
      if (p.vx * dir < 0) a *= P.TURN_BONUS;
      p.vx += dir * a;
      if (Math.abs(p.vx) > P.RUN_MAX) p.vx = dir * P.RUN_MAX;
      p.facing = dir;
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
    if (p.buffer > 0) p.buffer--;
    if (p.cutArmed && !jumpHeld && p.vy < -P.JUMP_CUT) {        // 上昇中に離すと低く跳ぶ
      p.vy = -P.JUMP_CUT; p.cutArmed = false;
    }

    p.vy = Math.min(p.vy + P.GRAVITY, P.FALL_MAX);

    if (moveAxis(p, p.vx, "x")) p.vx = 0;
    if (moveAxis(p, p.vy, "y")) p.vy = 0;
    p.onGround = p.vy >= 0 && collides(p.x, p.y + 1);

    // 歩きアニメ
    if (p.onGround && p.vx !== 0) p.anim++; else if (!p.onGround) p.anim = 8; else p.anim = 0;

    // 効果：ゴール（優先）→ トゲなど（即死）→ 穴に落ちた
    var bits = touching(p.x, p.y);
    if (bits & EB.goal) DK.clear();
    else if ((bits & EB.deadly) || p.y > DK.stage.h * T + 32) DK.die();
  };

  // 検証用：ある瞬間の状態を保存・復元する（自動テストで先読みするため。ゲームの動作には使わない）
  DK.debug = {
    snapshot: function () {
      return { p: Object.assign({}, DK.player), time: DK.time, mode: DK.mode, deaths: DK.deaths, prevJump: prevJump };
    },
    restore: function (s) {
      DK.player = Object.assign({}, s.p); DK.mode = s.mode; DK.deaths = s.deaths; prevJump = s.prevJump;
      setClock(s.time);
    }
  };

  // ---- 描画 ----
  var VIEW_W = C.SCREEN_W * T, VIEW_H = C.SCREEN_H * T;   // 320x192（3倍で960x576）

  function drawMovers(ctx, cx) {
    DK.stage.movers.forEach(function (m) {
      ctx.save();
      ctx.translate(m.x * T - cx, m.y * T);
      DK.drawPartTree(ctx, m.part, DK.time);
      ctx.restore();
    });
  }

  function formatTime(frames) { return (frames / C.FPS).toFixed(2) + "秒"; }
  DK.formatTime = formatTime;

  function drawCenterText(ctx, lines, color) {
    ctx.textAlign = "center";
    lines.forEach(function (ln) {
      ctx.font = "bold " + ln.size + "px sans-serif";
      ctx.lineWidth = 6; ctx.strokeStyle = "#101224"; ctx.strokeText(ln.text, ln.x || 480, ln.y);
      ctx.fillStyle = ln.color || color; ctx.fillText(ln.text, ln.x || 480, ln.y);
    });
  }

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

    s.statics.forEach(function (inst) {
      var x = inst.x * T - cx;
      if (x + inst.part.w < 0 || x > VIEW_W) return;   // 画面の外は描かない
      ctx.drawImage(DK.partCanvas(inst.part), x, inst.y * T);
    });
    drawMovers(ctx, cx);

    var frame = (p.onGround && p.vx !== 0 && ((p.anim >> 3) & 1)) || !p.onGround ? "walk" : "idle";
    DK.drawPixels(ctx, DK.playerFrames[frame], Math.round(p.x) - cx, Math.round(p.y), 1, p.facing < 0);

    // HUD（文字は倍率をかけずに描く）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = "bold 20px sans-serif";
    ctx.lineWidth = 4; ctx.strokeStyle = "#101224"; ctx.fillStyle = "#f4f4f4";
    ctx.textAlign = "left";
    ctx.strokeText("失敗 " + DK.deaths, 14, 28); ctx.fillText("失敗 " + DK.deaths, 14, 28);
    ctx.textAlign = "right";
    var shown = DK.mode === "clear" ? DK.clearInfo.time : DK.time;
    ctx.strokeText(formatTime(shown), 946, 28); ctx.fillText(formatTime(shown), 946, 28);

    if (DK.mode === "dead") {
      drawCenterText(ctx, [{ text: "ミス！", size: 48, y: 280 }], "#e63946");
    } else if (DK.mode === "clear") {
      ctx.fillStyle = "rgba(16,18,36,0.6)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      drawCenterText(ctx, [
        { text: "クリア！", size: 56, y: 230, color: "#ffd166" },
        { text: "タイム " + formatTime(DK.clearInfo.time) + "　失敗 " + DK.clearInfo.deaths + "回", size: 28, y: 290, color: "#f4f4f4" },
        { text: "R キーでもう一度", size: 20, y: 340, color: "#a9b0cc" }
      ].concat(DK.playOpts && DK.playOpts.note ? [{ text: DK.playOpts.note(DK.clearInfo), size: 22, y: 392, color: "#52b788" }] : []), "#f4f4f4");
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
  }
  window.addEventListener("DOMContentLoaded", function () { requestAnimationFrame(frame); });
})();
