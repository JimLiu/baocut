# 代码场景：整镜整段用 Canvas 或 SVG 画

`SKILL.md` 第 5 节「代码画面」的细则。这里的画面不是一段叠在素材上的图形，而是整镜、整段都由代码画：歌曲的逐句画面、讲解动画、角色小剧场。短的下横栏、关键词、大数字、品牌贴片仍按 `motion-graphics` 做。

## 1. 创意方向（歌曲与短剧）

- 用户没要安静的时候，默认做得热闹、有梗：意外的小细节、视觉玩笑、角色的表情与动作、景别忽大忽小、跟着节奏换机位。热闹来自编排（入场、缩放、换景、切换），不来自每帧乱闪的随机噪点。每个画面有一个看得清的主体；高潮前留一两个安静的拍子，高潮才落得下来。用户要克制、安静的，按用户的来。
- **埋梗与回收**：一个道具或动作在开头的钩子里出现，主歌里被用歪，到高潮变形，结尾收回来。一首歌两三条这样的线就够，不硬塞到每一句。
- 画面细节从歌词里具体的词、比喻与场景找，不停在抽象概念上。用到真实的事实与数字先核实，和编出来的梗分开记；编的就是编的，不说成事实。

## 2. 落点

| 用户要的 | 怎么做 |
| --- | --- |
| 可编辑的视频（默认） | 写成代码包，用 compositions_import 导入。用 `baocut/1` 合同（下面的最小包）：`initialize(context)` 里等图片与字体加载完（`img.decode()`），`renderAt(time, params)` 在一块 `<canvas>` 上画出那一刻（`time` 是 `{ ticks, timescale }`，秒 = `Number(ticks) / timescale`，不是秒数）；全画幅不透明的在根元素写 `data-alpha="false"`。按段落（一段一个场景）切成几个代码包首尾相接，改一段只重新导入那一段（`replace: { itemId }`） |
| 只要一个视频文件，明说由代码直接渲染、不要可编辑视频 | 在 BaoCut 之外渲染，例如逐帧画好交给 ffmpeg 编码。交付时说明画面不能在编辑器里逐个元素改；之后要可编辑，按上一行重做，不把渲染出的文件当素材导入后再叠加修改 |

整镜整段的画面用 `baocut/1`；叠加在实拍或别的画面上的贴片、标题、字幕条用 `motion-graphics` 的 scaffold（`hyperframes/1`，`window.__timelines` + `seek(秒)`），两种合同不混在一个包里。没有清单时，合同按入口 HTML 以及它用 `<script src>` 引用的包内脚本（模块再顺着静态 `import`）里有没有 `__baocutCompositions` 判断，几段共用一个 `engine.js`、注册写在里面也认得出。注册是运行期拼出来的（字符串拼接、`eval`），或者用的是较早的 BaoCut，会被当成 `hyperframes/1`，预览与导入等 `window.__timelines` 超时、报 `COMPOSITION_TIMELINE_MISSING`；这时 compositions_preview 与 compositions_import 都带 `manifest: {"contract": "baocut/1"}`（终端里写成 `--manifest '{"contract":"baocut/1"}'`）。`baocut/1` 的最小包（根元素的 `data-*` 就是清单，不用另写 `bundle.manifest.json`；`data-composition-id` 与注册用的键相同）：

```html
<!doctype html>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: #000; }
  #root { position: relative; width: 1080px; height: 1920px; }
  canvas { display: block; }
  @font-face { font-family: 'Body'; src: url('./fonts/body.ttf'); }
</style>
<div id="root" data-composition-id="scene-1" data-width="1080" data-height="1920" data-fps="30" data-duration="12.4" data-alpha="false">
  <canvas id="stage" width="1080" height="1920"></canvas>
</div>
<script>
  const W = 1080, H = 1920;
  let ctx = null;
  const hero = new Image();
  hero.src = './art/hero.png';
  function draw(t) {
    // t 是这一段内的秒数；画面只由 t 决定（第 4 节）
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);
    ctx.font = '72px Body';
    ctx.fillStyle = '#ffffff';
    ctx.fillText('第 ' + Math.floor(t) + ' 秒', 80, 200);
    ctx.drawImage(hero, 100, 400 + Math.min(t / 0.6, 1) * 200);
  }
  window.__baocutCompositions = window.__baocutCompositions || {};
  window.__baocutCompositions['scene-1'] = {
    async initialize(context) {
      // context.target 是上面的根元素；这里等图片与字体都加载完
      ctx = context.target.querySelector('#stage').getContext('2d');
      await Promise.all([hero.decode(), document.fonts.load('72px Body')]);
      draw(0);
    },
    async renderAt(time, params) {
      // time 是 { ticks, timescale }：秒 = Number(ticks) / timescale；params 目前是空对象
      draw(Number(time.ticks) / time.timescale);
    },
    dispose() {
      ctx = null;
    },
  };
</script>
```

