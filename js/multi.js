// ドット工房アクション：「みんなで」画面（参加・ロビー・ひろば）。表示はすべて textContent で行う（HTMLとして解釈させない）
(function () {
  function $(id) { return document.getElementById(id); }
  var myN = null, myName = "", myColor = null, joined = false;
  var roster = {};          // 番号 → { name, color }（ロビーの最新の名簿）
  var inPlaza = false, plazaT0 = 0, others = {};   // ひろばにいる間：ひろばの時計の0／他の人（番号 → { s: [受け取った位置の履歴] }）
  var SEND_MS = 50;         // 自分の位置を送る間隔（1秒に20回）
  var INTERP_MS = 100;      // 他の人は0.1秒前の姿で描く（届く間隔のばらつきをなめらかにつなぐため）
  var FRAME_NAMES = ["idle", "walk", "cling"], FRAME_IDX = { idle: 0, walk: 1, cling: 2 };
  var lastSend = 0;

  function store(key, val) { try { if (val === undefined) return localStorage.getItem(key); localStorage.setItem(key, val); } catch (e) { return null; } }

  function say(text, ok) { var el = $("mp-msg"); el.textContent = text || ""; el.className = "mp-msg" + (ok ? " ok" : ""); }
  function showLobby(on) { $("mp-join").hidden = on; $("mp-lobby").hidden = !on; }
  function safeColor(c) { return /^#[0-9a-fA-F]{6}$/.test(c) ? c : "#8d99ae"; }
  function round2(v) { return Math.round(v * 100) / 100; }
  function playScreenActive() { return $("screen-play").classList.contains("active"); }

  // ---- ロビー ----
  function renderLobby(m) {
    showMatchInfo(m.match);
    roster = {};
    var ul = $("mp-players"); ul.textContent = "";
    (m.players || []).forEach(function (p) {
      roster[p.n] = { name: p.name, color: safeColor(p.color) };
      var li = document.createElement("li");
      if (p.n === myN) li.className = "me";
      var dot = document.createElement("span"); dot.className = "mp-dot"; dot.style.background = safeColor(p.color);
      var name = document.createElement("span"); name.textContent = p.name + (p.n === myN ? "（あなた）" : "") + (p.in ? "　🎮ひろば" : "");
      li.appendChild(dot); li.appendChild(name); ul.appendChild(li);
    });
    var tb = $("mp-board").tBodies[0]; tb.textContent = "";
    (m.board || []).forEach(function (r, i) {
      var tr = document.createElement("tr");
      [String(i + 1), r.name, String(r.wins), String(r.games)].forEach(function (v, k) {
        var td = document.createElement("td"); td.textContent = v; if (k !== 1) td.className = "num"; tr.appendChild(td);
      });
      tb.appendChild(tr);
    });
    if (!(m.board || []).length) {
      var tr2 = document.createElement("tr"), td2 = document.createElement("td");
      td2.colSpan = 4; td2.textContent = "まだ記録がありません"; tr2.appendChild(td2); tb.appendChild(tr2);
    }
  }

  // ---- ひろば：位置の送受信 ----
  // 受け取った位置の履歴から、いまの表示時刻（0.1秒前）の位置を補間して返す。大きく飛んだとき（やり直し）は補間しない
  function sampleAt(o, rt) {
    var s = o.s;
    if (!s.length) return null;
    if (rt <= s[0].t) return s[0];
    for (var i = s.length - 1; i > 0; i--) {
      if (s[i - 1].t > rt) continue;
      var a = s[i - 1], b = s[i];
      if (rt >= b.t) return b;
      if (Math.abs(b.x - a.x) > 48 || Math.abs(b.y - a.y) > 48) return a;
      var k = (rt - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, f: a.f, a: a.a, m: a.m };
    }
    return s[s.length - 1];
  }

  // game.js が毎フレーム呼ぶ：他の人の「いまの体」（描いているのと同じ0.1秒前の補間位置）を DK.bodies にする。
  // dx, dy は前のフレームからの動き（頭に乗っている人を運ぶのに使う）。やり直しなどで大きく飛んだときは0にする
  DK.stepOthers = function () {
    if (!inPlaza) { DK.bodies = null; return; }
    var rt = performance.now() - INTERP_MS, bodies = [];
    Object.keys(others).forEach(function (k) {
      var o = others[k], s = sampleAt(o, rt);
      if (!s) return;
      var x = Math.round(s.x), y = Math.round(s.y);
      var dx = o.lx === undefined ? 0 : x - o.lx, dy = o.ly === undefined ? 0 : y - o.ly;
      if (Math.abs(dx) > 24 || Math.abs(dy) > 24) { dx = 0; dy = 0; }
      o.lx = x; o.ly = y;
      // ax: ぶつかり判定（横）用の「いまの位置の予想」。描いているのは0.1秒前の姿だが、向かい合って走ると
      //     お互いに過去の位置にぶつかって、実際には追い越してしまう。最新に届いた位置に、届いてからの経過ぶんの速度を足して使う
      var last = o.s[o.s.length - 1], ax = x;
      if (last) { var age = Math.min(6, Math.max(0, (performance.now() - last.t) * DK.config.FPS / 1000)); ax = Math.round(last.x + (last.vx || 0) * age); }
      bodies.push({ n: Number(k), x: x, y: y, ax: ax, dx: dx, dy: dy, m: s.m });
    });
    DK.bodies = bodies;
  };
  DK.onStomp = function (n) { DK.net.send({ t: "stomp", to: n }); };    // 相手の頭を踏んだ → 相手に知らせる

  function onSnap(m) {
    var now = performance.now(), seen = {};
    (m.p || []).forEach(function (p) {
      if (p.n === myN) return;                 // 自分の位置は自分で持っている
      seen[p.n] = true;
      var o = others[p.n] || (others[p.n] = { s: [] });
      o.s.push({ t: now, x: p.x, y: p.y, vx: p.vx, f: p.f, a: p.a, m: p.m });
      if (o.s.length > 8) o.s.shift();
    });
    Object.keys(others).forEach(function (k) { if (!seen[k]) delete others[k]; });   // ひろばから出た人を消す
  }

  // game.js から呼ばれる：他の人と自分の名前を描く。pass="world" はキャラ（倍率つきの世界の座標）、"names" は名前（倍率なし）
  DK.renderOthers = function (ctx, cx, cy, pass) {
    if (!inPlaza) return;
    var rt = performance.now() - INTERP_MS, list = [];
    Object.keys(others).forEach(function (k) {
      var info = roster[k], s = sampleAt(others[k], rt);
      if (info && s) list.push({ info: info, s: s });
    });
    if (pass === "world") {
      list.forEach(function (e) {
        ctx.save();
        if (e.s.m) ctx.globalAlpha = 0.45;      // ミス中・ゴール後はうすく
        ctx.drawImage(DK.playerSprite(FRAME_NAMES[e.s.a] || "idle", e.info.color, e.s.f < 0), Math.round(e.s.x) - cx, Math.round(e.s.y) - cy);
        ctx.restore();
      });
      return;
    }
    var scale = DK.config.SCALE;
    ctx.font = "16px DotGothic16, sans-serif"; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#101224";
    function label(text, x, y, color) {
      var px = (Math.round(x) + 8 - cx) * scale, py = (Math.round(y) - cy) * scale - 6;
      ctx.strokeText(text, px, py); ctx.fillStyle = color; ctx.fillText(text, px, py);
    }
    list.forEach(function (e) { label(e.info.name, e.s.x, e.s.y, "#f4f4f4"); });
    if (DK.player) label(myName, DK.player.x, DK.player.y, "#ffd166");
  };

  // game.js が毎フレーム呼ぶ：一定間隔で自分の位置を送る
  DK.onFrame = function () {
    if (!inPlaza) return;
    var now = performance.now();
    if (now - lastSend < SEND_MS) return;
    lastSend = now;
    var p = DK.player;
    DK.net.send({ t: "pos", x: round2(p.x), y: round2(p.y), vx: round2(p.vx), vy: round2(p.vy), f: p.facing < 0 ? -1 : 1,
      a: FRAME_IDX[DK.playerFrameName(p)], m: DK.mode === "dead" ? 1 : DK.mode === "clear" ? 2 : 0 });
    DK.crateNet.flush();                  // 自分が持ち主の木箱の位置も送る
  };

  // 全員で共通の時計：ひろばの0からの経過フレーム。ふだんは1フレームずつ進め、ずれたら1フレームずつ寄せる（大きくずれたら一気に合わせる）
  function frameNow() { return Math.max(0, Math.floor((DK.net.serverNow() - plazaT0) * DK.config.FPS / 1000)); }
  function clockFn(wanted, cur) {
    var target = frameNow();
    if (wanted === 0 || Math.abs(target - cur) > 20) return target;    // 始まり・やり直しでも、時計は戻さず共通の時刻に合わせる
    var d = target - wanted;
    return wanted + (d >= 2 ? 1 : d <= -2 ? -1 : 0);
  }

  function enterPlaza(m) {
    plazaT0 = m.t0;
    if (DK.net.clock.offset === null) DK.net.clock.offset = m.now - performance.now();   // ping の結果がまだなら、この応答で仮に合わせる
    inPlaza = true; others = {}; lastSend = 0;
    DK.clockFn = clockFn; DK.playerColor = myColor;
    var makeStage = { tutorial: DK.tutorialStage, tower: DK.towerStage }[m.stage] || DK.tutorialStage;
    DK.playStage(makeStage(), "multi");
    DK.crateNet.begin();                  // 木箱の共有を始める（サーバーからの cinit で、いまの位置と持ち主が届く）
    $("play-lobby").hidden = false; $("play-crates").hidden = false;
    $("play-msg").textContent = "ひろば：みんなで走りまわれるよ。ぶつかる・頭に乗れる・上から踏める。木箱は全員で共有（押した人のものになる。押し合って動かないときは、押し返すと奪える）。";
  }

  function leavePlaza(tellServer) {
    if (!inPlaza) return;
    inPlaza = false; others = {}; DK.bodies = null;
    DK.clockFn = null; DK.playerColor = null;
    DK.crateNet.end();
    $("play-lobby").hidden = true; $("play-crates").hidden = true; $("play-msg").textContent = "";
    if (tellServer) DK.net.send({ t: "exit" });
  }


  // ---- 対戦（MP5）：サーバーが進行を決め、ここは「見せる」と「ゴールを知らせる」だけ ----
  // ラウンドの流れ：round（ステージと開始時刻が届く）→ カウントダウン → GO → goal（だれかがゴール）→ rresult（結果）→ … → final（最終結果）
  var inMatch = false;      // 対戦中（ひろばと同じ仕組みで位置を送り合う）
  var rd = null;            // いまのラウンド { r, of, start, limit, title, author, phase: "intro" | "play" | "result" }
  var tempIds = [];         // このラウンドのために一時的に読み込んだ部品（遊び終わったら消す。自分の部品一覧には混ぜない）
  var goalSent = false, goals = 0, endAt = 0, matchTimer = null, goaledNames = [];
  var matchInfo = { on: false };     // ロビーの知らせにのっている対戦の状況

  function serverNow() { return DK.net.serverNow(); }
  function fmtMs(ms) { var s = Math.floor(ms / 1000), c = Math.floor((ms % 1000) / 10); return s + "." + (c < 10 ? "0" : "") + c + "秒"; }
  function overlay(on, cls) { var o = $("mp-overlay"); o.hidden = !on; o.className = "mp-overlay" + (cls ? " " + cls : ""); return o; }
  function line(parent, cls, text) { var d = document.createElement("div"); d.className = cls; d.textContent = text; parent.appendChild(d); return d; }

  function dropTemp(ids) { if (ids && ids.length) DK.dropParts(ids); }

  // 対戦の画面を片づける。部品の一時置き場を空にして、安全な見本ステージを置いておく（消した部品を使うステージが画面に残らないように）
  function closeMatchView() {
    inMatch = false; rd = null; goalSent = false; goals = 0; endAt = 0; goaledNames = [];
    clearInterval(matchTimer); matchTimer = null;
    DK.freeze = false; DK.noRestart = false;
    overlay(false); $("mp-hud").hidden = true;
    var old = tempIds; tempIds = [];
    if (old.length) {
      DK.playStage(DK.tutorialStage(), "stage");
      dropTemp(old);
      DK.showScreen("multi");
    }
  }

  function startRoundView(m) {
    var ids = [], data = null;
    var s = m.stage || {};
    if (s.kind === "file") {
      var r = DK.importStageText(String(s.text || ""), { temp: true });      // 受け取ったステージも、ブラウザ側でもう一度ぜんぶ検査する（設計書 S-9）
      if (!r.ok) { $("play-msg").textContent = "受け取ったステージが読めませんでした：" + r.error; return; }
      data = r.data; ids = r.tempIds;
    } else {
      var make = { tutorial: DK.tutorialStage, tower: DK.towerStage }[s.key];
      if (!make) { $("play-msg").textContent = "知らないステージが選ばれました。"; return; }
      data = make();
    }
    inMatch = true; inPlaza = true; others = {}; lastSend = 0;
    plazaT0 = m.start;
    DK.clockFn = clockFn; DK.playerColor = myColor;
    DK.noRestart = false; goalSent = false; goals = 0; endAt = 0; goaledNames = [];
    rd = { r: m.r, of: m.of, start: m.start, limit: m.limit, title: s.title || "", author: s.author || "", phase: "intro", cleared: false };
    var oldIds = tempIds; tempIds = ids;
    DK.freeze = false;
    DK.playStage(data, "multi", { onClear: onMyGoal });
    DK.crateNet.begin();
    dropTemp(oldIds);                              // 前のラウンドの部品は、新しいステージに切りかえたあとで消す
    DK.freeze = serverNow() < m.start;
    $("play-lobby").hidden = true; $("play-crates").hidden = true;
    $("play-msg").textContent = "対戦：ゴール旗に一番乗りを目指そう！　ぶつかる・頭に乗る・踏みつける・木箱の取り合いもアリ。";
    $("mp-hud").hidden = false;
    clearInterval(matchTimer); matchTimer = setInterval(matchTick, 100); matchTick();
    DK.showScreen("play");
  }

  function onMyGoal() {
    if (!inMatch || goalSent || !rd || rd.phase === "result") return;
    goalSent = true; DK.noRestart = true;
    DK.net.send({ t: "goal" });
  }

  // 0.1秒ごと：カウントダウン・GO・上の帯の更新
  function matchTick() {
    if (!inMatch || !rd) return;
    var now = serverNow(), toGo = rd.start - now;
    if (rd.phase === "intro") {
      if (toGo > 0) {
        DK.freeze = true;
        var o = overlay(true); o.textContent = "";
        line(o, "mp-sub", "ラウンド " + rd.r + " / " + rd.of);
        line(o, "mp-mid", rd.title || "（なまえなし）");
        if (rd.author) line(o, "mp-sub", "作者：" + rd.author);
        if (toGo <= 3000) line(o, "mp-big", String(Math.ceil(toGo / 1000)));
        else line(o, "mp-sub", "もうすぐ始まるよ…");
      } else {
        rd.phase = "play"; DK.freeze = false;
        var g = overlay(true, "clear"); g.textContent = ""; line(g, "mp-big", "GO!");
        setTimeout(function () { if (rd && rd.phase === "play") overlay(false); }, 700);
      }
    }
    var hud = $("mp-hud"); hud.textContent = "";
    function item(text, cls) { var s = document.createElement("span"); if (cls) s.className = cls; s.textContent = text; hud.appendChild(s); }
    item("ラウンド " + rd.r + " / " + rd.of);
    item("ゴール済み " + goals + "人");
    if (rd.phase === "result") item("結果発表");
    else if (endAt) { var left = Math.max(0, endAt - now); item("あと " + (left / 1000).toFixed(1) + " 秒で終了！", "bad"); }
    else if (rd.phase === "play") { var rest = Math.max(0, rd.start + rd.limit * 1000 - now); item("制限時間 " + Math.ceil(rest / 1000) + " 秒", rest < 10000 ? "bad" : ""); }
    else item("まもなくスタート");
    if (goaledNames.length) item("🏁 " + goaledNames.slice(0, 4).join(" → "), "hot");
  }

  function onGoalMsg(m) {
    goals = Math.max(goals, m.rank);
    endAt = m.end;
    goaledNames.push(m.name);
    if (m.n === myN) { var o = overlay(true, "clear"); o.textContent = ""; line(o, "mp-mid", m.rank + "位でゴール！"); setTimeout(function () { if (rd && rd.phase === "play") overlay(false); }, 1600); }
  }

  function resultTable(parent, rows, withRound) {
    var t = document.createElement("table"); t.className = "mp-result";
    var head = document.createElement("tr");
    (withRound ? ["順位", "なまえ", "タイム", "このラウンド", "合計"] : ["順位", "なまえ", "ゴール", "合計"]).forEach(function (h, i) {
      var th = document.createElement("th"); th.textContent = h; if (i >= 2) th.className = "num"; head.appendChild(th);
    });
    t.appendChild(head);
    rows.forEach(function (r, i) {
      var tr = document.createElement("tr");
      if (r.n === myN || (!withRound && r.name === myName)) tr.className = "me";
      var cells = withRound
        ? [r.rank ? r.rank + "位" : "—", r.name, r.rank ? fmtMs(r.ms) : "ゴールならず", r.rank ? "+" + r.pts : "0", String(r.total)]
        : [(r.win ? "👑 " : "") + (i + 1) + "位", r.name, r.goals + "回", r.total + "点"];
      cells.forEach(function (c, k) { var td = document.createElement("td"); td.textContent = c; if (k >= 2) td.className = "num"; tr.appendChild(td); });
      t.appendChild(tr);
    });
    parent.appendChild(t);
  }

  function onRoundResult(m) {
    if (!rd) return;
    rd.phase = "result"; DK.freeze = true; endAt = 0;
    var o = overlay(true); o.textContent = "";
    line(o, "mp-mid", "ラウンド " + m.r + " / " + m.of + " の結果");
    resultTable(o, m.rows, true);
    line(o, "mp-sub", m.last ? "このあと最終結果です…" : "つぎのラウンドをお楽しみに！");
  }

  function leaveToLobby() {
    leavePlaza(false); closeMatchView();
    DK.showScreen("multi");
  }

  function onFinal(m) {
    var winners = (m.rows || []).filter(function (r) { return r.win; });
    leavePlaza(false); rd = null; inMatch = false; goaledNames = []; clearInterval(matchTimer); matchTimer = null;
    DK.freeze = true; DK.noRestart = false; $("mp-hud").hidden = true;
    var o = overlay(true); o.textContent = "";
    line(o, "mp-sub", "最終結果");
    if (winners.length) {
      line(o, "mp-big", "👑 " + winners.map(function (w) { return w.name; }).join("・"));
      line(o, "mp-mid", winners.length > 1 ? "同点で優勝！" : "優勝！");
    } else line(o, "mp-mid", "今回は優勝者なし（ゴールした人がいませんでした）");
    resultTable(o, m.rows || [], false);
    var b = document.createElement("button"); b.className = "btn primary"; b.textContent = "ロビーにもどる";
    b.addEventListener("click", leaveToLobby); o.appendChild(b);
  }

  function onAbort(m) {
    leavePlaza(false); rd = null; inMatch = false; goaledNames = []; clearInterval(matchTimer); matchTimer = null;
    DK.freeze = true; DK.noRestart = false; $("mp-hud").hidden = true;
    var o = overlay(true); o.textContent = "";
    line(o, "mp-mid", "対戦が中止されました");
    if (m.why) line(o, "mp-sub", m.why);
    var b = document.createElement("button"); b.className = "btn primary"; b.textContent = "ロビーにもどる";
    b.addEventListener("click", leaveToLobby); o.appendChild(b);
  }

  // ロビーの対戦の表示
  function showMatchInfo(mi) {
    matchInfo = mi || { on: false };
    var t = $("mp-matchinfo");
    if (matchInfo.on) t.textContent = "対戦中：ラウンド " + matchInfo.r + " / " + matchInfo.of + (inMatch ? "" : "（次のラウンドから参加できるよ）");
    else t.textContent = "オーナーが対戦を始めるのを待っています。";
    $("mp-matchback").hidden = !inMatch;
    $("mp-plaza").disabled = !!matchInfo.on;
  }

  // ---- 参加 ----
  var DENIED = {
    pass: "合言葉がちがうよ。オーナーに聞いてみてね。",
    name: "なまえは 1〜10文字で入れてね。",
    taken: "そのなまえは、いま使われているよ。ほかのなまえにしてね。",
    full: "いっぱいで入れないよ。"
  };

  function join() {
    var name = $("mp-name").value.trim(), pass = $("mp-pass").value.trim();
    if (!name) { say("なまえを入れてね。"); return; }
    if (!pass) { say("合言葉を入れてね。"); return; }
    $("mp-go").disabled = true; say("つないでいます…", true);
    var told = false;     // 理由つきのメッセージを出し済みなら、切断のメッセージで上書きしない
    DK.net.connect({
      onopen: function () { DK.net.send({ t: "join", pass: pass, name: name, id: store("dk.mp.id") || undefined }); },
      onmessage: function (m) {
        if (m.t === "joined") {
          joined = true; myN = m.n; DK.myN = m.n; myName = m.name; myColor = safeColor(m.color);
          store("dk.mp.id", m.id); store("dk.mp.name", m.name);
          $("mp-me").textContent = "（" + m.name + " として参加中）";
          say(""); showLobby(true);
        } else if (m.t === "lobby") renderLobby(m);
        else if (m.t === "plaza") enterPlaza(m);
        else if (m.t === "round") startRoundView(m);
        else if (m.t === "goal") { if (inMatch) onGoalMsg(m); }
        else if (m.t === "rresult") { if (inMatch) onRoundResult(m); }
        else if (m.t === "final") onFinal(m);
        else if (m.t === "mabort") onAbort(m);
        else if (m.t === "busy") say("対戦中だよ。終わるまで待ってね。", false);
        else if (m.t === "snap") onSnap(m);
        else if (m.t === "stomped") { if (inPlaza && DK.stomped) DK.stomped(); }
        else if (m.t === "cinit" || m.t === "cs" || m.t === "cown" || m.t === "creset") { if (inPlaza) DK.crateNet.onMessage(m); }
        else if (m.t === "denied") {
          told = true;
          say(m.blocked ? "まちがいが続いたので、10分間は入れません。" : (DENIED[m.reason] || "参加できませんでした。"));
        } else if (m.t === "kicked") { told = true; say("ほかの画面から入り直されたので、こちらは終了したよ。"); }
      },
      onclose: function (info) {
        var was = joined; joined = false; $("mp-go").disabled = false; showLobby(false);
        var wasPlaza = inPlaza; leavePlaza(false); closeMatchView();
        if (wasPlaza) DK.showScreen("multi");
        if (told) return;
        if (was) say("サーバーとの接続が切れたよ。もう一度「参加する」を押してね。");
        else if (!info.opened) say("つながりませんでした。このページがマルチプレイ用サーバーのURLか、Hamachi がつながっているか確認してね。");
        else say("接続が切れました。もう一度ためしてね。");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!/^https?:$/.test(location.protocol)) return;     // ファイルを直接開いたときは「みんなで」を出さない
    $("tab-multi").hidden = false;
    $("mp-name").value = store("dk.mp.name") || "";
    $("mp-go").addEventListener("click", join);
    [$("mp-name"), $("mp-pass")].forEach(function (el) { el.addEventListener("keydown", function (e) { if (e.key === "Enter") join(); }); });
    $("mp-leave").addEventListener("click", function () { leavePlaza(false); DK.net.close(); joined = false; showLobby(false); $("mp-go").disabled = false; say("退出しました。"); });
    $("mp-plaza").addEventListener("click", function () { DK.net.send({ t: "enter" }); });
    $("play-lobby").addEventListener("click", function () { leavePlaza(true); DK.showScreen("multi"); });
    $("play-crates").addEventListener("click", function () { DK.net.send({ t: "creset" }); });   // 木箱を最初の位置にもどす（全員の画面で）
    // タブなどで「あそぶ」画面から離れたら、ひろばからも出る（画面が止まると位置が送られず、他の人に固まって見えるため）
    $("mp-back").addEventListener("click", function () { DK.showScreen("play"); });
    setInterval(function () { if (inPlaza && !inMatch && !playScreenActive()) leavePlaza(true); }, 500);   // 対戦中は離れても抜けない（ロビーの「対戦の画面にもどる」で戻れる）
  });
})();
