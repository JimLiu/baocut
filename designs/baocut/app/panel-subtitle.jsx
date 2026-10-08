/* 「字幕」Tab —— §13.2 / §16。
   第 27 轮起它只管**这一条字幕轨长什么样**，译文与原文怎么对上归独立的 Translate 面板；
   **第 152 轮两个 Tab 并成一个**：原文校对与双语校对不是两个地方，是同一张列表的两种
   形态——单列 cue 列表（下面的 EditView）与原文｜译文的双语对照（panel-translate.jsx
   导出的 TransEditView，带它自己的统计条、AI 入口、翻译中与收据两种状态）。

   **第 153 轮列表有了自己的对照条**（model-sublist.js）：第 152 轮让列表形态跟着轨条的
   选中反推（原文轨 → 单列、译文轨 → 双语），用户看不出这条规则——轨条读起来是「画面上有
   哪几条、样式改哪一条」，想看「中文 ＋ 日本語」去改两边字幕时找不到开关。现在轨条只管
   画面与样式作用域，列表看什么由轨条下面那一行决定：`只看原文 / 原文 ＋ 译文 / 只看译文`
   三档 ＋ 「对照哪一门译文」下拉（画面上的、拿下的、正在翻的都在，末尾「翻译成…」）。
   与轨条只剩一条单向耦合：选中一条译文轨（chip、画布、时间轴译文行）把对照语言切成它。

   第 45 轮：Style 子 Tab 换成**样式画廊 → 字幕属性页 → 动画页**三级栈
   （panel-substyle.jsx / panel-subprops.jsx）；第 151 轮子 Tab 退役，样式入口卡 ＋ 轨条
   摆在主页顶上（panel-substrip.jsx）。

   语言入口（面板头的下拉）第 152 轮随翻译 Tab 一起退役：它的四组东西全部长在轨条上——
   画面上的轨（选中 ＝ 编辑对象）、拿下来的幽灵 chip（放回）、正在翻的语言（进度 chip）、
   「＋ 翻译成…」（去 AI 工具）。语义不变：选一门语言切的是「**我在编辑哪一条轨**」，
   **不是**「timeline 上有哪几条轨」——轨落到时间轴上就固定在那里。 */