包内只用相对路径，不联网；上限是 4096 个文件、单个 64 MiB、合计 256 MiB，底图用 JPEG，贴图用 PNG 并裁到角色实际的边界，不留整幅的透明画布。

## 2.1 写成能走指令烘焙的样子

导入要等多久取决于烘焙走哪条路。compositions_import 对 `baocut/1` 的单张 Canvas 画面先录下绘制指令、在本机多线程光栅（1080×1920 约 50 帧/秒）；录不了的整段回退成浏览器逐帧截图（约 3 帧/秒，30 秒的段要四分多钟）。默认 `bake: "auto"` 自动选，按下面写就能走快的那条：

- **一张画布**：根元素里只有一张 `<canvas>`，宽高等于 `data-width` / `data-height`，不加 CSS 变换与不透明度；文字、图片都画进这张画布，根元素里不放别的可见元素。`getContext('2d')` 不带 `{ alpha: false }`。
- **每帧从头画**：`renderAt(time)` 开头先 `setTransform(1, 0, 0, 1, 0, 0)` 再整幅清屏（`clearRect(0, 0, W, H)`，或不透明的整幅 `fillRect`），不靠上一帧留下的像素，也不局部 `clearRect`；铺满画布的 `drawImage` 不算清屏，指令烘焙会以 `frame-not-cleared` 拒绝。
- **不读回主画布**：不 `getImageData` / `putImageData`，不把主画布当 `drawImage` 的源。要先画好再处理的效果，在离屏 canvas 上再画一遍（第 5.1 节的 `post-fx.js` 就这么做）。离屏 canvas 随便用，画进主画布时会按位图记下。
- **不用**：`ctx.filter`（模糊改用 `shadowBlur`，或缩小再放大）、`createConicGradient`、`Path2D`、`clip('evenodd')`、`imageSmoothingEnabled = false`、`imageSmoothingQuality` 设成 `medium` / `high`（保持默认）、`letterSpacing` 与 `wordSpacing`。`globalCompositeOperation` 只用 `source-over`、`lighter`、`multiply`、`screen`、`overlay`、`darken`、`lighten`、`difference`、`exclusion`。
- **图片**是包里的文件（`img.src = './art/a.png'`，PNG、JPEG、WebP、SVG 都行），不用 `data:` / `blob:` 地址、`ImageBitmap` 或视频帧。
- **文字**用第 5 节带进包里的字体（`@font-face`），并且覆盖要画的每个字：缺字、彩色 emoji 都会回退。要粗体就带粗体字体文件（只有常规体却写 `bold` 会回退）。拉丁、希腊、西里尔与中日韩文字走得了指令；阿拉伯、泰、天城等文字会回退。
- **导入后看结果的 `bake`**：`renderer` 是 `drawop-cpu` 就是走了指令。是 `browser-pixels` 时，`bake.fallback.reason` 写着第一条原因（例如 `recording: filter: blur(4px)`、`recording: main-canvas-readback`、`CANVAS_OPS_UNSUPPORTED: … text-missing-glyph: U+2665`），按上面改掉后用 `replace: { itemId }` 重新导入。原因是 `CANVAS_OPS_MISMATCH`（抽样画面对不上）时不用改代码，把原因告诉用户。
- 写完第一个包时可以传 `bake: "ops"` 导入：走不了指令就直接报错并给出原因，不白等截图。确认能走之后其余的包用默认值。
- **先算时间与空间再烘全片**。走指令时 1080×1920 一段 40 秒约一分钟；截图约 1–3 帧/秒，十分钟的片子要好几个小时。每段导入后把 `bake` 的 `renderer`、`fps`、`seconds` 记进自己的进度记录；第一段烘焙用的时间远超它本身的时长时，先停下看 `renderer` 与 `fallback.reason`，改好再烘其余各段。预渲染是 ProRes：不透明的 422 HQ 在 1080×1920 下每分钟约 1.2 GB，带透明的 4444 更大。长片先看视频所在磁盘的空余，不够时先和用户定把项目放到哪块盘，再在那里建视频。改版重烘后，旧的预渲染还占着空间，确认不会退回旧版后用 assets_prune 清掉（终端里是 `assets prune`）。
- `bake` 与 `background` 要新版 Runtime：参数说明（终端是 `help compositions import`）里列不出这两项就是旧版，先更新 BaoCut，更新不了就不带它们。终端里写成 `--bake ops`、`--background`。不带 `background` 时命令要等整段烘完才返回，期间没有进度输出：一段几十秒到几分钟属正常，不是卡死。
- **一段接一段导入**时带 `background: true`：导入立刻返回 `bakeJobId`，烘焙在后台排队串行进行（jobs_list / jobs_wait 看进度），期间接着导入下一段或改别的片段。上一段烘完写替身与下一段导入会撞版本：不给 `revision` 时 Runtime 按最新版本重试，给了就自己重试。后台任务结束后 jobs_inspect 结果的 `result.bake.renderer` 看它走了指令还是像素。改了这一段（换代码包、变速、裁开头）或删掉它，任务以 COMPOSITION_BAKE_SUPERSEDED 结束，要重新带 replace 导入。导出前用 jobs_list 确认烘焙都完成了：没烘完的片段没有预渲染，导出会被拒绝。换了代码包版本却没重烘的片段导出时以 EXPORT_PRERENDER_STALE 拒绝，正路是带 replace 重新导入；只有用户明确要旧画面才用 allowStalePrerender。
- **用 Three.js、p5 WEBGL 或别的 WebGL 库**时走不了指令，整段按截图烘焙（1080p 约 3 帧/秒），导入前跟用户说清要等多久。库文件放进包里（`vendor/three.module.js` 原样能用），不引 CDN；模型与贴图用 `gltf` / `glb` / `bin` / `hdr` / `ktx2`。Three.js 用 `new WebGLRenderer({ canvas, alpha: true, preserveDrawingBuffer: true })` 画到根元素里的画布，`setPixelRatio(1)`、`setSize(W, H, false)`，透明输出 `setClearColor(0x000000, 0)`；`renderAt` 里同步画完那一帧再 `renderer.getContext().finish()`，不用 `requestAnimationFrame` 循环；时间只从 `renderAt` 的参数来，不用 `THREE.Clock`。
- **用 p5 画 2D**能走指令：实例模式 `new p5(sketch, root)` 让画布挂进根元素，`setup` 里 `pixelDensity(1)`、`createCanvas(W, H)`、`noLoop()`，`draw` 开头 `clear()`（透明）或整幅 `background(...)`（不透明，根元素写 `data-alpha="false"`），`renderAt` 记下时间后 `inst.redraw()`，`initialize` 等 `setup` 跑完。文字要 `textFont` 指向包内字体。原样的 `p5.min.js` 会被离线扫描拒绝（`BUNDLE_NETWORK_REFERENCE`，库字串里有 9 处 URL）：带进包前把 `https://cdn.jsdelivr.net/npm/p5/translations/` 改成 `./translations/`，把 `new URL("http://…")` 探测字串与两处文档链接的 `http(s)://` 换成别的前缀；这些字串不影响画面。只画图形的场景优先纯 Canvas 2D，不用带 1 MB 的库。

