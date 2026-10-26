/* 字幕样式的**共用面** —— 第 45 轮从「一页控件」改成「画廊 + 属性页」。

   此前 Style 子页是一整页控件：三张预设卡，底下跟着字体、颜色、描边、阴影、
   位置十几行。两件事挤在一页里，哪件都做不好——想换个样子的人要在一排滑杆
   里找那三张卡，想调一个数的人要先滚过那三张卡。

   这一轮拆成两页：

     Style 子页 = **样式画廊**（2026-10-26 起是样式库，panel-sublibrary.jsx；缩略图仍在本文件）
        分类分区、每格一张缩略图，一眼看得出套上去是什么样
     ↓ 点缩略图上的铅笔，或在画布上点一条字幕
     字幕属性页 = panel-subprops.jsx
     ↓ 点动画那一行
     动画页 = panel-subprops.jsx

   缩略图**不是图片**：拿这份样式的 look 真画一遍（`lookCss`），所以点下去
   画面就是缩略图的样子。预烘的 webm/webp 好看，但会和真实渲染分叉。

   第 46 轮起缩略图**在动**：它按词画，逐词动画由一个共用节拍器驱动（取帧表在
   `BC_WA.frame`）。这一条不是装饰——上一轮的画廊里，「药丸卡拉OK」与「白底黑字」
   长得几乎一样，差别全在那个会点亮的当前词上，不动就得点进去才知道。核心侧
   `word_animation` 认的那七种，在这里是一眼能分辨的七种。

   画廊里陈列什么由形态决定，不是这里挑的——字幕 Tab 只有源语言一条轨的样式，
   翻译 Tab 有双语与仅译文两类，第 74 轮起**按形态分区**（「双语字幕」「翻译字幕」
   两区，`BC_SUB.gallery`，有测试）：两区都是字幕 Tab 那份列表的派生，区内顺序
   与字幕 Tab 相同。分区不是开关，两区在同一条滚动流里。

   **样式卡永不改轨集**（第 108 轮裁决：文档只和 timeline 相关，timeline 上有哪几条
   字幕轨就显示哪几条）。第 45/74 轮的「套用一份样式 = 对轨集的一次声明」到此退役
   ——双语卡补一条译文轨、仅译文卡把源语言拿下来，那是让一张缩略图替用户做了一次
   没打招呼的增删轨。卡只换涂装，落在当下这一份轨集上（`BC_SUB.applyTargets`）；
   缩略图画两行、画面上只有一行时，就只给在场的那条上妆并说清楚。增删轨的入口在
   timeline 行头与语言入口上（`subtrack.jsx`）。

   第一区是**我的品牌库**，画廊里没有「存到品牌库」——存是编辑完之后的动作，
   入口在属性页页脚那一条 savebar 上。 */
