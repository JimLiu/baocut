/* 字幕的**轨与组**模型 —— 第 45 轮重写。

   在这一轮之前，字幕在原型里是「一个独立元素类型 + 一份摊平的样式表」，双语
   被写死成 orig / trans 两个字段。三件事因此说不清楚：叠法归谁、第三门语言往
   哪里放、时间轴上那一条「字幕」到底是什么。

   按它本来的形状重画：

     **一门语言 = 一条字幕轨**（timeline 上一行）。转录完成默认落一条源语言轨；
     翻译完成默认再落一条译文轨，于是画面上是双语。再翻日文就是第三条。
     轨一旦落到 timeline 上就固定在那里——**面板的语言下拉切的是「我在编辑哪一
     条轨」，不是「timeline 上有哪几条轨」**。（Mac 版当前的毛病正是后者：切个
     Tab，时间轴上的轨跟着换掉了，用户没做任何删除动作却少了一条轨。）

     **每条轨是一个派生文本元素**：文本与时间是 transcript `words[]` 的投影，
     轨自己持有「长什么样」与「摆在哪儿」（锚点 ＋ 偏移），外加源语言轨独有的
     **词级时间戳**。第 47 轮去掉了「组」——编辑器不需要把几条字幕一起选中编辑，
     所以也不需要一个只为「一起编辑」而存在的对象（见下面 `place` 上方那段）。

   两条跟着这个形状走的规矩，都在下面的纯函数里：

   1. **一条轨就是一个可选中、可摆放的东西**（`scopes` / `writable` / `sections`）：
      属性页只有一种页——这一条轨的样子 ＋ 它自己的行内对齐与位置。没有「整组」那一档，
      也就没有「我现在改的是这一条还是那一栈」这个每次都要先答一遍的问题。
   2. **词级时间戳只在源语言轨上**（`hasWordTiming`）：所以逐词动画与强调词只
      长在源语言轨上，译文轨那一格换成「跟随源语言」——译文是句级对齐出来的，
      没有词的起止可以踩。

   核心早就是这么存的：样式文档是「根节点 + `origStyle` / `transStyle` 两份
   partial 覆盖」（`document.rs::merged_line_style`）。第 45 轮把两份覆盖推广成 N 条；
   第 47 轮把根节点上那几个**只为叠在一起而存在**的键（行间距、底板一块）去掉，
   位置下放到每条轨上。核心侧对应的是「每一行自己带 vertical_align 与位置」，
   `line_vertical_align` 不再需要「返回 None 就用接缝规则」那一档。 */
