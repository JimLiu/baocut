/* 字体库的演示数据（product-design §5.9「字体」，architecture-design §9.1）。
   ============================================================================
   选字列表把三种来源合成一张表：随应用发布的（内置）、本机已装的（本机）、Google Fonts
   字体目录里的（可下载，约 1900 个族）。这里只摆一小撮够演示各种状态的族；
   真实应用读 `fonts.catalogue`（族名、分类、文字、字重、许可与此刻的状态）。

   - `families`：每个族的元数据。`source` 是来源，`rank` 是目录的热门次序（越小越热门），
     `faceBytes` 是下载一个字重大约多大（中日韩字体一个字重就有 5–20 MB）。
     名字与 `BC_DATA.fonts.all` 对得上的，样张写法（`st`）用那一份；这里没有的族按族名摊。
   - `initial`：打开原型时下载缓存里已有的族与字重。
   - `inVideo`：演示视频（p1）用到的族——打开它时自动下载其中还没下载的。
   - `flaky`：第一次下载会失败的族（演示失败与重试）。
   - `catalogueTotal`：真实目录的族数（列表头写「共 N 个」）。
   不是 `data.js` 的一部分：那一份由别的屏幕共用，这里单独一份，免得互相牵动。
   ============================================================================ */
(function () {
  const OFL = 'OFL-1.1';
  const APACHE = 'Apache-2.0';
  const UFL = 'UFL-1.0';
  const f = (family, source, category, scripts, weights, licence, rank, faceBytes, extra) =>
    Object.assign({family, source, category, scripts, weights, italics: [], licence, rank, faceBytes}, extra || {});
  const MB = 1024 * 1024;

  const families = [
    // 随应用发布（渲染内核自带，不下载）
    f('Poppins', 'built-in', 'sans-serif', ['latin'], [400, 600, 700, 900], OFL, 12),
    f('Montserrat', 'built-in', 'sans-serif', ['latin', 'cyrillic'], [400, 600, 700], OFL, 4),
    f('Inter', 'built-in', 'sans-serif', ['latin', 'cyrillic', 'greek'], [400, 500, 700], OFL, 8),
    f('Anton', 'built-in', 'sans-serif', ['latin'], [400], OFL, 40),
    f('Bangers', 'built-in', 'display', ['latin'], [400], OFL, 160),
    f('Playfair Display', 'built-in', 'serif', ['latin', 'cyrillic'], [400, 700, 900], OFL, 30),
    f('Noto Sans SC', 'built-in', 'sans-serif', ['chinese', 'latin'], [400, 500, 700], OFL, 20),
    f('Rubik', 'built-in', 'sans-serif', ['latin', 'cyrillic', 'hebrew'], [400, 700, 900], OFL, 25),
    f('Squada One', 'built-in', 'display', ['latin'], [400], OFL, 600),
    f('Shrikhand', 'built-in', 'display', ['latin'], [400], OFL, 700),
    f('Archivo Black', 'built-in', 'sans-serif', ['latin'], [400], OFL, 220),
    f('Source Serif 4', 'built-in', 'serif', ['latin', 'cyrillic'], [400, 600], OFL, 140),
    f('System', 'built-in', 'sans-serif', ['latin', 'chinese', 'japanese', 'korean'], [400], null, 0),
    // 本机已装（同族只认本机的，不下载）
    f('思源黑体 Source Han Sans', 'local', 'sans-serif', ['chinese', 'japanese', 'korean', 'latin'], [400, 500, 700], OFL, null),
    f('思源宋体 Source Han Serif', 'local', 'serif', ['chinese', 'japanese', 'korean', 'latin'], [400, 600], OFL, null),
    f('站酷快乐体', 'local', 'display', ['chinese'], [400], null, null),
    f('Source Sans 3', 'local', 'sans-serif', ['latin'], [400, 600], OFL, null),
    f('Source Code Pro', 'local', 'monospace', ['latin'], [400], OFL, null),
    // Google Fonts 字体目录（按需下载）
    f('Ma Shan Zheng', 'google-fonts', 'handwriting', ['chinese', 'latin'], [400], OFL, 310, 5.6 * MB),
    f('ZCOOL KuaiLe', 'google-fonts', 'display', ['chinese', 'latin'], [400], OFL, 280, 4.1 * MB),
    f('Noto Serif SC', 'google-fonts', 'serif', ['chinese', 'latin'], [400, 700], OFL, 90, 11.8 * MB),
    f('Long Cang', 'google-fonts', 'handwriting', ['chinese', 'latin'], [400], OFL, 520, 6.2 * MB),
    f('Noto Sans JP', 'google-fonts', 'sans-serif', ['japanese', 'latin'], [400, 700], OFL, 10, 5.3 * MB),
    f('Zen Maru Gothic', 'google-fonts', 'sans-serif', ['japanese', 'latin'], [400, 700], OFL, 380, 3.9 * MB),
    f('Noto Sans KR', 'google-fonts', 'sans-serif', ['korean', 'latin'], [400, 700], OFL, 14, 6.0 * MB),
    f('Black Han Sans', 'google-fonts', 'sans-serif', ['korean', 'latin'], [400], OFL, 640, 2.4 * MB),
    f('Roboto', 'google-fonts', 'sans-serif', ['latin', 'cyrillic', 'greek', 'vietnamese'], [400, 500, 700], OFL, 1, 0.5 * MB, {italics: [400, 700]}),
    f('Open Sans', 'google-fonts', 'sans-serif', ['latin', 'cyrillic', 'greek', 'hebrew'], [400, 600, 700], OFL, 2, 0.5 * MB, {italics: [400]}),
    f('Lato', 'google-fonts', 'sans-serif', ['latin'], [400, 700, 900], OFL, 6, 0.1 * MB, {italics: [400]}),
    f('Ubuntu', 'google-fonts', 'sans-serif', ['latin', 'cyrillic', 'greek'], [400, 500, 700], UFL, 50, 0.3 * MB, {italics: [400]}),
    f('Roboto Slab', 'google-fonts', 'serif', ['latin', 'cyrillic', 'greek'], [400, 700], APACHE, 35, 0.3 * MB),
    f('Lobster', 'google-fonts', 'display', ['latin', 'cyrillic'], [400], OFL, 70, 0.4 * MB),
    f('Epilogue', 'google-fonts', 'sans-serif', ['latin'], [400, 700], OFL, 450, 0.1 * MB),
    f('Bricolage Grotesque', 'google-fonts', 'sans-serif', ['latin'], [400, 500, 700], OFL, 330, 0.2 * MB),
    f('IBM Plex Mono', 'google-fonts', 'monospace', ['latin', 'cyrillic'], [400, 500], OFL, 120, 0.1 * MB),
    f('Libre Caslon Text', 'google-fonts', 'serif', ['latin'], [400, 700], OFL, 560, 0.1 * MB),
    f('Instrument Serif', 'google-fonts', 'serif', ['latin'], [400], OFL, 240, 0.1 * MB, {italics: [400]}),
    f('Gloock', 'google-fonts', 'serif', ['latin', 'cyrillic'], [400], OFL, 900, 0.1 * MB),
    f('Unna', 'google-fonts', 'serif', ['latin'], [400, 700], OFL, 1100, 0.1 * MB),
    f('Pinyon Script', 'google-fonts', 'handwriting', ['latin'], [400], OFL, 800, 0.1 * MB),
    f('Indie Flower', 'google-fonts', 'handwriting', ['latin'], [400], OFL, 130, 0.1 * MB),
    f('Gloria Hallelujah', 'google-fonts', 'handwriting', ['latin'], [400], OFL, 420, 0.1 * MB),
    f('Just Me Again Down Here', 'google-fonts', 'handwriting', ['latin'], [400], OFL, 1300, 0.1 * MB),
    f('Ballet', 'google-fonts', 'handwriting', ['latin'], [400], OFL, 1500, 0.2 * MB),
    f('Jacquard 24', 'google-fonts', 'display', ['latin'], [400], OFL, 1600, 0.2 * MB),
    f('Lacquer', 'google-fonts', 'display', ['latin'], [400], OFL, 1400, 0.1 * MB),
    f('Rubik Spray Paint', 'google-fonts', 'display', ['latin', 'cyrillic', 'hebrew'], [400], OFL, 1700, 1.2 * MB),
    f('Special Gothic Expanded One', 'google-fonts', 'sans-serif', ['latin'], [400], OFL, 1800, 0.1 * MB),
    f('BBH Bartle', 'google-fonts', 'sans-serif', ['latin'], [400], OFL, 1900, 0.1 * MB),
    f('Noto Sans Arabic', 'google-fonts', 'sans-serif', ['arabic'], [400, 700], OFL, 160, 0.3 * MB),
    f('Noto Sans Devanagari', 'google-fonts', 'sans-serif', ['devanagari', 'latin'], [400, 700], OFL, 210, 0.4 * MB),
    f('Noto Sans Thai', 'google-fonts', 'sans-serif', ['thai', 'latin'], [400, 700], OFL, 260, 0.1 * MB),
  ];

  window.BC_FONTLIB_DATA = {
    families,
    catalogueTotal: 1944,
    catalogueDate: '2026-10-03',
    initial: {
      'Lobster': {faces: [400], at: '3 天前'},
      'Noto Sans JP': {faces: [400, 700], at: '上周'},
      'Instrument Serif': {faces: [400], at: '昨天'},
    },
    /* 演示视频用到的族：内置一个、本机一个、已下载一个、两个还没下载（其中一个第一次会失败） */
    inVideo: {p1: ['Poppins', '思源黑体 Source Han Sans', 'Lobster', 'Ma Shan Zheng', 'ZCOOL KuaiLe']},
    flaky: ['ZCOOL KuaiLe'],
    /* 最近用过（每次选字往前插一个） */
    recent: ['Instrument Serif', 'Poppins'],
  };
})();