(function () {
  const D = window.BC_DATA;
  const S = window.BC_SUB;
  const WA = window.BC_WA;
  const SA = window.BC_SA;

  /* ---------- 涂装 → 导出画面里的 CSS ----------
     缩略图、预览条、画布三处共用这一个函数，所以三处不可能画得不一样——
     「点下去画面就是缩略图的样子」是这一轮的承诺，它只能靠同一段代码兑现，
     靠两份对着抄的样式表兑现不了。

     字号是唯一的自变量：描边粗细、底板内边距、辉光半径全部按字号折算，
     所以同一份涂装在 13px 的缩略图与 20px 的画布上是同一个样子。 */
  /* 那 17 条动效的 `@keyframes` 是**生成**的（`BC_SA.keyframesCss()`），不是手写在
     ui.css 里的——手写就等于把关键帧抄了第二遍，抄错了没人知道。模型层只交字符串，
     碰 DOM 归这里。 */
  if (typeof document !== 'undefined' && !document.getElementById('bc-va')) {
    const el = document.createElement('style');
    el.id = 'bc-va';
    el.textContent = SA.keyframesCss();
    document.head.appendChild(el);
  }
  /* 动效字幕（emphasis 系列配方）第 71 轮起**不发关键帧**：它画在 canvas 上，
     每帧由 `BC_VC.plan(preset, layout, t)` 现算（app/subcaption.jsx）。此前这里还注入过
     一段 `<style id="bc-vc">`，那一段连同 `--vc-box-*` 的 `@property` 一起退役了。 */

  const CASE = {upper: 'uppercase', title: 'capitalize', lower: 'lowercase'};

  /** 底色 ＋ 不透明度 → 一个可用的 CSS 颜色。底色存成不透明的，透明度单独一格，
   *  属性页那颗「不透明度」滑杆才有东西可写；混在一个 `rgba()` 串里它就是个摆设。 */
  function withAlpha(color, pct) {
    const a = Math.max(0, Math.min(100, pct == null ? 100 : pct)) / 100;
    const m = /^#([0-9a-fA-F]{6})$/.exec(String(color || ''));
    if (!m) return color;                       // `var(--*)` 之类原样交出去
    const n = parseInt(m[1], 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  /** 背景怎么包：`block` 由外层的盒子承担（默认，画廊缩略图走这一档），
   *  `line` 由里面的 `WordLine` 承担（`box-decoration-break: clone`），外层因此不再画底。 */
  const plateOf = (p) => p.plate || 'block';

  /* 圆角与内边距都是**占字号的百分比**（第 62 轮从 px 改过来，与预设数据的归一化口径一致）。
     px 圆角不跟字号缩放：同一份样式在 13px 的缩略图与画布的大字上会是两个形状，而
     「点下去画面就是缩略图的样子」要求它们是同一个。 */
  const radiusOf = (p, fz) => Math.round(fz * (p.corners == null ? 0 : p.corners) / 100);
  const padOf = (p, fz) => {
    const v = Math.round(fz * (p.pad == null ? 20 : p.pad) / 100);
    return v + 'px ' + Math.round(v * 1.4) + 'px';   // 左右比上下宽一点，字才不贴着板边
  };

  function paintCss(p, fz) {
    const w = p.weight || 500;
    const st = {fontSize: fz, fontWeight: p.bold ? Math.max(w, 700) : w, color: p.color,
      lineHeight: (p.lh || 130) / 100, textAlign: p.align || 'center'};
    // 字体是样式的一部分（那 31 份预设有一半的差别就在族与字重上），不是面板的装饰
    if (p.stack) st.fontFamily = p.stack;
    if (p.italic) st.fontStyle = 'italic';
    if (p.bg && p.opacity > 0 && plateOf(p) === 'block') {
      st.background = withAlpha(p.bg, p.opacity);
      st.padding = padOf(p, fz);
      st.borderRadius = radiusOf(p, fz);
    }
    /* 分层涂装（caption-editor-redesign §4）：有 `layers` 就只画栈，不再读 v1 那几个镜像键——
       它们是给旧读者的第一层副本，两边都画就是同一道描边画两遍。填充与滤镜由 `--tx-*` 变量
       传到词与字的最内层（`.aw-t`，app/subtitle-active.css）。 */
    if (p.layers && window.BC_SURF) Object.assign(st, window.BC_SURF.cssOf(p.layers, p.color, fz));
    else if (p.outline) {
      /* 描边画在字的**后面**。`-webkit-text-stroke` 默认是「居中 ＋ 盖在填充之上」，
         于是一条 `size: .18` 的描边（Boba / Slay / Komika 那一档）会从两侧各啃掉
         半个笔宽——13px 的缩略图上那正好是整个字干，卡片糊成一团黑。描边应当是
         往外长的，`paint-order: stroke fill` 把顺序换过来就对上了：居中的笔宽仍是
         `fz × size`，但朝内那一半被填充盖住，看得见的是朝外的那一半。 */
      st.WebkitTextStroke = Math.max(0.5, +(fz * 0.05 * ((p.outlineW || 8) / 8)).toFixed(2)) + 'px ' + p.outlineColor;
      st.paintOrder = 'stroke fill';
    }
    if (p.shadow && !(p.layers && window.BC_SURF)) {
      const c = p.shColor || 'rgba(0,0,0,0.85)';
      const a = ((p.shAngle == null ? 90 : p.shAngle) * Math.PI) / 180;
      const d = (p.shDist == null ? 12 : p.shDist) / 100 * fz;
      const b = (p.shBlur == null ? 24 : p.shBlur) / 100 * fz;
      // 距离为 0 = 辉光：往四周铺一圈，而不是往某个方向投一份
      st.textShadow = d === 0
        ? '0 0 ' + Math.round(b * 2.2 + 2) + 'px ' + c + ', 0 0 ' + Math.round(b + 1) + 'px ' + c
        : Math.round(Math.cos(a) * d) + 'px ' + Math.round(Math.sin(a) * d) + 'px ' + Math.round(b) + 'px ' + c;
    }
    /* 动效要读的三个变量。哪一条读哪一个由动效的 `colourParam` 决定（字色 / 块色），
       所以三个都给：读不到的那一条本来就不碰它。墨色是我们自己那条规矩
       （块底亮就落墨、暗就落纸——看不出字的高亮等于没有高亮）。 */
    if (p.activeColor) {
      st['--wa-active'] = p.activeColor;
      st['--wa-box'] = p.activeColor;
      st['--wa-ink'] = WA.inkOn(p.activeColor);
    }
    // 字距按 1/100 em 存：同一份涂装在 13px 的缩略图与画布上的大字上是同一个疏密
    if (p.spacing) st.letterSpacing = (p.spacing / 100) + 'em';
    if (p.upper) st.textTransform = CASE[p.upper] || 'uppercase';
    return st;
  }

  /** 底板落在里层时的那一块。`line` 用 `box-decoration-break: clone` ——折行之后
   *  每一行各自贴一块、宽度跟着那一行走，这是一个纯 CSS 就能给的语义，不需要
   *  在 JS 里量文本。返回 null 表示底板归外层（`block` 档或者根本没开底板）。 */
  function plateCss(p, fz) {
    const mode = plateOf(p);
    if (!p.bg || !(p.opacity > 0) || mode === 'block') return null;
    return {background: withAlpha(p.bg, p.opacity), borderRadius: radiusOf(p, fz),
      padding: padOf(p, fz),
      WebkitBoxDecorationBreak: 'clone', boxDecorationBreak: 'clone'};
  }

  /** 画廊里那份 look 摊成一份涂装。套用样式做的正是同一件事（editor.jsx
      的 `applyPreset`），所以缩略图与套用之后的成员读的是同一组字段。

      第 62 轮起 `D.subtitle.looks` **本身就是换算好的涂装**（那 31 份预设，见
      model-subpresets.js），所以这里只剩「取一份副本」。此前它在这里现摊——从五六个键
      推出描边粗细、辉光半径、当前词颜色——那是把换算规则藏在视图层里：核心与属性页
      读不到它，画廊之外的任何人想复现同一份涂装都只能再抄一遍。 */
  /** `key` 是涂装表的键；也认一份**涂装对象**（轨自己那一份，`BC_SUB.line` 读出来的），
   *  第 151 轮的入口卡拿它画「轨上现在的样子」而不是目录里那张卡的样子。 */
  function lookPaint(key) {
    if (key && typeof key === 'object') return Object.assign({}, key);
    return Object.assign({}, D.subtitle.looks[key] || D.subtitle.looks.casper);
  }
  const lookCss = (key, fz) => paintCss(lookPaint(key), fz);
  const isMono = (key) => !!((key && typeof key === 'object' ? key : D.subtitle.looks[key]) || {}).mono;

  /* 共用节拍器、`WordLine` 与 `lineMotion` 住在 app/sub-wordline.jsx（2026-10-09 拆出）：
     画布与导出预览也用它们，四处同一段代码。 */
  const REDUCED = window.subReduced;
  const lineMotion = window.lineMotion;
  const WordLine = window.WordLine;

  /** 这一门语言的样例文字，取不到就落回默认那门（**英文**——BaoCut 不是一个中文 App）。
      画廊传的是固定的样张语言对（`D.subtitle.specimen`），预览条传的是轨自己的语言：
      样张要在所有项目里长一个样，预览条要长得像你的项目。 */
  function sampleOf(lang, key) {
    const s = D.subtitle.sample;
    return (s[lang] || s[D.subtitle.sampleDefault])[key];
  }

  /* ---------- 缩略图 ----------
     画的是一格画面：深底 + 这份样式排出来的一两行，逐词动画在跑。双语按默认叠法
     排——**译文在上、字更大；原文在下、字更小**——两行之间那条缝就是接缝，缩略图
     上也看得见。

     动的只有源语言那一行。这不是省事：**词级时间戳只有源语言轨有**，译文是句级
     对齐出来的，没有词的起止可以踩。所以双语卡上「下面那行在动、上面那行不动」
     本身就是一条规则的可见形态，用户不必读文档也能看出来。

     `langs` 按**位次**给（`main` 上、`sub` 下），不按角色给：单行样张与双语样张
     最显眼的那一行都该是同一门语言。同一个画廊里所有卡片写同一对语言，才比得出
     样式的差别——一张写中文、一张写英文，比的就成了语言。至于那一对是固定的
     （字幕 Tab 的样式样张）还是项目自己的语言对（翻译 Tab，第 74 轮），由
     样式库（`SubLibrary`，panel-sublibrary.jsx）决定，这里不挑。 */
  /* 动效字幕那一区的格子比通用格子高一档（`.sthumb--cap`，120px），画布字号跟着提一档。
     14 在字号阶梯上（13 不在），提上去之后各份之间由 `layout.size` 决定的相对大小
     一格没变——整条链是 `fz × layout.size / SIZE_REF`，等比。 */
  const CAP_FZ = 14;

  /** `rows` 给的时候（第 151 轮画廊与入口卡）直接照它画——`[role, look, lang]` 每行一条，
   *  由 `BC_SUB.screenRows` 按画面上现有的轨算出来；没给才按卡的形态画样张（品牌库
   *  存卡那一格的样张仍走这条路）。 */
  /** `texts`（样式库，§9.1）按角色给这一格要写的字（`{orig, trans}`），没给就用样张；
   *  `idle` 是卡不在可视区：节拍器不走、入场不跑，一千张卡时只有看得见的那几张在动。 */
  function SubThumb({p, fz = 13, langs, flip, rows: given, texts, idle}) {
    const L = langs || {};
    /* `p.look` 恒是**原文行**的 look（逐词动画长在它身上，`applyPreset` 也是这么落的），
       `p.look2` 是译文行的。默认叠法把译文放在上面，所以双语卡上第一行读的是 look2；
       `flip`（第 74.1 轮：项目的叠法被倒转过）时原文行画在上面——语言仍按**位次**取
       （`L.main` 恒是上面那行），所以调用方翻转叠法时要连 langs 一起翻。 */
    const rows = given ? given : p.form === 'bi'
      ? (flip
        ? [['orig', p.look, L.main], ['trans', p.look2 || p.look, L.sub]]
        : [['trans', p.look2 || p.look, L.main], ['orig', p.look, L.sub]])
      : p.form === 'trans' ? [['trans', p.look, L.main]] : [['orig', p.look, L.main]];
    const srcRow = rows.find((r) => r[0] === 'orig');
    const textOf = (role, lang) => (texts && texts[role]) || sampleOf(lang, 'thumb');
    const n = srcRow ? WA.split(textOf('orig', srcRow[2])).length : 0;
    /* 两轴（当前词 ＋ 动效，2026-10-09）：每一行按角色取——目录卡读 `BC_CS` 的正文，品牌库旧卡
       按 `anim` 查十九格表。源语言行带当前词，译文行只带「出现时」那几段动效（没有词级时间戳）。 */
    const words = rows.map((r) => window.subWordOf(p, r[0] === 'orig' ? 'source' : 'translation', lookPaint(r[1])));
    /* 动效字幕**永远在动**：一次一词 / 逐词堆叠本身就是它的动画，不跑节拍器那一区会全是静帧。 */
    const {cur, cycle} = window.useSubCycle(Math.max(n, 1), !idle && (p.caption ? true : words.some(window.subWordMoves)));
    /* 动效字幕走**第二条渲染路径**：配方自带涂装、排版与四档时间通道，画在 canvas 上，
       所以这里既不画 look 也不画行叠——整格交给 `CaptionCanvas`（app/subcaption.jsx）。
       时钟是它自己的循环时间线（与本文件的节拍器同 epoch），所以不用把 `cur` 传下去。 */
    /* 倒鸭子（`p.kinetic`，2026-09-17）走**第三条渲染路径**：跨句世界 ＋ 镜头，画在
       canvas 上循环放三条短 cue（daoyazi-stage.jsx 的 `DaoyaziThumb`）。译文行不进小样——
       它在画面上是固定在下沿的普通一行，小样要演的是它接管的那一层。 */
    if (p.kinetic && srcRow) {
      return (
        <span className="sthumb sthumb--kin">
          <window.DaoyaziThumb />
        </span>
      );
    }
    if (p.caption && srcRow) {
      return (
        <span className="sthumb sthumb--cap">
          <window.CaptionCanvas presetK={p.caption} text={textOf('orig', srcRow[2])}
            loop fz={CAP_FZ} still={REDUCED || idle} />
        </span>
      );
    }
    return (
      <span className="sthumb">
        {rows.map(([role, look, lang], i) => {
          const paint = lookPaint(look);
          const rowFz = i === 1 ? Math.round(fz * 0.8) : fz;
          const w = words[i];
          /* **底板要往里传**：`line` 那一档的底由 `WordLine` 画（`box-decoration-break` 管折行），
             外层只画 `block` 那一档；不传的话白板样式在画廊里等于没画。 */
          return (
            <span key={role + i} className={cx('sthumb__l', isMono(look) && 't-mono')} style={paintCss(paint, rowFz)}>
              <WordLine text={textOf(role, lang)} aw={w.aw} motion={w.motion} wordBox={w.wordBox} page={w.page}
                highlight={role === 'orig' ? demoMark(w, textOf(role, lang)) : null} cueId="thumb"
                cur={role === 'orig' ? cur : -1} cycle={cycle} still={REDUCED || idle} plate={plateCss(paint, rowFz)} />
            </span>
          );
        })}
      </span>
    );
  }

  /** 两轴三件铺成 `WordLine` 的 props；旧轨（没有 `activeWord`）给空，走旧路。 */
  const wordProps = (w) => (w ? {aw: w.aw, motion: w.motion, wordBox: w.wordBox, page: w.page} : {});
  /** 样张上的强调词：带强调外观的卡把样张最后一个词点亮，缩略图才看得出「关键词」那一档。 */
  function demoMark(w, text) {
    const e = w && w.emphasis;
    if (!e) return null;
    const list = WA.split(text);
    const i = list.length - 1;
    return {on: true, color: e.color, font: e.fontFamily || null, bold: e.bold !== false, italic: !!e.italic,
      scale: Math.round((e.scale || 1) * 100), marks: {thumb: [{text: list[i], index: i}]}};
  }

  /* ---------- 预览条 ----------
     属性页顶部那一条。画的是**这几条轨长什么样**：按 timeline 的行序排、当下在编辑的
     那一条加描边、源语言那一行把逐词动画放出来（同一个节拍器，与画廊同相位）。

     它不画位置——位置是每条轨自己的锚点 ＋ 偏移，画布上才看得准（第 47 轮去掉组之后
     尤其如此：预览条里两行紧挨着，画面上它们可能一个贴底一个在中间）。

     它与画廊缩略图的差别只在句子长短：缩略图给一句短的（一格里放得下），这里给一句
     完整的，因为折行、词距、当前词落在行尾这些事只有长句上看得见。 */
  function SubPreview({ctx, scope}) {
    const st = ctx.subStyle;
    /* 预览条画的是**画面上此刻那一条**（第 102 轮）：它上面写着「样张」，但它的职责
       是「点下去画面就是这个样子」。作用域切到「仅这一条」之后这里还照轨上那份画，
       条子上那一笔就在预览条与画布之间分了叉。 */
    const cueId = ctx.curCue ? ctx.curCue.id : null;
    const list = S.tracks(st);
    const sourceTrack = S.source(st) || {};
    const src = (sourceTrack.id && S.line(st, sourceTrack.id, cueId)) || sourceTrack;
    const anim = src.wordAnim || 'none';
    const cap = src.caption || null;
    const currentText = ctx.curCue && (ctx.cueText ? ctx.cueText(ctx.curCue.id) : ctx.curCue.text);
    const n = WA.split(currentText || sampleOf(src.lang, 'line')).length;
    // 两轴（2026-10-09）：轨上有 `activeWord` 就走两轴路，与画布、缩略图同一个组件
    const srcWord = window.subWordOfTrack(src, true);
    const {cur, cycle} = window.useSubCycle(n, cap ? true : srcWord ? list.some((t) =>
      window.subWordMoves(window.subWordOfTrack(S.line(st, t.id, cueId), t.role === 'source'))) : SA.moves(anim));
    const w = S.writable(st, scope);
    return (
      <div className="spp" aria-label="当前字幕样式预览">
        {list.map((t) => {
          const ln = S.line(st, t.id, cueId);
          const rawText = (t.role === 'source' ? currentText : ctx.curCue && ctx.curCue.trans) || sampleOf(t.lang, 'line');
          const text = window.BC_SUB_PREFS.displayText(rawText, st.punct !== false);
          // 与舞台同口径（第 74.1 轮）：名义字号 32 ↔ 基准 18，按各轨自己的字号折算
          const fz = Math.round(18 * ln.size / (D.subtitle.trackDefaults.size || 32));
          return (
            <div key={t.id} className={cx('spp__l', list.length > 1 && w === t.id && 'is-target',
              cap && t.role === 'source' ? 'spp__l--cap' : ln.kinetic && t.role === 'source' ? 'spp__l--kin' : ln.mono && 't-mono')}
              style={(cap || ln.kinetic) && t.role === 'source' ? null : Object.assign(paintCss(ln, fz),
                t.role === 'source' && !ln.activeWord ? lineMotion(anim, cur) : null)}>
              {/* 配方接管整条：涂装、排版与时间通道都归它，这一行不读轨上的那几格。
                  倒鸭子同理，小样按这一条 cue 的句子切三段循环放（daoyazi-stage.jsx）。 */}
              {ln.kinetic && t.role === 'source'
                ? <window.DaoyaziThumb text={text} kin={ln.kinetic} fontPx={18} />
                : cap && t.role === 'source'
                ? <window.CaptionCanvas presetK={cap} text={text}
                  loop fz={fz} still={REDUCED} />
                : <WordLine text={text} active={ln.activeColor} {...wordProps(window.subWordOfTrack(ln, t.role === 'source'))}
                  anim={t.role === 'source' ? anim : 'none'} cur={t.role === 'source' ? cur : -1} cycle={cycle} still={REDUCED}
                  highlight={t.role === 'source' ? ln.highlight : null} cueId={cueId}
                  plate={plateCss(ln, fz)} />}
            </div>
          );
        })}
      </div>
    );
  }

  /* 样式画廊 2026-10-26 换成样式库（caption-editor-redesign §9.1），在 panel-sublibrary.jsx。 */

  /* ---------- 样式那一支的三级栈 ----------
     画廊 → 字幕属性页 → 动画页，三页都是从 Tab 主页**推进来的**（第 151 轮起画廊也是，
     Style/Edit 子 Tab 退役；主页是校对列表 ＋ 顶上的样式入口卡，见 panel-substrip.jsx）。
     第 152 轮起只有一个字幕 Tab，`editId` 是轨条当下选中的那条轨。

     栈的位置存在 `ctx.paneView` 而不是局部 state，因为**画布上点一条字幕**要能
     把面板直接推到属性页那一层（见 stage.jsx）。作用域跟着选中的轨走。 */
  function SubStyleTab({ctx, ops, editId, backLabel, widen}) {
    const st = ctx.subStyle;
    /* 套「仅译文」样式时要知道落在哪一条译轨上——那件事发生在编辑器的写路径里，
       拿不到面板的 props，所以这里把当下的编辑对象挂到编辑器的一格上。 */
    if (ctx.subEditId) ctx.subEditId.current = editId || null;
    /* 作用域没有第二份真相：它**就是** `sel.trackId`，而且**永远是一条轨**——
       第 47 轮去掉组之后没有「整组」那一档了。画布上点一条、属性页顶部那排 chip、
       轨条——三个入口写的是同一个字段，所以三处永远一致，不会出现「面板说在改
       译文、画布上高亮的是原文」。轨被拿下来之后作用域回落到第一条（`writable`）。 */
    const sel = ctx.sel && ctx.sel.kind === 'subs' ? ctx.sel : null;
    const scope = S.writable(st, (sel && sel.trackId) || editId);
    const setScope = (v) => {
      ctx.pickSub(v);
      ctx.setPaneView('subprops');
    };

    /* 换页 / 收面板 / 切 rail 都把悬停预览撤掉（第 102.1 轮）：`onMouseLeave` 只在鼠标
       真的从卡片上移开时才发，从卡片上直接点走不经过那一下，预览就钉在画面上不走了。 */
    React.useEffect(() => () => ctx.setPeek(null), []);

    const remembered = React.useRef({});
    const view = ctx.paneView === 'subanim' ? 'anim' : ctx.paneView === 'subprops' ? 'props' : 'gallery';
    const go = (v) => ctx.setPaneView(v === 'home' ? null : 'sub' + v);

    if (view === 'anim') return <window.SubAnimView ctx={ctx} onBack={() => go('props')} />;
    if (view === 'props') {
      return <window.SubProps ctx={ctx} scope={scope} setScope={setScope} remembered={remembered} backLabel={backLabel}
        onBack={() => go('home')} onAnim={() => go('anim')} onGallery={() => go('gallery')} />;
    }
    return <window.SubLibrary ctx={ctx} ops={ops} editId={editId} backLabel={backLabel} widen={widen}
      onBack={() => go('home')} onEdit={() => go('props')} />;
  }

  Object.assign(window, {SubStyleTab, SubThumb, SubPreview, sampleOf, paintCss, plateCss, withAlpha, lookCss, lookPaint, isMono});
})();
