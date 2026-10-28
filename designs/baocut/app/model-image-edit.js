/* 「图片处理」五个工具的纯模型（2026-10-27，原型先行；技术方案「Mac M2 本地 AI 图像」P1 图片基础）。
   放大 / 去除物体 / 去水印 / 重绘 / 扩图共用一页（tool-image-edit.jsx 的 SegmentedControl 切换），都是文件到文件：
   输入是本机图片或 Space 里的图片条目，结果是保存位置里的一个 PNG、Space 里的一个图片条目，不动原图。
   执行者（architecture §7.9、§12.9）：
   - 放大：四种引擎，按选的模型定（见下面的 UPSCALE_MODELS）。Real-ESRGAN 与 waifu2x 是受管外部工具（ncnn，本机 GPU），
     Upscayl 的五套权重是另一个受管的权重包、由 Real-ESRGAN 运行；模型没有原生的倍数时先放大到原生倍数再缩（ffmpeg Lanczos）。
     Lanczos 插值不用下载；AI 重画把整张图交给收参考图的图像模型，按模型列出的尺寸画一张大的，再缩到目标尺寸。
   - 去除物体、去水印：「快速填充」由 ffmpeg 按涂抹区域从四周插值补上（不用模型，适合小块文字与角标）；「AI 修补」交给能按提示改图的
     图像模型（本机 Qwen-Image 或已连接的云端），只把选区周围裁成一块工作区送去，回来后只贴回选区，选区之外的像素一律保留原图。
   - 重绘：同一条 AI 修补的路，多一句「改成什么」。
   - 扩图：按目标画幅把原图放在新画布里（锚点），新增的边由图像模型画出，原图那一块原样贴回；单边扩出超过原图一倍时提醒分两次扩。
   这里只算：工具表、选区（涂抹的笔画 → 覆盖率与外框 → 工作区）、扩图的几何、输出尺寸与名字、表单检查与状态行。 */
