// ステージデータ
// ステージ = { title, author, w, h, start:{x,y}, cells:[{x, y, partId}], grid }
//   cells が保存・共有されるデータ。grid は遊ぶとき用に作る「マスごとの部品」の早見表
window.DK = window.DK || {};

// 動かない・子を持たない部品か（マス目の早見表に載せてよいか）
DK.isSimpleStatic = function (part) {
  return part.motion.type === "static" && part.children.length === 0;
};

// 遊ぶとき用の早見表を作る。cells の x, y は、部品の左上が置かれるマス
//   grid    : 動かない部品を、占めるマスすべてに並べたもの（すぐ引ける）。値は { part, x, y }
//   statics : grid に載せた部品の一覧（描画用）
//   crateDefs: 押せる部品（木箱）。早見表には載せない
//   movers  : 動く部品・子を持つ部品の一覧。cx, cy, r は「この円の外には届かない」範囲で、判定の絞り込みに使う
DK.buildGrid = function (stage) {
  var T = DK.config.TILE;
  stage.grid = new Array(stage.w * stage.h).fill(null);
  stage.statics = [];
  stage.movers = [];
  stage.crateDefs = [];   // 押せる部品（木箱）の最初の置き場所。遊ぶとき DK.crates に取り出して動かす
  stage.cells.forEach(function (c) {
    var part = DK.parts[c.partId];
    if (!part) return;
    var inst = { part: part, x: c.x, y: c.y };
    if (part.effect === "push" && DK.isSimpleStatic(part)) {
      stage.crateDefs.push(inst);
    } else if (DK.isSimpleStatic(part)) {
      for (var ty = c.y; ty < c.y + part.h / T; ty++) {
        for (var tx = c.x; tx < c.x + part.w / T; tx++) {
          if (tx >= 0 && tx < stage.w && ty >= 0 && ty < stage.h) stage.grid[ty * stage.w + tx] = inst;
        }
      }
      stage.statics.push(inst);
    } else {
      inst.cx = c.x * T + part.w / 2;
      inst.cy = c.y * T + part.h / 2;
      inst.r = DK.extentOf(part);
      stage.movers.push(inst);
    }
  });
};

DK.makeStage = function (o) {
  var stage = {
    title: o.title || "",
    author: o.author || "",
    w: DK.config.STAGE_W,
    h: DK.sanitizeStageHeight(o.h),
    start: o.start || { x: 2, y: 9 },    // スタート位置のマス。キャラの足元がこのマスの下端にそろう
    cells: o.cells || [],
    timeLimit: DK.sanitizeTimeLimit(o.timeLimit)   // 制限時間（秒）。0 なら無制限
  };
  DK.buildGrid(stage);
  return stage;
};

// 見本ステージ（コードで組んだもの）。部品の判定・動き・効果を一通り試せる並び。右端にゴール旗
// 見本ステージ2「いろいろ部品」
DK.sampleStage = function () {
  var cells = [];
  function put(x, y, id) { cells.push({ x: x, y: y, partId: id }); }
  function row(x0, x1, y, id) { for (var x = x0; x <= x1; x++) put(x, y, id); }
  var W = DK.config.STAGE_W, x;

  // 地面（2段）。穴は x=20〜23 と 46〜49
  for (x = 0; x < W; x++) {
    if ((x >= 20 && x <= 23) || (x >= 46 && x <= 49)) continue;
    put(x, 10, "grass");
    put(x, 11, "dirt");
  }
  // トゲ（ジャンプで越える）
  put(12, 9, "spike"); put(13, 9, "spike");
  // 薄い足場
  row(8, 11, 7, "thin");
  row(14, 16, 5, "thin");
  // 穴 1：横に動く足場で渡る
  put(20, 10, "mplat");
  // 半ブロックと階段
  put(26, 9, "half");
  row(28, 29, 9, "grass"); put(29, 8, "grass");
  // 山（斜面）
  row(32, 34, 9, "hill");
  // 丸石（積むとくぼみができる）
  put(38, 9, "round");
  put(40, 9, "round"); put(41, 9, "round"); put(41, 8, "round"); put(41, 7, "round");
  // 回転ノコギリ（ジャンプで越える）
  put(44, 9, "saw");
  // 穴 2：動く足場で渡る。真上でノコギリが回っているのでジャンプは禁物
  put(46, 10, "mplat");
  put(48, 7, "saw");
  // 草の階段
  for (var s = 0; s < 5; s++) for (var k = 0; k <= s; k++) put(54 + s, 9 - k, "grass");
  // エレベーター（縦に動く足場）で上の薄い足場へ
  put(60, 9, "vplat");
  row(62, 65, 6, "thin");
  // 半ブロックの道
  row(68, 71, 9, "half");
  // ゴール
  put(77, 9, "flag");

  return DK.makeStage({ title: "いろいろ部品", author: "", start: { x: 2, y: 9 }, cells: cells });
};

