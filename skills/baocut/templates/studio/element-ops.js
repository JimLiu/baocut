// BaoCut Subtitle Studio — 叠加元素写路径的 op 构造（纯函数）。
//
// 全部经 `POST <project>/__bcut/timeline/apply`（设计 §5.3）：
//   putSource / addElement / patchElement / removeElement。
// 缺省值取 CLI 门面与原型的产品缺省，好让 Web 新建的元素与 `bcut element add`、
// `bcut watermark add`、Mac App 建的元素长得一样：
//   · 文本：播放头处 10 秒窗口、居中偏上（原型 addTitle：x50 y40）；
//   · 图片：播放头处 4 秒窗口、右上 pip（原型 addBroll('image')：x71 y29 w34 radius28）；
//   · 水印：全片（无 start/end）、右上角小字、透明度 0.6
//     （`bcut watermark add` 的 rect 85,10,22 与 opacity 0.6）。
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BCS_ELEMENT_OPS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  // 文本元素缺省样式：字幕样式 schema 的子集（设计 §3.6 的示例值），因此渲染
  // 直接复用字幕内核。fontFamily 用 Studio 的字体键 'system'，与 studio/style.json
  // 同一套词汇表。
  const TEXT_STYLE = Object.freeze({
    fontFamily: 'system',
    fontSize: 41,
    fontColor: '#FFFFFF',
    bold: true,
    align: 'center',
    background: true,
    backgroundColor: '#101418A6',
    backgroundPadding: 14,
    borderRadius: 12,
    textOutline: { on: true, color: '#000000', width: 14 },
  });
  // 水印缺省样式：透明底、细描边的小字（原型 TEXT_WATERMARK 同款签名感）。
  const WATERMARK_STYLE = Object.freeze({
    fontFamily: 'system',
    fontSize: 20,
    fontColor: '#FFFFFF',
    bold: true,
    align: 'center',
    background: false,
    backgroundPadding: 0,
    textOutline: { on: true, color: '#000000', width: 15 },
  });
  const TEXT_PLACEHOLDER = '双击输入文字';
  const WATERMARK_TEXT = '@你的名字';
  const TEXT_SECONDS = 10;
  const IMAGE_SECONDS = 4;
  // 图片水印的缺省摆放：与文本水印同一个角落（右上、透明度 0.6），宽度只给 12%
  // —— 一个 logo 铺到 34% 就成了画面主体。全片显示，所以不带 start/end。
  const WATERMARK_IMAGE_PLACE = Object.freeze({ x: 85, y: 10, w: 12, opacity: 0.6 });

  const finite = (value, fallback) => (typeof value === 'number' && Number.isFinite(value)
    ? value
    : fallback);
  const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);
  const clone = (value) => JSON.parse(JSON.stringify(value));
  // 时间落到 0.1 秒栅格（原型 addTitle / addBroll 同精度）。
  const floorTenth = (value) => Math.floor(finite(value, 0) * 10) / 10;
  const roundTenth = (value) => Math.round(finite(value, 0) * 10) / 10;

  // 元素窗口：从播放头开始，最长到片尾；片尾之前不足 0.2 秒时把窗口往前挪，
  // 免得造出一个 end <= start 的非法元素（schema 会 400）。
  function window_(time, duration, seconds) {
    const end = Math.max(0.2, finite(duration, 0));
    const start = Math.min(floorTenth(time), roundTenth(Math.max(0, end - 0.2)));
    return { start: Math.max(0, start), end: roundTenth(Math.min(end, start + seconds)) };
  }

  function uid(prefix) {
    return prefix + Math.random().toString(36).slice(2, 10);
  }

  function addTextElement(options) {
    const span = window_(options.time, options.duration, TEXT_SECONDS);
    return {
      kind: 'addElement',
      element: {
        kind: 'text',
        text: options.text == null ? TEXT_PLACEHOLDER : options.text,
        start: span.start,
        end: span.end,
        place: { x: 50, y: 40 },
        style: clone(TEXT_STYLE),
      },
    };
  }

  // 上传得到的项目内相对路径 → source 记录（naturalW/H 由前端探测）。
  function imageSource(options) {
    const source = { path: options.path, kind: 'image', duration: 0 };
    if (isNumber(options.naturalWidth)) source.naturalW = Math.round(options.naturalWidth);
    if (isNumber(options.naturalHeight)) source.naturalH = Math.round(options.naturalHeight);
    return source;
  }

  // 图片：先注册 source，再建一个引用它的 pip 元素。两条 op 同一个事务 —— 撤销一步
  // 就该让这张图不再被引用。`role: 'watermark'` 走图片水印的缺省（全片、右上角小 logo，
  // 服务端因此把它放进 `wm` 轨）。
  function addImageElement(options) {
    const watermark = !!(options && options.role === 'watermark');
    const sourceId = options.sourceId || uid('src-');
    const element = {
      kind: 'image',
      srcId: sourceId,
      mode: 'pip',
      fit: 'cover',
      place: watermark ? { ...WATERMARK_IMAGE_PLACE } : { x: 71, y: 29, w: 34, radius: 28 },
    };
    if (watermark) {
      element.role = 'watermark';
    } else {
      const span = window_(options.time, options.duration, IMAGE_SECONDS);
      element.start = span.start;
      element.end = span.end;
    }
    return [
      { kind: 'putSource', sourceId, source: imageSource(options) },
      { kind: 'addElement', element },
    ];
  }

  // 换图：注册一个**新** source 再改 srcId，而不是覆盖原 source —— 同一个 source 可能
  // 还被别的元素引用，覆盖它会把那些元素一起换掉。旧 source 留在文档里（无引用），
  // 撤销一步即回到原图。
  function replaceImageSource(element, options) {
    const sourceId = (options && options.sourceId) || uid('src-');
    return [
      { kind: 'putSource', sourceId, source: imageSource(options) },
      { kind: 'patchElement', elId: element.id, set: { srcId: sourceId } },
    ];
  }

  // 水印：带 role 的普通 text 元素（§3.6 决策 7/8：role 只影响命令面与 lint），
  // 无 start/end = 全片。轨道由服务端按 role 选（watermark → `wm`）。
  function addWatermark(options) {
    const text = options && options.text ? String(options.text) : WATERMARK_TEXT;
    return {
      kind: 'addElement',
      element: {
        kind: 'text',
        role: 'watermark',
        text,
        place: { x: 85, y: 10, w: 22, opacity: 0.6 },
        style: clone(WATERMARK_STYLE),
      },
    };
  }

  // 几何补丁**不带 base**（数值 base 在这条链路上永远匹配不上，实测见下），
  // 语义因此是后写者胜 —— 拖动是对眼前这个对象的直接操纵，且并发方只可能是同一份
  // 文档的另一个客户端，最坏结果是覆盖对方一次拖动，比"拖完没有任何反应"好得多。
  //
  // 为什么不带：`patchElement` 的 base 走服务端 `json_matches_base` 的
  // `Value == Value`，而 serde_json 的 `Number` 按内部表示比较 —— 磁盘上的
  // `50.0`（f64）与 JS `JSON.stringify(50)` 出来的 `50`（u64）**不相等**。整数值
  // 的坐标于是 100% 落进 `skipped: [{reason:"base-mismatch"}]`，而那是 200 应答，
  // 前端不额外检查就是静默丢写。（实测：base 写 `50.0` 能匹配，`50` 不能。）
  // 字符串字段没有这个问题，所以 setText 仍做 CAS。
  function movePlace(element, place) {
    return {
      kind: 'patchElement',
      elId: element.id,
      set: { place: { x: place.x, y: place.y } },
    };
  }

  // place 的「所见值」快照，只取 x/y 两维：其它维（w/scale/rot/opacity/radius）不参与
  // 本次修改。当前没有调用方把它当 base 用（见上），保留给需要读所见坐标的面板。
  function basePlace(element) {
    const place = (element && element.place) || {};
    const base = {};
    if (place.x != null) base.x = place.x;
    if (place.y != null) base.y = place.y;
    return base;
  }

  function setText(element, text) {
    return {
      kind: 'patchElement',
      elId: element.id,
      base: { text: element.text == null ? '' : element.text },
      set: { text },
    };
  }

  function removeElement(element) {
    return { kind: 'removeElement', elId: typeof element === 'string' ? element : element.id };
  }

  // 元素在提示与 aria 里的称呼。
  function elementLabel(element) {
    if (!element) return '元素';
    if (element.role === 'watermark') return '水印';
    if (element.kind === 'image') return '图片';
    if (element.kind === 'text') return '文本';
    return '元素';
  }

  return {
    IMAGE_SECONDS,
    TEXT_PLACEHOLDER,
    TEXT_SECONDS,
    TEXT_STYLE,
    WATERMARK_IMAGE_PLACE,
    WATERMARK_STYLE,
    WATERMARK_TEXT,
    addImageElement,
    addTextElement,
    addWatermark,
    basePlace,
    elementLabel,
    imageSource,
    movePlace,
    removeElement,
    replaceImageSource,
    setText,
    uid,
    window: window_,
  };
});