(function () {
  /* ---------- 五个工具 ---------- */
  const OPS = [
    {id: 'upscale', name: '放大图片', label: '放大', icon: 'ZoomIn', verb: '放大图片',
      desc: '把图片放大 2–4 倍：本机的 Real-ESRGAN、waifu2x 或 Upscayl 的模型补出细节，也可以让图像模型重画一张大的', select: null, prompt: 'none', methods: ['esrgan'], batch: true},
    {id: 'erase', name: '去除物体', label: '去除物体', icon: 'MagicWand', verb: '去除',
      desc: '涂掉画面里不要的人或物，按周围的画面补上', select: 'brush', prompt: 'none', methods: ['model', 'fill']},
    {id: 'watermark', name: '去水印', label: '去水印', icon: 'Images', verb: '去水印',
      desc: '框出水印、角标或字幕条；同一位置可以一次处理多张图', select: 'box', prompt: 'none', methods: ['fill', 'model'], batch: true},
    {id: 'repaint', name: '重绘局部', label: '重绘', icon: 'Draw', verb: '重绘',
      desc: '涂出一块区域，写一句改成什么，只改这一块', select: 'brush', prompt: 'required', methods: ['model']},
    {id: 'expand', name: '扩展画面', label: '扩图', icon: 'AspectRatio', verb: '扩图',
      desc: '把画面往外扩到新的比例，新增的部分接着原图画出来', select: null, prompt: 'optional', methods: ['model']},
  ];
  const opById = (id) => OPS.find((o) => o.id === id) || null;
  const METHODS = {
    esrgan: {k: 'esrgan', name: 'Real-ESRGAN', sub: '本机 GPU · 不联网'},
    fill: {k: 'fill', name: '快速填充', sub: '本机 · 不用模型 · 几秒钟 · 适合小块文字与角标'},
    model: {k: 'model', name: 'AI 修补', sub: '图像模型按周围画面重画选区 · 大块物体与复杂背景'},
  };

  /* ---------- 放大 ----------
     每个模型带它的引擎、要下载的受管工具（执行的程序 `tool`、权重包 `pack`）、权重名、原生倍数、能不能去噪与权重的许可
     （architecture §7.9；同协议的 UPSCALE_IMAGE_MODEL_SPECS）。许可 commercial 为 false 是不能商用，null 是作者没写。 */
  const MAX_SIDE = 16384;
  const PROMPT_MAX = 1000;
  const UPSCALE_TOOLS = {
    'realesrgan-ncnn-vulkan': {name: 'Real-ESRGAN', version: 'v0.2.5.0', size: '49.4 MB', contents: '含照片、动画、插画三套权重', license: 'BSD-3-Clause',
      source: 'github.com/xinntao/Real-ESRGAN/releases', body: '开源的超分辨率程序，在这台电脑的显卡上运行，不联网、不上传图片。'},
    'waifu2x-ncnn-vulkan': {name: 'waifu2x', version: '20250915', size: '39.8 MB', contents: '含三套权重', license: 'MIT',
      source: 'github.com/nihui/waifu2x-ncnn-vulkan/releases', body: '开源的动画画风超分程序，可以顺带去噪；在这台电脑的显卡上运行，不联网、不上传图片。'},
    'upscayl-models': {name: 'Upscayl 权重', version: 'e1aeaf12', size: '130.3 MB', contents: '五套权重文件', license: '各套不同：CC BY 4.0、CC BY-NC-SA 4.0 或作者没写',
      source: 'github.com/upscayl/upscayl', body: '开源项目 Upscayl 整理的五套权重，只是模型文件，由已装好的 Real-ESRGAN 运行。'},
  };
  const UPSCALE_GROUPS = [
    {k: 'realesrgan', name: 'Real-ESRGAN'},
    {k: 'upscayl', name: 'Upscayl 权重 · 由 Real-ESRGAN 运行'},
    {k: 'waifu2x', name: 'waifu2x'},
    {k: 'other', name: '其他方式'},
  ];
  const BSD = {spdx: 'BSD-3-Clause', commercial: true};
  const NC = {spdx: 'CC BY-NC-SA 4.0', commercial: false};
  const UNSTATED = {spdx: null, commercial: null};
  const esrgan = (k, weights, native, name, sub, extra) => Object.assign({k, group: 'realesrgan', name, sub, engine: 'realesrgan',
    tool: 'realesrgan-ncnn-vulkan', pack: null, weights, native, denoise: false, license: BSD}, extra);
  const upscayl = (k, weights, name, sub, license) => esrgan(k, weights, [4], name, sub, {group: 'upscayl', pack: 'upscayl-models', license});
  const waifu = (k, weights, name, sub) => ({k, group: 'waifu2x', name, sub, engine: 'waifu2x', tool: 'waifu2x-ncnn-vulkan', pack: null, weights,
    native: [2, 4], denoise: true, license: {spdx: 'MIT', commercial: true}});
  const UPSCALE_MODELS = [
    esrgan('photo', 'realesrgan-x4plus', [4], '照片', '实拍、截图、写实画面'),
    esrgan('anime', 'realesr-animevideov3', [2, 3, 4], '动画（快）', '动画画面、平涂；原生 2、3、4 倍，最快'),
    esrgan('illustration', 'realesrgan-x4plus-anime', [4], '动画插画', '二次元插画与线稿，比「动画（快）」更锐利'),
    upscayl('upscayl-lite', 'upscayl-lite-4x', 'Upscayl Lite', '通用、轻量，显存小的电脑也能跑', UNSTATED),
    upscayl('high-fidelity', 'high-fidelity-4x', 'High Fidelity', '保留纹理与细节，适合照片', {spdx: 'CC BY 4.0', commercial: true}),
    upscayl('remacri', 'remacri-4x', 'Remacri', '细节自然、不过度磨皮，适合照片', NC),
    upscayl('ultramix-balanced', 'ultramix-balanced-4x', 'UltraMix Balanced', '锐度与平滑之间取中', UNSTATED),
    upscayl('ultrasharp', 'ultrasharp-4x', 'UltraSharp', '非常锐利；噪点多的图会被一起锐化', NC),
    waifu('waifu2x', 'models-cunet', 'waifu2x', '动画插画；三套里质量最好，也最慢'),
    waifu('waifu2x-anime', 'models-upconv_7_anime_style_art_rgb', 'waifu2x 动画画风', '动画插画，比上一套快'),
    waifu('waifu2x-photo', 'models-upconv_7_photo', 'waifu2x 照片', '照片，顺带去噪、去 JPEG 色块'),
    {k: 'lanczos', group: 'other', name: '平滑放大（Lanczos）', sub: '只是插值，不补细节；不用下载，几秒钟', engine: 'lanczos', tool: null, pack: null,
      weights: null, native: [2, 3, 4], denoise: false, license: null},
    {k: 'generative', group: 'other', name: 'AI 重画', sub: '图像模型照着原图重画一张大的；细节和文字可能变', engine: 'generative', tool: null, pack: null,
      weights: null, native: [], denoise: false, license: null},
  ];
  const SCALES = [2, 3, 4];
  /** waifu2x 的去噪级别：-1 不去噪，0–3 越来越强（也会抹掉一些细节） */
  const DENOISE = [{k: -1, label: '不去噪'}, {k: 0, label: '轻'}, {k: 1, label: '中'}, {k: 2, label: '强'}, {k: 3, label: '最强'}];
  const upscaleModel = (k) => UPSCALE_MODELS.find((m) => m.k === k) || UPSCALE_MODELS[0];
  /** 跑模型的引擎里，没有这个原生倍数时先放大到原生倍数再缩（ffmpeg Lanczos）；插值与 AI 重画不算 */
  const needsResize = (model, scale) => {
    const m = upscaleModel(model);
    return (m.engine === 'realesrgan' || m.engine === 'waifu2x') && m.native.indexOf(scale) < 0;
  };
  /** 中间那一步的倍数：原生倍数里第一个够的（照片模型的 2 倍是 4，waifu2x 的 3 倍是 4） */
  const peakScale = (model, scale) => (needsResize(model, scale) ? upscaleModel(model).native.find((n) => n >= scale) || scale : scale);
  /** 放大后的尺寸；中间要先放大到原生倍数时，上限按中间那一步查 */
  function upscaleSize(src, scale, model) {
    const width = src.width * scale;
    const height = src.height * scale;
    const peak = model ? peakScale(model, scale) : scale;
    return {width, height, tooLarge: src.width * peak > MAX_SIDE || src.height * peak > MAX_SIDE};
  }
  /** 这个模型要下载的受管工具：执行的程序在前，权重包在后（一次装一个） */
  const upscaleTools = (model) => { const m = upscaleModel(model); return [m.tool, m.pack].filter(Boolean); };
  /** 权重的许可提醒：不能商用、或作者没写许可时一句话；其他 null */
  function licenseNote(model) {
    const l = upscaleModel(model).license;
    if (!l || l.commercial === true) return null;
    return l.commercial === false ? `这套权重是 ${l.spdx} 许可：放大的结果不能商用` : '这套权重的作者没写许可：要商用先自己确认';
  }
  /** 菜单里的许可标签 */
  const licenseTag = (model) => { const l = upscaleModel(model).license; return !l || l.commercial === true ? null : l.commercial === false ? '不可商用' : '许可未注明'; };
  /** 提交参数（upscale-image）：只带这个模型收的参数——去噪只给 waifu2x，Provider、模型与补充说明只给 AI 重画 */
  function upscaleRequest(f, srcs, engine) {
    const m = upscaleModel(f.model);
    const prompt = String(f.prompt || '').trim();
    return Object.assign({inputs: srcs.map((s) => s.path || s.name), scale: f.scale, model: m.k},
      m.denoise ? {denoise: f.denoise} : {},
      m.engine === 'generative' && engine ? {provider: engine.provider, imageModel: engine.model} : {},
      m.engine === 'generative' && prompt ? {prompt} : {});
  }

  /* ---------- 选区：涂抹（brush）与框选（box） ----------
     坐标都是原图像素。笔画 = {r 半径, pts:[[x,y]...]}；框 = {x,y,w,h}。覆盖率按 16 px 的格子近似（够给提示用，不是真掩膜）。 */
  const GRID = 16;
  function cellsOf(sel, src) {
    const cols = Math.ceil(src.width / GRID);
    const rows = Math.ceil(src.height / GRID);
    const on = new Set();
    const mark = (x0, y0, x1, y1) => {
      for (let cy = Math.max(0, Math.floor(y0 / GRID)); cy <= Math.min(rows - 1, Math.floor(y1 / GRID)); cy++)
        for (let cx = Math.max(0, Math.floor(x0 / GRID)); cx <= Math.min(cols - 1, Math.floor(x1 / GRID)); cx++) on.add(cy * cols + cx);
    };
    (sel.boxes || []).forEach((b) => mark(b.x, b.y, b.x + b.w - 1, b.y + b.h - 1));
    (sel.strokes || []).forEach((s) => s.pts.forEach((p, i) => {
      const prev = s.pts[i - 1] || p;
      const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - prev[0], p[1] - prev[1]) / (GRID / 2)));
      for (let k = 0; k <= steps; k++) {
        const x = prev[0] + ((p[0] - prev[0]) * k) / steps;
        const y = prev[1] + ((p[1] - prev[1]) * k) / steps;
        mark(x - s.r, y - s.r, x + s.r, y + s.r);
      }
    }));
    return {on, cols, rows};
  }
  /** 选区的外框与覆盖率；没有选区时 null */
  function selectionStats(sel, src) {
    if (!src || !sel) return null;
    const {on, cols, rows} = cellsOf(sel, src);
    if (!on.size) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    on.forEach((i) => { const cx = i % cols, cy = Math.floor(i / cols); x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy); });
    const box = {x: x0 * GRID, y: y0 * GRID, w: Math.min(src.width, (x1 + 1) * GRID) - x0 * GRID, h: Math.min(src.height, (y1 + 1) * GRID) - y0 * GRID};
    return {box, coverage: on.size / (cols * rows)};
  }
  /** AI 修补送去的工作区：选区外框四周各留一半的上下文，至少 512 边长，不超出原图。整张都要送时 full 为 true。 */
  const ROI_MIN = 512;
  function workArea(box, src) {
    const side = (len, pad, total) => Math.min(total, Math.max(ROI_MIN, len + 2 * pad));
    const w = side(box.w, Math.round(box.w / 2), src.width);
    const h = side(box.h, Math.round(box.h / 2), src.height);
    const clamp = (start, len, total) => Math.max(0, Math.min(total - len, start));
    const x = clamp(Math.round(box.x + box.w / 2 - w / 2), w, src.width);
    const y = clamp(Math.round(box.y + box.h / 2 - h / 2), h, src.height);
    return {x, y, w, h, full: w === src.width && h === src.height};
  }

  /** 批量去水印：框按原图像素记在第一张上，别的图按比例换算到它自己的尺寸（同一个相对位置） */
  function scaleSelection(sel, from, to) {
    if (!sel || (from.width === to.width && from.height === to.height)) return sel;
    const kx = to.width / from.width, ky = to.height / from.height;
    return {strokes: (sel.strokes || []).map((s) => ({r: Math.round(s.r * Math.min(kx, ky)), pts: s.pts.map((p) => [Math.round(p[0] * kx), Math.round(p[1] * ky)])})),
      boxes: (sel.boxes || []).map((b) => ({x: Math.round(b.x * kx), y: Math.round(b.y * ky), w: Math.round(b.w * kx), h: Math.round(b.h * ky)}))};
  }
  /** 比例和第一张不同的图（差 2% 以上）：框换算过去可能偏，提示看一眼预览 */
  const ratioDiffers = (a, b) => Math.abs(a.width / a.height - b.width / b.height) / (a.width / a.height) > 0.02;
  /** 去水印的常见位置（也是不用指针时的选法）：四角的角标与底部字幕条，按画面的比例 */
  const BOX_PRESETS = [
    {k: 'br', label: '右下角', box: (w, h) => ({x: Math.round(w * 0.76), y: Math.round(h * 0.88), w: Math.round(w * 0.22), h: Math.round(h * 0.1)})},
    {k: 'bl', label: '左下角', box: (w, h) => ({x: Math.round(w * 0.02), y: Math.round(h * 0.88), w: Math.round(w * 0.22), h: Math.round(h * 0.1)})},
    {k: 'tr', label: '右上角', box: (w, h) => ({x: Math.round(w * 0.76), y: Math.round(h * 0.02), w: Math.round(w * 0.22), h: Math.round(h * 0.1)})},
    {k: 'tl', label: '左上角', box: (w, h) => ({x: Math.round(w * 0.02), y: Math.round(h * 0.02), w: Math.round(w * 0.22), h: Math.round(h * 0.1)})},
    {k: 'sub', label: '底部字幕条', box: (w, h) => ({x: 0, y: Math.round(h * 0.82), w, h: Math.round(h * 0.14)})},
  ];
  const ANCHOR_LABEL = {'top-left': '左上', top: '上方居中', 'top-right': '右上', left: '左侧居中', center: '正中', right: '右侧居中',
    'bottom-left': '左下', bottom: '下方居中', 'bottom-right': '右下'};
  /** 一张图会不会整张发出去：工作区盖满整张图（小图、选区很大）时 */
  function sendsWhole(op, sel, src) {
    if (op === 'expand') return true;
    const st = selectionStats(sel, src);
    return !!st && workArea(st.box, src).full;
  }

  /* ---------- 扩图 ---------- */
  const RATIOS = [
    {k: '16:9', label: '16:9 横屏'}, {k: '9:16', label: '9:16 竖屏'}, {k: '1:1', label: '1:1 方形'},
    {k: '4:3', label: '4:3'}, {k: '3:4', label: '3:4'}, {k: 'free', label: '按边扩'},
  ];
  const ANCHORS = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
  const EXPAND_MAX_SIDE = 4096;
  const ratioValue = (k) => { const [w, h] = String(k).split(':').map(Number); return w / h; };
  /** 目标画布与原图的位置：按比例时只往一个方向加（不裁原图），按边扩时四边各加 `margins` 里的百分比。 */
  function expandPlan(src, f) {
    if (!src) return null;
    let width = src.width, height = src.height;
    if (f.ratio === 'free') {
      const m = f.margins || {};
      const add = (pct, len) => Math.round(((pct || 0) / 100) * len);
      const left = add(m.left, src.width), right = add(m.right, src.width), top = add(m.top, src.height), bottom = add(m.bottom, src.height);
      return finish(src, src.width + left + right, src.height + top + bottom, left, top);
    }
    const r = ratioValue(f.ratio);
    if (src.width / src.height < r) width = Math.round(src.height * r); else height = Math.round(src.width / r);
    const a = f.anchor || 'center';
    const col = a.indexOf('left') >= 0 ? 0 : a.indexOf('right') >= 0 ? 2 : 1;
    const row = a.indexOf('top') >= 0 ? 0 : a.indexOf('bottom') >= 0 ? 2 : 1;
    const x = Math.round(((width - src.width) * col) / 2);
    const y = Math.round(((height - src.height) * row) / 2);
    return finish(src, width, height, x, y);
  }
  function finish(src, width, height, x, y) {
    const added = {left: x, top: y, right: width - src.width - x, bottom: height - src.height - y};
    const grew = Math.max(added.left + added.right, 0) / src.width > 1 || Math.max(added.top + added.bottom, 0) / src.height > 1;
    return {width, height, x, y, added, same: width === src.width && height === src.height,
      tooLarge: width > EXPAND_MAX_SIDE || height > EXPAND_MAX_SIDE, staged: grew};
  }

  /* ---------- 名字 ---------- */
  const SUFFIX = {upscale: (f) => `upscaled-${f.scale}x`, erase: () => 'erased', watermark: () => 'no-watermark', repaint: () => 'repainted', expand: () => 'expanded'};
  /** `<源名>-<后缀>.png`；重名时加序号（-2、-3），不覆盖 */
  function outputName(op, srcName, f, taken) {
    const stem = String(srcName || 'image').replace(/\.[^.]+$/, '');
    const base = `${stem}-${SUFFIX[op](f || {})}`;
    const used = new Set(taken || []);
    let name = `${base}.png`;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}.png`;
    return name;
  }

  /* ---------- 表单 ---------- */
  /** `editReady`：有没有能改图的模型就绪；没有时能快速填充的工具缺省快速填充 */
  function blank(op, editReady) {
    const o = opById(op);
    const method = editReady === false && o.methods.indexOf('fill') >= 0 ? 'fill' : o.methods[0];
    return {op, method, scale: 4, model: 'photo', denoise: 0, prompt: '', brush: 48, ratio: '16:9', anchor: 'center',
      margins: {left: 25, right: 25, top: 0, bottom: 0}, engine: null, seed: '', sameForAll: true};
  }
  /** 开始前的检查：第一条不过就是导航栏上的那句话；`bad` 时按钮按下只提示 */
  function problems(f, srcs, sel, ctx) {
    const o = opById(f.op);
    const src = srcs[0];
    if (!src) return [o.batch ? '先选一张或几张图片' : '先选一张图片'];
    const out = [];
    if (f.op === 'upscale') {
      const m = upscaleModel(f.model);
      const big = srcs.find((s) => upscaleSize(s, f.scale, f.model).tooLarge);
      if (big) out.push(needsResize(f.model, f.scale)
        ? `${big.name} 要先放大 ${peakScale(f.model, f.scale)} 倍，超过 ${MAX_SIDE} 像素：换原生 ${f.scale} 倍的模型，或先把图缩小`
        : `${big.name} 放大 ${f.scale} 倍后超过 ${MAX_SIDE} 像素，换小一点的倍数`);
      // ctx.tools：受管工具的现状（名字 → 'ready' 等）；不给时不查
      const missing = ctx && ctx.tools ? upscaleTools(f.model).find((t) => ctx.tools[t] !== 'ready') : null;
      if (missing) out.push(`第一次用这个模型前要下载 ${UPSCALE_TOOLS[missing].name}（约 ${UPSCALE_TOOLS[missing].size}）`);
      if (m.engine === 'generative' && ctx && ctx.modelReason) out.push(ctx.modelReason);
      if (m.engine === 'generative' && String(f.prompt || '').trim().length > PROMPT_MAX) out.push(`补充说明不超过 ${PROMPT_MAX} 个字`);
    }
    if (o.select && !selectionStats(sel, src)) out.push(o.select === 'box' ? '先在图上框出水印' : `先在图上涂出要${f.op === 'repaint' ? '重绘' : '去掉'}的地方`);
    if (o.select && selectionStats(sel, src) && selectionStats(sel, src).coverage > 0.6) out.push('选区超过画面的六成：换「生成图片」重画整张更合适');
    if (o.prompt === 'required' && !String(f.prompt || '').trim()) out.push('写一句要改成什么');
    if (f.op === 'expand') {
      const p = expandPlan(src, f);
      if (p.same) out.push('目标比例和原图一样，换一个比例或按边扩');
      else if (p.tooLarge) out.push(`扩完超过 ${EXPAND_MAX_SIDE} 像素：先把原图缩小，或少扩一点`);
    }
    if (f.method === 'model' && ctx && ctx.modelReason) out.push(ctx.modelReason);
    return out;
  }
  /** 导航栏上的状态行：问题优先，否则说这一次会得到什么 */
  function statusLine(f, srcs, sel, ctx, tried) {
    const errs = problems(f, srcs, sel, ctx);
    const src = srcs[0];
    if (errs.length && (tried || !src)) return {bad: !!src, text: errs[0]};
    if (errs.length) return {bad: false, text: errs[0]};
    const name = outputName(f.op, src.name, f, ctx && ctx.taken);
    if (f.op === 'upscale') {
      const s = upscaleSize(src, f.scale);
      return {bad: false, text: `${srcs.length > 1 ? `${srcs.length} 张 · ` : ''}${s.width}×${s.height} · ${name}`};
    }
    if (f.op === 'expand') { const p = expandPlan(src, f); return {bad: false, text: `${p.width}×${p.height} · ${name}`}; }
    return {bad: false, text: `${srcs.length > 1 ? `${srcs.length} 张 · ` : ''}${METHODS[f.method].name} · ${name}`};
  }
  /** 任务卡上的一行说明 */
  function jobMeta(r) {
    const f = r.form;
    if (f.op === 'upscale') {
      const m = upscaleModel(f.model);
      const denoise = m.denoise ? ` · ${(DENOISE.find((d) => d.k === f.denoise) || DENOISE[1]).label}` : '';
      return `${m.name}${denoise} · ${f.scale}× · ${r.out.width}×${r.out.height}`;
    }
    if (f.op === 'expand') return `${f.ratio === 'free' ? '按边扩' : f.ratio} · ${r.out.width}×${r.out.height}`;
    if (f.op === 'repaint') return `「${String(f.prompt).slice(0, 24)}」`;
    return `${METHODS[f.method].name}${r.batch > 1 ? ` · 第 ${r.index} / ${r.batch} 张` : ''}`;
  }

  const api = {OPS, opById, METHODS, MAX_SIDE, PROMPT_MAX, UPSCALE_TOOLS, UPSCALE_GROUPS, UPSCALE_MODELS, SCALES, DENOISE, upscaleModel, needsResize,
    peakScale, upscaleSize, upscaleTools, licenseNote, licenseTag, upscaleRequest,
    GRID, selectionStats, workArea, scaleSelection, ratioDiffers, BOX_PRESETS, ANCHOR_LABEL, sendsWhole, ROI_MIN, RATIOS, ANCHORS, EXPAND_MAX_SIDE, expandPlan, outputName, blank, problems, statusLine, jobMeta};
  if (typeof window !== 'undefined') Object.assign(window, {BC_IMAGE_EDIT: api});
  if (typeof module !== 'undefined') module.exports = api;
})();