// 見本ステージ3「たてのぼり」（高さ24）：木箱を寄せて踏み台にして高い壁を越え、壁キックで縦穴を登ってゴールへ
DK.towerStage = function () {
  var cells = [];
  function put(x, y, id) { cells.push({ x: x, y: y, partId: id }); }
  var x, y;
  for (x = 0; x < DK.config.STAGE_W; x++) { put(x, 22, "grass"); put(x, 23, "dirt"); }   // 地面
  put(6, 21, "crate"); put(6, 20, "crate"); put(6, 19, "crate");   // 積んだ木箱（下を押すと上もいっしょに動く）
  for (y = 14; y <= 21; y++) put(14, y, "grass");          // 高い壁（8マス。ジャンプ＋壁キックでも約7マスまで。木箱を寄せて踏み台にする）
  put(19, 21, "spike"); put(20, 21, "spike");              // 壁を越えたあとのトゲ
  for (y = 6; y <= 19; y++) put(24, y, "grass");           // 縦穴の左の壁（下に入り口がある）
  for (y = 5; y <= 21; y++) put(28, y, "grass");           // 縦穴の右の壁
  for (x = 29; x <= 44; x++) { put(x, 5, "grass"); put(x, 6, "dirt"); }   // 登った先の足場
  put(35, 4, "spike"); put(36, 4, "spike");                // 最後のトゲ
  put(42, 4, "flag");                                      // ゴール
  return DK.makeStage({ title: "たてのぼり", author: "", h: 24, start: { x: 2, y: 21 }, cells: cells });
};

// ---- ステージの保存・安全チェック（M5） ----
DK.STAGE_KEY = "dk.stage";

// 制限時間（秒）。0 = 無制限。作り手が決められる範囲は 5〜600 秒の整数
DK.TIME_LIMIT_MIN = 5;
DK.TIME_LIMIT_MAX = 600;
DK.sanitizeTimeLimit = function (v) {
  v = Math.round(Number(v));
  if (!isFinite(v) || v <= 0) return 0;
  return Math.max(DK.TIME_LIMIT_MIN, Math.min(DK.TIME_LIMIT_MAX, v));
};

// ステージの縦マス数。選べる値（DK.config.STAGE_HEIGHTS）以外は基本の12にする（昔のステージは h がない）
DK.sanitizeStageHeight = function (v) {
  v = Number(v);
  return DK.config.STAGE_HEIGHTS.indexOf(v) >= 0 ? v : DK.config.STAGE_H;
};
DK.STAGE_H_MAX = Math.max.apply(null, DK.config.STAGE_HEIGHTS);

// 部品がステージ上で占めるマス数
DK.tilesOf = function (part) {
  return { w: part.w / DK.config.TILE, h: part.h / DK.config.TILE };
};

