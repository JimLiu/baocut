/* 译文校对的几张视图 —— §13.2 / 第 9.1、9.2、24、152 轮。
   第 27 轮从 Subtitle 里拆出来的翻译 Tab 在**第 152 轮退役**：字幕与翻译是同一个「字幕」
   Tab，列表跟着轨条选中的轨走——选中译文轨时，面板里装的就是这个文件导出的几张视图
   （`TransEditView` 双语对照 ＋ 它自己的统计条与 AI 入口、`TransRunView` 翻译中、
   `TransDoneView` 收据、`TransRunHead` 别的语言正在翻时的顶条）。装配在 panel-subtitle.jsx。
   这里仍只管**译文与原文怎么对上**——目标语、对齐块语义、过期刷新、逐句重译/重对齐、
   黏结诊断。单条字幕长什么样归样式栈（panel-substyle.jsx / panel-subprops.jsx）。

   第 153 轮：对照卡的**两侧都能单击进编辑**（同 panel-subtitle 的 cue 卡、文稿的段落：
   单击、光标落在点的那个字上、失焦提交、Esc 取消）。此前译文只能 hover 出一条「编辑译文」
   链接，点了还只是一句 toast——用户的原话是「不能直接编辑字幕」。改动落在 `Frag` 一处：
   四种卡的每个片段都经它渲染，所以「点一下就能改」不用在每张卡里各写一遍。`only='trans'`
   时只画译文一列（对照条的「只看译文」档）。

   第 154 轮：块卡**按块成对分行**——每个对齐块占一行、原文 / 译文左右并排、行间一道
   细线、行首序号。此前原文侧几块行内相接成一句、译文侧同样相接，再在卡底画一条译文侧
   刻度：读者能看出「这句拆了三块」，却看不出**哪一块对哪一块**（用户原话「双语对照的时候
   看不出句子内部的拆分对应关系」）。成对分行是结构上的对应，不是悬停联动、也不是连线图；
   卡底那条译文侧刻度随之退场（信息已经在行里）。Tab / ⇧Tab 在片段之间走（同一行先原文
   后译文，再下一句），`fx.next` 决定次序。

   四种块语义（依据 research/alignment-block-display-notes.md）：
     block     正常成对：块是**双侧划分**（1↔1、单调、不交叉），第 154 轮起按块成对
               分行（台账 184）；不做「点块两侧同亮」的悬停联动，也永远不要画成
               「原文 cue → 译文行」的连线图。
     many      多对一：一行译文的源词区间跨 2 条原文字幕 → 原文侧渲染成子行
               （渲染期投影，不落盘）。这是合法紧凑形态，不报错。
     deficit   行数亏空：一行译文覆盖 3 条原文、停留 6.4s，超出舒适阅读时长 → 可重对齐。
     sentence  整句对应：语序交叉不拆分，原文逐词高亮、译文整句显示。 */
