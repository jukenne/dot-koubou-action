// ドット工房アクション：マルチプレイの通信（サーバーのページから開いたときだけ使う）
// 使い方：DK.net.connect({ onopen, onmessage(msg), onclose(info) }) / DK.net.send(obj) / DK.net.close()
(function () {
  var PING_MS = 3000;       // サーバーは10秒しゃべらない接続を切るので、3秒ごとに ping を送る
  var ws = null, pingTimer = null, pingN = 0;
  // サーバーの時計とのずれ。ping を送った時刻と pong の往復時間から測り、いちばん往復が短かったときの値を使う
  var clock = { offset: null, bestRtt: Infinity, stale: 0 };
  function onPong(m) {
    if (typeof m.c !== "number" || typeof m.s !== "number") return;
    var now = performance.now(), rtt = now - m.c;
    if (rtt < 0) return;
    if (rtt <= clock.bestRtt || ++clock.stale > 10) { clock.bestRtt = rtt; clock.stale = 0; clock.offset = m.s + rtt / 2 - now; }
  }
  function ping() { DK.net.send({ t: "ping", n: ++pingN, c: performance.now() }); }

  DK.net = {
    clock: clock,
    serverNow: function () { return performance.now() + (clock.offset || 0); },   // サーバーの時刻（ミリ秒）
    connected: function () { return !!ws && ws.readyState === 1; },
    connect: function (handlers) {
      DK.net.close();
      var sock;
      try { sock = new WebSocket("ws://" + location.host + "/ws"); }
      catch (e) { if (handlers.onclose) handlers.onclose({ opened: false }); return; }
      ws = sock;
      clock.offset = null; clock.bestRtt = Infinity; clock.stale = 0;
      var opened = false;
      sock.onopen = function () {
        opened = true;
        pingTimer = setInterval(ping, PING_MS);
        ping(); setTimeout(ping, 150); setTimeout(ping, 300);   // つないだらすぐ数回測って、時計を早くそろえる
        if (handlers.onopen) handlers.onopen();
      };
      sock.onmessage = function (e) {
        var m;
        try { m = JSON.parse(e.data); } catch (err) { return; }
        if (!m || typeof m.t !== "string") return;
        if (m.t === "pong") onPong(m);
        else if (handlers.onmessage) handlers.onmessage(m);
      };
      sock.onclose = function () {
        if (ws === sock) { clearInterval(pingTimer); ws = null; }
        if (handlers.onclose) handlers.onclose({ opened: opened });
      };
      sock.onerror = function () { /* 失敗は onclose で扱う */ };
    },
    send: function (obj) { if (DK.net.connected()) ws.send(JSON.stringify(obj)); },
    close: function () { if (ws) { var s = ws; ws = null; clearInterval(pingTimer); try { s.close(); } catch (e) { /* 無視 */ } } }
  };
})();
