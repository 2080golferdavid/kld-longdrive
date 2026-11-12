/*
 * KLD LONG DRIVE — KOREA LONG DRIVE SUMMIT 2026 로고 (광고판용 작은 픽셀 스프라이트)
 *
 * 받은 로고 이미지(assets/logo/summit-2026.webp)를 광고판에 맞게 46x30 도트로 다시 그린 것이다.
 * 산은 원본 모양을 따라 봉우리 3개로 그렸고, 글자는 크기가 작아 변환하면 뭉개져서 도트 글자로 직접 찍었다.
 * '.' 투명(판 바탕), 'n' 남색, 'b' 하늘색. 흰 판(#ffffff) 위에 그리는 것을 전제로 한 색이다.
 * 광고판에 넣는 법: config.js 의 brand.sponsors 에 'SUMMIT' 을 적는다 (js/render.js 의 drawBoard 가 그린다).
 */
(function (root) {
  'use strict';
  var KLD = root.KLD = root.KLD || {};

  var ROWS = [
    '......................b.......................',
    '.....................bbb......................',
    '....................bbbbb.....................',
    '...................bbbb.bb....................',
    '...........b......bbbbbb.bb.......b...........',
    '..........bbb....bbbbbbbb.bb.....bbb..........',
    '.........bbb.b..bbbbbbbbbb.bb...bbb.b.........',
    '...b....bbbbb.bbbbbbbbbbbbb.bb.bbbbb.b....b...',
    '..bbb..bbbbbbb.bbbbbbbbbbbbbbbbbbbbbb.b..bbb..',
    '.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.',
    '..............................................',
    '.............n.n.nnn.nn..nnn..n...............',
    '.............n.n.n.n.n.n.n...n.n..............',
    '.............nn..n.n.nn..nn..nnn..............',
    '.............n.n.n.n.n.n.n...n.n..............',
    '.............n.n.nnn.n.n.nnn.n.n..............',
    '..............................................',
    'n.....nn..n..n..nnn...nnn..nnn..nnn.n..n.nnnn.',
    'n....n..n.nn.n.n......n..n.n..n..n..n..n.n....',
    'n....n..n.nn.n.n......n..n.n..n..n..n..n.n....',
    'n....n..n.n.nn.n.nn...n..n.nnn...n..n..n.nnn..',
    'n....n..n.n.nn.n..n...n..n.n.n...n..n..n.n....',
    'n....n..n.n..n.n..n...n..n.n..n..n...nn..n....',
    'nnnn..nn..n..n..nnn...nnn..n..n.nnn..nn..nnnn.',
    '..............................................',
    'bbb.b.b.b...b.b...b.bbb.bbb..nnn.nnn.nnn.nnn..',
    'b...b.b.bb.bb.bb.bb..b...b.....n.n.n...n.n....',
    'bbb.b.b.b.b.b.b.b.b..b...b...nnn.n.n.nnn.nnn..',
    '..b.b.b.b...b.b...b..b...b...n...n.n.n...n.n..',
    'bbb.bbb.b...b.b...b.bbb..b...nnn.nnn.nnn.nnn..'
  ];
  var COLORS = { n: '#05142b', b: '#3aadff' };
  var W = ROWS[0].length, H = ROWS.length;
  var canvas = null;

  function build() {
    if (canvas || typeof document === 'undefined') return canvas;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var g = c.getContext('2d');
    if (!g) return null;
    for (var y = 0; y < H; y++) {
      for (var x = 0; x < W; x++) {
        var col = COLORS[ROWS[y].charAt(x)];
        if (col) { g.fillStyle = col; g.fillRect(x, y, 1, 1); }
      }
    }
    canvas = c;
    return canvas;
  }

  // (x, y) 가 왼쪽 위. 그릴 수 없으면 null (호출한 쪽에서 글자로 대신한다)
  function draw(g, x, y) {
    var c = build();
    if (!c) return null;
    g.drawImage(c, Math.round(x), Math.round(y));
    return { x: Math.round(x), y: Math.round(y), w: W, h: H };
  }

  KLD.summit = { w: W, h: H, draw: draw, available: function () { return !!build(); } };
})(typeof globalThis !== 'undefined' ? globalThis : this);