## 3. 时间从文稿来

- **整首歌按整帧分段**：帧率取视频的帧率。每段记起始帧（含）与帧数，结束帧不含，下一段的起始帧 = 这一段的起始帧 + 帧数；从第 0 帧一直排到 `ceil(歌长 × 帧率)`，每一帧恰好属于一段，前奏和结尾都在里面。没有字的地方（前奏、换气、间奏、尾奏）也是段，不是空隙。
- **每段一个代码包**，包的时长正好是这一段的帧数。导入后用 videos_inspect 核对各段首尾相接、没有空隙也不重叠，总长等于歌长。歌在时间线上始终是一整段音频，不切开、不拼接、不变速。
- documents_read 读转写（已按原文写回的那份），把每句的起止时间与文字写成包里的一个数据文件（例如 `lines.js`），画面按它排：每句一个画面窗口。一句的画面不越过所在段落的结尾：前一段的最后一句不能拖进下一段的间奏或高潮。
- **跟拍**：入场、换姿势、闪光落在真实唱出的字与重拍上。歌导入后用 assets_analyze 分析它，把它写出的 JSON 拷进每个包：`frames` 里每帧有响度、低中高三段频带与起音强度，`onsets` 是起音时刻，`beats` 有拍、小节与段落。包里的时间 t 先换成歌的源文件时间（加上这个包在时间线上的开始，减去歌在时间线上的开始，再加歌的源起点），帧号 = `floor((源文件时间 − source.offset) × fps)`。让脉动跟 `bass`、闪动跟 `onset`、整体亮度跟 `level`。自动测出的拍点只作参考，按转写的字时间和试听核对，变速或不规则的段落尤其要核对。
- 用户要「剪个 15 秒左右」这类节选时，起止落在完整的一句或一段歌词上，不按要求的秒数把最后一句截断。