// (x, y) に部品を置いたとき、ステージ（縦 h マス）の中に収まるか
DK.fitsStage = function (part, x, y, h) {
  var t = DK.tilesOf(part);
  return x >= 0 && y >= 0 && x + t.w <= DK.config.STAGE_W && y + t.h <= (h || DK.config.STAGE_H);
};

// 保存データ・友達のファイルを読むときの安全チェック。使えない置き方は捨てる。
// 後ろに書かれたものが手前に重なる（古い方を残さず、重なったら後勝ち）
DK.sanitizeCells = function (list, h) {
  var out = [];
  if (!Array.isArray(list)) return out;
  list.forEach(function (c) {
    if (!c || typeof c.partId !== "string" || !DK.parts[c.partId]) return;
    var x = Number(c.x), y = Number(c.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    var part = DK.parts[c.partId];
    if (!DK.fitsStage(part, x, y, h)) return;
    out = DK.placeCell(out, { x: x, y: y, partId: c.partId });
  });
  return out;
};

// cells に新しい置き方 cell を加える。重なる古い部品は取り除く（置き換え）。新しい配列を返す
DK.placeCell = function (cells, cell) {
  var t = DK.tilesOf(DK.parts[cell.partId]);
  var kept = cells.filter(function (o) {
    var ot = DK.tilesOf(DK.parts[o.partId]);
    return o.x + ot.w <= cell.x || cell.x + t.w <= o.x || o.y + ot.h <= cell.y || cell.y + t.h <= o.y;
  });
  kept.push({ x: cell.x, y: cell.y, partId: cell.partId });
  return kept;
};

// マス (tx, ty) を覆っている、いちばん手前（後に置いた）の cell の番号。なければ -1
DK.cellIndexAt = function (cells, tx, ty) {
  for (var i = cells.length - 1; i >= 0; i--) {
    var c = cells[i], part = DK.parts[c.partId];
    if (!part) continue;
    var t = DK.tilesOf(part);
    if (tx >= c.x && tx < c.x + t.w && ty >= c.y && ty < c.y + t.h) return i;
  }
  return -1;
};

DK.sanitizeStageData = function (d) {
  d = d && typeof d === "object" ? d : {};
  var s = d.start || {}, h = DK.sanitizeStageHeight(d.h);
  var sx = Number.isInteger(s.x) ? Math.max(0, Math.min(DK.config.STAGE_W - 1, s.x)) : 2;
  var sy = Number.isInteger(s.y) ? Math.max(0, Math.min(h - 1, s.y)) : h - 3;
  var cl = d.cleared, cleared = null;
  if (cl && typeof cl.sig === "string" && cl.sig.length <= 30 && Number.isInteger(cl.time) && cl.time > 0 && Number.isInteger(cl.deaths) && cl.deaths >= 0) {
    cleared = { sig: cl.sig, time: cl.time, deaths: cl.deaths };   // 作者がクリアしたときの印と記録（M6）
  }
  return {
    id: typeof d.id === "string" && /^[a-z0-9]{1,24}$/.test(d.id) ? d.id : "",
    updated: Number.isFinite(d.updated) ? d.updated : 0,
    title: String(d.title || "").slice(0, 24),
    author: String(d.author || "").replace(/[\r\n\t]/g, " ").slice(0, 16),
    h: h,
    start: { x: sx, y: sy },
    cells: DK.sanitizeCells(d.cells, h),
    timeLimit: DK.sanitizeTimeLimit(d.timeLimit),
    cleared: cleared
  };
};

// ---- 作ったステージの一覧（このブラウザの localStorage）----
// 昔は「いま作っている1つ」だけ（dk.stage）だった。いまは一覧（dk.stages）で持ち、ステージ選択画面に並べる。
DK.STAGES_KEY = "dk.stages";
DK.STAGES_MAX = 30;

DK.newStageId = function () { return "s" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); };

