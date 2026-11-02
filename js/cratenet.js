// ドット工房アクション：みんなで遊ぶときの木箱の共有（MP4b）
// 箱は番号 i（ステージの並び順。全員が同じステージを読むので同じ番号になる）で呼ぶ。
//   持ち主 … その箱の物理を計算して、位置を20回/秒で送る人。箱を押した人が（サーバーの先着順判定で）なる
//   ほかの人 … 受け取った位置を0.1秒遅れで補間して箱を動かす（箱は「動かない障害物」として扱う。乗れる・ぶつかる）
//   持ち主のいない箱 … 全員が自分の画面で普通に計算する（動かないので、全員で同じ結果になる）
// game.js とのつなぎ口：DK.crateNet.active / gate(group)（押す前に権利を取る）/ step()（毎フレーム）、各箱の c.net（他の人が持ち主）
(function () {
  var INTERP_MS = 100;
  var owners = {};       // 箱の番号 → 持ち主のプレイヤー番号（持ち主のいない箱は載っていない）
  var buf = {};          // 箱の番号 → 受け取った位置の履歴 [{ t, x, y, d }]
  var auth = {};         // 箱の番号 → 最後に確定した位置 { x, y, d }。権利を断られたときの戻り先
  var lastSent = {};     // 自分が最後に送った位置
  var lastClaimAt = 0;
  var pending = {};      // 箱の番号 → 申請した時刻。サーバーの返事が届くまでの「仮の持ち主」（そのあいだに別の知らせが来ても戻さない）
  var PENDING_MS = 1500;

  function round2(v) { return Math.round(v * 100) / 100; }

  function snapshotInitial() {
    auth = {};
    DK.crates.forEach(function (c, i) { auth[i] = { x: c.x, y: c.y, d: c.dead ? 1 : 0 }; });
  }

  function setPos(i, p) {
    var c = DK.crates[i];
    if (!c || !p) return;
    c.x = p.x; c.y = p.y; c.dead = !!p.d; c.vy = 0; c.fall = 0;
  }

  // 履歴から、時刻 rt の位置（補間）。大きく飛んだ（やり直しなど）ときは補間しない
  function sample(list, rt) {
    if (!list || !list.length) return null;
    if (rt <= list[0].t) return list[0];
    for (var k = list.length - 1; k > 0; k--) {
      if (list[k - 1].t > rt) continue;
      var a = list[k - 1], b = list[k];
      if (rt >= b.t) return b;
      if (Math.abs(b.x - a.x) > 48 || Math.abs(b.y - a.y) > 48) return a;
      var f = (rt - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, d: a.d };
    }
    return list[list.length - 1];
  }

  function indexOfCrate(c) { return DK.crates.indexOf(c); }

  var net = DK.crateNet = {
    active: false,

    begin: function () {
      owners = {}; buf = {}; lastSent = {}; pending = {};
      snapshotInitial();
      net.active = true;
    },
    end: function () {
      net.active = false; owners = {}; buf = {}; lastSent = {}; pending = {};
      DK.crates.forEach(function (c) { c.net = false; });
    },

    // 箱の塊 group を押す前に呼ばれる。動かしてよければ true。
    //   持ち主がいない箱 → すぐ自分のものにして動かす（サーバーに権利を申請。先に別の人が取っていたら、あとで元に戻される）
    //   別の人が持ち主の箱 → 動かせない（その人がしばらく動かしていなければ、申請が通って動かせるようになる）
    gate: function (group) {
      var ids = group.map(indexOfCrate), claim = false, blocked = false;
      ids.forEach(function (i) {
        var o = owners[i];
        if (o === DK.myN) return;
        if (o === undefined) claim = true; else blocked = true;
      });
      if (blocked) {
        var now = performance.now();
        if (now - lastClaimAt >= 200) { lastClaimAt = now; DK.net.send({ t: "claim", ids: ids }); }
        return false;
      }
      if (claim) {
        var t = performance.now();
        ids.forEach(function (i) { owners[i] = DK.myN; pending[i] = t; var c = DK.crates[i]; c.net = false; c.vy = 0; c.fall = 0; });
        DK.net.send({ t: "claim", ids: ids });
      }
      return true;
    },

    // 毎フレーム（game.js の update から）：他の人が持ち主の箱を、受け取った位置へ動かす。動いたぶんは cdx, cdy に足す（箱に乗っている人を運ぶため）
    step: function () {
      var rt = performance.now() - INTERP_MS;
      DK.crates.forEach(function (c, i) {
        var o = owners[i];
        if (o === undefined || o === DK.myN) { c.net = false; return; }
        c.net = true;
        var s = sample(buf[i], rt) || auth[i];
        if (!s) return;
        var dx = s.x - c.x, dy = s.y - c.y;
        c.x = s.x; c.y = s.y; c.dead = !!s.d; c.vy = 0; c.fall = 0;
        if (Math.abs(dx) <= 24 && Math.abs(dy) <= 24) { c.cdx += dx; c.cdy += dy; }
      });
    },

    // 一定間隔で（multi.js の onFrame から）：自分が持ち主の箱のうち、動いたものの位置を送る
    flush: function () {
      var items = [];
      DK.crates.forEach(function (c, i) {
        if (owners[i] !== DK.myN) return;
        var d = c.dead ? 1 : 0, ls = lastSent[i];
        if (ls && ls.x === c.x && ls.y === c.y && ls.d === d) return;
        lastSent[i] = { x: c.x, y: c.y, d: d };
        items.push({ i: i, x: round2(c.x), y: c.y, d: d });
      });
      for (var k = 0; k < items.length; k += 24) DK.net.send({ t: "crate", c: items.slice(k, k + 24) });
    },

    // サーバーからの知らせ。扱ったら true
    onMessage: function (m) {
      var now = performance.now();
      if (m.t === "cinit" || m.t === "cs") {
        (m.c || []).forEach(function (it) {
          auth[it.i] = { x: it.x, y: it.y, d: it.d };
          if (m.t === "cinit") { setPos(it.i, auth[it.i]); buf[it.i] = []; }
          else if (owners[it.i] !== DK.myN) (buf[it.i] = buf[it.i] || []).push({ t: now, x: it.x, y: it.y, d: it.d });
          if (buf[it.i] && buf[it.i].length > 8) buf[it.i].shift();
        });
        if (m.t === "cinit") net.applyOwners(m.o);
        return true;
      }
      if (m.t === "cown") { net.applyOwners(m.o); return true; }
      if (m.t === "creset") {
        DK.makeCrates(); snapshotInitial();
        owners = {}; buf = {}; lastSent = {}; pending = {};
        return true;
      }
      return false;
    },

    // 持ち主の表を更新する。自分のものだと思っていた箱を失ったら、最後に確定した位置へ戻す（先に別の人が取っていた）
    applyOwners: function (list) {
      var next = {}, now = performance.now();
      (list || []).forEach(function (e) { next[e[0]] = e[1]; });
      DK.crates.forEach(function (c, i) {
        var was = owners[i], is = next[i];
        if (is === DK.myN || (is !== undefined && is !== DK.myN)) delete pending[i];   // 返事が来た（通った・先に別の人が取っていた）
        if (was === DK.myN && is === undefined && pending[i] && now - pending[i] < PENDING_MS) { next[i] = DK.myN; return; }   // 申請中：返事が来るまで自分のものとして扱う
        if (was === DK.myN && is !== DK.myN) {
          setPos(i, auth[i]);
          buf[i] = [{ t: performance.now(), x: c.x, y: c.y, d: c.dead ? 1 : 0 }];
          delete lastSent[i];
        }
        if (is === DK.myN && was !== DK.myN) { c.net = false; c.vy = 0; c.fall = 0; delete lastSent[i]; }   // 権利が通った・引き継いだ
      });
      owners = next;
    }
  };
})();