## 4. 确定性

- 第 t 秒的画面只由 t 决定：不用 `Math.random`、`Date.now` 与自走的动画；要随机就用按编号取值的哈希（同一个编号永远是同一个值）。计数、位置、已出现的元素都从 t 算出来，不逐帧累加。
- 缓动函数先把进度钳到 `[0, 1]`，区间外严格返回 0 或 1：back、elastic 这类曲线在 0 附近会算出极小的非零值，拿它判断「已出现」就会提前露出元素。
- 导入时会核对同一时刻两次取帧一致（不一致报 `COMPOSITION_NONDETERMINISTIC`）。确定的画面也能单独取任意一帧、分段并行渲染。

## 5. 画面元素

- **角色、道具与场景底图**：用 `skills_read` 读 `baocut-catalog-media`，按它「生成图片」里「成套素材」的做法画出来、抠好，放进包里。
- **角色在代码里同框**：每张生成的图只有一个角色，两个角色的对视、互动在代码里摆位置、定朝向；同一张图里画两个角色只用于封面、海报这类静止的画面。
- **图层顺序**固定为：场景底图 → 远处的图形 → 在角色身后的文字 → 角色 → 前景的粒子与光 → 字幕。字从角色身后穿过、被头发挡住，靠的是图层顺序，不是抠图。
- **图标、光效、边框**：用代码画，直接用 canvas 路径，或把 SVG 存成包里的 `.svg` 文件当图片画（不用 `data:` / `blob:` 地址，见第 2.1 节）。矢量图标的动效（火苗、摇铃、闪光）给一个相位参数，按时间取值；按尺寸与相位画到离屏 canvas 上缓存，不每帧重新画。
- **不用系统 emoji**：各平台的字形不同，离屏渲染时可能没有彩色 emoji 字体。
- **字体**：从本机已装的字体里选定几款，只把选中的 TTF 或 OTF 文件带进包里，留着它的授权说明。字体集合（`.ttc`）要拆出单个字面再用，不把扩展名改成 `.ttf` 冒充。全片渲染前先用有代表性的歌词画一帧样张：标点、数字和成片里每一种文字都要有字形，缺字会落到别的字体上，例如 `♥` 会被画成彩色 emoji。想要的字体没有时先和用户定换哪款，不悄悄替换。
- **角色动画**：在几个姿势之间切换，加上位移、旋转、挤压与抖动；不逐帧生成。
- **场景底图**：铺满裁切、慢慢推拉、压暗；字幕所在的那一条保持暗、干净。
- **光效与冲击**：闪白、发光、震动、推近、故障写进包里的提示表 `cues.json`（见下一节），时刻取起音点、切换与唱到的字。闪白之后再起发光，不同时起，免得整屏发白；不让两个闪白意外挨在一起；颗粒感只加一层；有意留下的安静画面不加效果。