function stageListRaw() {
  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(DK.STAGES_KEY) || "null"); } catch (e) { raw = null; }
  if (Array.isArray(raw)) return raw;
  // はじめて：昔の1ステージ版（dk.stage）があれば、一覧の最初の1つとして引き継ぐ（元のデータは消さない）
  var old = null;
  try { old = JSON.parse(localStorage.getItem(DK.STAGE_KEY) || "null"); } catch (e) { old = null; }
  return old ? [Object.assign({ id: DK.newStageId(), updated: Date.now() }, old)] : [];
}

function writeStageList(list) {
  try { localStorage.setItem(DK.STAGES_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}

// 一覧（新しく更新した順）。安全チェック済み
DK.listStages = function () {
  var out = [];
  stageListRaw().forEach(function (r) {
    var d = DK.sanitizeStageData(r);
    if (d.id) out.push(d);
  });
  return out.sort(function (a, b) { return b.updated - a.updated; });
};

DK.getStage = function (id) {
  var l = DK.listStages();
  for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
  return null;
};

// 保存（id が一覧になければ追加）。成功したら true
DK.saveStageData = function (d) {
  if (!d || !d.id) return false;
  var rec = { id: d.id, updated: Date.now(), title: d.title, author: d.author, h: d.h || DK.config.STAGE_H, start: d.start, cells: d.cells, timeLimit: d.timeLimit || 0, cleared: d.cleared || null };
  var list = stageListRaw(), found = false;
  list = list.map(function (r) { if (r && r.id === d.id) { found = true; return rec; } return r; });
  if (!found) {
    if (list.length >= DK.STAGES_MAX) return false;
    list.push(rec);
  }
  d.updated = rec.updated;
  return writeStageList(list);
};

DK.deleteStage = function (id) {
  return writeStageList(stageListRaw().filter(function (r) { return r && r.id !== id; }));
};

// 新しいステージ（地面とゴールだけの、すぐ遊べる土台）
DK.blankStage = function () {
  var cells = [];
  for (var x = 0; x < DK.config.STAGE_W; x++) { cells.push({ x: x, y: 10, partId: "grass" }); cells.push({ x: x, y: 11, partId: "dirt" }); }
  cells.push({ x: 77, y: 9, partId: "flag" });
  return { id: DK.newStageId(), updated: Date.now(), title: "", author: "", h: DK.config.STAGE_H, start: { x: 2, y: 9 }, cells: cells, timeLimit: 0, cleared: null };
};

// 見本ステージ1「はじめの一歩」：走る・ジャンプ・穴・トゲ・階段だけ。ゲームの基本を知るための短くやさしい面
DK.tutorialStage = function () {
  var cells = [];
  function put(x, y, id) { cells.push({ x: x, y: y, partId: id }); }
  function inPit(x) { return (x >= 22 && x <= 24) || (x >= 48 && x <= 50) || (x >= 64 && x <= 66); }
  for (var x = 0; x < DK.config.STAGE_W; x++) {
    if (inPit(x)) continue;
    put(x, 10, "grass");
    put(x, 11, "dirt");
  }
  put(14, 9, "spike");                                   // トゲ：ジャンプで越える
  put(30, 9, "grass"); put(31, 9, "grass"); put(31, 8, "grass");   // 階段
  put(32, 9, "grass"); put(32, 8, "grass"); put(32, 7, "grass");
  put(36, 7, "thin"); put(37, 7, "thin"); put(38, 7, "thin");      // 高いところの足場（寄り道）
  put(42, 9, "spike"); put(43, 9, "spike");               // トゲ2つ（少し長いジャンプ）
  put(56, 9, "round"); put(57, 9, "round"); put(57, 8, "round");   // 丸石（なめらかな坂）
  put(72, 9, "half");                                    // 半ブロック
  put(77, 9, "flag");                                    // ゴール
  return DK.makeStage({ title: "はじめの一歩", author: "", start: { x: 2, y: 9 }, cells: cells });
};