(function () {
  const {useState, useEffect, useMemo, useRef} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const F = window.BC_FIND;
  const R = window.BC_TRUN;

  /* 重译的两条路要让人分得清（product-design §5.10）：模型 API 不经过对话、按用量计费；Agent 在会话里做、用订阅、写入前会问。
     模型取翻译工具记住的那只，原型固定写演示用的那只。 */
  const DIRECT_MODEL = 'claude-sonnet';
  const AGENT_SUB = '在当前会话里做 · 用 Agent 订阅';
  const DIRECT_SUB = `直接调 ${DIRECT_MODEL} · 按用量计费`;

  const spColor = (sp) => `oklch(0.5 0.14 ${D.speakers[sp].hue})`;
  const spName = (sp) => D.speakers[sp].name;

  /* ---------- 查找面：把一张对齐卡拆成可查找的最小文本片段 ----------

     四种卡的文本结构完全不同（块对 / 子行 / 逐词 / 整句），但查找不该知道这件事。
     所以先把每张卡摊平成 [{side, part, text}]，之后计数、上一个/下一个、高亮、替换
     全在这张平表上跑——这也是「替换范围」能同时管原文和译文的前提：
     side 就是范围开关的那两个值。

     一条限制照实说：整句对应卡的原文是**逐词存的**，所以跨词的查询（「前面改了」）
     在它身上查不到——那不是查找的 bug，是这张卡的原文没有连续文本可查。 */
  const fragKey = (id, side, part) => id + ':' + side + ':' + part;

  function cardFragments(c) {
    const out = [];
    const push = (side, part, text) => { if (text) out.push({side, part, text}); };
    if (c.kind === 'block') {
      c.blocks.forEach((b, i) => push('orig', 'b' + i, b.o));
      c.blocks.forEach((b, i) => push('trans', 'b' + i, b.t));
    } else if (c.kind === 'many' || c.kind === 'deficit') {
      c.subs.forEach((x, i) => push('orig', 's' + i, x));
      push('trans', 't', c.trans);
    } else if (c.kind === 'sentence') {
      c.words.forEach((w, i) => push('orig', 'w' + i, w));
      push('trans', 't', c.trans);
    } else {
      push('orig', 'o', c.orig);
      push('trans', 't', c.trans);
    }
    push('trans', 'rw', c.rewritten); // 换成块卡/多对一卡后，自然译句仍可查找且只读。
    return out;
  }

  /* 一个片段的渲染：覆盖表取文本 + 查找高亮 + **单击进编辑**（第 153 轮）。四种卡共用它，
     所以「替换之后画面上就是新文本」「点一下就能改」都不需要在每张卡里各写一遍。
     `edit={false}` 的片段只读——整句对应卡的原文是逐词存的，没有连续文本可改；
     `fx.commit` 不在（运行态那类只读列表）时同样只读。 */
  function Frag({fx, id, side, part, text, className, placeholder, edit = true}) {
    const k = fragKey(id, side, part);
    const v = fx.get(k, text);
    if (!edit || !fx.commit) return <Hl text={v} ms={fx.ms.get(k)} cur={fx.cur} />;
    return (
      <EditableText className={className} value={v} placeholder={placeholder}
        editing={fx.editing === k} ms={fx.ms.get(k)} cur={fx.cur}
        caretAt={fx.editing === k ? fx.caret : undefined}
        ops={fx.ops ? fx.ops(id, side, part) : undefined}
        onBegin={() => { if (fx.seekAt) fx.seekAt(id); fx.setEditing(k); }} onCancel={() => fx.setEditing(null)}
        onCommit={(nv) => fx.commit(k, side, nv)}
        onHistory={fx.onHistory}
        onNext={fx.next ? (d) => fx.next(k, d) : undefined} />
    );
  }
  const fragText = (fx, id, side, part, text) => fx.get(fragKey(id, side, part), text);

  function useNaturalReference(c, fx) {
    const [open, setOpen] = useState(false);
    return {
      chip: c.rewritten ? <BCAction className="stlink" style={{fontSize: 11}} aria-expanded={!!(open || (fx.cur && fx.cur.card === c.id && fx.cur.part === 'rw'))}
        onClick={e => {e.stopPropagation(); setOpen(v => !v);}}>字幕版已改写</BCAction> : null,
      content: c.rewritten && (open || (fx.cur && fx.cur.card === c.id && fx.cur.part === 'rw')) ?
        <div className="rwcard"><b>自然译文</b><span><Frag fx={fx} id={c.id} side="trans" part="rw" text={c.rewritten} edit={false} /></span>
          <em>仅供参考，请编辑上方字幕版。修改字幕不会改动自然译句。</em></div> : null,
    };
  }

  /* 接缝上的「并入上一句」（第 155 轮）：骑在卡的上边线上、悬停才出、不占布局——与 cue 列表
     的「并入上一条」同一枚，也与 App 翻译列表非编辑态的 `merge_sentence_up` pill 同位。
     只在能并（上一句同说话人、两张都是成对 / 块卡）时挂。 */
  function Seam({seam}) {
    if (!seam) return null;
    return (
      <BCAction className="sbseam" onClick={(e) => { e.stopPropagation(); seam.run(); }}>
        <Ic n="chevup" className="ic--14" />{seam.label}
      </BCAction>
    );
  }

  /* 卡头右端的 ⋯（第 159 轮，台账 115 改制）：单句 AI 动作从一排悬停出现的文字链收成一颗
     图标钮 + 菜单。文字链那排盖在卡头上，鼠标一靠近就把播放三角挡住、窄栏里还被截断；
     一颗 20px 的钮悬停才显、常占布局位，怎么都挡不到播放三角。菜单项与 apps/baocut 的
     `card_menu_model` 同序：重译 / 重新对齐 / 按源行拆分对齐 ／ 隐藏字幕 / 复制译文。 */
  function MoreBtn({items}) {
    const [open, setOpen] = useState(false);
    return (
      <span className={cx('sbmore', open && 'is-open')} onClick={(e) => e.stopPropagation()}>
        <IconBtn icon="more" size="xs" tip="这一句的更多操作" on={open} onClick={() => setOpen((v) => !v)} />
        <Popover open={open} onClose={() => setOpen(false)} align="right" width={248}>
          <Menu>
            {items.map((it, i) => (it === '-'
              ? <MenuRule key={i} />
              : <MenuItem key={i} icon={it.icon} label={it.label} sub={it.sub} disabled={it.off}
                  onClick={() => { setOpen(false); it.run(); }} />))}
          </Menu>
        </Popover>
      </span>
    );
  }

  /* 卡头播放三角 = seek 到该句起点（与字幕卡 panel-subtitle 的 onPick 同语义，
     第 104 轮裁决双端一致，台账 110）。stopPropagation：点卡本身也是跳到句首，不重复 seek。
     编辑态（第 159 轮）：cps 与 ⋯ 都让位——那格由 `.edbar`（拆 / 并三键）坐。 */
  function CardHead({c, chips, onSeek, more, editing}) {
    return (
      <div className="sbh">
        <span className="sbsp" style={{color: spColor(c.sp)}}>{spName(c.sp)}</span>
        <BCAction className="sbplay" onClick={(e) => { e.stopPropagation(); if (onSeek) onSeek(); }}>
          <Ic n="play" className="ic--14" />
        </BCAction>
        <span className="sbt">{c.time}</span>
        {chips}
        <window.TmChip c={c} />{/* 翻译记忆「沿用」（embedding-integration §2.6），subtitle-tm.jsx */}
        {c.cutStale ? <Chip tone="notice">原文被剪切</Chip> : null}
        {editing || !c.readingSpeed || c.readingSpeed.level === 'none' ? null : <span className={cx('cps', c.readingSpeed.level === 'warn' && 'is-warn', c.readingSpeed.level === 'bad' && 'is-hot')}>{c.readingSpeed.value} cps</span>}
        {more && !editing ? <MoreBtn items={more} /> : null}
      </div>
    );
  }
  // 卡正在编辑（任一片段）：卡头换成拆 / 并三键，卡挂 is-editing
  const editingIn = (fx, c) => !!fx.editing && fx.editing.indexOf(c.id + ':') === 0;

  /* ---- 正常成对：按块成对分行（第 154 轮，台账 184） ----
     一块一行、原文 / 译文左右并排、行间细线、行首序号——「第 2 块原文对第 2 块译文」
     是版面自己说出来的，不靠悬停联动，也不画连线。第 104 轮那条译文侧静态刻度
     （台账 114 的 W8 基线、App 的 `render_block_strip`）随之退场：它只说「拆了几块、
     各多宽」，分行之后这两件事都在行里了。 */
  function BlockCard({c, on, onPick, fx, onSeek, seam, more}) {
    const natural = useNaturalReference(c, fx);
    const n = c.blocks.length;
    const ed = editingIn(fx, c);
    return (
      <div className={cx('sb', on && 'is-on', ed && 'is-editing')} data-card={c.id} style={{borderLeftColor: spColor(c.sp)}} onClick={onPick}>
        <Seam seam={seam} />
        <CardHead c={c} onSeek={onSeek} more={more} editing={ed} chips={<>{c.stale ? <Chip tone="notice">已过期</Chip> : null}<Chip>拆成 {n} 行</Chip>{natural.chip}</>} />
        <div className="blkpairs">
          {c.blocks.map((b, i) => (
            <div key={i} className={cx('tg2 blkpair', fx.only && 'tg2--one')}>
              {fx.only ? null : (
                <div className="tgo">
                  <i className="blkn">{i + 1}</i>
                  <Frag className="blkw" fx={fx} id={c.id} side="orig" part={'b' + i} text={b.o} placeholder="（这一行没有原文）" />
                </div>
              )}
              <div className="tgt">
                {fx.only ? <i className="blkn">{i + 1}</i> : null}
                <Frag className="blkw" fx={fx} id={c.id} side="trans" part={'b' + i} text={b.t} placeholder="（这一行还没有译文 · 点这里填）" />
              </div>
            </div>
          ))}
        </div>
        {natural.content}
      </div>
    );
  }

  /* ---- 多对一 / 行数亏空：原文侧按字幕分成子行 ---- */
  function StackedCard({c, on, onPick, fx, onSeek, more}) {
    const natural = useNaturalReference(c, fx);
    const deficit = c.kind === 'deficit';
    const ed = editingIn(fx, c);
    return (
      <div className={cx('sb', on && 'is-on', ed && 'is-editing')} data-card={c.id} style={{borderLeftColor: spColor(c.sp)}} onClick={onPick}>
        <CardHead c={c} onSeek={onSeek} more={more} editing={ed} chips={
          <>
            {c.stale ? <Chip tone="notice">已过期</Chip> : null}
            <Chip>1 行译文 · {c.subs.length} 条原文</Chip>
            {deficit ? <Chip tone="notice">{c.subs.length} 条原文共用一行</Chip> : null}
            {natural.chip}
          </>
        } />
        <div className={cx('tg2', fx.only && 'tg2--one')}>
          {fx.only ? null : (
            <div className="tgo">
              {c.subs.map((x, i) => (
                <Frag key={i} className="mo1sub" fx={fx} id={c.id} side="orig" part={'s' + i} text={x} />
              ))}
            </div>
          )}
          <Frag className="tgt" fx={fx} id={c.id} side="trans" part="t" text={c.trans} />
        </div>
        {/* 亏空卡的「按源行重新对齐」（第 159 轮）不再单独画一条文字链——它就是 ⋯ 菜单里的
            「按源行拆分对齐」，亏空那枚 notice Chip 已经把「为什么要拆」说清了 */}
        <div className="blknote">{c.note}</div>
        {natural.content}
      </div>
    );
  }

  /* ---- 整句对应：语序交叉不拆分 ---- */
  function SentenceCard({c, on, onPick, fx, onSeek, more}) {
    const ed = editingIn(fx, c);
    return (
      <div className={cx('sb', on && 'is-on', ed && 'is-editing')} data-card={c.id} style={{borderLeftColor: spColor(c.sp)}} onClick={onPick}>
        <CardHead c={c} onSeek={onSeek} more={more} editing={ed} chips={<>{c.stale ? <Chip tone="notice">已过期</Chip> : null}<Chip>整句对应</Chip></>} />
        <div className={cx('tg2', fx.only && 'tg2--one')}>
          {fx.only ? null : (
            <div className="tgo" title="整句对应卡的原文按词存——要改原文，切到「只看原文」">
              {c.words.map((w, i) => (
                <span key={i} className={cx('wsw', i === c.cur && 'is-cur')}>
                  <Frag fx={fx} id={c.id} side="orig" part={'w' + i} text={w} edit={false} />
                </span>
              ))}
            </div>
          )}
          <Frag className="tgt" fx={fx} id={c.id} side="trans" part="t" text={c.trans} />
        </div>
        <div className="blknote">{c.note}</div>
      </div>
    );
  }

  /* ---- 普通成对（含过期 / 未翻译 / 字幕改写展开） ---- */
  function PlainCard({c, on, onPick, fx, onSeek, seam, more}) {
    const natural = useNaturalReference(c, fx);
    // 「未翻译」看的是覆盖表之后的文本：用户在占位上直接填了译文，橙色就该退
    const empty = !fragText(fx, c.id, 'trans', 't', c.trans);
    const ed = editingIn(fx, c);
    return (
      <div className={cx('sb', on && 'is-on', ed && 'is-editing')} data-card={c.id} style={{borderLeftColor: spColor(c.sp)}} onClick={onPick}>
        <Seam seam={seam} />
        <CardHead c={c} onSeek={onSeek} more={more} editing={ed} chips={
          <>
            {c.stale ? <Chip tone="notice">已过期</Chip> : null}
            {empty ? <Chip tone="notice">未翻译</Chip> : null}
            {natural.chip}
          </>
        } />
        {/* 单句 AI 动作（台账 115）第 159 轮收进卡头的 ⋯ 菜单（`MoreBtn`），这里不再画一排 */}
        <div className={cx('tg2', fx.only && 'tg2--one')}>
          {fx.only ? null : <Frag className="tgo" fx={fx} id={c.id} side="orig" part="o" text={c.orig} />}
          {/* 没译文的那一句：占位本身就是输入口，点进去直接填 */}
          <Frag className={cx('tgt', empty && 'is-empty')} fx={fx} id={c.id} side="trans" part="t"
            text={c.trans} placeholder="（还没有译文 · 点这里填）" />
        </div>
        {natural.content}
      </div>
    );
  }

  /* ---------- 翻译中：运行态头 ----------
     §13.2 W6 的形状（`apps/baocut` 的 `lists/translate.rs::render_live`）：
     标题 + 百分比 + 进度条 + 行/调用两行计数 + 四段阶梯 + 模型活动行 + Cancel。
     发起方三档（第 207 轮，`BC_TRUN.sourceKind`）：App 自己开的只有活动行；命令行开的
     出「命令行正在跑」；Agent 会话开的出「Agent 会话正在跑 · 会话「…」」+ 打开会话
     （抽屉里那条会话就是它的过程记录，这里不再复述一份）。取消钮看 `canCancel`：
     命令行的任务不归这个进程管，只有记录明确接受叫停才给钮——摆一颗按不动的取消钮
     是假承诺。计数只在有总数时出（同 App v2 的 when 门控）。 */
  function TransRunHead({job, lang, slice, onCancel}) {
    const app = useApp();
    if (R.selfRun(job)) return <SelfRunHead job={job} lang={lang} />;
    const queued = job.status === 'queued';
    const cur = slice.stage;
    const c = R.counts(job.pct, D.translate.liveTotals, queued);
    const kind = R.sourceKind(job);
    const cli = kind === 'cli';
    const cancelable = R.canCancel(job);
    const model = (job.sub || '').split(' · ')[0] || 'claude';
    const act = R.activity(slice, model);
    const sessTitle = R.sessionTitle(job);
    return (
      <div className="livehd">
        <div className="livehd__t">
          <span className="livehd__dot" />
          <b className="grow">{queued ? '排队中' : '翻译中 · ' + D.srcLang.abbr + ' → ' + lang.name}</b>
          <span className="t-mono livehd__pct">{Math.round(job.pct)}%</span>
        </div>
        <div className="livebar"><i style={{width: job.pct + '%'}} /></div>
        {c.linesTotal && !queued ? (
          <div className="livehd__m">
            <span className="t-mono">{c.lines} / {c.linesTotal} 句</span>
            <span className="dot">·</span>
            <span className="t-mono">{c.calls} / {c.callsTotal} 次模型调用</span>
          </div>
        ) : null}
        <div className="ajstg">
          {R.TRANS_STAGES.map((st, i) => (
            <div key={st} className={cx('ajseg', i < cur && 'is-done', i === cur && !queued && 'is-cur')}>
              <i /><em>{st}</em>
            </div>
          ))}
        </div>
        {cli
          ? <div className="livehd__m"><span>命令行正在跑这条任务 · task {job.id}</span></div>
          : act ? <div className="ajact"><span className="k">MODEL ACTIVITY</span><span className="v">{act}</span></div> : null}
        {kind === 'agent' ? (
          <div className="livehd__m">
            <span className="t-truncate">Agent 会话正在跑这条任务{sessTitle ? ' · 会话「' + sessTitle + '」' : ''}</span>
            {job.session && window.BC_SURFACE.agent ? <BCAction className="stlink" onClick={() => app.openSession(job.session)}>打开会话</BCAction> : null}
          </div>
        ) : null}
        {cancelable ? (
          <div className="livehd__a">
            {window.BC_SURFACE.ai ? <Btn variant="secondary" size="s" onClick={onCancel}>取消翻译</Btn> : null}
            <span className="t-detail-xs grow">
              {queued ? '还没开始——现在取消不会留下任何痕迹。'
                : kind === 'agent' ? '取消会一并停下那条会话。译文会一句一句出现，全部落盘后才能编辑。'
                : '译文会一句一句出现，全部落盘后才能编辑。'}
            </span>
          </div>
        ) : null}
      </div>
    );
  }

  /* ---------- 智能体自己翻译的运行态头（product-design §5.7，`BC_TRUN.selfRun`） ----------
     没有四段阶梯：标题 + 进度条（第一批写进视频之前不确定）+ 已译 / 一共几句 + 指回会话。不给取消钮——
     译文是会话里那一轮在写，要停就到会话里停；这里摆一颗取消只会停掉记录、停不下智能体。 */
  function SelfRunHead({job, lang}) {
    const app = useApp();
    const sessTitle = R.sessionTitle(job);
    /* 第一批写进视频之前没有百分比：不确定的细条、写一共多少句；之后按已译句数画（product-design §5.7） */
    const pct = R.selfPct(job);
    const label = '翻译中 · ' + (lang ? lang.name : job.lang || job.target);
    const count = !job.linesTotal ? '' : pct != null ? '已译 ' + job.linesDone + ' / ' + job.linesTotal + ' 句 · ' : '共 ' + job.linesTotal + ' 句 · ';
    return (
      <div className="livehd">
        <div className="livehd__t">
          <span className="livehd__dot" />
          <b className="grow">{'翻译中 · ' + D.srcLang.abbr + ' → ' + (lang ? lang.name : job.lang || job.target)}</b>
          {pct != null ? <span className="t-mono livehd__pct">{pct}%</span> : null}
        </div>
        {pct != null
          ? <Progress value={pct} thin className="livehd__pg" label={label} />
          : <Progress indeterminate thin className="livehd__pg" label={label} />}
        <div className="livehd__m">
          <span>{count}智能体逐句翻译，分批写进视频</span>
        </div>
        <div className="livehd__m">
          <span className="t-truncate">Agent 会话正在翻译{sessTitle ? ' · 会话「' + sessTitle + '」' : ''}</span>
          {job.session && window.BC_SURFACE.agent ? <BCAction className="stlink" onClick={() => app.openSession(job.session)}>打开会话</BCAction> : null}
        </div>
      </div>
    );
  }

  /* ---------- 翻译中：正文按阶段换 ----------
     四段各有各的样子，理由逐条写在 model-trans-run.js 顶部。这里只负责画。 */
  const QUEUED_NOTE = <>排在别的任务后面——轮到它才开始读文稿。现在还没有任何模型在动。</>;
  const STAGE_NOTE = [
    <>正在读文稿并分句——这一步在数句子和查术语表，还没有译文可看。</>,
    <>整句翻译：一句原文对一句完整自然译文。<b>此时整句上屏，还没有块刻度</b>——那是合法中间态，不是对齐丢了。</>,
    <>拆分对齐：确定性代码把译句切成最小单调块，两侧刻度块数相同、恒平行不交叉。</>,
    <>正在写回 transcript.json——落盘之后这一门语言才会出现在字幕语言入口里。</>,
  ];

  function LiveRow({r, state}) {
    const blocks = state === 'aligned';
    const bar = (w, k) => <div className="blkbar" key={k}>{w.map((f, i) => <i key={i} className="blkseg is-on" style={{flex: f}} />)}</div>;
    return (
      <div className="sb sb--live" style={{borderLeftColor: spColor(r.sp)}}>
        <div className="sbh">
          <span className="sbsp" style={{color: spColor(r.sp)}}>{spName(r.sp)}</span>
          <span className="sbt">{r.time}</span>
          {state === 'translating' ? <Chip tone="notice">正在翻译…</Chip> : null}
          {state === 'aligning' ? <Chip tone="notice">正在拆分对齐…</Chip> : null}
        </div>
        <div className="tg2">
          <div className="tgo">{r.o}</div>
          {state === 'translating'
            ? <div className="tgt is-empty">正在翻译<i className="caret" /></div>
            : <div className="tgt">{r.t}</div>}
        </div>
        {/* 两条刻度**堆在整张卡下面**（同 BlockCard）——它们恒平行、块数相同，
            塞进两栏网格会让它们被当成两个格子各自换行 */}
        {blocks ? <div className="blkrow">{bar(r.ob, 'o')}{bar(r.tb, 't')}</div> : null}
      </div>
    );
  }

  function RunView({ctx, lang, slice}) {
    /* 智能体自己翻译：译文一批批写进来，没有句子可流，只说清楚在等什么 */
    if (R.selfRun(ctx.transJob)) return (
      <>
        <TransRunHead job={ctx.transJob} lang={lang} slice={slice} onCancel={ctx.cancelTrans} />
        <div className="pscroll bc-scroll">
          <div className="signpost">智能体在会话里逐句翻译，一批批写进视频——全部译完后这里才有译文可对照。原文列表照常可读可改。</div>
        </div>
      </>
    );
    return (
      <>
        <TransRunHead job={ctx.transJob} lang={lang} slice={slice} onCancel={ctx.cancelTrans} />
        <div className="pscroll bc-scroll">
          <div className="signpost">{slice.queued ? QUEUED_NOTE : STAGE_NOTE[slice.stage]}</div>
          {slice.rows.length
            ? (
              <>
                <div className="colhead"><span>原文 · {D.srcLang.name}</span><span>译文 · {lang.name}</span></div>
                {slice.rows.map((x) => <LiveRow key={x.i} r={x.row} state={x.state} />)}
              </>
            )
            : (
              <div className="liveskel">
                {[0, 1, 2].map((i) => (
                  <div className="liveskel__r" key={i}>
                    <span className="liveskel__h" /><span className="liveskel__l" /><span className="liveskel__l liveskel__l--s" />
                  </div>
                ))}
              </div>
            )}
        </div>
      </>
    );
  }

  /* ---------- 双语对照列表（`only='trans'` 时只画译文一列） ---------- */
  function EditView({ctx, target, cur, only}) {
    const app = useApp();
    const [refreshing, setRefreshing] = useState(false);
    const [staleMenu, setStaleMenu] = useState(false);
    const [editing, setEditingRaw] = useState(null);  // {k, caret}：正在编辑的片段 key、光标落在哪
    const setEditing = (k, caret) => setEditingRaw(k ? {k, caret} : null);
    /* 卡表与覆盖层一起由编辑器按语言保存，结构变化同一笔进入全局历史。 */
    const doc = ctx.translations[target] || {cards: D.translate.cards, overrides: {}};
    const cards = doc.cards;
    /* 第 196 轮：剪口播剪到句中的原文（§13.1）——译文卡按时间落进那条 cue 的区间就标「原文被剪切」，
       统计条给一个直达「刷新过期译文」的入口；处理不在这里做。 */
    const cutN = ctx.transImpact ? ctx.transImpact.stale.length : 0;
    const cutSpans = useMemo(() => {
      const ids = new Set((ctx.transImpact ? ctx.transImpact.stale : []).map((im) => im.id));
      return (ctx.cues || []).filter((q) => ids.has(q.id));
    }, [ctx.transImpact, ctx.cues]);
    const cutStaleAt = (t) => cutSpans.some((q) => t >= q.start - 0.05 && t < q.end);
    const putDoc = next => ctx.putTranslationDoc(target, next);
    useEffect(() => setEditingRaw(null), [ctx.history.revision, target]);
    const O = window.BC_CUEOPS;
    const [scope, setScope] = useState('both');     // both | orig | trans
    const [scopeOpen, setScopeOpen] = useState(false);

    /* 查找替换的范围是**两侧**：翻译面板的正文有原文和译文两列，
       只能改译文的替换在这里是半个功能——校对时最常见的一类改动
       （术语、人名、产品名统一）恰恰要两侧一起改，才不会让对齐块两边对不上。 */
    const edits = useTextEdits({value: doc.overrides, onChange: overrides => putDoc({...doc, overrides})});
    // key → 当前文本（覆盖优先），替换与块刻度都读它
    const base = new Map();
    cards.forEach((c) => cardFragments(c).forEach((f) => {
      const k = fragKey(c.id, f.side, f.part);
      base.set(k, edits.get(k, f.text));
    }));
    const displayedTranslation = (c) => c.kind === 'block'
      ? c.blocks.map((b, i) => base.get(fragKey(c.id, 'trans', 'b' + i)) ?? b.t).join('')
      : edits.get(fragKey(c.id, 'trans', 't'), c.trans || '');
    const S = {
      cues: ctx.cues.length,
      sentences: cards.length,
      untranslated: cards.filter(c => !displayedTranslation(c).trim()).length,
      deficits: cards.filter(c => c.kind === 'deficit').length,
      stale: cards.filter(c => c.stale).length,
    };
    const find = useFind({
      replaceOk: (m) => m.part !== 'rw',
      items: cards.flatMap((c) => cardFragments(c)
        .filter((f) => scope === 'both' || (scope === 'orig' ? f.side === 'orig' : f.side === 'trans'))
        .map((f) => ({
          key: fragKey(c.id, f.side, f.part),
          card: c.id, side: f.side, part: f.part,
          text: base.get(fragKey(c.id, f.side, f.part)),
        }))),
      onReplace: (list, rq) => {
        const patch = {}; let n = 0;
        F.byKey(list).forEach((ms, key) => {
          if (ms[0] && ms[0].part === 'rw') return;
          const r = F.replaceIn(base.get(key), ms, rq);
          if (r.changed) { patch[key] = r.text; n += r.changed; }
        });
        if (n) edits.put(patch);
        return n;
      },
      onJump: (m) => { const c = cards.find((x) => x.id === m.card); if (c) seekF(T.parse(c.time)); },
    });
    // 换范围 / 换目标语之后命中表整个换了一批，序号归零
    useEffect(() => { find.reset(); }, [scope, target]);

    /* 单击改写落在同一张覆盖表里（与查找替换同一份），所以替换过的句子点开就是替换后的
       文本，改写过的句子替换时也读得到。原文那一侧在真实产品里写的是 cue 表（词级时间
       自动重排，同 panel-subtitle 的单列改写）；译文那一侧改完块刻度按新长度重画。 */
    const commit = (k, side, v) => {
      setEditing(null);
      const nv = v.trim();
      if (nv === (base.get(k) || '')) return;
      const id = k.slice(0, k.indexOf(':'));
      // 手工改了译文就是审过这一句（product-design §5.10）：过期标记随这一笔一起去掉，撤销一次两样都回去
      if (side === 'trans' && cards.some((c) => c.id === id && c.stale)) {
        putDoc({cards: withStale([id], false), overrides: {...doc.overrides, [k]: nv}});
      } else edits.put({[k]: nv});
      app.toast(side === 'orig' ? '已改写原文 · 词级时间自动重排' : '已改写译文 · 块刻度已按新长度重算',
        'positive', {label: '撤销', undo: true, run: () => ctx.history.undo()});
    };
    /* Tab / ⇧Tab 的走格次序（第 154 轮）：同一行先原文后译文，再到下一句——校对时的
       视线就是这么走的。只看译文时只走译文；整句对应卡的原文按词存、不可改，跳过；
       「自然译文」那格要展开才看得见，不在次序里。 */
    const editOrder = (c) => {
      const o = (part) => (only ? null : [c.id, 'orig', part]);
      const t = (part) => [c.id, 'trans', part];
      if (c.kind === 'block') return c.blocks.flatMap((b, i) => [o('b' + i), t('b' + i)]);
      if (c.kind === 'many' || c.kind === 'deficit') return [...c.subs.map((x, i) => o('s' + i)), t('t')];
      if (c.kind === 'sentence') return [t('t')];
      return [o('o'), t('t')];
    };
    const order = cards.flatMap(editOrder).filter(Boolean).map((a) => fragKey(a[0], a[1], a[2]));
    const next = (k, d) => { const nk = order[order.indexOf(k) + d]; if (nk) setEditing(nk); };

    /* ---- 拆行 / 并行 / 并句（第 155 轮，model-cueops.js） ----
       行是块卡的单位（一个对齐块 = 原文 / 译文一对）；普通成对卡就是一行。
       Enter 把两侧同时拆在已有成对边界上；原子块没有内部边界时保留草稿并提示。
       行首 ⌫ 并入上一行；已经是第一行再按，跨过卡的边界并到**上一句**去（两句的
       行首尾相接，原文译文一起并——那就是「合并两个句子」）。⌦ 在行尾对称。
       结构一改，这张卡覆盖表里的 key 指的就不是原来那一格了：先把覆盖摊回卡里再动结构。 */
    const mat = (c) => {
      const keys = [];
      const g = (side, part, fb) => { const k = fragKey(c.id, side, part); keys.push(k); return edits.get(k, fb); };
      if (c.kind === 'block') {
        const blocks = c.blocks.map((b, i) => Object.assign({}, b, {o: g('orig', 'b' + i, b.o), t: g('trans', 'b' + i, b.t)}));
        return {card: Object.assign({}, c, {blocks}), keys};
      }
      if (c.kind === 'plain') {
        const card = Object.assign({}, c, {orig: g('orig', 'o', c.orig), trans: g('trans', 't', c.trans)});
        if (c.rewritten) card.rewritten = g('trans', 'rw', c.rewritten);
        return {card, keys};
      }
      if (c.kind === 'many' || c.kind === 'deficit') {
        return {card: Object.assign({}, c, {subs: c.subs.map((text, i) => g('orig', 's' + i, text)), trans: g('trans', 't', c.trans)}), keys};
      }
      return {card: c, keys};
    };
    const rowIdx = (c, part) => (/^[bs]\d+$/.test(part) ? +part.slice(1) : 0);
    const partOf = (card, row, side) => (card.kind === 'block' ? 'b' + row
      : side === 'orig' ? (card.kind === 'many' || card.kind === 'deficit' ? 's' + row : 'o') : 't');
    const apply = (nextCards, keys, msg, focus) => {
      const overrides = {...doc.overrides};
      keys.forEach(key => delete overrides[key]);
      putDoc({cards: nextCards, overrides});
      setEditingRaw(focus || null);
      app.toast(msg, 'positive', {label: '撤销', undo: true,
        run: () => ctx.history.undo()});
    };
    const splitRowAt = (c, part, side, text, at) => {
      const m = mat(c);
      const i = rowIdx(c, part);
      const sourceCue = side === 'orig' && O.sourceRows(m.card);
      const nc = sourceCue ? O.splitSourceRow(m.card, i, text, at) : O.splitRow(m.card, i, side, text, at);
      if (!nc) {
        app.toast(!O.cutText(text, at) ? '把光标放到要拆开的位置，再拆分' : '这里没有可拆的对齐边界 · 保留当前文字');
        return false;
      }
      apply(cards.map((x) => (x.id === c.id ? nc : x)), m.keys,
        sourceCue ? '已拆分原文字幕 · 译文保持完整' : '已按对齐边界拆成两行 · 原文与译文一起保留',
        {k: fragKey(c.id, side, partOf(nc, i + 1, side)), caret: 0});
    };
    const sentenceErr = (err, dir) => (err === 'speaker' ? '说话人不同 · 不能合并'
      : err === 'kind' ? '多对一 / 整句对应的卡不参与合并' : dir < 0 ? '已经是第一句' : '已经是最后一句');
    /* 并到相邻一行去；这一行已经在卡的边上就并到相邻那一句去。keep 为真时并完继续编辑、光标落在接缝上 */
    const mergeRowTo = (c, part, side, text, dir, keep) => {
      const m = mat(c);
      const i = rowIdx(c, part);
      const rows = O.rowsOf(m.card);
      const sourceCue = side === 'orig' && O.sourceRows(m.card);
      if (sourceCue && sourceCue[i + dir] != null) {
        const r = O.mergeSourceRows(m.card, i, text == null ? sourceCue[i] : text, dir);
        apply(cards.map(x => x.id === c.id ? r.card : x), m.keys, dir < 0 ? '已并入上一条原文字幕' : '已并入下一条原文字幕',
          keep ? {k: fragKey(c.id, side, partOf(r.card, r.row, side)), caret: r.caret} : null);
        return;
      }
      if (rows && rows[i + dir]) {
        const r = O.mergeRows(m.card, i, side, text, dir);
        apply(cards.map((x) => (x.id === c.id ? r.card : x)), m.keys,
          dir < 0 ? '已并入上一行' : '已并入下一行',
          keep ? {k: fragKey(c.id, side, partOf(r.card, r.row, side)), caret: side === 'orig' ? r.caret.o : r.caret.t} : null);
        return;
      }
      let me = m.card;
      if (text != null && rows) me = O.withRows(m.card, rows.map((r, n) => (n === i ? Object.assign({}, r, {[side === 'orig' ? 'o' : 't']: text}) : r)));
      const list = cards.map((x) => (x.id === c.id ? me : x));
      const j = list.findIndex((x) => x.id === c.id) + dir;
      const other = list[j] ? mat(list[j]) : null;
      if (other) list[j] = other.card;
      const r = O.mergeCards(list, c.id, dir);
      if (r.err) {
        app.toast(sentenceErr(r.err, dir));
        return false;
      }
      const nc = r.cards.find((x) => x.id === r.id);
      const row = dir < 0 ? r.row : i;
      const caret = dir < 0 ? 0 : (text != null ? text.length : (rows ? rows[i][side === 'orig' ? 'o' : 't'].length : 0));
      apply(r.cards, m.keys.concat(other ? other.keys : []),
        dir < 0 ? '已并入上一句 · 原文与译文一起并' : '已并入下一句 · 原文与译文一起并',
        keep ? {k: fragKey(nc.id, side, partOf(nc, row, side)), caret} : null);
    };
    const opsFor = (id, side, part) => {
      const c = cards.find((x) => x.id === id);
      if (!c || part === 'rw') return undefined;
      const rows = side === 'orig' ? O.sourceRows(c) || O.rowsOf(c) : O.rowsOf(c);
      if (!rows) return undefined;
      const i = rowIdx(c, part);
      const mergeOp = (dir) => {
        const inCard = rows[i + dir] != null;
        const probe = inCard ? null : O.mergeCards(cards, c.id, dir);
        const why = probe && probe.err ? sentenceErr(probe.err, dir) : null;
        const label = inCard ? (dir < 0 ? '并入上一行' : '并入下一行') : (dir < 0 ? '并入上一句' : '并入下一句');
        return {label, off: !!why, tip: why, why: () => app.toast(why),
          run: (text) => mergeRowTo(c, part, side, text, dir, true)};
      };
      return {
        split: {label: '拆分', run: (text, at) => splitRowAt(c, part, side, text, at)},
        up: mergeOp(-1),
        down: mergeOp(1),
      };
    };
    const seamFor = (c) => (O.canMergeCards(cards, c.id, -1)
      ? {label: '并入上一句', run: () => mergeRowTo(c, partOf(c, 0, 'orig'), 'orig', null, -1, false)} : null);
    /* 暂停时点正文跟播放头（第 159 轮）：翻译卡只存了这一句的显示时间码（起点），没有
       词级时间，所以只能跳到句首——App 拿源词的真实词时跳到点中的那个字。播放中不动
       播放头：正在放的时候点一下是想改字，不是想跳。 */
    const seekAt = (id) => {
      if (ctx.playing) return;
      const c = cards.find((x) => x.id === id);
      if (c) seekF(T.parse(c.time));
    };
    /* 播放高亮与跟随（product-design §5.7），同字幕列表（panel-subtitle.jsx）与 App 的
       translation-list：`is-on` 是播放头所在的那一句（按时间码 ＋ 时长算），暂停时停在那句、
       落在两句之间不亮；播放中它滚进视野、不居中。点卡 = 跳到句首并恢复跟随。 */
    const listRef = useRef(null);
    const nowCard = cards[window.BC_FOLLOW.activeAt(cards.map((c) => ({start: T.parse(c.time), end: T.parse(c.time) + c.duration})), ctx.playT)];
    const {resume, listProps} = window.usePlayFollow({listRef, playing: ctx.playing, hold: !!editing, place: 'nearest',
      locate: (list) => (nowCard ? list.querySelector(`[data-card="${nowCard.id}"]`) : null)});
    function seekF(t) { resume(); ctx.seek(t); }
    const fx = {get: (k, fb) => edits.get(k, fb), ms: find.byKey, cur: find.cur,
      editing: editing && editing.k, caret: editing && editing.caret, setEditing, commit, next, only, ops: opsFor, seekAt,
      onHistory: dir => dir < 0 ? ctx.history.undo() : ctx.history.redo()};
    /* ⋯ 菜单（台账 115 改制）：直接跑不弹窗（--sentences 定向本句，「按源行拆分对齐」额外带
       --align-density paired）。第 153 轮撤掉的「编辑译文」不回来：两侧文字本身就是编辑入口。 */
    const undo = {label: '撤销', undo: true, run: () => app.toast('已撤销')};
    const historyUndo = {label: '撤销', undo: true, run: () => ctx.history.undo()};
    /* 过期标记（product-design §5.10）：「过期」与「待翻译」是同一个标记（译文 status: stale），刷新与
       「交给 Agent」都会重译它；改原文由 Runtime 自动标，这里是手工标与手工清。进全局历史，撤销一次回去。 */
    const withStale = (ids, on) => cards.map((x) => (ids.includes(x.id) ? {...x, stale: on} : x));
    const markStale = (c, on) => {
      putDoc({...doc, cards: withStale([c.id], on)});
      app.toast(on ? '已标为过期 · 刷新过期译文时会重译这一句' : '已去掉过期标记', 'positive', historyUndo);
    };
    /* 直接重译：Runtime 的 translate 流程就地刷新这份译文（translationId + sentences），同一笔事务
       改从它生成的字幕层里这几句的字幕条、时间轴不动；撤销一次两边一起回去。 */
    /* opts.onUndo：撤销时一起还原的面板外状态（「改为重译」放回沿用标记，subtitle-tm.jsx） */
    const retranslate = (ids, msg, opts) => {
      const overrides = {...doc.overrides};
      // 没有译文的那几句填上演示译文（真实产品里是模型译的）
      cards.forEach((c) => { if (ids.includes(c.id) && c.fill && !displayedTranslation(c).trim()) overrides[fragKey(c.id, 'trans', 't')] = c.fill; });
      putDoc({cards: withStale(ids, false), overrides});
      app.toast(msg, 'positive', opts && opts.onUndo ? {...historyUndo, run: () => { ctx.history.undo(); opts.onUndo(); }} : historyUndo);
    };
    /* 交给 Agent（§5.10）：发到这部视频当前的会话（Home 左侧那条，或 Space 的悬浮会话）；没有就新开一条。
       不切走：译文面板留在原地，Agent 写完的译文按同样的规矩跟着改字幕。 */
    const toAgent = (intent) => {
      if (!app.harness) { app.toast('还没有可用的编码 Agent · 连接后就能把这件事交给它'); app.go({r: 'settings', sec: 'agent'}); return; }
      const r = app.route || {};
      const sid = (r.r === 'agent' && r.movie ? r.id : (app.movieChats || {})[ctx.proj.id]) || null;
      app.openAgent({project: ctx.proj.id, sid, send: true, stay: true, prompt: window.BC_AGENT.intentPrompt(intent, ctx.proj)});
      app.toast(sid ? '已发到当前会话' : '已交给 Agent · 新会话');
    };
    const scopeOf = (c) => `${c.time}「${(c.orig || (c.words || []).join('') || (c.blocks || []).map((b) => b.o).join('') || (c.subs || []).join('')).slice(0, 24)}」`;
    /* 前三条要调模型、「交给 Agent」要会话：Web 表面（model-surface.js）只留过期标记、隐藏与复制 */
    const moreFor = (c) => (window.BC_SURFACE.ai ? [
      ...window.BC_SEMTM.moreItems(c, app, retranslate), // 沿用的句子「改为重译」：去掉沿用并接着重译这一句（embedding-integration §2.6）
      {icon: 'sparkle', label: '用模型 API 重译这一句', sub: DIRECT_SUB, run: () => retranslate([c.id], '已重译这一句 · 字幕跟着更新 · 0.9s · claude-sonnet')},
      ...(window.BC_SURFACE.agent ? [{icon: 'agent', label: '交给 Agent 重译这一句', sub: AGENT_SUB,
        run: () => toAgent({kind: 'retranslate', lang: cur.name, scope: scopeOf(c)})}] : []),
      {icon: 'refresh', label: '重新对齐这一句', run: () => app.toast('已重新对齐 · 0.4s', 'positive')},
      {icon: 'split', label: '按源行拆分对齐', run: () => app.toast('已按源行拆分对齐 · 1.2s · claude-sonnet', 'positive', undo)},
      '-',
    ] : []).concat([
      c.stale
        ? {icon: 'check', label: '去掉过期标记', run: () => markStale(c, false)}
        : {icon: 'clock', label: '标为过期', run: () => markStale(c, true)},
      {icon: 'captions', label: '隐藏这一句的字幕', run: () => app.toast('已隐藏这一句的字幕 · 画面上不再出现', 'positive', undo)},
      {icon: 'copy', label: '复制译文', off: !fragText(fx, c.id, 'trans', 't', c.trans),
        run: () => app.toast('已复制译文')},
    ]);

    const SCOPES = [
      {k: 'both', label: '原文和译文', short: '两侧'},
      {k: 'orig', label: '只在原文里', short: '原文'},
      {k: 'trans', label: '只在译文里', short: '译文'},
    ];
    const scopeLabel = SCOPES.find((x) => x.k === scope).short;

    /* 批量重译的范围与 Runtime 不点名时一样：标了过期的与还没有译文的 */
    const todoIds = cards.filter((c) => c.stale || !displayedTranslation(c).trim()).map((c) => c.id);
    const refresh = () => {
      setRefreshing(true);
      setTimeout(() => {
        setRefreshing(false);
        retranslate(todoIds, `已重译 ${todoIds.length} 句 · 字幕跟着更新 · 2.1s · claude-sonnet`);
      }, 1400);
    };

    const card = (c) => {
      // 读当前展示译文（含查找替换和就地改写），不使用演示数据中冻结的 cps。
      // 自然译句是可展开的参考，不与上屏译文重复计数。
      const text = displayedTranslation(c);
      c = {...c, cutStale: cutStaleAt(T.parse(c.time)),
        readingSpeed: window.BC_SUBLIST.readingSpeed(text, c.duration, target)};
      const on = !!nowCard && nowCard.id === c.id;
      const pick = () => seekF(T.parse(c.time));
      // 与 panel-subtitle 的 `onPick={() => seek(c.start)}` 同形；翻译卡只存了
      // 显示时间码，起点从它解析（台账 110）
      const sk = () => seekF(T.parse(c.time));
      const more = moreFor(c);
      if (c.kind === 'block') return <BlockCard key={c.id} c={c} on={on} onPick={pick} fx={fx} onSeek={sk} seam={seamFor(c)} more={more} />;
      if (c.kind === 'many' || c.kind === 'deficit') return <StackedCard key={c.id} c={c} on={on} onPick={pick} fx={fx} onSeek={sk} more={more} />;
      if (c.kind === 'sentence') return <SentenceCard key={c.id} c={c} on={on} onPick={pick} fx={fx} onSeek={sk} more={more} />;
      return <PlainCard key={c.id} c={c} on={on} onPick={pick} fx={fx} onSeek={sk} seam={seamFor(c)} more={more} />;
    };

    return (
      <>
        <FindBar find={find} placeholder={`在${scopeLabel}里查找`} hint={find.cur && find.cur.part === 'rw' ? '自然译文仅供参考，请编辑上方字幕版。' : null}
          extra={
            <Picker size="s" value={scopeLabel} open={scopeOpen} popAlign="left" popWidth={216}
              onClose={() => setScopeOpen(false)} onClick={() => setScopeOpen((v) => !v)}>
              <Menu>
                <MenuHead>替换范围</MenuHead>
                {SCOPES.map((x) => (
                  <MenuItem key={x.k} label={x.label} on={scope === x.k}
                    onClick={() => { setScope(x.k); setScopeOpen(false); }} />
                ))}
              </Menu>
            </Picker>
          } />

        {/* 统计条一行放下（product-design §5.10）：左边只写句数与要处理的计数（全称在 tip 里），动作都是右边的图标钮。
            「重译」一组管过期与未翻译的句子（用模型 API / 交给 Agent），原文被剪切的「处理」也收在它的菜单里。 */}
        <div className="statbar statbar--one">
          <span className="statbar__counts">
            {refreshing
              ? <span className="warn">正在重译 {todoIds.length} 句…</span>
              : <>
                <span title={`${S.cues} cues · ${S.sentences} 句`}>{S.sentences} 句</span>
                {S.untranslated > 0 ? <span className="warn" title={`${S.untranslated} 句还没有译文`}>{S.untranslated} 未翻译</span> : null}
                {S.stale > 0 ? <span className="warn" title={`${S.stale} 句译文已过期${window.BC_SURFACE.ai ? '' : ' · ' + window.BC_SURFACE.aiElsewhere('重译')}`}>{S.stale} 过期</span> : null}
                {cutN > 0 ? <span className="warn" title={`${cutN} 句原文被剪切`}>{cutN} 被剪切</span> : null}
                {S.deficits > 0 ? <span className="warn" title={`${S.deficits} 处黏结：一行译文停留太久`}>{S.deficits} 黏结</span> : null}
                {/* 术语不一致（embedding-integration §2.6）：统一是一笔普通编辑，Web 也有 */}
                <window.TmConflicts cards={cards} textOf={(k, d) => edits.get(k, d)} onSeek={seekF}
                  onFix={(ov, n) => { putDoc({...doc, overrides: {...doc.overrides, ...ov}}); app.toast(`已统一 ${n} 处为术语表译法`, 'positive', historyUndo); }} />
                {todoIds.length + cutN + S.deficits === 0 ? <span className="ok">全部最新</span> : null}
              </>}
          </span>
          <IconBtn icon="search" size="s" tip="查找和替换 · ⌘F" on={find.open}
            onClick={() => (find.open ? find.close() : find.setOpen(true))} />
          {/* 一枚 AI 钮收下所有要调模型或会话的动作：上一组是重译（过期与未翻译的一起，直接调模型 = Runtime 就地刷新
              这份译文，或发到当前会话交给 Agent；原文被剪切的去工具页处理），下一组是整篇的翻译工具与交给 Agent */}
          {window.BC_SURFACE.ai ? <span className="statbar__menu">
            <IconBtn icon="sparkle" size="s" on={staleMenu}
              tip={refreshing ? `正在重译 ${todoIds.length} 句` : '重译与翻译'} onClick={() => setStaleMenu((v) => !v)} />
            <Popover open={staleMenu} onClose={() => setStaleMenu(false)} align="right" width={272}>
              <Menu>
                {todoIds.length > 0 ? <MenuItem icon="sparkle" label={`用模型 API 重译这 ${todoIds.length} 句`} sub={DIRECT_SUB}
                  disabled={refreshing} onClick={() => { setStaleMenu(false); refresh(); }} /> : null}
                {todoIds.length > 0 && window.BC_SURFACE.agent ? <MenuItem icon="agent" label={`交给 Agent 重译这 ${todoIds.length} 句`} sub={AGENT_SUB}
                  onClick={() => { setStaleMenu(false); toAgent({kind: 'stale', lang: cur.name, count: todoIds.length}); }} /> : null}
                {cutN > 0 ? <MenuItem icon="split" label={`处理原文被剪切的 ${cutN} 句`} sub="打开刷新过期译文"
                  onClick={() => { setStaleMenu(false); ctx.requestAi('stale', {k: 'cut', label: `原文被剪切的 ${cutN} 句`, count: cutN}); }} /> : null}
                {todoIds.length > 0 || cutN > 0 ? <MenuRule /> : null}
                <MenuItem icon="translate" label="翻译工具" sub="整篇翻译、换模型与术语表"
                  onClick={() => { setStaleMenu(false); ctx.requestAi('translate', null); }} />
                {/* 第 109 轮：翻译面板直通 Agent——带着「翻成当前这门语言」的草稿开左抽屉 */}
                {window.BC_SURFACE.agent ? <MenuItem icon="agent" label="让 Agent 翻译或校对"
                  sub={app.harness ? '新会话，草稿已写好' : '先连接编码 Agent'}
                  onClick={() => { setStaleMenu(false); app.harness
                    ? app.openAgent({project: ctx.proj.id, prompt: window.BC_AGENT.intentPrompt({kind: 'translate', lang: cur.name}, ctx.proj)})
                    : app.go({r: 'settings', sec: 'agent'}); }} /> : null}
              </Menu>
            </Popover>
          </span> : null}
        </div>

        <div className="pscroll bc-scroll" ref={listRef} {...listProps}>
          {only
            ? <div className="colhead colhead--one"><span>译文 · {cur.name}</span></div>
            : <div className="colhead"><span>原文 · {D.srcLang.name}</span><span>译文 · {cur.name}</span></div>}
          {cards.map(card)}
          <div className="signpost">
            {only ? '点一句译文就能改写，Tab 走到下一句。' : '原文和译文都能点进去直接改写，Tab 在两侧与上下句之间走。'}
            Enter 在光标处拆行，行首 ⌫ 并入上一行、第一行再按一次并入上一句。
            一句原文对上多句译文、或整句对整句，都是<b>正常的</b>，不是对齐出错；
            只有一条译文停留太久才值得重新对齐。
          </div>
        </div>
      </>
    );
  }

  /* ---------- 跑完：收据 + 这一门语言的正文 ----------
     §15.1 的第三态。**一次 AI run 收尾一定要留下可撤销的出口**——只弹一条
     会自己消失的 toast 不算数，用户回头找不到任何地方可以反悔。 */
  function DoneView({ctx, lang, rc}) {
    const done = !rc.undone;
    return (
      <>
        <div style={{padding: '0 12px'}}>
          <Receipt
            undone={rc.undone}
            text={rc.undone
              ? `已撤销 · ${lang.name} 译文已移除`
              : `已应用 · 翻译成${lang.name} ${D.translate.liveTotals.lines} 句 · 拆分对齐 68 块 · 31.4s · claude`}
            onUndo={ctx.undoTrans} onRedo={ctx.redoTrans} onAgain={ctx.rerunTrans} onDone={ctx.dismissTrans} />
        </div>
        <div className="pscroll bc-scroll">
          {done ? (
            <>
              <div className="colhead"><span>原文 · {D.srcLang.name}</span><span>译文 · {lang.name}</span></div>
              {D.translate.live.map((r, i) => <LiveRow key={i} r={r} state="aligned" />)}
              <div className="signpost">
                这一门语言已经落盘，字幕语言入口里可以切过去了。逐句核对与单句重译在这一屏继续。
              </div>
            </>
          ) : (
            <div className="emptytr">
              <Ic n="translate" className="ic--16" />
              <b>还没有 {lang.name} 译文</b>
              <span>刚才那一跑已经撤销，原文一个字没动。「再跑一次」会用同一套设置重来。</span>
            </div>
          )}
        </div>
      </>
    );
  }

  /* ---------- 翻译中：压缩版（第 207 轮） ----------
     只看原文的列表上方那一条：呼吸点 + 「翻译中 · 中 → 日本語」+ 百分比 + 细进度条 +
     「查看进度」。它**不换正文**——原文列表照旧可读可改，舞台与播放不受影响；
     这一跑压在哪门语言上、跑到哪儿了，看一眼就知道。点「查看进度」才切到那门语言的运行态。 */
  function TransRunStrip({job, lang, onOpen}) {
    const queued = job.status === 'queued';
    /* 智能体自己翻译在第一批写进视频之前没有百分比：不写数字，底边是来回走的不确定细条 */
    const self = R.selfRun(job);
    const pct = self ? R.selfPct(job) : job.pct;
    const indet = self && pct == null;
    return (
      <div className={cx('runstrip', queued && 'is-queued')} role="status">
        <span className="livehd__dot" />
        <span className="runstrip__t t-truncate">{R.stripText(job, D.srcLang.abbr, lang ? lang.name : job.target)}</span>
        {indet ? null : <span className="t-mono runstrip__pct">{Math.round(pct)}%</span>}
        <BCAction className="stlink" onClick={onOpen}>查看进度</BCAction>
        <div className={cx('runstrip__bar', indet && 'is-indeterminate')}><i style={indet ? undefined : {width: pct + '%'}} /></div>
      </div>
    );
  }

  Object.assign(window, {TransEditView: EditView, TransRunView: RunView, TransDoneView: DoneView, TransRunHead, TransRunStrip});
})();
