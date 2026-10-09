/* 字幕属性页 —— 第 45 轮新增（§13.2 / §16），第 102 轮重排。

   画廊（panel-substyle.jsx）负责「换一个样子」，这里负责「改其中某一项」。
   两条进来的路：画廊卡片右下角的铅笔，以及**在画布上点一条字幕**。

   这一页只有一种形态：**当下这一条轨的样子**（第 47 轮去掉「整组」）。字体、字号、
   颜色、行数、底板、描边、阴影、位置都在这一页；源语言轨多两段（当前词、强调词；动效两条轨都有），
   译文轨少这两段、多一行比例链——因为词级时间戳只有源语言轨有。画面上叠着两行时
   多一段「双语」（上下次序，第 152 轮）。

   段的门控在 model-substyle.js（纯函数、有测试），这里只按段键渲染。
   开关型的段用 `.stcard`（关掉只剩标题行）——与文字面板的样式子页同一个部件：
   不生效的控件不留在屏幕上。

   第 102 轮的三件（起因是用户拿属性页与浮动条的截图来对照）：

   1. **「文字」段换成排版工具块**。此前是六条 `label + 控件` 的行（字体 / 字号 /
      颜色 / 排版 / 行高 / 字距），占满一屏还看不到第一张卡。压成两行无标签的
      工具条就够了，而**文字面板（`panel-text.jsx`）的 Edit text 早就是这个形状**
      ——同一件事（这一行怎么排）在两处长成两个样子，本身就是分叉。所以这里是让两处
      收敛到同一个已经在用的块上。
   2. **补两处缺口**：文字阴影的颜色（`trackDefaults.shColor` 一直在，属性页没有挂点）
      与强调词的「AI 自动挑词」（§16.1 的默认值总表早写着，原型漏画了）。
   3. **样式作用域「全部字幕 / 仅这一条」**——「脱离主样式」的语义，判断见 §16.3。

   逐词动效那一页第 102 轮搬去 `panel-subanim.jsx`（行数纪律）。
   第 148 轮覆盖旧版第 2 条中的 AI 入口：按用户要求移除，改为直接手动点词。
   排版标签、低频详情与动画入口顺序以当前渲染为准。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const S = window.BC_SUB;

  /* ---------- 属性页 ---------- */
  function SubProps({ctx, scope, setScope, onBack, onAnim, onGallery, remembered}) {
    const app = useApp();
    const [pop, setPop] = useState(null);
    const tg = (k) => setPop(pop === k ? null : k);
    const st = ctx.subStyle;
    const list = S.tracks(st);
    const many = list.length > 1;
    const w = S.writable(st, scope);            // 落笔写哪条轨——永远是一条
    const track = S.byId(st, w);
    /* 拿下 / 放回的共用入口（`subtrack.jsx`）。这一页只有「拿下」这一半——放回的入口
       在时间轴行头与语言入口上，所以软上限那一句确认（`ops.dialog`）这里不挂。 */
    const ops = window.useSubTrackOps(ctx, w);

    /* 「仅这一条」= 画布上此刻那一条 cue（`ctx.curCue`，三处读同一个纯函数）。
       播放头一走，这一档指的就是新的那一条：作用域跟着画面上选中的
       那条字幕走，不是钉在某一条上。 */
    const cue = ctx.curCue;
    const oneCue = ctx.subScope === 'cue' && !!cue && !!w;
    const cueId = oneCue ? cue.id : null;
    const ln = w ? S.line(st, w, cueId) : null;
    /* 落笔的分流就这一行：整条轨写 `tracks`，仅这一条写覆盖表。白名单在纯层
       （`BC_SUB.CUE_KEYS`），所以逐词动效那几个键从这条路溜不进覆盖表。 */
    const set = (patch, continuous) => {
      const numeric = Object.values(patch).some((v) => typeof v === 'number');
      const color = Object.keys(patch).some((k) => /color|^bg$/i.test(k));
      const tag = continuous || numeric || color ? 'subtitle:' + w + ':' + (cueId || 'all') + ':' + Object.keys(patch).join(',') : null;
      return oneCue ? ctx.setSubCue(cueId, w, patch, tag) : ctx.setSubTrack(w, patch, tag);
    };
    const cur = D.subtitle.catalog.find((p) => p.id === st.preset);
    const memoryKey = w + ':' + (cueId || 'all');
    const memory = remembered.current[memoryKey] || (remembered.current[memoryKey] = {});
    if (ln && ln.opacity > 0) memory.opacity = ln.opacity;

    /* 段头右侧那句作用域：说清这一笔落在哪里，比控件本身还重要。
       写的是**角色在前**（原文（中文）/ 译文（English））——这一屏上用户想的是「原文
       那条」还是「译文那条」，语言只是补充说明（见 `BC_SUB.label`）。
       「仅这一条」那一档在前面再加一节，因为它才是这时候最要紧的那半句。 */
    const trackAside = !many ? '整条字幕' : '仅' + S.label(track);
    /* 「仅这一条」那一档不再接「整条字幕」——单轨时那半句的意思是「这一笔落在整条
       字幕上」，与前半句正好相反，两句连在一起读不通。多轨时后半句仍要有：作用域
       在这一档是二维的（哪一条 cue × 哪一条轨）。 */
    const aside = oneCue ? (many ? '仅这一条 · ' + S.label(track) : '仅这一条') : trackAside;

    /** 把这一段交还给「全部字幕」。段里一项都没改时不出这颗钮——**它出现本身就是**
     *  「这一段有自定义」的信号，所以标签里不必再印一个数（第 102.2 轮）。
     *
     *  文案第 102.2 轮重写（用户读不懂：「这个全部跟随和跟随是啥意思？」）。原来写的是
     *  「跟随（1）」，两处都错：
     *    · **`跟随` 是状态不是动作**，长得像个徽标而不是按钮，而设计系统的文案规矩是
     *      「按钮上放动词」；
     *    · **括号里那个数恰恰是「没跟随」的项数**——标签与数字的意思是反的。
     *  现在名词统一成 `自定义`、
     *  动词统一成 `清除`、去处统一写 `全部字幕`，三处（卡头 / 作用域条 / 条子下拉）同一套词。 */
    const revert = (sec, label) => {
      if (!oneCue) return null;
      const hit = S.sectionOverrides(st, cueId, w, sec);
      if (!hit.length) return null;
      /* **不挂提示气泡**：这一层的 tooltip 是给纯图标钮用的（`white-space: nowrap`，
         照 `加粗` / `左对齐` 那种两三个字的长度做的），一句解释塞进去会横着冲出面板；
         而解释本来就该在上面那行状态里（「N 项自定义 · 其余跟随全部字幕」定义了这个词），
         按钮自己只要是个动词短语就够。 */
      return (
        <BCAction className="revert" onClick={() => {
          ctx.clearSubCue(cueId, w, sec);
          app.toast('已清除「' + label + '」的自定义 · 这一段跟着全部字幕走');
        }}><Ic n="undo" className="ic--14" />清除自定义</BCAction>
      );
    };

    const card = (k, label, on, onToggle, body, note) => (
      <div className="stcard" key={k}>
        <div className="hd">{label}<span className="spacer" />
          {note ? <span className="t-detail-xs" style={{marginRight: 8}}>{note}</span> : null}
          {revert(k, label)}
          <Switch ariaLabel={label} on={!!on} onChange={onToggle} />
        </div>
        {on ? <div className="bd">{body}</div> : null}
      </div>
    );

    /* ---------- 排版工具块（＝ 文字面板的 Edit text） ----------
       第一行 字体 · 字号 · 色；第二行 B I │ 三档对齐 │ 大小写 │ 行高与字距。
       字号从滑杆换成下拉，读的是**浮动条那一份档位表**（`BC_BAR.SIZES`）——同一个
       字号菜单在条子上与面板里各写一份，迟早出现「条子上有 56、面板里没有」。
       目录里的样式带着表外的字号（那 31 份预设不是按这套阶梯定的），所以表外的
       当前值单列一行置顶，不会因为进了这张菜单就被悄悄吸到最近的一档上。 */
    const typo = () => {
      const B = window.BC_BAR;
      const caseCur = D.subtitle.cases.find((c) => (c.k || '') === (ln.upper || ''))
        || D.subtitle.cases[0];
      return (
        <>
          <div className="txrow">
            <div className="subprops__font">
              <span className="subprops__label">字体</span>
              <Picker wide value={ln.font} open={pop === 'font'}
                onClick={() => tg('font')} />
              {pop === 'font' ? <FontPicker inline value={ln.font}
                onPick={(n) => { set({font: n}); setPop(null); }} /> : null}
            </div>
            <div className="subprops__size" style={{position: 'relative'}}>
              <span className="subprops__label">字号</span>
              <Picker value={ln.size + 'px'} open={pop === 'size'} onClick={() => tg('size')} />
              <Popover open={pop === 'size'} onClose={() => setPop(null)} align="right" dir="down" width={132}>
                {B.SIZES.indexOf(ln.size) < 0
                  ? <div className="mdi is-on"><span className="nm">{ln.size}px</span><Ic n="check" className="ic--14" /></div>
                  : null}
                {B.SIZES.map((sz) => (
                  <BCAction size="M" key={sz} className={cx('mdi', ln.size === sz && 'is-on')}
                    onClick={() => { set({size: sz}); setPop(null); }}>
                    <span className="nm">{sz}px</span>
                    {ln.size === sz ? <Ic n="check" className="ic--14" /> : null}
                  </BCAction>
                ))}
              </Popover>
            </div>
          </div>

          <div className="subprops__color"><PRow label="文字颜色">
            <ColorField value={ln.color} scope={aside} open={pop === 'color'} onToggle={() => tg('color')}
              onPick={(c, live) => { set({color: c}); if (!live) setPop(null); }} inline />
          </PRow></div>

          <div className="txrow" style={{marginTop: 8}}>
            {/* 只有 B / I（第 48 轮去掉了 U）：字幕加下划线是极少数情况，
                留一颗从不按的钮比缺一颗更贵。 */}
            <div className="seg">
              <BCAction className={cx('seg__b', ln.bold && 'is-on')} style={{fontWeight: 800}}
                title="加粗" aria-label="加粗" aria-pressed={!!ln.bold}
                onClick={() => set({bold: !ln.bold})}>B</BCAction>
              <BCAction className={cx('seg__b', ln.italic && 'is-on')} style={{fontStyle: 'italic'}}
                title="斜体" aria-label="斜体" aria-pressed={!!ln.italic}
                onClick={() => set({italic: !ln.italic})}>I</BCAction>
            </div>
            {/* 三档对齐读共用词表（第 89.2 轮）：此前这一处自己写了一份，
                「居中」与另两处的「中」并存；换成图标之后连这个问题也没有了。 */}
            <Segmented value={ln.align} onChange={(v) => set({align: v})}
              items={window.BC_EL.ALIGNS} />
            {/* 大小写四档第 102 轮收成一颗下拉。此前是四颗并排的
                图标钮——摊开在这一行里，B / I / 三档对齐 / 四档大小写一共九颗，
                一个三百来像素的面板排不下，而这四档里有三档是「偶尔用一次」。 */}
            <div style={{flex: 'none', position: 'relative'}}>
              <div className="seg">
                <BCAction className={cx('seg__b', pop === 'case' && 'is-on')} onClick={() => tg('case')}
                  title="大小写" style={{fontWeight: 700}}>{caseCur.demo}</BCAction>
              </div>
              <Popover open={pop === 'case'} onClose={() => setPop(null)} align="right" dir="down" width={168}>
                {D.subtitle.cases.map((c) => (
                  <BCAction size="M" key={c.k || 'none'} className={cx('mdi', (ln.upper || '') === c.k && 'is-on')}
                    onClick={() => { set({upper: c.k}); setPop(null); }}>
                    <span className="nm">{c.name}</span>
                    <span className="t-detail-xs" style={{marginRight: 6}}>{c.demo}</span>
                    {(ln.upper || '') === c.k ? <Ic n="check" className="ic--14" /> : null}
                  </BCAction>
                ))}
              </Popover>
            </div>
            {/* 行高与字距收进同一枚弹层（与文字面板、`···` 菜单同一处形态）。
                下限 -10：预设目录里最紧的一档是 `letterSpacing: -3.12`（Bulb / Vegas），
                换算过来是 -6，卡在 -5 上就调不回它原本的样子。 */}
            <div style={{position: 'relative', marginLeft: 'auto'}}>
              <div className="seg">
                <BCAction className={cx('seg__b', pop === 'sp' && 'is-on')} onClick={() => tg('sp')}
                  title="行高与字距">
                  <Ic n="line-height" className="ic--14" /><Ic n="chevdown" className="ic--14" />
                </BCAction>
              </div>
              <Popover open={pop === 'sp'} onClose={() => setPop(null)} align="right" dir="down"
                width={240} className="pop--pad">
                <ValueRow label="行高" value={ln.lh} min={90} max={200} unit="%"
                  onChange={(v) => set({lh: v})} />
                <ValueRow label="字距" value={ln.spacing} min={-10} max={30}
                  onChange={(v) => set({spacing: v})} />
              </Popover>
            </div>
          </div>
        </>
      );
    };

    const sec = (k, first) => {
      switch (k) {
        case 'text':
          return (
            <React.Fragment key={k}>
              <SecHead first={first} aside={aside} action={revert('text', '文字')}>文字</SecHead>
              <div className="sec">{typo()}</div>
            </React.Fragment>
          );
        case 'background': {
          /* 「底板」→「背景」（第 50 轮）。

             这一排是形状钮：**看得出来**比读三个词快，所以每一格画的就是它
             落在画面上的样子（两条各自贴一块 / 词与词之间断开 / 整条一块）。圆角
             **没收进形态**——目录里的样式用到 2/3/6/10/12/50 六个
             半径，一个「圆/方」开关装不下，圆角仍是滑杆。
             「逐行」靠 `box-decoration-break: clone` 给，不在 JS 里量文本。 */
          const pl = ln.plate || 'line';
          return card(k, '背景', ln.opacity > 0, (v) => set({opacity: v ? (memory.opacity || 55) : 0}), (
            <>
              <PRow label="形态">
                <div className="plates">
                  {D.subtitle.plates.map((x) => (
                    <Tip key={x.k} label={x.name + ' · ' + x.note}>
                      <BCAction className={cx('plate', pl === x.k && 'is-on')}
                        aria-label={x.name} aria-pressed={pl === x.k} onClick={() => set({plate: x.k})}>
                        <i className={'plate__f plate__f--' + x.k} />
                      </BCAction>
                    </Tip>
                  ))}
                </div>
              </PRow>
              <PRow label="颜色">
                <ColorField value={ln.bg} scope={aside} open={pop === 'bg'} onToggle={() => tg('bg')}
                  onPick={(c, live) => { set({bg: c}); if (!live) setPop(null); }} inline />
              </PRow>
              {/* 底色是不透明的，透明度在这一格——两者分开存，这颗滑杆才有东西可写 */}
              <ValueRow label="不透明度" value={ln.opacity} min={1} max={100} unit="%"
                onChange={(v) => set({opacity: v})} />
              {/* 圆角是**占字号的百分比**（第 62 轮，与预设数据的归一化口径一致）：px 圆角
                  不跟字号缩放，同一份样式在缩略图与画布上会是两个形状 */}
              <BCDisclosure className="subprops__details" title={<> 圆角 </>}>
                <ValueRow label="圆角" value={ln.corners} min={0} max={50} unit="%"
                  onChange={(v) => set({corners: v})} />
              </BCDisclosure>
            </>
          ));
        }
        case 'outline':
          return card(k, '文字描边', !!ln.outline, (v) => set({outline: v}), (
            <>
              <ValueRow label="粗细" value={ln.outlineW} min={0} max={40} onChange={(v) => set({outlineW: v})} />
              {/* 描边色第 89.3 轮换成与背景行同一颗 `ColorField`（用户裁决）：此前是五颗
                  快捷色方块，理由是「设计稿上描边只有这五颗」——但同一张卡里、上下相邻
                  的两行「颜色」长成两个控件，而且五颗之外的描边色在这里无路可走。 */}
              <PRow label="颜色">
                <ColorField value={ln.outlineColor} scope={aside} open={pop === 'outline'}
                  onToggle={() => tg('outline')}
                  onPick={(c, live) => { set({outlineColor: c}); if (!live) setPop(null); }} inline />
              </PRow>
            </>
          ));
        case 'shadow':
          /* 阴影色第 102 轮补上。`trackDefaults.shColor`（`rgba(0,0,0,0.85)`）一直在文档里，
             属性页却没有挂点——那是原型自己漏了一格。少这一格的代价是浅底视频上的字幕只能用黑影，
             而「白底上打一层白影当外发光」正是描边之外的另一种做法。 */
          return card(k, '文字阴影', !!ln.shadow, (v) => set({shadow: v}), (
            <>
              <ValueRow label="模糊" value={ln.shBlur} min={0} max={100} onChange={(v) => set({shBlur: v})} />
              <PRow label="颜色">
                <ColorField value={ln.shColor} scope={aside} open={pop === 'shadow'}
                  onToggle={() => tg('shadow')}
                  onPick={(c, live) => { set({shColor: c}); if (!live) setPop(null); }} inline />
              </PRow>
              <BCDisclosure className="subprops__details" title={<> 距离与角度 </>}>
                <ValueRow label="距离" value={ln.shDist} min={0} max={100} onChange={(v) => set({shDist: v})} />
                <ValueRow label="角度" value={ln.shAngle} min={0} max={360} unit="°" onChange={(v) => set({shAngle: v})} />
              </BCDisclosure>
            </>
          ));
        /* 「字幕动画」那一行（十九格里挑一格）2026-10-09 拆成两段（caption-style-model-design §9）：
           「当前词」（panel-subactive.jsx）与「动效」（panel-submotion.jsx）。动态排版的轨
           不出这两段——倒鸭子那一段取代它们（段的门控在 model-substyle.js）。 */
        case 'activeWord':
          return <window.SubActiveSection key={k} ln={ln} track={track} set={set} first={first} aside={aside}
            action={revert('activeWord', '当前词')} pop={pop} tg={tg} setPop={setPop} />;
        case 'motion':
          return <window.SubMotionSection key={k} ln={ln} track={track} set={set} first={first} aside={aside}
            action={revert('motion', '动效')} />;
        case 'kinetic':
          /* 倒鸭子那一段整段在 panel-daoyazi.jsx（行数纪律）。它写的是整条轨的 `kinetic`，
             不走这里的 `set`（cue 覆盖表的白名单里没有它，走了会被静默丢掉）。 */
          return <window.DaoyaziProps key={k} ctx={ctx} track={track} cue={cue} first={first} aside={trackAside} />;
        case 'highlight': {
          const h = ln.highlight || {on: false, color: ln.activeColor, scale: 100, bold: true};
          const seth = (patch) => set({highlight: Object.assign({}, h, patch)}, 'scale' in patch || 'color' in patch);
          return card(k, '强调词', !!h.on, (v) => seth({on: v}), (
            <>
              <p className="hint">点选当前字幕中要强调的词，再调整它的样子。强调会一直保留，不随朗读移动。</p>
              <div className="subprops__words" aria-label="选择强调词">
                {cue ? window.BC_WA.split(ctx.cueText ? ctx.cueText(cue.id) : cue.text).map((word, index) => (
                  <BCAction key={index} className={cx('subprops__word', window.BC_SI.isMarked(h, cue.id, word, index) && 'is-on')}
                    aria-pressed={window.BC_SI.isMarked(h, cue.id, word, index)}
                    onClick={() => seth({marks: window.BC_SI.toggleMark(h, cue.id, word, index)})}>{word}</BCAction>
                )) : <span className="hint">先将播放头移到一条字幕上。</span>}
              </div>
              <p className="hint">选词只作用于当前这一条；字体与颜色遵循上方应用范围。</p>
              {/* 强调词可以换一副字体：
                  「换个颜色」与「换副字体」是两种不同的强调，一份样式里可能只想要后者。
                  留空 = 跟这一条轨的正文同一副。 */}
              <PRow label="字体">
                <div style={{flex: 1, minWidth: 0}}>
                  <Picker wide value={h.font || ln.font + '（同正文）'} open={false} onClick={() => tg('hlfont')} />
                  {pop === 'hlfont' ? <FontPicker inline value={h.font || ln.font}
                    onPick={(n) => { seth({font: n === ln.font ? null : n}); setPop(null); }} /> : null}
                </div>
              </PRow>
              <PRow label="颜色">
                <ColorField value={h.color} scope="强调词" open={pop === 'hl'} onToggle={() => tg('hl')}
                  onPick={(c, live) => { seth({color: c}); if (!live) setPop(null); }} inline />
                <div className="row gap4" style={{marginLeft: 8}}>
                  <IconBtn icon="text" size="s" tip="加粗" on={h.bold} onClick={() => seth({bold: !h.bold})}>
                    <span style={{fontWeight: 800, fontSize: 12}}>B</span>
                  </IconBtn>
                  <IconBtn icon="text" size="s" tip="斜体" on={h.italic} onClick={() => seth({italic: !h.italic})}>
                    <span style={{fontStyle: 'italic', fontSize: 12}}>I</span>
                  </IconBtn>
                </div>
              </PRow>
              <ValueRow label="字号" value={h.scale} min={80} max={160} unit="%" onChange={(v) => seth({scale: v})} />
            </>
          ));
        }
        case 'position':
          /* 位置是**这一条轨自己的**（第 47 轮从组下放下来），键与量纲**照抄核心**
             （第 49 轮）：`y` 是锚线的帧高百分比 0–100，`valign` 是这一块的哪条边钉在
             锚线上。两件事在核心里是独立的——`y` 决定挂在哪儿，`valign` 决定折行往哪长；
             原型此前那一对（`anchor` ＋ 0–30 的 `offset`）把它们绑死了，量纲也对不上。
             画布上竖直拖字幕写的就是 `y`。 */
          return (
            <React.Fragment key={k}>
              <SecHead first={first} aside={aside} action={revert('position', '位置')}>位置</SecHead>
              <div className="sec">
                <PRow label="放在画面"><Segmented value={ln.y <= 20 ? 'top' : ln.y >= 80 ? 'bottom' : 'middle'}
                  items={[{k: 'top', label: '顶部'}, {k: 'middle', label: '居中'}, {k: 'bottom', label: '底部'}]}
                  onChange={(v) => set(v === 'top' ? {y: 10, valign: 'top'} : v === 'middle' ? {y: 50, valign: 'center'} : {y: 90, valign: 'bottom'})} /></PRow>
                <BCDisclosure className="subprops__details" title={<> 精确位置与换行方向 </>}>
                <ValueRow label="距顶部" value={ln.y} min={0} max={100} unit="%"
                  onChange={(v) => set({y: v})} />
                {/* 「锚线位置」= 锚线穿过这一块的哪条边。它不叫「垂直对齐」，因为对齐是
                    结果不是设定：钉住哪条边，折行往哪长就跟着定了（下面那句 hint）。 */}
                <PRow label="锚线位置">
                  <div style={{flex: 1}}>
                    {/* 三格摆的是 S2 的 `Align{Top,Middle,Bottom}` 原件（第 89.3 轮）：
                        两根竖条对着一条横线，一眼就是「哪条边钉在那条线上」，
                        比「顶 / 中 / 底」三个孤字讲得清楚。键序读 `BC_POSE.VALIGN_ITEMS`。 */}
                    <Segmented size="s" value={ln.valign} onChange={(v) => set({valign: v})}
                      items={window.BC_POSE.VALIGN_ITEMS} />
                  </div>
                </PRow>
                <div className="hint">
                  {ln.valign === 'top' ? '顶边钉在锚线上 → 折行向下长。'
                    : ln.valign === 'center' ? '中线钉在锚线上 → 折行向上下均分。'
                    : '底边钉在锚线上 → 折行向上长（字幕的常态）。'}
                </div>
                </BCDisclosure>
                <ValueRow label="水平位置" value={ln.x == null ? 50 : ln.x} min={0} max={100} unit="%" onChange={(x) => set({x})} />
                <ValueRow label="宽度" value={ln.width == null ? 80 : ln.width} min={30} max={100} unit="%" onChange={(width) => set({width})} />
              </div>
            </React.Fragment>
          );
        case 'ratioNote': {
          /* 比例链：这一条译文行相对原文行多大。它此前挂在「整组」那一档的接缝段上，
             组去掉之后它的正确位置就是**这一条译文轨自己的字号旁边**——它讲的本来
             就是「这一条相对原文行多大」。 */
          const r = S.ratio(st, w);
          const src = S.source(st);
          return (
            <div className="hint" key={k}>
              根字号 {r.root} × 双语压缩 {+S.BI_SCALE.toFixed(3)} ≈ {r.orig}（「{(src || {}).name}」的有效字号）；
              这一条 {r.trans} = 原文 × {r.k}。
            </div>
          );
        }
        case 'bilingual': {
          /* 两行之间的事（第 152 轮）：此前只在轨条上有一颗「倒转 ⇅」，属性页里没有对应的
             一段——用户在属性页找「译文在上还是在下」找不到，只能回主页。这里是它的正式位置，
             轨条那颗是快捷入口，两处写的是同一件事（`S.flipStack`）。字号比例不在这里：
             它是译文轨自己字号旁那一句比例链。 */
          const order = S.stackOrder(st);
          const flip = () => {
            const before = st;
            ctx.setSubStyle({tracks: S.flipStack(st)});
            app.toast('已倒转 · 现在' + (order === 'srcTop' ? '译文在上、原文在下' : '原文在上、译文在下'),
              'positive', {label: '撤销', undo: true, run: () => {
                ctx.restoreSubStyle(before); app.toast('已撤销倒转');
              }});
          };
          return (
            <div className="stcard" key={k}>
              <div className="hd">双语<span className="spacer" /></div>
              <div className="bd">
                <PRow label="上下">
                  <div style={{flex: 1}}>
                    <Segmented size="s" value={order} onChange={(v) => { if (v !== order) flip(); }}
                      items={[{k: 'srcTop', label: '原文在上'}, {k: 'transTop', label: '译文在上'}]} />
                  </div>
                </PRow>
                <ValueRow label="行间距" value={st.gap == null ? 6 : st.gap} min={0} max={40}
                  onChange={(gap) => ctx.setSubStyle(window.BC_SUB_PREFS.withGap(st, gap))} />
                <div className="hint">在上那行是主行，字更大；倒转换的是主行是哪门语言，各自的样式不动。</div>
              </div>
            </div>
          );
        }
        case 'display': {
          const timing = st.displayTiming || {leadIn: 0.5, tail: 1};
          return <React.Fragment key={k}>
            <SecHead aside="相对于句子的开始与结束">显示</SecHead>
            <div className="sec">
              <ValueRow label="提前" value={timing.leadIn} min={0} max={2} step={0.1} unit="秒"
                onChange={(leadIn) => ctx.setSubStyle({displayTiming: {...timing, leadIn}})} />
              <ValueRow label="延后" value={timing.tail} min={0} max={3} step={0.1} unit="秒"
                onChange={(tail) => ctx.setSubStyle({displayTiming: {...timing, tail}})} />
              <PRow label="标点"><Switch ariaLabel="逗号句号换成空格" on={st.punct !== false}
                onChange={(punct) => ctx.setSubStyle({punct})} /><span>逗号句号换成空格</span></PRow>
              <div className="hint">修改的选项会记住，下次新建字幕继续使用。</div>
            </div>
          </React.Fragment>;
        }
        case 'saveFoot':
          return (
            <div className="savebar" key={k}>
              <span className="savebar__s"><strong>{cur ? cur.name : '自定义'}</strong> · 已修改</span>
              <Btn variant="secondary" size="s" onClick={() => app.toast('已存到品牌库 · 跨视频可用', 'positive')}>
                存到品牌库
              </Btn>
            </div>
          );
        default:
          return null;
      }
    };

    const keys = S.sections(st, scope, cueId);
    const foot = keys.indexOf('saveFoot') >= 0;
    const body = keys.filter((x) => x !== 'saveFoot');

    /* 把这一条轨从画面上拿下来。**不是删数据**——那门语言的 cue 与词级时间戳仍在
       文稿里，时间轴行头与语言入口都能把它放回来。它此前住在「整组」那一档的轨列表里；
       组去掉之后落在这一条自己的属性页上——2026-09-24 页头规则（§13）起从页头的垃圾桶
       挪到页脚那颗红钮：属性页的页头只有返回与标题，移除类动作只在页脚。
       拒绝的判据与撤销走共用的那一份（`subtrack.jsx`，第 108 轮）：同一件事此前在
       这里与时间轴上各写一遍，撤销还只是句装饰话。 */
    const drop = () => {
      const fallback = ops.drop(w);
      if (fallback) setScope(fallback);
    };

    return (
      <>
        <window.PanelHead title="字幕属性" onBack={onBack} backTip="返回字幕" />
        <window.SubPreview ctx={ctx} scope={scope} />
        <div className="mact"><Btn variant="secondary" size="s" onClick={onGallery}>更换样式</Btn></div>
        {/* 几条轨就是几颗 chip。**没有「整组」那一档**（第 47 轮）：字幕各自选中、
            各自编辑，不需要「我现在改的是这一条还是那一栈」这道题。 */}
        {many ? (
          <div className="targets">
            {list.map((t) => (
              <Chip key={t.id} pill onClick={() => setScope(t.id)} on={w === t.id}>{S.label(t)}</Chip>
            ))}
          </div>
        ) : null}
        <window.SubScopeBar ctx={ctx} trackId={w} />
        <div className="pscroll bc-scroll subprops">
          {['text', 'ratioNote', 'outline', 'shadow', 'background', 'activeWord', 'motion', 'kinetic', 'highlight', 'position', 'bilingual', 'display'].filter((k) => body.includes(k)).map((k, i) => sec(k, i === 0))}
          <BCAction className="danger" onClick={drop}><Ic n="trash" className="ic--16" />从画面上拿下这条字幕</BCAction>
        </div>
        {foot ? sec('saveFoot') : null}
      </>
    );
  }

  /* ---------- 样式作用域：全部字幕 / 仅这一条 ----------
     「把这一条脱离主样式单独改」在 BaoCut 是这一条，不是一颗链条钮（§16.3 的判断）。
     三条要点都在这里：

       · **作用域是写出来的一档**，不是链/断链两个图标。用户脑子里的问题是「我这一笔
         改的是这一条还是全部」，那就把这句话摆在屏幕上。
       · **状态说得出口**。刚脱离时画面上什么都不会变（落的是一张空
         覆盖表），所以下面这条状态行把「这一条改过几项、其余仍跟随」印出来。
       · **退回是分级的**：整条一颗、每一段各一颗（段头那枚「跟随（N）」），
         不是一颗按钮一次性丢光全部覆盖。

     切轨与关闭属性页都不动这一档：它挂在编辑器上（`ctx.subScope`），与浮动条那颗
     chip 是同一个开关。 */
  function SubScopeBar({ctx, trackId}) {
    const app = useApp();
    const st = ctx.subStyle;
    const cue = ctx.curCue;
    const one = ctx.subScope === 'cue' && !!cue;
    const marks = one && cue && trackId ? S.overriddenKeys(st, cue.id, trackId) : [];
    const text = one ? (ctx.cueText ? ctx.cueText(cue.id) : cue.text) : '';
    return (
      <div className="subscope">
        {/* 「应用范围」这三个字第 102.1 轮补上（用户点名）。此前只有两颗段控件、没有
            主语——「全部字幕 / 仅这一条」自己说不出它管的是**这一笔改动落在哪里**，
            第一次见的人多半读成一个过滤器（只显示这一条？只播这一条？）。 */}
        <div className="subscope__r">
          <span className="subscope__k">应用范围</span>
          <Segmented size="s" value={one ? 'cue' : 'all'} onChange={(v) => ctx.setSubScope(v)}
            items={[{k: 'all', label: '全部字幕'}, {k: 'cue', label: '仅这一条'}]} />
        </div>
        {one && cue ? (
          <div className="subscope__s subprops__scope">
            <span className="subscope__t" title={text}>{window.BC_TL.truncate(text, 18)}</span>
            {marks.length ? (
              <>
                <span className="subscope__n">{marks.length} 项自定义 · 其余跟随全部字幕</span>
                <BCAction className="revert" onClick={() => {
                  ctx.clearSubCue(cue.id, trackId, null);
                  app.toast('已清除这一条的全部自定义 · 它现在完全跟着全部字幕走');
                }}><Ic n="undo" className="ic--14" />清除全部自定义</BCAction>
              </>
            ) : <span className="subscope__n">还没有自定义 · 下面改的只落在它身上</span>}
          </div>
        ) : null}
      </div>
    );
  }

  Object.assign(window, {SubProps, SubScopeBar});
})();
