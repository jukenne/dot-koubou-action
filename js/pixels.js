// ドット絵の共通処理（文字→ドット配列、Canvas への描画、部品の絵のキャッシュ）
// ドット配列は 横×縦 個の数字（行ごとに並べる）。0=透明、1〜8=DK.config.PALETTE の番号+1
window.DK = window.DK || {};

// 文字の絵を 256個の数字の配列に変換
DK.textToPixels = function (rows, legend) {
  var out = [];
  rows.forEach(function (row) {
    for (var i = 0; i < row.length; i++) out.push(legend[row[i]] || 0);
  });
  return out;
};

// (x, y) の位置から 絵を作る。fn(x, y) は 0〜8 を返す。w, h は絵の大きさ（省略すると16×16）
DK.pixelsFromFn = function (fn, w, h) {
  w = w || DK.config.TILE; h = h || DK.config.TILE;
  var out = [];
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) out.push(fn(x, y) || 0);
  return out;
};

// pixels を Canvas に描く。w は絵の横幅（省略すると16）。flip=true で左右反転
DK.drawPixels = function (ctx, pixels, x, y, scale, flip, w) {
  w = w || DK.config.TILE;
  for (var i = 0; i < pixels.length; i++) {
    var v = pixels[i];
    if (!v) continue;
    var px = i % w, py = (i / w) | 0;
    if (flip) px = w - 1 - px;
    ctx.fillStyle = DK.config.PALETTE[v - 1];
    ctx.fillRect(x + px * scale, y + py * scale, scale, scale);
  }
};

// 部品の絵（子部品を除く、その部品自身の絵）を w×h の小さな Canvas にして使い回す
// 毎フレーム何千回も塗るのを避ける。絵を書き換えたら part.ver を増やすと作り直される
DK.partCanvas = function (part) {
  if (!part._canvas || part._canvasVer !== part.ver) {
    var c = part._canvas || document.createElement("canvas");
    c.width = part.w; c.height = part.h;
    DK.drawPixels(c.getContext("2d"), part.pixels, 0, 0, 1, false, part.w);
    part._canvas = c;
    part._canvasVer = part.ver;
  }
  return part._canvas;
};