(function () {
  const {useState, useRef, useEffect} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;

  const spColor = (sp) => `oklch(0.5 0.14 ${D.speakers[sp].hue})`;

  /* ---------- 原文轨的列表：单语 cue 校对 ---------- */
  function CueCard({c, i, on, done, editing, onPick, onEdit, onCommit, onNext, onHistory, live, text, ms, cur, own, ops, caretAt, seam}) {
    const body = text == null ? c.text : text;
    const rate = window.BC_SUBLIST.readingSpeed(body, c.end - c.start, D.srcLang.code);
    return (
      <div className={cx('sb', on && 'is-on', done && 'is-done', editing && 'is-editing', live && 'sb--live', live === 'tail' && 'is-tail')}
        data-cue={c.id} style={{borderLeftColor: live ? 'var(--gray-300)' : spColor(c.sp)}} onClick={onPick}>
        {/* 接缝上的那枚「并入上一条」（第 155 轮）：骑在卡的上边线上、悬停才出、不占布局，
            同 apps/baocut 字幕列表的 Merge up pill。只在能并（同说话人）时挂。 */}
        {seam && !editing ? (
          <BCAction className="sbseam" onClick={(e) => { e.stopPropagation(); seam.run(); }}>
            <Ic n="chevup" className="ic--14" />{seam.label}
          </BCAction>
        ) : null}
        <div className="sbh">
          <span className="sbn">{i + 1}</span>
          {/* 实时段落还没有说话人（说话人只在转录完成的结果里，product-design §5.7）：
              色带统一中性灰，名字位只在最后一条写「识别中」，其余只留序号与时间码 */}
          {live === 'tail'
            ? <span className="sbsp sbsp--unk">识别中</span>
            : live ? null : <span className="sbsp" style={{color: spColor(c.sp)}}>{D.speakers[c.sp].name}</span>}
          <span className="sbt">{T.timecode(c.start)}</span>
          {live || editing || rate.level === 'none' ? null : <span className={cx('cps', rate.level === 'warn' && 'is-warn', rate.level === 'bad' && 'is-hot')}>{rate.value} cps</span>}
          {/* 有自己样式的那几条标一枚链（第 102 轮）。
              这一列是覆盖表**唯一能被一眼扫到**的地方：不标的话，「为什么第 37 条比别的
              大一号」只能靠一条条点过去才看得出来。 */}
          {own ? <Tip label={'这一条有自己的样式（' + own + ' 项）· 其余跟随全部字幕'}>
            <span className="sbown"><Ic n="link" className="ic--14" /></span></Tip> : null}
        </div>
        {/* 转录中不给编辑：那批 cue 还没落盘，改了没有可写回的地方 */}
        {live
          ? <div className="sbtext">{body}{live === 'tail' ? <i className="caret" /> : null}</div>
          : <EditableText className="sbtext" value={body} editing={editing} ms={ms} cur={cur} onNext={onNext}
              ops={ops} caretAt={caretAt} onHistory={onHistory}
              onBegin={(at, len) => onEdit({id: c.id}, at, len)} onCommit={onCommit} onCancel={() => onEdit(null)} />}
      </div>
    );
  }

  function EditView({ctx, trackId}) {
    const app = useApp();
    const {playT, seek, pick, liveJob, cues, paras, playing} = ctx;
    const O = window.BC_CUEOPS;
    const [edit, setEdit] = useState(null);   // {id, caret}：正在编辑哪一条、光标落在哪
    useEffect(() => setEdit(null), [ctx.history.revision]);
    const listRef = useRef(null);
    const [follow, setFollow] = useState(true);
    /* 第 243 轮：字幕列表只在**第一次转录**（视频还没有字幕）时跟着长；重新转录时已有的字幕原样留着，
       只有文稿面板切实时态——与时间轴同一条规矩（`ctx.liveAt` 对重新转录的任务是 null）。 */
    const live = !!liveJob && liveJob.status === 'running' && ctx.liveAt != null;
    const slice = live ? window.BC_TX.liveSlice(D.cues, D.DUR, liveJob.pct) : null;

    /* 改写后的字幕文本落在**编辑器那张 cue 表**里，不是这个面板自己的一份：
       cue 是唯一的写入单位，文稿 Tab 的段落正文是它相接出来的投影。
       在这里改一条，切回文稿必须看得见同一句话变了。 */
    const textOf = (c) => ctx.cueText(c.id);
    const fastCount = cues.filter(c => ['warn', 'bad'].includes(
      window.BC_SUBLIST.readingSpeed(textOf(c), c.end - c.start, D.srcLang.code).level)).length;
    // 第 196 轮：剪口播剪进 cue 的条数（§13.1）——字幕时长在时间轴上已按剪口缩短，这里只报数
    const cutN = ctx.transImpact ? ctx.transImpact.partial + ctx.transImpact.whole + ctx.transImpact.trimmed + ctx.transImpact.fixed : 0;
    /* 这一条改过几项（全部轨加起来）。0 就不标——列表里每一行都挂一枚灰图标，
       等于把「有几条是特殊的」这条信息抹平。 */
    const ownCount = (id) => window.BC_SUB.tracks(ctx.subStyle)
      .reduce((n, t) => n + window.BC_SUB.overriddenKeys(ctx.subStyle, id, t.id).length, 0);
    const find = useFind({
      items: cues.map((c) => ({key: c.id, text: textOf(c)})),
      onReplace: (list, rq) => {
        const patch = {}; let n = 0;
        window.BC_FIND.byKey(list).forEach((ms, id) => {
          const r = window.BC_FIND.replaceIn(textOf({id}), ms, rq);
          if (r.changed) { patch[id] = r.text; n += r.changed; }
        });
        if (n) ctx.putCueText(patch);
        return n;
      },
      onJump: (m) => { const c = cues.find((x) => x.id === m.key); if (c) seekF(c.start); },
    });

    /* ---- 拆与并（第 155 轮）：键、按钮、接缝 pill 三条路走同一段代码 ----
       一次动作 = 一次落表 = 一条可撤销的 toast（同 App 的「一动作一提交一撤销」）。
       文本是这一刻编辑框里的（还没提交也算），所以「改几个字再按回车拆」不用先失焦。 */
    const commitText = (c, v) => {
      setEdit(null);
      const nv = (v == null ? textOf(c) : v).trim();
      if (nv === textOf(c)) return;
      ctx.putCueText({[c.id]: nv});
      app.toast('已改写这一条字幕 · 词级时间自动重排', 'positive',
        {label: '撤销', undo: true, run: () => ctx.history.undo()});
    };
    const undoable = (msg) => app.toast(msg, 'positive',
      {label: '撤销', undo: true, run: () => ctx.history.undo()});
    const doSplit = (c, text, at) => {
      const r = O.splitCue(cues, c.id, text, at);
      if (!r) { commitText(c, text); app.toast('把光标放到要拆开的位置，再拆分'); return; }
      ctx.setCues(r.cues);
      setEdit({id: r.id, caret: 0});
      undoable('已拆成两条 · 时间按字数分');
    };
    /* dir < 0 并入上一条、> 0 并入下一条；`keep` 为真时并完继续编辑、光标落在接缝上 */
    const doMerge = (c, text, dir, keep) => {
      const r = O.mergeCues(cues, c.id, text, dir);
      if (r.err) {
        if (keep) commitText(c, text);
        app.toast(r.err === 'speaker' ? '说话人不同 · 不能合并' : dir < 0 ? '已经是第一条' : '已经是最后一条');
        return;
      }
      ctx.setCues(r.cues);
      setEdit(keep ? {id: r.id, caret: r.caret} : null);
      undoable(dir < 0 ? '已并入上一条 · 时间接上' : '已并入下一条 · 时间接上');
    };
    const mergeOp = (c, dir) => {
      const probe = O.mergeCues(cues, c.id, null, dir);
      const why = probe.err === 'speaker' ? '说话人不同 · 不能合并' : dir < 0 ? '已经是第一条' : '已经是最后一条';
      return {label: dir < 0 ? '并入上一条' : '并入下一条', off: !!probe.err,
        tip: probe.err ? why : null, why: () => app.toast(why), run: (text) => doMerge(c, text, dir, true)};
    };
    const opsFor = (c) => ({
      split: {label: '拆分', run: (text, at) => doSplit(c, text, at)},
      up: mergeOp(c, -1),
      down: mergeOp(c, 1),
    });

    /* 播放跟随（product-design §5.7，panel-transcript-follow.jsx）：正在播的那一条滚进视野、
       不居中；暂停不滚、编辑中不滚；播放中手动滚开就停，面板里跳播或重新开始播放时恢复。
       与下面「转录中跟随最新」各管一种状态：转录中不挂这套。 */
    const activeCue = cues[window.BC_FOLLOW.activeAt(cues, playT)];
    const {resume, listProps} = window.usePlayFollow({listRef, playing: playing && !live, hold: !!edit, place: 'nearest',
      locate: (list) => (activeCue ? list.querySelector(`[data-cue="${activeCue.id}"]`) : null)});
    function seekF(t) { resume(); seek(t); }

    // 转录中跟随最新，与 Transcript 的实时态同一条规矩：用户往上翻就停住
    useEffect(() => {
      const el = listRef.current;
      if (!live || !el || !follow) return;
      el.scrollTop = el.scrollHeight;
    }, [live, liveJob && liveJob.pct, follow]);

    if (live) {
      // 整条到达；最后一条（识别中）末尾挂光标，保存阶段不再有
      const rows = slice.settled.map((c, i) => (
        <CueCard key={c.id} c={c} i={i} live={i === slice.tailIndex ? 'tail' : 'done'} onPick={() => seek(c.start)} />
      ));
      return (
        <>
          <window.LiveHead job={liveJob} dur={D.DUR} onCancel={ctx.cancelLive} />
          <div className="pscroll bc-scroll" ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
              if (atEnd !== follow) setFollow(atEnd);
            }}>
            {rows.length
              ? rows
              : <div className="liveskel">
                  {[0, 1, 2].map((i) => (
                    <div className="liveskel__r" key={i}>
                      <span className="liveskel__h" /><span className="liveskel__l" /><span className="liveskel__l liveskel__l--s" />
                    </div>
                  ))}
                  <div className="t-detail-xs" style={{padding: '4px'}}>识别出来的文字会陆续出现在这里；有的服务要等全部识别完才一起返回。</div>
                </div>}
          </div>
          {follow ? null : (
            <BCAction className="livejump" onClick={() => { setFollow(true); listRef.current.scrollTop = listRef.current.scrollHeight; }}>
              <Ic n="chevdown" className="ic--14" />回到最新
            </BCAction>
          )}
        </>
      );
    }

    return (
      <>
        <div className="statbar">
          <span>{cues.length} cues · {paras.length} 句</span>
          {fastCount > 0 ? <span className="warn">{fastCount} cues 超出阅读速度</span> : null}
          {cutN > 0 ? <span>{cutN} cues 被剪短</span> : null}
          <span className="tail">Enter 拆 · 行首 ⌫ 并上 · 行尾 ⌦ 并下</span>
          <IconBtn icon="search" size="s" tip="查找和替换 · ⌘F" on={find.open}
            onClick={() => (find.open ? find.close() : find.setOpen(true))} />
        </div>
        <FindBar find={find} placeholder="在字幕里查找" />
        <div className="pscroll bc-scroll" ref={listRef} {...listProps}>
          {cues.map((c, i) => (
            <CueCard key={c.id} c={c} i={i} editing={!!edit && edit.id === c.id} text={textOf(c)}
              onHistory={dir => dir < 0 ? ctx.history.undo() : ctx.history.redo()}
              caretAt={edit && edit.id === c.id ? edit.caret : undefined}
              ms={find.byKey.get(c.id)} cur={find.cur} own={ownCount(c.id)}
              on={playT >= c.start && playT < c.end} done={playT >= c.end}
              onPick={() => { seekF(c.start); pick({kind: 'cue', id: c.id, trackId}); }}
              onEdit={(e, at, len) => {
                // 暂停时点正文跟播放头（第 159 轮）：点中第几个字，播放头就到那个字的时间。
                // 原型没有词级时间，按字符位置在 cue 区间里插值；播放中不动播放头。
                if (e && at != null && !playing) seekF(O.caretTime(c.start, c.end, at, len));
                setEdit(e);
              }}
              onNext={(d) => { const nc = cues[i + d]; if (nc) setEdit({id: nc.id}); }}
              ops={opsFor(c)}
              seam={O.canMergeCues(cues, c.id, -1) ? {label: '并入上一条', run: () => doMerge(c, null, -1, false)} : null}
              onCommit={(v) => commitText(c, v)} />
          ))}
        </div>
      </>
    );
  }

  /* ---------- 列表的对照条（第 153 轮）：三档模式 ＋ 对照哪一门译文 ----------
     摆在轨条正下方、与它同一种「标签 ＋ 一行控件」的形状：上一行回答「画面上有什么」，
     这一行回答「列表给我看什么」。两行都常在——正在翻、看收据时也要能切回原文。
     第 154 轮撤掉行尾那句「点一句直接改写」提示：语言名一长它就把整行挤成两行，
     而「能改」这件事由片段的悬停描边与列表底部的 signpost 来说。 */
  const MODE_ITEMS = [{k: 'src', label: '只看原文'}, {k: 'bi', label: '原文 ＋ 译文'}, {k: 'trans', label: '只看译文'}];

  function ListBar({ctx, pref, setPref, opts, view}) {
    const app = useApp();
    const L = window.BC_SUBLIST;
    const [open, setOpen] = useState(false);
    const setMode = (k) => {
      // 一门译文都没有时那两档进不去：说清楚去哪开，不要静默弹回
      if (k !== 'src' && !opts.length) { app.toast(window.BC_SURFACE.ai ? '还没有译文 · 先在轨条上「翻译成…」' : '还没有译文 · ' + window.BC_SURFACE.aiElsewhere('翻译')); return; }
      setPref({mode: k, lang: view.lang});
    };
    return (
      <div className="sublist">
        <span className="substrip__k">列表</span>
        <Segmented size="s" items={MODE_ITEMS} value={view.mode} onChange={setMode} />
        {view.mode === 'src' ? null : (
          <Picker size="s" value={view.opt ? view.opt.name : '译文'} open={open} popAlign="left" popWidth={232}
            onClose={() => setOpen(false)} onClick={() => setOpen((v) => !v)}>
            <Menu>
              <MenuHead>对照哪一门译文</MenuHead>
              {opts.map((o) => (
                <MenuItem key={o.code} label={o.name} suffix={L.suffix(o) || null} on={o.code === view.lang}
                  onClick={() => { setPref({mode: view.mode, lang: o.code}); setOpen(false); }} />
              ))}
              {window.BC_SURFACE.ai ? <MenuItem icon="plus" label="翻译成…" sub="选语言，缺省交给 Agent"
                onClick={() => { setOpen(false); ctx.requestAi('translate', null); }} /> : null}
            </Menu>
          </Picker>
        )}
      </div>
    );
  }

  /* ---------- 「字幕」Tab 主体（第 152 轮起只有这一个） ---------- */
  function SubtitlePanel({ctx}) {
    const S = window.BC_SUB;
    const R = window.BC_TRUN;
    const L = window.BC_SUBLIST;
    const st = ctx.subStyle;
    const run = ctx.transJob;
    const rc = ctx.transReceipt;
    /* 推进来的页有自己的页头（含「回上一层」），Tab 自己的头让位：两条 48px 的标题栏
       摞着，上面那条在子页里点不响，却占着面板最值钱的一条位置。`subedit` 是舞台工具条
       「Edit」那颗钮写的值，等于回主页。 */
    const drilled = /^sub(gallery|props|anim)$/.test(ctx.paneView || '');

    /* 两件事、两个字段，不再互相反推（第 153 轮）：
       · **样式的编辑对象** = `sel.trackId`（轨条 chip、画布、时间轴 cue 块都写它），与画布
         高亮、属性页那排 chip 永远一致；正在翻、还没落轨的那门回落到源语言轨。
       · **列表看什么** = 对照条的偏好 `pref`（模式 ＋ 对照语言），经 BC_SUBLIST 收敛成 `view`。 */
    const src = S.source(st) || S.tracks(st)[0] || {};
    const selId = ctx.sel && ctx.sel.trackId;
    const editId = S.byId(st, selId) ? selId : src.id;
    // 拿下 / 放回一条轨：软上限那一句确认与轨条共用（subtrack.jsx）
    const ops = window.useSubTrackOps(ctx, editId);

    const runLang = run && run.target
      ? (D.transLangs.find((l) => l.code === run.target) || {code: run.target, name: run.target}) : null;
    /* 正在翻的那门：没落轨 → 一条独立的「翻译中」候选；已落轨（重翻）→ 进度挂在那条轨上
       （第 207 轮，model-sublist.js）。 */
    const opts = L.langs({
      tracks: S.tracks(st), shelved: ctx.availableSubTracks(),
      running: runLang ? {code: runLang.code, name: runLang.name, pct: run.pct} : null,
    });
    const [pref, setPref] = useState({mode: 'src', lang: null});
    const view = L.resolve(pref, opts);
    /* 与轨条的单向耦合：选中一条译文轨（chip、画布、时间轴译文行）→ 对照语言切成它，
       单列时顺便切到双语。选中原文轨不动列表（用户可能正在双语里改样式作用域）。 */
    useEffect(() => { setPref((p) => L.onPick(p, selId, opts)); }, [selId]);
    /* 翻译跑起来 / 收据来了都把选中带到那门语言上（旧翻译 Tab 的同一条规矩，上面那条耦合
       再把列表带过去）：用户点的是「翻译成日本語」，结果停在英语列表上会看不出有任何事情发生。
       **只限 App 自己开的翻译**（第 207 轮，`BC_TRUN.jumpsList`）：命令行 / Agent 开的是背景里
       发生的事，用户可能正在校对原文——不抢他的列表，进度条与轨条尾巴负责让他看见。 */
    useEffect(() => { if (run && run.target && R.jumpsList(run)) ctx.pickSub(run.target); }, [run && run.id]);
    const rcTarget = rc && rc.target;
    useEffect(() => { if (rcTarget) ctx.pickSub(rcTarget); }, [rcTarget]);

    const lang = view.opt ? {code: view.opt.code, name: view.opt.name} : null;
    const onRun = view.mode !== 'src' && !!run && run.target === view.lang;
    const slice = run ? R.runSlice(D.translate.live, run.pct, run.status === 'queued') : null;
    const onReceipt = view.mode !== 'src' && !!rc && rc.target === view.lang && !run;

    if (!ctx.cues.length && !(ctx.liveJob && ctx.liveJob.status === 'running')) {
      const hasMedia = ctx.sources.video.length > 0 || ctx.sources.audio.length > 0;
      return <div className="pview">
        <div className="panelhd"><span className="t-title-sm">字幕</span></div>
        <div className="panelbody"><Empty icon="captions" title="还没有字幕">
          {hasMedia ? (window.BC_SURFACE.ai ? '转录媒体后，即可在这里校对字幕。' : window.BC_SURFACE.aiElsewhere('转录') + '。') : '先添加视频或音频，再生成字幕。'}
          {/* Web 表面不起转录：有媒体时只说去处，不给「生成字幕」（model-surface.js） */}
          {hasMedia && !window.BC_SURFACE.ai ? null : <div className="row" style={{justifyContent: 'center', marginTop: 16}}>
            <Btn variant="accent" onClick={() => hasMedia ? ctx.requestAi('retrans') : ctx.setTab('video')}>
              {hasMedia ? '生成字幕' : '添加媒体'}
            </Btn>
          </div>}
        </Empty></div>
      </div>;
    }

    if (drilled) {
      return (
        <div className="pview">
          <window.SubStyleTab ctx={ctx} ops={ops} editId={editId} backLabel="字幕" />
          {ops.dialog}
        </div>
      );
    }
    /* 列表按对照条装配。正在翻这一门时不摆样式入口卡（这一屏的主角是进度，
       轨还没落下来），但轨条与对照条仍在——它们是切回别的语言的路。 */
    /* 只看原文时运行态**不换正文**，只在列表上方压一条进度（第 207 轮）：原文列表照旧
       可读可改，舞台与播放不受影响。点「查看进度」= 对照条切到那门语言（运行态正文在那边）。 */
    const openRun = () => setPref({mode: 'bi', lang: run.target});
    const body = onReceipt ? <window.TransDoneView ctx={ctx} lang={lang} rc={rc} />
      : onRun ? <window.TransRunView ctx={ctx} lang={lang} slice={slice} />
      : view.mode === 'src' ? (
        <>
          {run ? <window.TransRunStrip job={run} lang={runLang} onOpen={openRun} /> : null}
          <EditView ctx={ctx} trackId={src.id} />
        </>
      )
      : (
        <>
          {run ? <window.TransRunHead job={run} lang={runLang} slice={slice} onCancel={ctx.cancelTrans} /> : null}
          <window.TransEditView ctx={ctx} target={view.lang} cur={lang}
            only={view.mode === 'trans' ? 'trans' : null} />
        </>
      );
    return (
      <div className="pview">
        <div className="panelhd">
          <span className="t-title-sm">字幕</span>
          <span className="grow" />
          <span className="t-detail-xs">{L.label(view, src.name || D.srcLang.name)}</span>
        </div>
        <window.SubStyleEntry ctx={ctx} ops={ops} editId={editId} noCard={onRun} />
        <ListBar ctx={ctx} pref={pref} setPref={setPref} opts={opts} view={view} />
        {body}
        {ops.dialog}
      </div>
    );
  }

  Object.assign(window, {SubtitlePanel});
})();