## 5.1 提示表 `cues.json` 与后期效果

- 每个包一份 `cues.json`：`[{ "t": 3.2, "kind": "flash", "dur": 0.25, "strength": 0.8, "sfx": "boom" }]`。`t` 是包内的秒（与 `renderAt(time)` 同一个时间），`kind` 取 `flash`、`glow`、`shake`、`zoom`、`glitch`，`dur` 是效果的长度，`strength` 是 0..1。画面与音效读同一份表，事件只记一次。
- `sfx` 可选，是 assets_sfx 的配方名：导入包之后，按表里带 `sfx` 的每一条，在「包在时间线上的开始 + t」处用 assets_sfx 放到音效轨（`place.at`；`riser` 让末尾对准 t，放在 t 减去它的长度处）。改了表就同步改音效，不让画面和声音各走各的。
- 后期效果：用 `skills_read` 读本 skill 的 `examples/post-fx.js`，原样存成包里的 `post-fx.js`，在 `index.html` 里用 `<script src="./post-fx.js"></script>` 引入，得到全局的 `PostFX`。`PostFX.cuesAt(cues, t)` 把表合成这一刻各种效果的强度，再按它画震动、推近、发光、色散、暗角、颗粒、闪白，文件开头的注释是 `renderAt(time)` 里的写法与叠加顺序。都由 t 决定，不破坏确定性。发光与色散要传一个 `draw(g, w, h)`，在离屏画布上把正片再画一遍，不读回主画布，所以能走指令烘焙（第 2.1 节）；色散要再画两遍整幅，只在故障那几帧开。

## 6. 字幕、封面与署名

- 歌词与字幕默认是字幕层（可改、可双语），画面里只放梗与图，不把同一句话再画一遍。要逐字高亮这类字幕层做不到的样式时才画进代码，这时停用对应的字幕层，不让两份叠在一起。
- **给字幕留出一条带**：字幕层压在代码画面上面，场景里的图例、标签、步骤说明落进这条带就会被字幕盖住。带的位置从字幕样式算：`y` 是锚线（画面高度的百分比），`verticalAlign` 定字幕块哪条边落在锚线上，`fontSize` 按 540 短边计（1080 宽乘 2），最多两行。横版 1920×1080 用默认样式时，单行约在 y 890–970 px，两行约 850–1010 px；竖版 1080×1920 放在 `y` 75、居中时，两行约 1360–1520 px。写场景前定好这条带，所有段落都不往里放要读的东西；同一套画面出另一种画幅或语言时按新的带重排，译文更长，常常折成两行。
- **第一帧就是封面**（主 skill 的通用规则）：代码场景里就是 0 秒已把标题与主视觉画完整，不从空白淡入、不弹出，停一两秒再转进正片；用 compositions_preview 取 0 秒核对。
- **片尾署名**：名字、账号与各项分工逐字照用户给的，不改写、不补；你另加的说明（例如「非官方二创」）单独一行。

## 7. 自检