(function () {
  /* ---------- 轨 ----------
     第 47 轮**去掉了组**。此前几条轨叠成一个「组」，组持有行间距 / 底板一块还是
     各自一块 / 锚点 / 偏移，属性页为它单开一档「整组」，画布上还能整栈选中。

     去掉它的理由很直接：编辑器不需要「把几条字幕一起选中编辑」这件事。**一门语言
     一条轨，各自选中、各自编辑**——位置也是各自的。组留在那里只带来两样东西：一档
     点进去几乎全是几何数字的属性页，以及「我现在改的是这一条还是那一栈」这个每次
     都要先答一遍的问题。

     组一走，`gap` 与「底板整组一块」也跟着走了：前者是两条轨共用一个锚点时才需要
     的东西（各自有锚点之后，缝就是两个偏移的差），后者要求几条轨共享一块底板，那
     正是「组合在一起」。锚点 ＋ 偏移下放到轨上，于是画布上拖一条只动那一条。 */

  /** 轨的顺序**就是** `tracks` 数组的顺序（自上而下），不另存一份 order。
   *  它现在只决定 timeline 上的行序与新轨插在哪儿——**画面上谁在上谁在下由各自的
   *  锚点 ＋ 偏移决定**，不是数组顺序。 */
  function tracks(st) { return (st && st.tracks) || []; }
  function byId(st, id) { return tracks(st).find((t) => t.id === id) || null; }
  /** 源语言轨。**没有就是没有**——不退回 `tracks[0]`：源语言被「仅译文」样式
   *  拿下来之后，画面上第一条是译文轨，让它冒充源语言会把词级时间戳、比例链的
   *  基准、以及「只显示原文」该往哪儿补，三件事一起搞错。调用点一律 `|| {}`。 */
  function source(st) { return tracks(st).find((t) => t.role === 'source') || null; }
  function translations(st) { return tracks(st).filter((t) => t.role !== 'source'); }

  /* 第 49 轮去掉了「样式跟随源语言」。它是组模型的最后一块遗留：那时候双语是「一份
     样式带两行」，译文行不写自己那份就照抄原文的。轨各自独立之后它变成一处**隐性耦合**
     ——在原文轨上改个颜色，另一条轨会跟着变，而用户并没有选中它。双语套装的配对由
     样式目录里的 `look2` 给（`applyPreset` 落的就是它），不需要一个运行时的连线。 */

  /** 一条轨在界面上怎么称呼：**先说角色，再说语言**。
   *
   *  第 50 轮改的。此前 chip 与段头写的是语言名（`English` / `中文`），但用户在这一屏
   *  想的是「原文那条」还是「译文那条」——语言是补充说明，不是主语。只写角色又不够：
   *  译文可能有好几条，得靠语言区分。所以两个都给，角色在前。 */
  function label(t) {
    if (!t) return '';
    return (t.role === 'source' ? '原文' : '译文') + '（' + (t.name || t.lang) + '）';
  }

  /** 词级时间戳只在源语言轨上。 */
  function hasWordTiming(track) { return !!track && track.role === 'source'; }

  /* ---------- 默认叠法：**译文在上、原文在下** ----------
     第 46 轮改的方向。此前是原文在上、字更大，那是「给会源语言的人配个译文」的
     排法；BaoCut 的观众读的是译文，所以译文是主行——在上、字更大，原文在下、
     字更小，**逐词动画留在原文行上**（词级时间戳只有它有，见 `hasWordTiming`）。
     默认字号按上下位置区分，与语言无关：下行原文 20，上行译文 32 = 原文 × 1.6
     （§16.1）。倒转时交换几何与字号，因此上大下小的比例保持不变。

     组去掉之后这条规矩还在，只是落点变了：它决定新轨**插在 timeline 的哪一行**，
     以及默认锚点/偏移取哪一档（译文那一档更靠上）。画面上的上下由轨自己的偏移说了算。 */
  function place(list, track) {
    if (track.role === 'source') return list.concat([track]);   // 原文恒在最下
    const i = list.findIndex((t) => t.role === 'source');
    return i < 0 ? list.concat([track]) : list.slice(0, i).concat([track], list.slice(i));
  }

  /** 轨的增删与换位。都是纯函数：返回新的 tracks 数组，不改入参。 */
  function addTrack(st, track) {
    if (byId(st, track.id)) return tracks(st);
    return place(tracks(st), track);
  }
  /** 把一条轨从组里拿下来。**拿下来不是删数据**：这门语言的 cue 与词级时间戳
   *  仍在文稿里，语言入口的「有译文，还没放上去」那一组能把它放回来。
   *  唯一的硬边界是不能拿掉最后一条——画面上一条字幕都没有就不是字幕了。 */
  function removeTrack(st, id) {
    const list = tracks(st);
    if (list.length < 2 || !byId(st, id)) return list;
    return list.filter((x) => x.id !== id);
  }
  /** 换一门语言：**身份来自新轨，长相来自被换掉的那条**。
   *
   *  用户调好的双语套装不该因为把英语换成日语就丢——那是两件事。角色变了的时候
   *  几个只对源语言成立的键跟着角色走（词级动画、强调词），否则译文轨上会留一份
   *  渲染端永远不读的数据。 */
  function replaceTrack(st, outId, inTrack) {
    const out = byId(st, outId);
    if (!out || !inTrack) return tracks(st);
    const next = Object.assign({}, out, {
      id: inTrack.id, lang: inTrack.lang, name: inTrack.name, role: inTrack.role,
    });
    if (next.role !== 'source') {
      delete next.wordAnim;
      delete next.caption;
      delete next.kinetic;
      delete next.activeColor;
      delete next.highlight;
      // 当前词只对有词级时间的轨成立（caption-style-model-design §4）
      if (next.activeWord) next.activeWord = {mode: 'none', spoken: 'keep', unspoken: 'keep'};
      delete next.emoji;
    }
    return tracks(st).map((t) => (t.id === outId ? next : t));
  }

  /** 把一条搁置的轨放回画面时该走哪条路——**软上限**（默认两条，第三条起问一次）。
   *
   *    'add'   画面上不足两条：直接放回去。这是「仅译文 / 只显示原文」的回头路，
   *            不该有摩擦。
   *    'ask'   放回去会变成三条以上，且有**同角色**的一条可以换：问一次
   *            「换成这一门」还是「再叠一条」。
   *    'stack' 同上但没有可换的（把源语言放回一堆译文上——画面上不可能已有第二条
   *            源语言），只剩「再叠一条」，仍然确认一次。
   *
   *  不做硬上限也不做 disabled：disabled 说不出理由，一句确认能。 */
  function putBackMode(st, track, editId) {
    if (tracks(st).length < 2) return {mode: 'add', swapId: null};
    if (!track || track.role === 'source') return {mode: 'stack', swapId: null};
    const cur = byId(st, editId);
    const swap = (cur && cur.role !== 'source' ? cur : translations(st)[0]) || null;
    return swap ? {mode: 'ask', swapId: swap.id} : {mode: 'stack', swapId: null};
  }

  /* ---------- 属性页的段门控 ---------- */

  /** 这次落笔写哪条轨。**永远是一条轨**——组去掉之后没有「谁也不写」这一档了。
   *  作用域指向一条不存在的轨（刚被拿下来）时回落到第一条。 */
  function writable(st, scope) {
    return (byId(st, scope) || tracks(st)[0] || {}).id || null;
  }

  /** 属性页顶部那排 chip：就是几条轨。一条轨时没有可选的，不摆一排只有一颗的 chip。 */
  function scopes(st) {
    return tracks(st).length < 2 ? [] : tracks(st).map((t) => t.id);
  }

  /** 一条轨那一页的段：文字 → 行数 → 描边 → 阴影 → 底板 → 动画 → 强调词 → 自动表情。
   *  顺序按「看得见的东西从大到小」排（第 48 轮把底板挪到描边/阴影之后）。
   *
   *  第 48 轮的两处删减：**下划线**（只留 B / I——字幕加下划线是极少数情况，
   *  留一颗从不按的钮比缺一颗更贵）与**每行随机微倾**。行内对齐不再单开一段，折进
   *  「文字」那一段的排版行，与 B / I / 大小写摆在同一行：
   *  它们都是「这一行怎么排」。
   *
   *  **第 102 轮更正一条事实**：随机微倾那一条当时写的理由是「我们自己加的花活」
   *  ——这句是错的，每行随机微倾是字幕样式里常见的一行开关。删它的**结论**仍然成立，
   *  但正确的理由是另一条：核心 `bcut-subtitle-render` 没有 per-line rotation 这条通道，
   *  画一个渲染端读不到的开关就是空控件。理由错的删减与理由对的删减在文档里长得一样，
   *  但只有后者能被复核，所以这一条要改正而不是留着。
   *
   *  第 50 轮又去掉两个：
   *  - **行数 1/2/3**（`maxLines`）。字幕若是自动切的，它才有意义；
   *    我们的切分单位是 **cue**，在 Edit 子页上用 Enter / ⌫ 改，画布上折几行
   *    是宽度与字号算出来的结果。一个不带「超了怎么办」（缩字号？截断？改切分？）的
   *    上限在这套模型里什么都做不了——空控件比缺控件更贵。
   *  - **自动表情**。它是一条独立的产品能力（要 AI 挑、要有表情资源、要说清挑不到
   *    时怎么办），塞在样式属性页里既不完整也不属于这一层，先砍掉。
   *
   *  第 102 轮**把这一页重新核对了一遍**，结论：
   *  - 行数 1/2/3 与自动表情**维持删除**，理由同第 50 轮，一个字都没变；
   *  - 文字阴影**补上颜色**——`trackDefaults` 里 `shColor` 一直在，属性页却没有挂点，
   *    这是原型自己的缺口；
   *  - 强调词**补上「AI 自动挑词」**——§16.1 的默认值总表早就写着「强调词（开关 ·
   *    **AI 自动** · 字体 · 色 · B I · 字号）」，原型漏画了那一档。它与上面删掉的
   *    「自动表情」不是一回事：挑哪个词加重是**这份样式内部**的事，而自动表情要往
   *    画面上贴一个新对象。
   *  第 148 轮按用户要求撤下 AI 自动挑词，强调词改为手动；旧段键保留兼容，
   *  属性视图将动画卡提前到文字之后。 */
  function memberSections(track) {
    /* 倒鸭子（`kinetic`，2026-09-17）接管源语言轨整条的排版、颜色与镜头，canvas 不读涂装
       ——文字 / 描边 / 阴影 / 底板四段在它上面是空控件，让位给「倒鸭子」那一段；动画段
       留着（那一行印「倒鸭子 · 来自样式」并能换回逐词动效），强调词留着（它就是倒鸭子的
       强调词）。位置也不在：字幕区域由它自己的「字幕区域」三档决定。 */
    /* 字幕样式模型（caption-style-model-design §9，2026-10-09）：「字幕动画」一行拆成
       「当前词」（activeWord）与「动效」（motion）两段。当前词只长在有词级时间的轨上；
       动效（入场 / 退场 / 循环）是整条的事，译文轨也有，只是没有「念到时」那一档。
       倒鸭子接管时这两段都让位给它那一段（§9 末段），换回普通字幕走画廊。 */
    if (track && track.kinetic) return ['kinetic', 'highlight'];
    const list = ['text', 'outline', 'shadow', 'background'];
    if (hasWordTiming(track)) list.push('activeWord', 'motion', 'highlight');
    else if (track) list.push('motion');
    return list;
  }

  /** 段的顺序与门控。返回段键数组，视图按键渲染。

   *  组去掉之后**只有一种页**：这一条轨的样子 ＋ 它自己的行内对齐与位置。此前有
   *  三种（一条轨 / 多轨看组 / 多轨看某一条），三种各缺一点东西——多轨时点进一条轨
   *  拿不到锚点，得先切回「整组」；那句「先切回整组再改」的指路本身就是这个形状不
   *  对的证据。
   *  译文轨多一行比例链 hint：它是「这一条相对原文行多大」，只有并排时才有意义。 */
  /** 段的门控**只看轨**，不看作用域（第 102.1 轮，用户裁决）。

   *  第 102 轮首版在「仅这一条」那一档砍掉了逐词动效与强调词两段，理由是「动效是整条
   *  轨的时间通道配方」。用户点破：那是**属性缺失**——同一张属性页，切一下作用域少掉
   *  两张卡，人第一反应是「坏了」，而不是「这一档不支持」。而且那条理由站不住：整张
   *  cue 覆盖表在核心里都还没有挂点（台账第 103 条），单独把动效摘出来说「它没有挂点」，
   *  是拿同一条缺口只判其中一件。「没改过的字段仍然跟随主样式」说的也是**全部字段**。
   *
   *  所以现在两个作用域是**同一页**，只是落笔的目标不同——这也正是作用域这个词的意思。 */
  function sections(st, scope) {
    const t = byId(st, writable(st, scope));
    if (!t) return ['saveFoot'];
    const list = memberSections(t);
    if (tracks(st).length > 1 && t.role !== 'source' && source(st)) {
      list.splice(1, 0, 'ratioNote');
    }
    // 画面上叠着原文与译文两行时，每一条轨的页上都有「双语」那一段（上下次序，第 152 轮）
    const bi = stackOrder(st) ? ['bilingual'] : [];
    return list.concat(t.kinetic ? [] : ['position']).concat(bi).concat(['display', 'saveFoot']);
  }

  /* ---------- cue 级样式覆盖（第 102 轮）----------
     把一条 cue 从主样式上「脱离」出来单独改：这一条 cue 的个体样式覆盖对象在
     `null`（跟随）与 `{}`（脱离、但暂时一项都没改）之间切，没改过的字段仍然跟随主样式。

     所以它就是一张**稀疏覆盖表**：改过的字段写在这一条上，没改的仍然读主样式。
     这个形状与 BaoCut 已有的两处完全同构（transcript 的编辑意图写稀疏覆盖表；字幕
     样式文档是「根节点 ＋ partial 覆盖」）。

     入口不做成一颗链条钮，理由写在 §16.3；这里只留落法的三条硬规矩：

     1. **作用域是显式的一档**（`全部字幕 / 仅这一条`），不是一个隐形模态。只点一下
        「脱离」的话画面上什么都不会变（落的是 `{}`），用户看不到自己进了另一个作用域。
     2. **覆盖表逐段可见、逐段可退**（`overriddenKeys` / `clearSection`），不是只有一颗
        按钮把整条覆盖一次性丢光——链条图标并不承诺「重置」。
     3. **这一条轨上能改的，逐条也都能改**（`CUE_KEYS` ＝ 属性页那几段的全部字段）。
        第 102 轮首版把逐词动效与强调词排除在外，第 102.1 轮按用户裁决收回——见
        `sections()` 上面那段：同一张页少掉两张卡读起来是「坏了」，不是「不支持」，
        而且那条理由（「核心没有 per-cue 挂点」）对整张覆盖表同样成立，单摘两件出来
        说它，是拿同一条缺口只判其中一件。「没改过的字段仍然跟随主样式」说的也是全部字段。 */
  const CUE_KEYS = [
    'font', 'size', 'color', 'bold', 'italic', 'align', 'upper', 'lh', 'spacing',
    'outline', 'outlineW', 'outlineColor',
    'shadow', 'shDist', 'shBlur', 'shAngle', 'shColor',
    'plate', 'bg', 'opacity', 'corners',
    // 词级那三件 ＋ 强调词（第 102.1 轮）。`caption` 也在里面：动画页选任意一格都会
    // 顺手把配方撤掉，那一笔要能落在覆盖表上，否则在这一档里选动效等于没选。
    'wordAnim', 'caption', 'activeColor', 'highlight', 'textMotion', 'wordBackground', 'nativeStyle',
    // 新正文的两个维度（caption-style-model-design §3.4 / §3.5），上面那几件由它们派生
    'activeWord', 'motion',
    'y', 'valign', 'x', 'width',
  ];
  /** 段 → 它管着哪几个键。`clearSection` 与段头上那个计数读同一份，所以「这一段有
   *  几项自己的设定」与「点一下退回去」不可能对不上。合起来必须**恰好**是 `CUE_KEYS`
   *  （有测试钉着）——漏一个键，那个键就改得了却退不回去。 */
  const SECTION_KEYS = {
    text: ['font', 'size', 'color', 'bold', 'italic', 'align', 'upper', 'lh', 'spacing'],
    outline: ['outline', 'outlineW', 'outlineColor'],
    shadow: ['shadow', 'shDist', 'shBlur', 'shAngle', 'shColor'],
    background: ['plate', 'bg', 'opacity', 'corners'],
    /* 「字幕动画」一段拆成两段（caption-style-model-design §11）：当前词管念到的词长什么样，
       动效管整条怎么进出。派生键各归其源：`activeColor` / `wordBackground` 跟当前词走，
       目录格 `wordAnim`、配方 `caption`、Studio 的 `textMotion` / `nativeStyle` 跟动效走。 */
    activeWord: ['activeWord', 'activeColor', 'wordBackground'],
    motion: ['motion', 'wordAnim', 'caption', 'textMotion', 'nativeStyle'],
    highlight: ['highlight'],
    position: ['y', 'valign', 'x', 'width'],
  };

  function cueStyles(st) { return (st && st.cueStyles) || {}; }
  /** 这一条 cue 在这条轨上的覆盖表。**没有脱离时返回 null**——`null` 与 `{}` 是两个
   *  状态（跟随 / 脱离但还没改）。 */
  function cueOverride(st, cueId, trackId) {
    const per = cueStyles(st)[cueId];
    return (per && per[trackId]) || null;
  }
  function isDetached(st, cueId, trackId) { return !!cueOverride(st, cueId, trackId); }
  /** 这一条改过哪几项（顺序照 `CUE_KEYS`，所以两次读同一张表次序一样）。 */
  function overriddenKeys(st, cueId, trackId) {
    const o = cueOverride(st, cueId, trackId);
    return o ? CUE_KEYS.filter((k) => k in o) : [];
  }
  /** 某一段改过几项。段头上那个计数与「恢复跟随」读的是同一个数。 */
  function sectionOverrides(st, cueId, trackId, sec) {
    const o = cueOverride(st, cueId, trackId);
    if (!o) return [];
    return (SECTION_KEYS[sec] || []).filter((k) => k in o);
  }

  /** 写一笔逐条覆盖。**白名单外的键直接丢**——逐词动效与强调词恒是整条轨的，
   *  让它们从这条路溜进覆盖表，画面上会出现一条渲染端永远不读的数据。
   *  返回新的 `cueStyles`（纯函数，不改入参）。 */
  function setCueStyle(st, cueId, trackId, patch) {
    const map = cueStyles(st);
    if (!cueId || !trackId) return map;
    const keep = {};
    Object.keys(patch || {}).forEach((k) => { if (CUE_KEYS.indexOf(k) >= 0) keep[k] = patch[k]; });
    const cur = cueOverride(st, cueId, trackId) || {};
    return Object.assign({}, map, {
      [cueId]: Object.assign({}, map[cueId], {[trackId]: Object.assign({}, cur, keep)}),
    });
  }
  /** 让这一条脱离（落一张空覆盖表）或回到跟随（整条抹掉）。 */
  function detachCue(st, cueId, trackId) {
    const map = cueStyles(st);
    if (!cueId || !trackId || isDetached(st, cueId, trackId)) return map;
    return Object.assign({}, map, {[cueId]: Object.assign({}, map[cueId], {[trackId]: {}})});
  }
  function clearCue(st, cueId, trackId) {
    const map = cueStyles(st);
    const per = map[cueId];
    if (!per || !(trackId in per)) return map;
    const nextPer = Object.assign({}, per);
    delete nextPer[trackId];
    const next = Object.assign({}, map);
    if (Object.keys(nextPer).length) next[cueId] = nextPer; else delete next[cueId];
    return next;
  }
  /** 把一段退回跟随。**段里一项都没改时是空操作**（返回原表），所以段头那颗钮在
   *  计数为 0 时按下去不会白生成一份新文档。 */
  function clearSection(st, cueId, trackId, sec) {
    const hit = sectionOverrides(st, cueId, trackId, sec);
    if (!hit.length) return cueStyles(st);
    const cur = cueOverride(st, cueId, trackId) || {};
    const next = Object.assign({}, cur);
    hit.forEach((k) => { delete next[k]; });
    const map = cueStyles(st);
    return Object.assign({}, map, {[cueId]: Object.assign({}, map[cueId], {[trackId]: next})});
  }
  /** 画面上这一刻是哪一条 cue。三处（画布、属性页、工具条）读同一个函数——「仅这一条」
   *  指的就是画布上此刻那一条，三处各判一遍迟早会指到两条不同的字幕上。 */
  function cueAt(cues, t) {
    const list = cues || [];
    return list.find((c) => t >= c.start && t < c.end) || list[0] || null;
  }
  /** 哪些 cue 脱离了（给 Edit 子页那张列表标记用）。 */
  function detachedCueIds(st) {
    const map = cueStyles(st);
    return Object.keys(map).filter((id) => Object.keys(map[id] || {}).length);
  }

  /* ---------- 样式画廊 ---------- */

  /** 样式的**形态**：这一份样式画的是几条轨、哪几条。
   *  它决定这份样式出现在哪个 Tab，与风格分类（动态/社交/…）是两个正交的轴。
   *  第 108 轮起形态**只做陈列**（画廊分区、样张画几行、落在哪几条轨上取哪一份涂装），
   *  不再投影成轨集——画面上有哪几条字幕由 timeline 说了算。 */
  const FORMS = ['orig', 'bi', 'trans'];

  /* 第 151 轮起画廊**不再按形态分区、也不再分 Tab 陈列**：字幕 Tab 与翻译 Tab 看到的是
     同一份画廊，一份涂装只有一张卡，缩略图画的是**用户画面上现有的那几条轨**
     （`screenRows`），套上去落在画面上的每一条轨（`applyTargets` 的 `screen` 形态）。
     此前的分区（字幕 Tab 只放 `orig`、翻译 Tab 放 `bi` ＋ `trans`）是第 44 轮「样式卡
     声明轨集」那套模型的陈列遗迹：第 108 轮卡不再补轨、不再拿轨之后，缩略图上画两行
     而画面上只有一行，就是在许诺一件套上去不会发生的事——用户由此推断「套翻译样式
     会多一条译文轨、套字幕样式会少一条」，试错的根源正在这里。`TAB_FORMS` / `forms` /
     `tabOf` / `FORM_CATS` 随之退役；`FORMS` 与 `applyTargets` 的三种旧形态留给品牌库
     里存过的卡与既有测试。 */

  /** 一张卡属于哪一份涂装：`v-` / `vb-` / `vt-` 三个前缀是第 74 轮按形态派生出的三胞胎
   *  （data.js 的目录仍按三形态生成，模型层在这里收拢），去掉前缀就是同一份。品牌库
   *  的卡没有前缀，原样返回。 */
  function family(id) { return String(id || '').replace(/^v[bt]?-/, ''); }

  /** 画廊陈列用的目录：每份涂装只留一张卡，形态一律 `screen`——套上去落在画面上的
   *  每一条轨。译文行的涂装取 `look2`，没有就与原文行同款（三胞胎里 `bi` 那张本来
   *  就是同款）。 */
  function screenCatalog(catalog) {
    const seen = {};
    const out = [];
    const all = new Set((catalog || []).map(p => family(p.id)));
    (catalog || []).forEach((p) => {
      const k = family(p.id);
      const representative = window.BC_SD ? window.BC_SD.representative(k) : k;
      if (representative !== k && all.has(representative)) return;
      if (seen[k]) return;
      seen[k] = true;
      out.push(Object.assign({}, p, {id: 'v-' + k, form: 'screen', look2: p.look2 || p.look}));
    });
    return out;
  }

  /** 一张卡的缩略图该画几行、每行什么涂装与语言：**照画面上现有的轨**，从上到下
   *  按锚线 `y` 排（`stackOrder` 同一判据），停用的轨（`hidden`）不在画面上、不画。
   *  行是 `[role, look, lang, trackId]`——前三项与 panel-substyle.jsx 的 `SubThumb` 同一形状，
   *  第四项给入口卡回查轨上现在的涂装。
   *  画面上一条轨都没有（或全停用）时退回单行样张，语言由调用方给（`fallbackLang`）。 */
  function screenRows(st, p, fallbackLang, scopeId) {
    const y = (t) => (t.y == null ? 86 : t.y);
    const rows = tracks(st).filter((t) => !t.hidden)
      .slice().sort((a, b) => y(a) - y(b))
      .map((t) => {
        const role = t.role === 'source' ? 'orig' : 'trans';
        /* 第 152 轮「套到」作用域：缩略图只重画作用域里那一行，其余行画轨上现在的涂装
           （`line` 读出来的就是涂装对象，`SubThumb` 认 look 对象与 look 键）。作用域内
           那一行落的是卡的主涂装 `look`——单独给一条轨换样子时，用户点的是这张卡本身，
           不是它给「第二行」配的那份。 */
        const look = !scopeId ? (role === 'orig' ? p.look : (p.look2 || p.look))
          : t.id === scopeId ? p.look : line(st, t.id);
        return [role, look, t.lang || t.id, t.id];
      });
    return rows.length ? rows : [['orig', p.look, fallbackLang || 'en', null]];
  }

  /** 一条轨身上勾的是哪张卡（第 152 轮起样式按轨记：`t.preset`）。没记过的轨读文档级
   *  `preset`——它是整份一起套时留下的那一份，第 152 轮之前的文档只有这一格。 */
  function presetOf(st, t) { return (t && t.preset) || (st && st.preset) || null; }

  /** 画面当下套的是哪一张卡（按涂装找，三胞胎任一 id 都算同一张）。**画面上的每一条轨
   *  都勾在同一族**才算「套的是它」；各轨勾在不同的卡上（第 152 轮「套到」单独给一条
   *  换过）返回 null，调用方用 `styleNames` 印「Ali · Kitty」那种混搭名。找不到（品牌库
   *  里删掉了、或从没套过）也返回 null。 */
  /*  `exact`（2026-10-09 字幕样式模型）：画廊不再按家族别名折叠，一份预设一张卡，所以
   *  画廊的勾按 id 的家族**原样**比——按别名比的话点 Hustle 会把经典也勾上。 */
  function currentCard(st, catalog, exact) {
    const vis = tracks(st).filter((t) => !t.hidden);
    const keys = vis.length ? vis.map((t) => family(presetOf(st, t))) : [family(st && st.preset)];
    const representative = key => !exact && window.BC_SD ? window.BC_SD.representative(key) : key;
    const k = representative(keys[0]);
    if (!k || keys.some((x) => representative(x) !== k)) return null;
    return (catalog || []).find((p) => representative(family(p.id)) === k) || null;
  }

  /** 入口卡上印的名字：每一条可见轨（按画面上的次序）勾的那张卡的名字，同名相邻合并；
   *  勾不到卡的轨印「自定义」。全部同一张时就是一个名字。`catalogs` 是按优先级给的
   *  几份目录（画廊 / 品牌库），先找到先算。 */
  function styleNames(st, catalogs) {
    const lists = (catalogs || []).filter(Boolean);
    const nameOf = (id) => {
      const k = family(id);
      for (const c of lists) {
        const p = k ? c.find((x) => family(x.id) === k) : null;
        if (p) return p.name;
      }
      return '自定义';
    };
    const y = (t) => (t.y == null ? 86 : t.y);
    const vis = tracks(st).filter((t) => !t.hidden).slice().sort((a, b) => y(a) - y(b));
    const names = vis.length ? vis.map((t) => nameOf(presetOf(st, t))) : [nameOf(st && st.preset)];
    return names.filter((n, i) => i === 0 || n !== names[i - 1]);
  }

  /** 一份样式套到哪几条轨上。**样式卡永不改轨集**（第 108 轮裁决：文档只和 timeline
   *  相关，timeline 上有哪几条字幕轨就显示哪几条）——卡只换涂装，落在**当下这一份**
   *  轨集上，不补轨也不拿轨。形态因此降为「这份样式画的是几行」的陈列元数据：
   *
   *    orig  落在源语言轨上（画面上没有源语言轨时，落在语言入口选中的那条）
   *    trans 落在语言入口当下选中的那条译文轨上（第 106 轮「样式卡语言中立」）
   *    bi    源语言 ＋ 那条译文一起落；**缺哪条就只给在场的那条上妆**
   *
   *  回退顺序是「本形态的天然角色 → 另一个角色 → 轨集第一条」，不是直接取
   *  `tracks[0]`：默认轨集的第一条是译文（`place` 把源语言排在末尾），直接取第一条
   *  会让一张「只显示原文」的卡涂到译文行上。 */
  function applyTargets(st, form, editId, scopeId) {
    const list = tracks(st);
    if (!list.length) return [];
    // 第 152 轮「套到」：作用域指到一条轨时只给它上妆，别的轨一根线都不动
    if (scopeId && byId(st, scopeId)) return [scopeId];
    // 第 151 轮：画廊卡一律落在画面上的每一条轨（停用的也上妆——它仍在 timeline 上）
    if (form === 'screen') return list.map((t) => t.id);
    const src = source(st);
    const cur = byId(st, editId);
    const tr = (cur && cur.role !== 'source' ? cur : translations(st)[0]) || null;
    if (form === 'bi') return [src, tr].filter(Boolean).map((t) => t.id);
    const want = form === 'trans' ? (tr || src) : (src || tr);
    return [(want || list[0]).id];
  }

  /** 把目录切成区（分类序 × 目录序），空区不返回。`formList` 是陈列过滤：画廊传
   *  `['screen']`（第 151 轮起只有这一档），品牌库与旧测试仍可按三种旧形态过滤。 */
  function gallery(catalog, cats, formList) {
    const want = Array.isArray(formList) ? formList : [formList];
    return cats
      .map((c) => ({
        cat: c,
        items: catalog.filter((p) => want.indexOf(p.form) >= 0 && p.cat === c.k),
      }))
      .filter((g) => g.items.length > 0);
  }

  /* ---------- 轨样式的取值 ---------- */

  /** 这一条轨画出来是什么样。**每条轨就是它自己那一份**——第 49 轮去掉「跟随源语言」
   *  之后这里没有回落逻辑了：一条轨的样子不再取决于另一条轨此刻是什么样。
   *  返回的是副本，改它不会写回文档。 */
  function line(st, id, cueId) {
    const t = byId(st, id);
    if (!t) return null;
    /* `cueId` 给的时候叠上这一条自己的覆盖：**没改过的字段仍然读轨上那一份**。 */
    const o = cueId ? cueOverride(st, cueId, id) : null;
    return Object.assign({}, t, o || null);
  }

  /** 双语压缩：根字号 × (20/34) = **原文**行有效字号；译文行 = 原文 × 比
   *  （§16.1：34 × (20/34) = 20，译文 32 = 20 × 1.6）。

   *  原型里根字号没有独立的键，所以从原文轨的字号**反推**着印。上一轮这里是
   *  `orig = src.size × 0.533`——那句话把原文行的有效字号说成了它实际字号的一半，
   *  印一个和画面对不上的数比不印更坏。 */
  /* ---------- 双语叠法：谁在上（第 74.1 轮） ---------- */

  /** 当下的叠法。判据是**画出来的位置**（锚线 `y` 小者在上），不是数组序——数组序
   *  只管 timeline 的行序。画面上凑不齐源语言 ＋ 译文两条时谈不上谁在上，返回 null。 */
  function stackOrder(st) {
    const src = source(st);
    const tr = translations(st)[0];
    if (!src || !tr) return null;
    const y = (t) => (t.y == null ? 86 : t.y);
    return y(tr) <= y(src) ? 'transTop' : 'srcTop';
  }

  /** 倒转叠法：交换源语言轨与第一条译文轨的**几何与主行字号**（`y` / `valign` /
   *  `size`）——在上那行永远是主行（字更大），倒转换的是「主行是哪门语言」，不是把
   *  大字挪到下面去。角色与词级那几件（`wordAnim` / `caption` / `activeColor` /
   *  `highlight`）不动：它们跟角色走，不跟位次走。叠了第三条时只动这两条。
   *  返回新数组；不足两条时原样返回。 */
  function flipStack(st) {
    const src = source(st);
    const tr = translations(st)[0];
    if (!src || !tr) return tracks(st);
    const geo = (t) => ({y: t.y, valign: t.valign, size: t.size});
    return tracks(st).map((t) => {
      if (t.id === src.id) return Object.assign({}, t, geo(tr));
      if (t.id === tr.id) return Object.assign({}, t, geo(src));
      return t;
    });
  }

  const BI_SCALE = 20 / 34;
  /** `cueId` 给的时候按**这一条 cue 的有效字号**算（第 102.1 轮）：字号能逐条覆盖，
   *  比例链却照轨上那份印的话，这一屏会印出一句与画面对不上的乘法。 */
  function ratio(st, id, cueId) {
    const src = source(st) || {};
    const srcLn = src.id ? line(st, src.id, cueId) || src : src;
    const t = line(st, id, cueId) || byId(st, id) || {};
    const orig = srcLn.size || 0;
    return {root: Math.round(orig / BI_SCALE), orig, trans: t.size || 0,
      k: orig ? +((t.size || 0) / orig).toFixed(2) : 0};
  }

  window.BC_SUB = {
    FORMS, BI_SCALE,
    tracks, byId, source, translations, hasWordTiming, label,
    place, addTrack, removeTrack, replaceTrack, putBackMode,
    writable, scopes, memberSections, sections,
    CUE_KEYS, SECTION_KEYS,
    cueStyles, cueOverride, isDetached, overriddenKeys, sectionOverrides,
    setCueStyle, detachCue, clearCue, clearSection, cueAt, detachedCueIds,
    family, screenCatalog, screenRows, presetOf, currentCard, styleNames, applyTargets, gallery,
    line, ratio, stackOrder, flipStack,
  };
})();
