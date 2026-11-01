// 効果音（Web Audio で小さな音を合成する。音声ファイルは使わない）
// ブラウザの決まりで、最初のクリック／キー入力のあとにしか鳴らせない。鳴らせなくてもゲームは普通に動く。
window.DK = window.DK || {};

(function () {
  var KEY = "dk.sound";
  var ctx = null;
  var on = true;
  try { on = localStorage.getItem(KEY) !== "off"; } catch (e) {}

  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // 1音：type=波形, f0→f1 に周波数を変えながら dur 秒鳴らす
  function tone(c, t0, type, f0, f1, dur, vol) {
    var o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  var SOUNDS = {
    jump:  function (c, t) { tone(c, t, "square", 300, 640, 0.12, 0.06); },
    die:   function (c, t) { tone(c, t, "sawtooth", 420, 70, 0.4, 0.07); },
    clear: function (c, t) { [523, 659, 784, 1047].forEach(function (f, i) { tone(c, t + i * 0.1, "square", f, f, 0.16, 0.06); }); },
    place: function (c, t) { tone(c, t, "triangle", 520, 520, 0.04, 0.08); },
    erase: function (c, t) { tone(c, t, "triangle", 220, 160, 0.06, 0.08); },
    pick:  function (c, t) { tone(c, t, "triangle", 700, 900, 0.05, 0.06); }
  };

  DK.sound = {
    play: function (name) {
      if (!on || !SOUNDS[name]) return;
      var c = audio();
      if (c) SOUNDS[name](c, c.currentTime);
    },
    isOn: function () { return on; },
    toggle: function () {
      on = !on;
      try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) {}
      DK.sound.render();
      if (on) DK.sound.play("pick");
    },
    render: function () {
      var b = document.getElementById("sound-toggle");
      if (b) { b.textContent = on ? "🔊 音あり" : "🔇 音なし"; b.setAttribute("aria-pressed", on ? "true" : "false"); }
    }
  };

  window.addEventListener("DOMContentLoaded", function () {
    var b = document.getElementById("sound-toggle");
    if (b) b.addEventListener("click", DK.sound.toggle);
    DK.sound.render();
  });
})();
