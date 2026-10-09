/* 右侧面板 —— §13。本轮 Transcript 做实（它是产品最核心的一屏，而前身原型里
   只有 4 个 handler），其余面板画骨架 + 统一的「本轮未做」标记。 */
(function () {
  const S = window.RSP;
  const {useState, useRef, useEffect, useMemo, useCallback} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const CH = window.BC_CH;
  const TX = window.BC_TX;
  const F = window.BC_FIND;
  const CUT = window.BC_CUT;
  const FOLLOW = window.BC_FOLLOW;
  /* AI 入口跟表面走（model-surface.js）：Web 表面上重跑 / 整理文稿 / 交给 Agent 都不出现 */
  const AI = window.BC_SURFACE.ai;

  /* 说话人色：与 apps/baocut `theme.rs::speaker_band/speaker_text`、core `build.rs`
     的 SPEAKER_HUES 同源——色带 oklch(0.62 0.14 h)、名字 oklch(0.5 0.14 h)。
     data.js 只存色相角，两个亮度档在这里折算，三表面因此不可能各调各的。 */
  const spBand = (sp) => `oklch(0.62 0.14 ${D.speakers[sp].hue})`;
  const spText = (sp) => `oklch(0.5 0.14 ${D.speakers[sp].hue})`;

  /* ---------- Transcript（§13.1） ---------- */

  /* 标签跟语言包走（第 73 轮）：哪门语言是「原文」由打开的项目决定，
     所以这张表按次现算，不能在模块顶上定死。

     本轮把「哪一门译文」从这张表里拆出来：语言档仍是三选一
     （原文 / 只看译文 / 双语对照），但项目翻过几门就列几门——下拉里
     一门语言一行，末行的「同时显示原文」把只看译文升成双语对照。
     只有 `done > 0` 的才上榜（没翻过的语言在这里选出来是一屏空）；
     源语言自己不算译文，`transLangs` 里那一条要剔掉。 */
  const TRANS_LANGS = () => (D.transLangs || [])
    .filter((l) => l.done > 0 && l.code !== D.srcLang.code);
  /* 选中的那门译文：记的是 code，一门都没有时为 null（下拉只剩原文一行）。 */
  const transLangOf = (code) => {
    const list = TRANS_LANGS();
    return list.find((l) => l.code === code) || list[0] || null;
  };
  /* 语言钮上写的那一句：原文写源语名、只看译文写那门语言、双语写两门。 */
  const langShort = (lang, tr) => (lang === 'src' ? D.srcLang.name
    : lang === 'trans' ? (tr ? tr.name : '译文')
    : D.srcLang.name + ' ＋ ' + (tr ? tr.name : '译文'));

  /* 范围菜单：一段 / 一章 都能单独重跑三个 flow。
     写成一个共用件，是因为「章」和「段」的动作表完全一样，只有范围标签不同；
     两处各写一遍迟早会漂成两张表。 */
  function ScopeMenu({ctx, scope, lang, paras, onClose}) {
    const app = useApp();
    /* 按复制设置 / 只复制文字（transcript-copy.jsx） */
    const copyItems = useScopeCopyItems({ctx, scope, lang, paras, onClose});
    const run = (tool, name) => {
      ctx.requestAi(tool, {kind: scope.kind, label: scope.label, count: paras.length});
      onClose();
      app.toast(`${name} · 范围已设为${scope.label}`);
    };
    return (
      <Menu>
        <MenuHead>复制{scope.label}</MenuHead>
        {copyItems}
        {AI ? <>
          <MenuRule />
          <MenuHead>只对{scope.label}重跑</MenuHead>
          <MenuItem icon="redo" label="重新转录" sub="换模型只重跑这一段音频" onClick={() => run('retranscribe', '重新转录')} />
          <MenuItem icon="sparkle" label="润色并重新分段" onClick={() => run('polish', '润色')} />
          <MenuItem icon="mic" label="识别说话人" onClick={() => run('speakers', '识别说话人')} />
        </> : null}
      </Menu>
    );
  }

  /* 段落行：说话人独立头行（名字 + 时间跳转 + 挪章节 + 段菜单）+ 正文。
     结构按 apps/baocut/src/adapters/transcript_list.rs（3px 说话人色带 + 头行 + 正文块），
     但**形态按原型走卡片**（见 §13.1 与 README 分歧台账 #9）：圆角卡 + 左缘 3px 说话人色
     + 条目间留 gap，与 Subtitle 的 cue 卡（`.sb`）是同一族——两个 Tab 装的是同一批话，
     一个画成密排表、一个画成卡片，切过去要重新认一遍版式。 */
  function ParaRow({p, on, done, editing, drag, ctx, lang, text, msSrc, msTr, cur, shades, cut, spans, words, onSeek, onEdit, onCommit, onNext, onDrag, onMove}) {
    const [menu, setMenu] = useState(false);
    const canUp = !!CH.movePlan(ctx.chapters, ctx.paras, p.id, -1);
    const canDown = !!CH.movePlan(ctx.chapters, ctx.paras, p.id, 1);
    const showSrc = lang !== 'trans';
    const showTr = lang !== 'src';
    return (
      <div data-para={p.id} className={cx('para', on && 'is-on', done && 'is-done', drag && 'is-drag')}
        style={{borderLeftColor: spBand(p.sp)}}
        onClick={() => onSeek(p.start)}>
        {/* 拖的是说话人头行，不是整段——正文要留给单击进编辑 */}
        <div className="para__h" draggable onDragStart={(e) => onDrag(p, e)} onDragEnd={() => onDrag(null)}>
          <span className="para__sp" style={{color: spText(p.sp)}}>{D.speakers[p.sp].name}</span>
          <BCAction className="para__t" onClick={(e) => { e.stopPropagation(); onSeek(p.start); }}>
            {T.timecode(p.start, {decimals: 0})}
          </BCAction>
          <span className="grow" />
          <BCAction className="para__act" title="移到上一章" disabled={!canUp}
            onClick={(e) => { e.stopPropagation(); onMove(p.id, -1); }}><Ic n="chevup" className="ic--14" /></BCAction>
          <BCAction className="para__act" title="移到下一章" disabled={!canDown}
            onClick={(e) => { e.stopPropagation(); onMove(p.id, 1); }}><Ic n="chevdown" className="ic--14" /></BCAction>
          <BCAction className="para__act" title="播放本段"
            onClick={(e) => { e.stopPropagation(); onSeek(p.start); ctx.setPlaying(true); }}>
            <Ic n="play" className="ic--14" />
          </BCAction>
          <span style={{position: 'relative'}}>
            <BCAction className={cx('para__act', menu && 'is-on')} title="这一段…"
              onClick={(e) => { e.stopPropagation(); setMenu((v) => !v); }}><Ic n="more" className="ic--14" /></BCAction>
            <Popover open={menu} onClose={() => setMenu(false)} align="right" dir="down" width={236}>
              <ScopeMenu ctx={ctx} lang={lang} paras={[p]} onClose={() => setMenu(false)}
                scope={{kind: 'para', label: '这一段'}} />
            </Popover>
          </span>
        </div>
        {/* 剪辑模式（第 192 轮）：正文换成 token 视图，划掉 / 虚线 / 停顿标都在里面；改字态才是就地编辑。
            改字态的 `text` 已是抠掉已剪词的投影（第 199 轮）——已剪的字只有剪辑态才看得见；
            整段都剪掉的段在改字态根本不出这张卡，由外面的剪缝（CutSeam）接手。 */}
        {showSrc && cut ? (
          <CutText p={p} text={text == null ? p.text : text} spans={spans} view={cut} words={words} />
        ) : showSrc ? (
          <EditableText className="para__b" value={text == null ? p.text : text} editing={editing}
            shades={shades}
            /* 播放跟随按词铺开（panel-transcript-follow.jsx）；有查找命中时查找优先，退回段级 */
            read={words && !(msSrc && msSrc.length) ? <FollowWords text={text == null ? p.text : text} words={words} shades={shades} /> : undefined}
            ms={msSrc} cur={cur} onNext={onNext}
            onBegin={() => onEdit(p.id)} onCommit={onCommit} onCancel={() => onEdit(null)} />
        ) : null}
        {/* 只在双语对照下译文才降一档；单独看译文时它就是正文。
            译文不在这里改——它归 Translate Tab（§13.3）：所以译文可以查、可以高亮，
            但替换按钮对译文命中是灰的，不给一个改了不算数的入口。 */}
        {showTr ? (
          <div className={cx('para__b', lang === 'both' && 'para__b--tr')}>
            <Hl text={p.trans} ms={msTr} cur={cur} />
          </div>
        ) : null}
      </div>
    );
  }

  /* 实时段落：只读。它还不是文档——没有 cue id 可指、不进撤销栈、也不该被改写；
     所以这里不复用 ParaRow（那一份带改写、挪章节与 ⋯ 菜单），另画一个瘦的。 */
  function LiveRow({p, text, tail, onSeek}) {
    /* 实时段落还没有说话人（说话人只在转录完成的结果里，product-design §5.7）：
       色带统一中性灰；名字位只在最后一段写「识别中」，其余只留时间码。 */
    return (
      <div className={cx('para para--live', tail && 'is-tail')}
        style={{borderLeftColor: 'var(--gray-300)'}}
        onClick={() => onSeek(p.start)}>
        <div className="para__h">
          {tail ? <span className="para__sp para__sp--unk">识别中</span> : null}
          <span className="para__t para__t--flat">{T.timecode(p.start, {decimals: 0})}</span>
        </div>
        <div className="para__b">{text}{tail ? <i className="caret" /> : null}</div>
      </div>
    );
  }

  function LiveTranscript({ctx}) {
    const app = useApp();
    const {liveJob} = ctx;
    const bodyRef = useRef(null);
    const [follow, setFollow] = useState(true);
    const slice = TX.liveSlice(D.paras, D.DUR, liveJob.pct);

    // 跟随最新：用户往上翻就停住并浮出「回到最新」，不跟他抢滚动条
    useEffect(() => {
      const el = bodyRef.current;
      if (!el || !follow) return;
      el.scrollTop = el.scrollHeight;
    }, [liveJob.pct, follow]);
    const onScroll = (e) => {
      const el = e.currentTarget;
      const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      if (atEnd !== follow) setFollow(atEnd);
    };
    const toEnd = () => {
      setFollow(true);
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    };

    const empty = !slice.settled.length;
    return (
      <>
        <div className="panelhd">
          <span className="t-title-sm grow">文稿</span>
          {/* 转录中只留复制：润色 / 章节 / 说话人都要等完整文稿，
              这时候摆出来只会是点不动的菜单 */}
          <IconBtn icon="copy" size="s" tip="复制已转录的部分" disabled={!slice.settled.length}
            onClick={() => {
              const txt = TX.copyText(slice.settled, {lang: 'src', speakers: D.speakers});
              copyToClipboard(txt).then((ok) => ok
                ? app.toast(`已复制已转录的 ${slice.settled.length} 段 · 转录仍在进行`, 'positive')
                : app.toast('复制失败 · 浏览器拒绝了剪贴板权限', 'negative'));
            }} />
        </div>
        <window.LiveHead job={liveJob} dur={D.DUR} onCancel={ctx.cancelLive} />
        <div className="panelbody panelbody--tsc bc-scroll" ref={bodyRef} onScroll={onScroll}>
          {liveJob.status === 'error' ? <Empty title="等待重新转录">视频仍可预览，完成转录后在这里校对文稿。</Empty> : empty
            ? <div className="liveskel">
                {[0, 1, 2].map((i) => (
                  <div className="liveskel__r" key={i}>
                    <span className="liveskel__h" /><span className="liveskel__l" /><span className="liveskel__l liveskel__l--s" />
                  </div>
                ))}
                <div className="t-detail-xs" style={{padding: '4px'}}>识别出来的文字会陆续出现在这里；有的服务要等全部识别完才一起返回。</div>
              </div>
            : <div className="tlist">
                {/* 整段到达，没有写到一半的句子；最后一段（识别中）末尾挂光标，保存阶段不再有 */}
                {slice.settled.map((p, i) => <LiveRow key={p.id} p={p} text={p.text} tail={i === slice.tailIndex} onSeek={ctx.seek} />)}
              </div>}
        </div>
        {follow ? null : (
          <BCAction className="livejump" onClick={toEnd}><Ic n="chevdown" className="ic--14" />回到最新</BCAction>
        )}
      </>
    );
  }

  /* ---------- 「剪辑」开关（第 200 轮立、第 201 轮入面板头，§12.6 / §13.1）----------
     Switch + 文字标签，挂在文稿面板头标题右侧。它是编辑器的全局状态（`ctx.cutMode`），
     不是文稿局部视图：关 = 成片视图（文稿抠掉已剪词、时间轴折叠且不画剪口），
     开 = 剪辑视图（文稿按字铺开可剪可恢复、时间轴撑开成源片时钟画空槽带与建议带）。
     待处理建议数写在标签后（关着时才标——开着时汇总条已经在报）。 */
  function CutSwitch({ctx}) {
    const CUT = window.BC_CUT;
    const n = ctx.cutMode ? 0 : CUT.suggested(ctx.cuts || []).length;
    const act = CUT.active(ctx.cuts || []).length;
    const tip = ctx.cutMode ? '关掉剪辑：文稿与时间轴只看成片'
      : n ? `打开剪辑：${n} 处建议待处理` : act ? `打开剪辑：看 ${act} 处已剪段、可恢复` : '打开剪辑：拖选文字剪口播';
    return (
      <span className="tsc__cut" title={tip}>
        <Switch on={!!ctx.cutMode} onChange={(v) => ctx.setCutMode(v)} ariaLabel="剪辑"
          label={<>剪辑{n ? <span className="tsc__cutn">{n}</span> : null}</>} />
      </span>
    );
  }

  function TranscriptPanel({ctx}) {
    const app = useApp();
    const shadedCueIds = useMemo(() => new Set(ctx.cues.filter((_, i) => i % 2 === 0).map(c => c.id)), [ctx.cues]);
    const {playT, seek, pick, chapters} = ctx;
    const [lang, setLang] = useState('src');
    /* 在看哪一门译文。null = 跟着目录第一门走；语言档与它是两根轴，
       换语言不改档、勾「同时显示原文」不改语言。 */
    const [transCode, setTransCode] = useState(null);
    const [edit, setEdit] = useState(null);
    const [pop, setPop] = useState(null);        // 'ai' | 'lang'
    const [drag, setDrag] = useState(null);      // {id, from} 拖动中的段
    const [over, setOver] = useState(-1);        // 当前悬停的落点章节
    const [chMenu, setChMenu] = useState(null);  // 打开菜单的章节 id
    const [provisional, setProvisional] = useState(() => TX.initialSegmentsProvisional(D.initialSegments));
    const listRef = useRef(null);

    // 段落正文一律现取（cue 改写表是唯一真相），复制与查找因此不会拿到旧文本
    const paras = ctx.paras.map((p) => Object.assign({}, p, {text: TX.paraSrc(p, ctx.cueText)}));
    const secs = CH.sections(chapters, paras);
    const activeId = (paras.find((p) => playT >= p.start && playT < p.end) || {}).id;
    /* 播放跟随（panel-transcript-follow.jsx）：只在播放中、非编辑态把当前词滚到列表中间；
       手动滚开就停，面板内的 seek 或重新播放时恢复——所以面板里的跳播都走 seekF */
    const {resume, listProps} = useTranscriptFollow({listRef, playing: ctx.playing, activeId, edit});
    const seekF = useCallback((t) => { resume(); seek(t); }, [resume, seek]);

    /* 查找按**当前语言视图**取面：看原文就查原文，看双语就两列都查。

       **落笔的单位是 cue 不是段落**（同 `apps/baocut` 的 `findbar.rs::replace`：
       按 cue 原文生成 `sourceText`）。所以两类命中改不了，都在按下去之前就标出来：
         · 译文列——译文的真相在 Translate Tab（§13.2），在这里改既不回写 trans
           也绕过对齐块的账；
         · 跨了 cue 边界的原文命中——它没有单个 `sourceText` 可写。 */
    const srcOf = (p) => TX.paraSrc(p, ctx.cueText);
    const spansOf = (p) => TX.cueSpans(p, ctx.cueText);

    /* 剪辑模式（第 192 轮，§13.1）：选区真相在 ctx.cutSel（第 193 轮上提，时间轴也读它），
       ⌫ / Esc 归 useCutSelection，浮动工具条与菜单是面板级的各一枚；
       选区 → 时间按 cue 内字符比例折算（原型没有词级时间戳） */
    const cueById = useMemo(() => new Map(ctx.cues.map((c) => [c.id, c])), [ctx.cues]);
    const cueOf = (id) => cueById.get(id);
    useCutSelection(ctx);
    const [cutMenu, setCutMenu] = useState(null);
    const cutView = ctx.cutMode ? {cuts: ctx.cuts, cueOf, ctx: Object.assign({}, ctx, {seek: seekF}),
      onMenu: (cut, e) => setCutMenu({cut, x: e.clientX, y: e.clientY})} : null;
    /* 第 199 轮：改字态不显示已剪词。每段的显示文本 = 全文抠掉已生效剪口占的字；
       查找、就地编辑都读这一份，提交时 CUT.restoreHidden 把抠掉的段放回再摊回 cue。
       剪辑态仍读全文（CutText 自己划掉）。 */
    const editViewOf = (p) => (ctx.cutMode ? null : CUT.editView(srcOf(p), spansOf(p), cueOf, ctx.cuts));
    const shownOf = (p) => { const v = editViewOf(p); return v ? v.text : srcOf(p); };
    const find = useFind({
      items: paras.flatMap((p) => [
        lang !== 'trans' ? {key: p.id + ':src', para: p.id, side: 'src', text: shownOf(p)} : null,
        lang !== 'src' ? {key: p.id + ':trans', para: p.id, side: 'trans', text: p.trans || ''} : null,
      ].filter(Boolean)),
      replaceOk: (m) => {
        if (m.side !== 'src') return false;
        const p = paras.find((x) => x.id === m.para);
        return !!p && !!TX.cueOfRange(spansOf(p), m.start, m.end);
      },
      onReplace: (list, rq) => {
        const patch = {}; let n = 0;
        F.byKey(list).forEach((ms, key) => {
          const p = paras.find((x) => key === x.id + ':src'); if (!p) return;
          // 命中已经保证不跨边界，所以每一条都能落到它那条 cue 的原文上
          const spans = spansOf(p);
          ms.slice().sort((a, b) => b.start - a.start).forEach((m) => {
            const cue = TX.cueOfRange(spans, m.start, m.end); if (!cue) return;
            const s = spans.find((x) => x.id === cue);
            const cur = patch[cue] != null ? patch[cue] : ctx.cueText(cue);
            const r = F.replaceIn(cur, [{start: m.start - s.start, end: m.end - s.start}], rq);
            if (r.changed) { patch[cue] = r.text; n += r.changed; }
          });
        });
        if (n) ctx.putCueText(patch);
        return n;
      },
      onJump: (m) => { const p = paras.find((x) => x.id === m.para); if (p) seekF(p.start); },
    });
    // 换语言等于换了一批命中，序号归零（换的是哪一门译文同样算）
    useEffect(() => { find.reset(); }, [lang, transCode]);
    const lockHint = !find.cur || !find.cur.locked ? null
      : find.cur.side === 'trans'
        ? '译文只查不改——改写译文在「翻译」Tab'
        : '这一处跨了两条字幕的边界，没有单条字幕可以落笔——先在「字幕」Tab 调整切分，或改一个不跨边界的词';


    const startDrag = (p, e) => {
      if (!p) { setDrag(null); setOver(-1); return; }
      const from = CH.chapterOfPara(chapters, p);
      setDrag({id: p.id, from});
      if (e && e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', p.id);
        const row = e.currentTarget.parentNode;
        if (row) e.dataTransfer.setDragImage(row, 12, 12);
      }
    };
    // 落点只可能是相邻章：章节是连续时间区间，隔一章落下去会把中间那章劈成两段
    const dirFor = (i) => (drag && Math.abs(i - drag.from) === 1 ? (i < drag.from ? -1 : 1) : 0);
    const dropOk = (i) => {
      const d = dirFor(i);
      return d !== 0 && !!CH.movePlan(chapters, ctx.paras, drag.id, d);
    };
    const doDrop = (i) => {
      setOver(-1);
      if (!drag || !dropOk(i)) return;
      ctx.moveParaChapter(drag.id, dirFor(i));
      setDrag(null);
    };

    const move = (id, dir) => {
      if (!CH.movePlan(chapters, ctx.paras, id, dir)) {
        app.toast(dir < 0 ? '这一段前面没有别的章节了' : '这一段后面没有别的章节了');
        return;
      }
      ctx.moveParaChapter(id, dir);
    };

    /* 改字态里整段剪光的段不占卡片：连着剪光的几段折成一条剪缝（BC_CUT.seamRows / CutSeam）。
       剪辑态不折——那一态的正文本来就要把已剪的字划着给人看。 */
    const allCutOf = (p) => { const ev = editViewOf(p); return !!ev && ev.text === ''; };
    const rows = (list) => CUT.seamRows(list, allCutOf, ctx.cuts).map((row) => (
      row.kind === 'seam'
        ? <CutSeam key={row.id} seam={row} ctx={ctx} />
        : paraRow(row.para)
    ));

    const paraRow = (p) => { const ev = editViewOf(p); return (
      <ParaRow key={p.id} p={p} ctx={ctx} lang={lang} on={p.id === activeId} done={playT >= p.end} editing={edit === p.id}
        shades={app.prefs.cueShading === true ? spansOf(p).filter(s => shadedCueIds.has(s.id)) : undefined}
        drag={drag && drag.id === p.id} text={ev ? ev.text : srcOf(p)} cur={find.cur}
        cut={cutView} spans={spansOf(p)}
        msSrc={find.byKey.get(p.id + ':src')} msTr={find.byKey.get(p.id + ':trans')}
        words={p.id === activeId && lang !== 'trans' && edit !== p.id
          ? FOLLOW.paraWords(ev ? ev.text : srcOf(p), spansOf(p), cueOf, playT, ev && ev.hidden) : null}
        onSeek={(t) => { seekF(t); pick({kind: 'cue', id: p.cueIds[0]}); }}
        onEdit={setEdit} onDrag={startDrag} onMove={move}
        onNext={(d) => { const np = paras[paras.findIndex((x) => x.id === p.id) + d]; if (np) setEdit(np.id); }}
        onCommit={(v) => {
          setEdit(null);
          // 改字态编辑的是投影：先把抠掉的已剪词放回，再按全文判「没改」与摊回 cue
          const full = ev ? CUT.restoreHidden(ev.text, v.trim(), ev.hidden) : v.trim();
          if (full === srcOf(p)) return;          // 没改就别报「已改写」
          // 整段改写摊回它那几条 cue（真实产品里这一步在服务端重派生，见 model-transcript）
          ctx.putCueText(TX.applyParaEdit(p, ctx.cueText, full));
          setProvisional(false);
          app.toast(provisional
            ? '已改写这一段 · 初始分段已转为正式边界'
            : '已改写这一段 · 词级时间自动重排', 'positive',
            {label: '撤销', undo: true, run: () => app.toast('已撤销')});
        }} />
    ); };

    const trLangs = TRANS_LANGS();
    const trLang = transLangOf(transCode);
    const curShort = langShort(lang, trLang);

    // 转录还在跑：文稿是任务事件流的投影，整面板切只读的实时态
    if (ctx.liveJob && (ctx.liveJob.status === 'running' || ctx.liveJob.origin === 'url')) return <LiveTranscript ctx={ctx} />;

    return (
      <>
        <div className="panelhd">
          <span className="t-title-sm grow">文稿</span>
          {/* 全局「剪辑」开关（第 200 轮立、第 201 轮搬到文稿面板头）：一位同时决定文稿是改字态
              还是剪辑态、时间轴是成片视图还是撑开的源片视图。它管的是全局状态，但入口跟着
              被剪的对象——文字——放，不挤在 transport 里；关着时已剪的内容在两边都看不见，
              有待处理建议时开关旁标数（那是建议唯一常驻的可见入口）。 */}
          <CutSwitch ctx={ctx} />
          {provisional ? (
            <Tip label={`基于 ${D.initialSegments.source} ASR 分段 · ${D.initialSegments.paragraphs} 段；编辑后转为正式分段`}>
              <Chip tone="info" pill>初始分段</Chip>
            </Tip>
          ) : null}
          <IconBtn icon="search" size="s" tip="查找和替换 · ⌘F" on={find.open}
            onClick={() => (find.open ? find.close() : find.setOpen(true))} />
          {/* 复制钮一点就按记住的组合复制全文，旁边的下拉是复制设置（transcript-copy.jsx） */}
          <TranscriptCopy ctx={ctx} paras={paras} lang={lang} langLabel={curShort} transCode={trLang && trLang.code} />
          {AI && <S.MenuTrigger align="end" isOpen={pop === 'ai'} onOpenChange={(open) => setPop(open ? 'ai' : null)}>
            <S.ActionButton size="S" isQuiet aria-label="整理文稿"><S.Icons.MagicWand /></S.ActionButton>
            <S.Menu aria-label="整理文稿">
              <S.MenuSection><S.Header>整理全文</S.Header>
                <S.MenuItem textValue="重新转录" onAction={() => { setPop(null); ctx.requestAi('retranscribe', null); }}>
                  <S.Icons.Redo /><S.Text slot="label">重新转录</S.Text><S.Text slot="description">换一个模型识别全文</S.Text>
                </S.MenuItem>
                <S.MenuItem textValue="润色并重新分段" onAction={() => { setPop(null); ctx.requestAi('polish', null); }}>
                  <S.Icons.MagicWand /><S.Text slot="label">润色并重新分段</S.Text><S.Text slot="description">逐段对照修改，可还原</S.Text>
                </S.MenuItem>
                <S.MenuItem textValue="生成章节" onAction={() => { setPop(null); ctx.requestAi('chapters', null); }}>
                  <S.Icons.ListBulleted /><S.Text slot="label">生成章节</S.Text><S.Text slot="description">需先完成文稿润色</S.Text>
                </S.MenuItem>
                <S.MenuItem textValue="识别说话人" onAction={() => { setPop(null); ctx.requestAi('speakers', null); }}>
                  <S.Icons.Microphone /><S.Text slot="label">识别说话人</S.Text><S.Text slot="description">区分声音，确认后应用</S.Text>
                </S.MenuItem>
              </S.MenuSection>
              <S.MenuSection><S.Header>从文稿出发</S.Header>
                {[['shortscut', '剪成短视频', '挑几段，各做成一支竖屏短视频'], ['summary', '写总结', '正文加带时间的要点'], ['blog', '写博客', '改写成一篇文章'],
                  ['title', '起标题', '几个角度不同的候选'], ['desc', '写简介', '带章节时间码和标签'], ['cover', '做封面', '从关键帧出发做几张候选']]
                  .filter(([k]) => !(k === 'shortscut' && window.BC_SHORTS.isShorts(ctx.proj))).map(([k, label, sub]) =>
                  <S.MenuItem key={k} textValue={label} onAction={() => { setPop(null); ctx.requestAi(k, null); }}>
                    <S.Text slot="label">{label}</S.Text><S.Text slot="description">{sub}</S.Text>
                  </S.MenuItem>)}
              </S.MenuSection>
              <S.MenuSection aria-label="会话">
                <S.MenuItem textValue="交给 Agent" onAction={() => { setPop(null); if (app.harness) app.openAgent({project: ctx.proj.id}); else app.go({r: 'settings', sec: 'agent'}); }}>
                  <Ic n="agent" /><S.Text slot="label">交给 Agent…</S.Text>
                  <S.Text slot="description">{app.harness ? '用一句话描述需要做的事' : '先连接 Agent'}</S.Text>
                </S.MenuItem>
              </S.MenuSection>
            </S.Menu>
          </S.MenuTrigger>}
        </div>
        <FindBar find={find} placeholder="在文稿里查找" hint={lockHint} />
        <div className="tsctop">
          <div className="row gap6">
            <Picker size="s" value={curShort} open={pop === 'lang'} popAlign="left" popWidth={232}
              onClose={() => setPop(null)}
              onClick={() => setPop((v) => (v === 'lang' ? null : 'lang'))}>
              <Menu>
                <MenuHead>文稿语言</MenuHead>
                <MenuItem label={D.srcLang.name} sub="原文" on={lang === 'src'}
                  onClick={() => { setLang('src'); setPop(null); }} />
                {trLangs.length ? <MenuRule /> : null}
                {trLangs.map((l) => (
                  <MenuItem key={l.code} label={l.name} sub="译文"
                    on={lang !== 'src' && trLang && trLang.code === l.code}
                    onClick={() => {
                      setTransCode(l.code);
                      // 换语言不改档：从原文点进来才落到只看译文
                      if (lang === 'src') setLang('trans');
                      setPop(null);
                    }} />
                ))}
                {trLangs.length ? <>
                  <MenuRule />
                  {/* 第二根轴：勾上就是双语对照。看原文时没有可对照的那一列，所以禁用 */}
                  <MenuItem label="同时显示原文" sub={lang === 'src' ? '先选一门译文' : '双语对照'}
                    disabled={lang === 'src'} on={lang === 'both'}
                    onClick={() => { setLang(lang === 'both' ? 'trans' : 'both'); setPop(null); }} />
                </> : <MenuItem label="还没有译文" sub="在「字幕」Tab 里翻译" disabled />}
              </Menu>
            </Picker>
            <Chip>{ctx.cues.length} 条字幕</Chip>
            <Chip>{new Set(ctx.cues.map(c => c.sp)).size} 位说话人</Chip>
            <Chip>{chapters.length} 章</Chip>
          </div>
          {ctx.cutMode ? <CutBar ctx={ctx} /> : TX.hasWordTiming(lang) ? null : (
            <div className="tscnote">
              <Ic n="info" className="ic--14" />
              <span>译文只做段级跟随——词级时间戳只在原文，按词对齐播放进度会是编出来的。</span>
            </div>
          )}
        </div>
        <div className={cx('panelbody panelbody--tsc bc-scroll', drag && 'is-dragging')} ref={listRef} {...listProps}>
          <div className="tlist">
            {secs.map((sec, i) => {
              if (!sec.chapter) return <div className="tsec" key="flat">{rows(sec.paras)}</div>;
              // 三态：源章节保持原样（它不是「被拒绝」的落点）、相邻可落的亮起、其余压暗
              const ok = drag ? dropOk(i) : false;
              const state = !drag ? null : i === drag.from ? 'is-src' : ok ? (over === i ? 'is-drop is-over' : 'is-drop') : 'is-nodrop';
              const open = chMenu === sec.chapter.id;
              return (
                <div key={sec.chapter.id} className={cx('tsec', state)}
                  onDragEnter={() => { if (ok) setOver(i); }}
                  onDragLeave={(e) => { if (ok && !e.currentTarget.contains(e.relatedTarget)) setOver(-1); }}
                  onDragOver={(e) => { if (ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                  onDrop={(e) => { e.preventDefault(); doDrop(i); }}>
                  <div className="chead">
                    <ChapterTitle chapter={sec.chapter} onRename={ctx.renameChapter} />
                    <span className="chead__r t-mono">
                      {T.timecode(sec.chapter.start, {decimals: 0})}–{T.timecode(sec.chapter.end, {decimals: 0})}
                    </span>
                    <span className="grow" />
                    {ok ? <span className="chead__drop">移到这一章</span>
                        : <span className="chead__n">{sec.paras.length} 段</span>}
                    <span style={{position: 'relative'}}>
                      <BCAction className={cx('chead__b', open && 'is-on')} title="这一章…"
                        onClick={() => setChMenu(open ? null : sec.chapter.id)}>
                        <Ic n="more" className="ic--14" />
                      </BCAction>
                      <Popover open={open} onClose={() => setChMenu(null)} align="right" dir="down" width={236}>
                        <ScopeMenu ctx={ctx} lang={lang} paras={sec.paras} onClose={() => setChMenu(null)}
                          scope={{kind: 'chapter', label: `「${sec.chapter.title}」`}} />
                      </Popover>
                    </span>
                  </div>
                  {sec.paras.length
                    ? rows(sec.paras)
                    : <div className="chead__empty">这一章还没有段落——把上下相邻章节的段落拖进来</div>}
                </div>
              );
            })}
          </div>
          <div className="t-detail-xs tscfoot">
            {ctx.cutMode
              ? '拖选一段文字按 ⌫ 剪掉；划掉的字点一下可以恢复，虚线是 AI 的建议、点它接受或忽略。播放和导出都直接跳过已剪的段。'
              : '点正文即可改写，光标落在你点的那个字上；拖说话人行（或按 ↑ ↓）把这一段挪到相邻章节。章节是连续时间区间，所以挪一段会连带同侧的邻居一起走。'}
          </div>
        </div>
        {ctx.cutMode ? <CutFloat ctx={ctx} scrollRef={listRef} /> : null}
        <CutMenu menu={cutMenu} ctx={ctx} onClose={() => setCutMenu(null)} />
      </>
    );
  }

  /* ---------- 骨架面板 ---------- */
  function PanelView({ctx}) {
    /* 版面编辑器开着时右栏整个让给它（舞台那边同步换成 TemplateStudioStage） */
    if (ctx.tplStudio && ctx.tab === 'elements') return <window.TemplateStudioPanel ctx={ctx} />;
    /* 多选（第 115 轮）：右栏换成批量摘要，属性页只认 primary，多选时会误导。几条字幕轨一起选中时同理，
       不管停在哪个 Tab（字幕轨的多选不换 Tab，见 editor.jsx）。 */
    if ((ctx.sels || []).length > 1 && ctx.tab === 'elements') return <window.MultiSelectPanel ctx={ctx} />;
    if (window.BC_SELECT.subMembers(ctx.sels).length > 1) return <window.MultiSelectPanel ctx={ctx} />;
    if (ctx.liveJob?.origin === 'url' && ctx.liveJob.status === 'error' && ['transcript', 'subtitle'].includes(ctx.tab)) return <>
      <div className="panelhd"><span className="t-title-sm">字幕生成</span></div>
      <window.LiveHead job={ctx.liveJob} dur={D.DUR} onCancel={ctx.cancelLive} />
      <Empty title="等待重新转录">视频仍可预览，完成转录后在这里校对文稿。</Empty>
    </>;
    if (ctx.tab === 'transcript') return <TranscriptPanel ctx={ctx} />;
    // 第 152 轮起字幕与翻译是同一个 Tab：列表跟着轨条选中的轨走（panel-subtitle.jsx）
    if (ctx.tab === 'subtitle')   return <window.SubtitlePanel ctx={ctx} />;
    if (ctx.tab === 'aitools')    return <window.AiToolsPanel ctx={ctx} />;
    if (ctx.tab === 'elements')   return <window.ElementsPanel ctx={ctx} />;
    if (ctx.tab === 'text')       return <window.TextPanel ctx={ctx} />;
    /* 主轨片段选中时，`video` 栏换成片段自己那一页（第 115 轮 §7）：时间轴点主轨块与
       点元素块对等，都翻出属性页；不选片段时这一栏仍然是素材库。 */
    if (/^(image|video|audio)$/.test(ctx.tab)) return <window.MediaPanel ctx={ctx} kind={ctx.tab} />;
    if (ctx.tab === 'brand')      return <window.BrandPanel ctx={ctx} />;
    if (ctx.tab === 'settings')   return <window.ProjectSettingsPanel ctx={ctx} />;
    // rail 每一栏都有真面板，没有兜底——新增 rail 项必须同时给面板，不许悄悄退化成占位
    return null;
  }

  Object.assign(window, {PanelView, TranscriptPanel, ParaRow, LiveTranscript});
})();
