// 共有：ステージを「使った部品ごと」ファイルに書き出す／友達のファイルを安全に読み込む
//
// ファイルは JSON（拡張子 .dotkoubou.json）。見本部品は id だけを書き、自作部品は中身ぜんぶを書く。
// 読み込みでは、友達の部品に新しい id をふり直す（自分の部品を上書きしないため）。
// すでに同じ内容の部品が手元にあるときは、増やさずにそれを使う（同じファイルを何度開いても部品が増えない）。
window.DK = window.DK || {};

(function () {
  var FORMAT = "dot-koubou-stage";
  var VERSION = 1;
  var MAX_FILE_CHARS = 8 * 1024 * 1024;   // これより大きいファイルは受け付けない
  var MAX_PARTS = 200;

  // cells が使っている部品（呼び出し先も含む）のid一覧。呼び出される側が先に並ぶ
  DK.usedPartIds = function (cells) {
    var seen = {}, order = [];
    function visit(id, depth) {
      var p = DK.parts[id];
      if (!p || seen[id] || depth > DK.MAX_DEPTH + 2) return;
      seen[id] = true;
      p.children.forEach(function (c) { visit(c.partId, depth + 1); });
      order.push(id);
    }
    cells.forEach(function (c) { visit(c.partId, 0); });
    return order;
  };

  function hash(str) {
    var h = 5381;
    for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + "-" + str.length.toString(36);
  }

  // ステージの中身（置き方・スタート・使っている部品の絵や設定）から決まる印。
  // 1つでも変わると別の値になるので、「クリアしたときと同じステージか」の判定に使う
  DK.stageSignature = function (data) {
    var parts = DK.usedPartIds(data.cells).sort().map(function (id) { return DK.partToData(DK.parts[id]); });
    return hash(JSON.stringify({ s: data.start, c: data.cells, p: parts }));
  };

  // 書き出し用の文字列を作る。clear は { time, deaths }（作者のクリア記録）
  DK.exportStageText = function (data, clear) {
    var ids = DK.usedPartIds(data.cells);
    var obj = {
      format: FORMAT, version: VERSION,
      title: data.title || "", author: data.author || "",
      start: data.start, cells: data.cells.map(function (c) { return { x: c.x, y: c.y, partId: c.partId }; }),
      parts: ids.filter(function (id) { return !DK.parts[id].builtin; }).map(function (id) { return DK.partToData(DK.parts[id]); }),
      authorClear: clear ? { time: clear.time, deaths: clear.deaths } : null
    };
    return JSON.stringify(obj);
  };

  DK.exportFileName = function (data) {
    var base = (data.title || "ステージ").replace(/[\\/:*?"<>|\s]+/g, "_").slice(0, 24) || "stage";
    return base + ".dotkoubou.json";
  };

  // 部品の中身を比べるための文字列（id は含めない）
  function contentKey(d) {
    return JSON.stringify([d.name, d.w, d.h, d.pixels, d.motion, d.effect, d.children.map(function (c) { return [c.partId, c.x, c.y]; })]);
  }

  // 友達のファイルの文字列を読み込む。成功なら { ok:true, data:{title,author,start,cells}, authorClear, newParts }
  // 失敗なら { ok:false, error:"理由" }。部品は手元に追加される（自作部品として保存される）
  DK.importStageText = function (text) {
    if (typeof text !== "string" || text.length > MAX_FILE_CHARS) return { ok: false, error: "ファイルが大きすぎるか、読めないよ。" };
    var raw;
    try { raw = JSON.parse(text); } catch (e) { return { ok: false, error: "ステージのファイルじゃないみたい（読み取れなかったよ）。" }; }
    if (!raw || raw.format !== FORMAT) return { ok: false, error: "ドット工房アクションのステージのファイルじゃないみたい。" };
    if (raw.version !== VERSION) return { ok: false, error: "このファイルは新しい（または古い）形式で、まだ読めないよ。" };
    if (!Array.isArray(raw.cells) || raw.cells.length > DK.config.STAGE_W * DK.config.STAGE_H) return { ok: false, error: "ステージの中身が正しくないよ。" };

    // 1. ファイルの部品を安全チェック（id はファイル内のもの）
    var defs = {};
    (Array.isArray(raw.parts) ? raw.parts.slice(0, MAX_PARTS) : []).forEach(function (r) {
      var d = DK.sanitizePart(r);
      if (d && !(DK.parts[d.id] && DK.parts[d.id].builtin)) defs[d.id] = d;   // 見本と同じidは無視（見本を使う）
    });

    // 2. 新しい id をふり直しながら、呼び出される側から順に取り込む
    var map = {}, state = {}, added = 0;
    function resolve(id) {
      if (DK.parts[id] && DK.parts[id].builtin) return id;     // 見本部品はそのまま
      if (!defs[id]) return null;                               // ファイルにない部品は無かったことにする
      if (map[id]) return map[id];
      if (state[id] === "busy") return null;                    // 循環はここで切る
      state[id] = "busy";
      var d = defs[id], kids = [];
      d.children.forEach(function (c) {
        var m = resolve(c.partId);
        if (m) kids.push({ partId: m, x: c.x, y: c.y });
      });
      var def = { id: null, name: d.name, w: d.w, h: d.h, pixels: d.pixels, motion: d.motion, effect: d.effect, children: kids };
      var key = contentKey(def), found = null;
      DK.partOrder.forEach(function (pid) {
        var p = DK.parts[pid];
        if (!found && !p.builtin && contentKey(DK.partToData(p)) === key) found = pid;
      });
      if (found) map[id] = found;
      else {
        def.id = DK.newPartId();
        DK.addPart(def);
        map[id] = def.id; added++;
      }
      state[id] = "done";
      return map[id];
    }

    var cells = [];
    raw.cells.forEach(function (c) {
      if (!c || typeof c.partId !== "string") return;
      var m = resolve(c.partId);
      if (m) cells.push({ x: c.x, y: c.y, partId: m });
    });
    DK.fixGraph();
    if (added) DK.saveUserParts();
    cells = DK.sanitizeCells(cells);
    if (!cells.length) return { ok: false, error: "置かれている部品が1つも読み込めなかったよ。" };

    var base = DK.sanitizeStageData({ title: raw.title, start: raw.start, cells: cells });
    var ac = raw.authorClear;
    var authorClear = ac && Number.isInteger(ac.time) && ac.time > 0 && ac.time < 60 * 60 * 60 * 10 && Number.isInteger(ac.deaths) && ac.deaths >= 0
      ? { time: ac.time, deaths: Math.min(ac.deaths, 9999) } : null;
    return {
      ok: true,
      data: { title: base.title, author: String(raw.author || "").replace(/[\r\n\t]/g, " ").slice(0, 16), start: base.start, cells: base.cells },
      authorClear: authorClear, newParts: added
    };
  };
})();