- 先画一帧风格样张给用户看，定下再写全片。**开头样段要带上第一次高潮**（副歌或第一个爆点）：风格撑不撑得住在高潮上才看得出来，留到最后才发现要返工。
- compositions_preview 一次最多取 24 个时刻：每句、每个段落交界各取一帧，加 `sheet: true` 拼成一张接触表一次看完（格子里不写时刻，按 `at` 给的顺序从左到右、一行满了换行，对不上就看结果的 `sheet.cells`），查文字重叠、画面空、上一句残留到下一段、元素出画。改完只重看改到的时刻。帧写在工作目录下的 `.baocut-out/frames/`，是临时输出：终端里从自己的工作目录运行，不在用户的代码仓库里跑。
- 拼起来的帧只看得出排版，看不出动作：入场、换姿势这类动作，在那一下前后约 2 秒里密集地取满 24 帧看连贯不连贯，再导出预览按正常速度看、听画面跟不跟拍。
- **烘焙前先给用户看会动的画面**：用 `skills_read` 读本 skill 的 `examples/bundle-preview.html`，原样存进工作目录，写一份 `preview.json` 列出各段的代码包、旁白音频、对齐好的句子时间与参考图，起一个本机静态服务打开（文件开头的注释写了用法）。页面跟着旁白逐帧画，叠上字幕带，不导入、不烘焙，改了代码包刷新就能再看。用户要逐段提意见时先在这里改到满意，再导入烘焙，省掉一轮轮重烘。
- **全片导入或渲染前先冒烟**：每个包的开头、中点、结尾各用 compositions_preview 取一帧。删掉的辅助函数、拼错的变量这类运行时错误，在这一步就会报出是哪个包、哪个时刻，不等烘焙或渲染到一半才发现。
- 每个包导入后看结果的 `bake.renderer`：该走指令的包回退成了 `browser-pixels`，按 `bake.fallback.reason` 和第 2.1 节改掉再换上去。
- 改一段或插入一段只重做那一个包（`replace: { itemId }`，插入时新建一个包放进去、把后面的段往后挪），没改的包不重新导入。
- **一段变长、变短、删掉或插进新段**：`replace` 不会挪后面的片段，变长时撞上同轨后一段会以 TIMELINE_OVERLAP 拒绝；deleteItems 只删不挪，留下空隙。

  **删掉一段**（连同它的旁白、字幕、音效）并让后面前移补上，用一笔 edits_apply 的 `removeRange` 波纹删除：`from`、`to` 是这一段在时间线上的起止秒数（也可写 `{"unit": "frames", "value": 帧号}` 免得取整），删的是 `[from, to)`，`to` 写成下一段的起点不会多切一帧。`trackIds` 列出所有要一起动的轨道：画面、旁白、字幕、音效都列上，没列的轨道不动，后面的内容就和画面错开。跨全片的背景音乐列上会在这里剪出一个接口，不列则音乐不跟着缩，片尾要另修。盖住这段时间的视频、音频、合成片段被拆开、删掉中间，图片、文字、字幕片段缩短，整个落在区间里的删掉；列出的轨道或片段锁着时整笔以 TARGET_LOCKED 失败。删多段时从最后一段往前排，可以放进同一笔事务。章节固定在时间线上，不归 removeRange 管：区间之后的章节另用 `upsertChapter` 把 `at` 减去 `to − from`，落在区间里的用 `removeChapter` 删掉或挪到 `from`。删完按下面第 4 步核对。

  **变长、变短或插入**时，先按整帧算出差值 Δ（新帧数 − 旧帧数；插入时是新段的帧数），再按这个顺序做：
  1. videos_inspect 带 `fromSeconds`（这一段的结尾；终端里写成 `--from-seconds`）列出片段，结果是与这段时间相交的片段，只留 `startSeconds` 不早于这一段结尾的那些；`itemsCoverage.truncated` 为 true 时加大 `limit` 再读。画面、旁白、字幕、音效、音乐各轨都算上，字幕层的片段漏挪一个，那段字幕就和画面错开。
  2. 变长或插入时，先用一笔 edits_apply 的 `moveItems` 把它们整体后挪 Δ（`offset` 写 `{"unit": "frames", "value": Δ}`），腾出位置；变短时先换包，再前挪。
  3. 带 `replace` 换包，或在腾出的位置放新段，旁白与字幕跟着换。
  4. videos_inspect 核对各段首尾相接、没有空隙也不重叠，总长等于各段帧数之和。

  有几段要一起改时，从最后一段往前做：前面的段还没变，后面算出的起点不会被打乱。讲解片按段配旁白、按段打包时，`explainer-video` 的制作脚本已按这几步实现（用 `skills_read` 读 `explainer-video`）。
- 在 BaoCut 之外渲染时：按场景分段渲染、能续跑，没改的段沿用；渲染中途不改代码，否则前后段不一致；从成片里抽几帧与单帧渲染比对，核对每段的帧数。
- 做完是每一段、连同结尾都已就位、看过，不只是开头样段。

## 8. 修改

- 改角色（换造型、加角色）出一个新版本的设定图与姿势，旧版本和用了它的段落保留；只重做用到新版本的段落（`replace: { itemId }`），姿势变了要重新量裁切边界与摆放位置。
- 按意见重做某一段时，保留分镜里这一段有意义的动作（例如「睡不着躺在床上」），用户没要求改编就不换成另一个好看但意思不同的动作。
