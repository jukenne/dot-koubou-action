// プレイヤーキャラ：現実にいない丸っこい四足の生き物。青い体、頭の触角の先に光る黄色い玉、炎のようなしっぽ
// 16x16ドット、右向きで描いて左向きは反転する
// 文字の意味: . 透明 / b 青 / w 白 / k 黒（目） / r 赤（ほっぺ） / y 黄（触角の玉としっぽ）
window.DK = window.DK || {};

DK.PLAYER_LEGEND = { ".": 0, "k": 1, "w": 2, "r": 3, "y": 5, "b": 7 };   // 数字は DK.config.PALETTE の番号+1

DK.PLAYER_FRAMES_TEXT = {
  // 立ち
  idle: [
    "................",
    "................",
    "............yy..",
    "............yy..",
    "............b...",
    "....bbbbbbbbb...",
    "y.bbbbbbbbbbbb..",
    "yybbbbbbbkbbkbb.",
    "yybbbbbbbkbbkbb.",
    "ybbbbbbbrbbbbrb.",
    ".bbwwwwwwwwwwbb.",
    ".bbwwwwwwwwwwbb.",
    "..bbbbbbbbbbbb..",
    "..bb.bb..bb.bb..",
    "..bb.bb..bb.bb..",
    "..ww.ww..ww.ww.."
  ],
  // 歩き（足を広げる）
  walk: [
    "................",
    "................",
    "............yy..",
    "............yy..",
    "............b...",
    "....bbbbbbbbb...",
    "y.bbbbbbbbbbbb..",
    "yybbbbbbbkbbkbb.",
    "yybbbbbbbkbbkbb.",
    "ybbbbbbbrbbbbrb.",
    ".bbwwwwwwwwwwbb.",
    ".bbwwwwwwwwwwbb.",
    "..bbbbbbbbbbbb..",
    ".bb..bb..bb.bb..",
    ".bb..bb..bb.bb..",
    ".ww..ww..ww.ww.."
  ],
  // 壁に張り付く（右の壁に手をついている。左の壁のときは反転して描く）
  cling: [
    "................",
    "................",
    "............yy..",
    "............yy..",
    "............b...",
    "....bbbbbbbbb...",
    "y.bbbbbbbbbbbbw.",
    "yybbbbbbbkbbkbb.",
    "yybbbbbbbkbbkbb.",
    "ybbbbbbbrbbbbrbw",
    ".bbwwwwwwwwwwbb.",
    ".bbwwwwwwwwwwbb.",
    "..bbbbbbbbbbbb..",
    "..bb.bb..bb.bb..",
    "..bb.bb..bb.bb..",
    "..ww.ww..ww.ww.."
  ]
};

// 当たり判定の箱（スプライト内のドット座標。耳としっぽは含めない）
DK.PLAYER_HITBOX = { x: 2, y: 6, w: 12, h: 10 };

DK.playerFrames = {};
Object.keys(DK.PLAYER_FRAMES_TEXT).forEach(function (name) {
  DK.playerFrames[name] = DK.textToPixels(DK.PLAYER_FRAMES_TEXT[name], DK.PLAYER_LEGEND);
});
