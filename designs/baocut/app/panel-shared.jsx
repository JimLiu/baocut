/* 面板通用件 —— 跨面板复用的三个「统一件」＋ 排版件。
   第 20.1 / 20.2 轮把取色面板、字体选择框、时间编辑器统一成三个共用件（五个挂点
   共用一份），那是当时花两轮专门做的收敛；这一层就是它们在新载体里的落点。 */
(function () {
  const {useState, useRef, useEffect, useLayoutEffect} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const C = window.BC_COLOR;

  /** 分节头：**左边标题 ＋ 紧跟着的辅助说明，右边一件动作**（第 89 轮定形）。

      三条都是这一轮按参照面板改的：
      1. 动作（查看全部 / 再加一层 / 存为文字样式）此前是塞进标题里或借 `aside` 传的
         一个 `.viewall`——`margin-left: auto` 在 span 里不起作用，于是它贴在标题右边，
         每一处的落点还都不一样。现在它是**第三个具名槽**，靠 `margin-left: auto`
         统一右对齐，二十来个挂点一次改齐。
      2. 标题与辅助说明此前都是 11px（700/gray-600 对 400/gray-500），只差一档字重，
         远看是一行灰字。标题改成 12px/700/gray-900 并去掉 uppercase（中文里那条
         变换本来就不生效，只把英文撑开），说明留 11px/400/gray-500——字号、字重、
         明度三处一起拉开。
      3. `aside` 只放**说明**，不再兼职放按钮。 */
  const SecHead = ({children, aside, action, first}) => (
    <div className={cx('sechead', first && 'first')}>
      <span className="sechead__t">{children}</span>
      {aside ? <span className="aside">{aside}</span> : null}
      {action ? <span className="sechead__a">{action}</span> : null}
    </div>
  );

  const PRow = ({label, children}) => (
    <window.BCControlLabel.Provider value={typeof label === "string" ? label : null}><div className="prow2">
      {label ? <span className="lab">{label}</span> : null}
      {children}
    </div></window.BCControlLabel.Provider>
  );

  /** S2 slider supplies its label, value and keyboard stepping. Exact input lives
      in a native popover, so the row no longer repeats the same value three times.
      Volume may exceed the slider range through its numeric input (product-design §5.1). */
  function ValueRow({label, value, min, max, hardMax, step = 1, unit, extra, onChange}) {
    const S = window.RSP;
    const top = hardMax ?? max;
    const formatOptions = unit === '%' ? {style: 'unit', unit: 'percent'} : undefined;
    return <div className="bc-value-row">
      <S.Slider size="S" label={label} value={Math.min(value, max)} minValue={min} maxValue={max}
        step={step} formatOptions={formatOptions} onChange={onChange} UNSAFE_className="bc-value-row__slider" />
      <S.DialogTrigger>
        <S.ActionButton size="S" isQuiet aria-label={`精确输入${label}`}><S.Icons.Edit /></S.ActionButton>
        <S.Popover placement="bottom end" aria-label={`精确输入${label}`}>
          <div className="bc-value-row__input">
            <S.NumberField label={unit ? `${label}（${unit}）` : label} value={value} minValue={min}
              maxValue={Number.isFinite(top) ? top : undefined} step={step} autoFocus
              onChange={(n) => { if (Number.isFinite(n)) onChange(n); }} />
          </div>
        </S.Popover>
      </S.DialogTrigger>
      {(extra != null || value > max || (unit && unit !== '%')) && <span className="bc-value-row__detail">
        {value > max ? `当前 ${value}${unit || ''} · 滑杆上限 ${max}${unit || ''} · ` : null}{extra ?? unit}
      </span>}
    </div>;
  }

  /* Native S2 color controls share color conversion with the editor model. */

  /* token（`var(--gray-1000)`）→ hex。要读 CSS 变量，所以这一步只能在视图层做；
     值不会变，按 token 名缓存一次。 */
  const HEXCACHE = {};
  function resolveHex(v) {
    const raw = String(v == null ? '' : v);
    const direct = C.normHex(raw);
    if (direct) return direct;
    const token = raw.match(/^var\((--[\w-]+)\)$/);
    if (!token) return '#000000';
    if (!HEXCACHE[raw]) {
      const read = getComputedStyle(document.documentElement).getPropertyValue(token[1]).trim();
      HEXCACHE[raw] = C.normHex(read) || '#000000';
    }
    return HEXCACHE[raw];
  }

  function ColorPanel({value, onPick, scope, clearLabel, allowsAlpha = true}) {
    const S = window.RSP;
    const app = useApp();
    const hex = resolveHex(value);
    const hsv = C.toHsv(hex) || {h: 0, s: 0, v: 0};
    const [rememberedHue, setRememberedHue] = useState(hsv.h);
    const hue = hsv.s > 0.02 && hsv.v > 0.02 ? hsv.h : rememberedHue;
    const alpha = C.alphaOf(value);
    const color = S.parseColor(`hsb(${hue}, ${hsv.s * 100}%, ${hsv.v * 100}%)`).withChannelValue('alpha', alpha / 100);
    const [mode, setMode] = useState('Hex');
    const [draft, setDraft] = useState(null);
    const write = (next) => {
      if (!next) return;
      setRememberedHue(next.toFormat('hsb').getChannelValue('hue'));
      onPick(C.withAlpha(next.toString('hex'), next.getChannelValue('alpha') * 100), true);
    };
    const commit = () => {
      if (draft === null) return;
      const next = C.parseAny(draft, mode);
      setDraft(null);
      if (next) onPick(C.withAlpha(next, alpha), true);
    };
    const pickFromScreen = () => {
      if (!window.EyeDropper) { app.toast('取色器：这个浏览器没有 EyeDropper'); return; }
      new window.EyeDropper().open().then((r) => onPick(C.withAlpha(r.sRGBHex, alpha), true)).catch(() => {});
    };
    const swatches = (colors, label) => <S.ColorSwatchPicker aria-label={label} size="S" density="compact" value={value ? hex : null}
      onChange={(c) => onPick(c.toString('hex'), false)}>
      {colors.map((c) => <S.ColorSwatch key={c} color={c} />)}
    </S.ColorSwatchPicker>;
    return <div className="cpanel" role="group" aria-label={scope ? scope + '颜色' : '颜色'}>
      <S.ColorArea aria-label="饱和度与亮度" colorSpace="hsb" xChannel="saturation" yChannel="brightness"
        value={color} onChange={write} UNSAFE_className="bc-color-area" />
      <S.ColorSlider label="色相" channel="hue" colorSpace="hsb" size="S" value={color} onChange={write} />
      {allowsAlpha && <S.ColorSlider label="不透明度" channel="alpha" size="S" value={color} onChange={write} />}
      <div className="cphex">
        <S.Picker aria-label="颜色格式" size="S" selectedKey={mode} onSelectionChange={(m) => { setMode(m); setDraft(null); }} UNSAFE_className="bc-color-format">
          {C.MODES.map((m) => <S.PickerItem id={m} key={m}>{m}</S.PickerItem>)}
        </S.Picker>
        {mode === 'Hex' ? <S.ColorField aria-label="十六进制颜色" size="S" value={color} onChange={(c) => c && write(c.withChannelValue('alpha', alpha / 100))} UNSAFE_className="bc-color-field" />
          : <Field size="s" aria-label={`${mode}颜色`} className="bc-color-field" value={draft ?? C.format(hex, mode)}
            onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => {
              if (e.key === 'Enter') { commit(); e.target.blur(); }
              if (e.key === 'Escape') { setDraft(null); e.target.blur(); }
            }} />}
        <IconBtn icon="dropper" size="s" tip="从画面上吸一个色" onClick={pickFromScreen} />
      </div>
      <div className="cpsec">品牌色</div>
      {swatches(D.brand.colors, '品牌色')}
      <S.ActionButton size="S" isQuiet onPress={() => app.toast('已存到品牌色 · 全 App 的取色面板都能取到', 'positive')}>
        <Ic n="brand" /><S.Text>存到品牌色</S.Text>
      </S.ActionButton>
      <S.Divider size="S" />
      <div className="cpsec">{scope || '预设颜色'}</div>
      {swatches(D.subtitle.swatches, '预设颜色')}
      {clearLabel && <S.ActionButton size="S" isQuiet onPress={() => onPick(null, false)}><Ic n="color-none" /><S.Text>{clearLabel}</S.Text></S.ActionButton>}
    </div>;
  }

  function ColorField({value, onPick, scope, open, onToggle, inline, clearLabel, allowsAlpha}) {
    const panel = <ColorPanel value={value} onPick={onPick} scope={scope}
      clearLabel={clearLabel} allowsAlpha={allowsAlpha} />;
    return (
      <div style={{position: 'relative', marginLeft: 'auto'}}>
        <BCAction className="colorb" onClick={onToggle}>
          {value ? <i style={{'--swatch-c': value}} /> : <i className="cdot--none" />}
          <b>{value ? String(value).replace('var(--', '').replace(')', '') : (clearLabel || '—')}</b>
        </BCAction>
        <Popover open={open} onClose={onToggle} align="right" dir="down">{panel}</Popover>
      </div>
    );
  }

  /* ---------- 统一字体选择框 ----------
     拆到 panel-font-picker.jsx（按需下载的字体，product-design §5.9）；仍是 `window.FontPicker`，五个挂点不变。 */

  /* ---------- 统一时间编辑器 ----------
     mm:ss.d / hh:mm:ss.d / 裸秒三种都收；非法输入弹回原值（解析在 BC_TIME，有单测）。
     表针钮 = 设为播放头位置。 */
  /* `pad`：这一行没有播放头钮，但同一组里别的行有——留出那 24px,
     否则三行的输入框右缘各在各的位置（`TimingSub` 的「时长 / 开始 / 结束」就是这样）。 */
  function TimeField({value, onChange, playT, size = 's', pad}) {
    const [draft, setDraft] = useState(null);
    const shown = draft != null ? draft : T.timecode(value);
    return (
      <div className="row gap4" style={{flex: 'none'}}>
        <div style={{width: 92}}>
          <Field size={size} className="t-mono" value={shown}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              const v = T.parse(draft);
              setDraft(null);
              if (v != null) onChange(T.clamp(v, D.DUR));
            }} />
        </div>
        {playT != null
          ? <IconBtn icon="clock" size="s" tip="设为播放头位置" onClick={() => onChange(T.clamp(playT, D.DUR))} />
          : pad ? <i className="tfpad" aria-hidden="true" /> : null}
      </div>
    );
  }

  /** 面板头（左标题 / 右动作）。
      属性页与推进来的子页带 `onBack`（2026-09-24 页头规则，§13）：**返回图标钮（不写字，
      tip 写回到哪）＋ 左对齐的本页标题 ＋ 可选右侧灰字 `aside`**。标题写这一页是什么
      （「编辑图片」「动画」），不写上一级的名字；删除类动作不进页头，只在页脚。 */
  const PanelHead = ({title, onBack, backTip, aside, children}) => (
    <div className="panelhd">
      {onBack ? <IconBtn icon="back" size="s" tip={backTip || '返回'} onClick={onBack} /> : null}
      <span className="t-title-sm grow">{title}</span>
      {aside != null && aside !== '' ? <span className="t-detail-xs t-truncate">{aside}</span> : null}
      {children}
    </div>
  );

  /* ---------- ChapterTitle：章节标题就地改名（Transcript 章节头 / AI Tools 章节卡共用） ----------
     App v2 `editor/chapter_edit.rs` + `lists/subtitle.rs::render_chapter_head`：
     单击标签进入输入态，Enter 提交、Esc 取消、失焦按提交处理；空标题不写。
     两个挂点共用一份，是因为「章节名」只有一份真相——两处各写各的，
     迟早出现一处能改一处不能改（前身原型的 AI 卡就只是个 toast）。 */
  function ChapterTitle({chapter, onRename, size = 'lg'}) {
    const [draft, setDraft] = useState(null);
    const commit = (v) => { setDraft(null); if (v != null && v.trim() && v.trim() !== chapter.title) onRename(chapter.id, v); };
    if (draft != null) {
      return (
        <Field className={cx('chtitle chtitle--in', 'chtitle--' + size)} value={draft} autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(e.currentTarget.value); }
            if (e.key === 'Escape') { e.preventDefault(); setDraft(null); }
            e.stopPropagation();
          }}
          onClick={(e) => e.stopPropagation()} />
      );
    }
    return (
      <BCAction className={cx('chtitle', 'chtitle--' + size)} title="点击改名"
        onClick={(e) => { e.stopPropagation(); setDraft(chapter.title); }}>{chapter.title}</BCAction>
    );
  }

  /* ---------- LiveHead：转录运行态头（§13.1；Transcript 与 Subtitle 共用） ----------
     形态跟 Translate Tab 的运行态头同族（§13.3 W6）：标题 + 百分比 + 进度条 +
     计数 + 四段阶段阶梯 + Cancel。转录跑的是音频，所以阶梯换成
     `解码音频 / 识别 / 词级对齐 / 落盘`，计数换成「已转录 mm:ss / mm:ss」。 */
  function LiveHead({job, dur, onCancel}) {
    const app = useApp();
    if (job.origin === 'url' && job.status === 'error') return <div className="livehd">
      <div className="t-title-sm">转录已停止 · 视频已保留</div>
      <p className="t-detail">{job.canceled ? '未完成的转录没有保存。可以从任务详情重新开始。' : '不用重新下载。打开任务详情处理后，继续生成字幕。'}</p>
      {/* Web 表面没有任务页（model-surface.js）：只报状态，处理回 Agent 或 App */}
      {window.BC_SURFACE.pages ? <Btn variant="accent" size="s" onClick={() => app.go({r: 'task', id: job.id})}>查看任务</Btn> : null}
    </div>;
    const cur = window.BC_TX.liveStage(job.pct);
    const at = window.BC_TX.liveAtPct(job.pct, dur);
    /* 第 243 轮：识别做完、结果还在写进视频——标题换成「正在保存转写」，不再给取消
       （真实界面 transcribe-progress 的 writing 态；百分比不再报，识别已经到头）。 */
    const saving = window.BC_TX.liveSaving(job);
    return (
      <div className="livehd">
        <div className="livehd__t">
          {/* product-design §5.1: transcription status, using the native AI loader. */}
          <window.RSP.AI.PixelLoader icon={window.RSP.AI.microphone} size={16} />
          <b className="grow">{saving ? '正在保存转写' : job.origin === 'url' ? job.phase : '转录中'}</b>
          {saving ? null : <span className="t-mono livehd__pct">{Math.round(job.pct)}%</span>}
        </div>
        <div className="livebar"><i style={{width: job.pct + '%'}} /></div>
        <div className="livehd__m">
          <span className="t-mono">已转录 {window.BC_TIME.timecode(at, {decimals: 0})} / {window.BC_TIME.timecode(dur, {decimals: 0})}</span>
          <span className="dot">·</span>
          <span>{job.sub}</span>
        </div>
        <div className="ajstg">
          {window.BC_TX.LIVE_STAGES.map((st, i) => (
            <div key={st} className={cx('ajseg', i < cur && 'is-done', i === cur && 'is-cur')}><i /><em>{st}</em></div>
          ))}
        </div>
        <div className="livehd__a">
          {window.BC_SURFACE.ai && !saving ? <Btn variant="secondary" size="s" onClick={onCancel}>取消转录</Btn> : null}
          <span className="t-detail-xs grow">识别出来的部分会一段一段出现，转录完成后才能编辑。</span>
        </div>
      </div>
    );
  }


  /* ---------- EditableText：单击进正文，光标落在点的那个字上 ----------
     App v2 `lists/transcript.rs` 的口径是**单击**进多行编辑（不是双击），
     并且 `caretClicked` 把落点算到词一级。双击进编辑是表单控件的做法：
     文稿是一篇正在读的文章，读到哪儿改哪儿，多按一次是白按的。

     光标定位靠 `caretIndexFromPoint` 从点击坐标反查字符位置，再放到同一处；
     取不到就退到行尾——退到开头会把光标甩到用户看的地方之外。
     Transcript 段落、Subtitle cue 卡、双语对照卡的每个片段共用这一件：几处是同一种编辑。

     **第 154 轮：编辑态就是阅读态那个元素**（contentEditable），不再换成 textarea。
     textarea 是另一个盒子：在双语两列网格里它的固有宽度会把自己那一列撑宽、把对面挤成
     两三行；在块卡里它是块级的，把行内相接的一句拆成「前一块 / 编辑框 / 后一块」三行——
     用户的原话是「看起来一行，一点两行三行了」。就地编辑没有第二个盒子：字号、行高、换行
     位置、旁边的文字全都不动，只多一圈焦点环。键位：失焦 / ⌘Enter 提交、Esc 取消、
     Tab / ⇧Tab 提交并走到下一格 / 上一格（`onNext(dir)`，由列表决定「下一格」是谁——
     cue 列表是下一条，双语卡是同一行的另一侧、再到下一句）。

     **拆与并（第 155 轮）** 由 `ops` 接进来，三件事都是「光标所在的位置说了算」：
       · Enter：光标在文本**中间**就在这里拆（`ops.split.run(text, at)`），在两端就是提交
         ——与 apps/baocut 的 `cue_edit.rs::enter_key` 同口径；
       · ⌫ 在行首（光标 0、没有选区）：并入上一条（`ops.up.run(text)`）；
       · ⌦ 在行尾：并入下一条（`ops.down.run(text)`）。
     三件事各有一颗按钮，摆在卡头右端（`.edbar`，第 179 轮进入卡头正常布局，窄栏可换行；
     正文仍原位编辑，但不能为了固定卡高而遮住按钮），按钮
     只画图标和它对应的键，名字进 Tip。`ops` 里哪一项是 null 就不画那颗。
     读态单击时 `onBegin(at, len)` 带出光标落点：暂停时卡用它把播放头挪到点中的字。
     `caretAt` 是并条之后把光标放到接缝上用的：没有它，并完光标落在句尾，用户找不到
     刚才那两条是在哪接上的。 */
  function EditableText({value, className, editing, onBegin, onCommit, onCancel, onNext, onHistory, placeholder, ms, cur, shades, ops, caretAt, read}) {
    const ref = useRef(null);
    const caret = useRef(null);
    const nativeRedoTarget = useRef(null);
    const done = useRef(false);   // Esc / Tab / ⌘Enter 之后的 blur 不能再提交一次
    const [head, setHead] = useState(null);
    useLayoutEffect(() => {
      setHead(editing ? ref.current?.closest('.sb')?.querySelector('.sbh') || null : null);
    }, [editing]);
    useEffect(() => {
      const el = ref.current;
      if (!editing || !el) return;
      done.current = false;
      nativeRedoTarget.current = null;
      el.focus();
      const tn = el.firstChild && el.firstChild.nodeType === 3 ? el.firstChild : null;
      const len = tn ? tn.nodeValue.length : 0;
      const want = caret.current == null ? (typeof caretAt === 'number' ? caretAt : len) : caret.current;
      const at = Math.max(0, Math.min(want, len));
      caret.current = null;
      try {
        const r = document.createRange();
        if (tn) r.setStart(tn, at); else r.setStart(el, 0);
        r.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) { /* 定不到位就留在浏览器给的位置，不值得为此中断编辑 */ }
    }, [editing]);
    if (editing) {
      const text = () => (ref.current ? ref.current.innerText : value);
      const finish = (how, dir) => {
        if (done.current) return;
        done.current = true;
        if (how === 'cancel') { onCancel(); return; }
        onCommit(text());
        if (how === 'next' && onNext) onNext(dir);
      };
      /* 光标在编辑框文本里的位置与「有没有选区」——键位判断全看它。
         拿不到选区（焦点不在框里）就当作在末尾，让键回落到浏览器默认行为。 */
      const where = () => {
        const el = ref.current;
        const t = text();
        try {
          const sel = window.getSelection();
          if (!el || !sel || !sel.rangeCount || !el.contains(sel.anchorNode)) return {at: t.length, len: t.length, range: false};
          const r = sel.getRangeAt(0).cloneRange();
          r.setStart(el, 0);
          return {at: r.toString().length, len: t.length, range: !sel.isCollapsed};
        } catch (e) { return {at: t.length, len: t.length, range: false}; }
      };
      /* 受理后由列表重新指定编辑格；显式返回 false 的拒绝不提交、不锁住草稿。
         done 先挡住同步 blur，失败再放开，使下一次失焦仍能正常保存。 */
      const run = (op, withAt) => {
        if (!op || done.current) return;
        const w = where();
        done.current = true;
        const accepted = withAt ? op.run(text(), w.at) : op.run(text());
        if (accepted === false) done.current = false;
      };
      const o = ops || {};
      /* 按不了的那颗（第一条没有上一条、说话人不同）不藏起来：藏了用户不知道这里本来有
         这件事；灰着、悬停说原因（`op.tip`），按键落在它身上时由列表出一句 toast（`op.why`）。 */
      // 图标 + 键的整组参与卡头换行，不在正文上叠一层。
      const btn = (op, kbd, icon) => {
        if (!op) return null;
        const b = (
          <Btn key={op.label} size="xs" variant="secondary" icon={icon} disabled={!!op.off}
            onClick={() => run(op, op === o.split)}><i className="kbd">{kbd}</i></Btn>
        );
        return <Tip key={op.label} label={op.tip ? `${op.label} · ${op.tip}` : op.label}>{b}</Tip>;
      };
      const tryOp = (op, withAt) => { if (op.off) { if (op.why) op.why(); } else run(op, withAt); };
      return (
        <>
          <div ref={ref} className={cx(className, 'edt is-editing')} contentEditable suppressContentEditableWarning
            spellCheck={false} data-ph={placeholder || ''}
            onClick={(e) => e.stopPropagation()}
            onInput={e => {
              const type = e.nativeEvent.inputType;
              if (type !== 'historyUndo' && type !== 'historyRedo') nativeRedoTarget.current = null;
              if (type === 'historyRedo' && text() === nativeRedoTarget.current) nativeRedoTarget.current = null;
            }}
            onBlur={() => finish('commit')}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
              // 草稿有改字时仍交给浏览器的文本撤销；刚拆并后无新草稿则撤整笔结构。
              if (onHistory && (e.metaKey || e.ctrlKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
                const redo = e.shiftKey || e.key.toLowerCase() === 'y';
                if (!redo && text() !== value && nativeRedoTarget.current == null) nativeRedoTarget.current = text();
                // 回到原值也可能仍有可重做的文字；先走完本地重做，不能误跳文档栈。
                if (text() === value && !(redo && nativeRedoTarget.current != null)) {
                  e.preventDefault(); done.current = true; onCancel(); onHistory(redo ? 1 : -1);
                }
                return;
              }
              else if (e.key === 'Escape') { e.preventDefault(); finish('cancel'); }
              else if (e.key === 'Tab') { e.preventDefault(); finish(onNext ? 'next' : 'commit', e.shiftKey ? -1 : 1); }
              else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); finish('commit'); }
              else if (e.key === 'Enter') {
                e.preventDefault();
                const w = where();
                if (o.split && !w.range && w.at > 0 && w.at < w.len) tryOp(o.split, true);
                else finish('commit');
              } else if (e.key === 'Backspace' && o.up) {
                const w = where();
                if (!w.range && w.at === 0) { e.preventDefault(); tryOp(o.up); }
              } else if (e.key === 'Delete' && o.down) {
                const w = where();
                if (!w.range && w.at >= w.len) { e.preventDefault(); tryOp(o.down); }
              }
            }}>{value}</div>
          {head && ops && (o.split || o.up || o.down) ? ReactDOM.createPortal(
            <div className="edbar" onMouseDown={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
              {btn(o.split, '↩', 'split')}{btn(o.up, '⌫', 'chevup')}{btn(o.down, '⌦', 'chevdown')}
            </div>, head
          ) : null}
        </>
      );
    }
    return (
      <div className={cx(className, 'edt')} onClick={(e) => {
        e.stopPropagation();
        const at = caretIndexFromPoint(e.currentTarget, e.clientX, e.clientY);
        caret.current = at;
        // 第 159 轮：把光标位置交给卡——暂停时卡拿它去挪播放头（点哪个字，播放头就到哪个字）
        onBegin(at, String(value == null ? '' : value).length);
      }}>{/* `read`：读态子节点的替代（文稿播放跟随的词元 span，panel-transcript-follow.jsx）；拼起来必须仍是 value */}
        {value ? read || <Hl text={value} ms={ms} cur={cur} shades={shades} /> : <span className="ph">{placeholder}</span>}</div>
    );
  }

  /* ---------- 查找与替换（文稿 / 字幕 / 翻译共用，§13.4） ----------

     三个 Tab 的文本结构不一样（段落 / cue / 对齐卡的两侧），但**查找体验必须是同一件**：
     同一个匹配器（BC_FIND）、同一条查找条、同一套高亮与上一个/下一个。
     参照 designs/baocut-mac 的 `vk-findbar`——它把匹配器收进模型层、三个 Tab 只组合，
     所以 Aa/全词/正则在三处的语义不会各走各的。 */

  const F = window.BC_FIND;

  /** 高亮一段文本。ms 是这段文本自己的匹配区间（UTF-16 偏移），cur 是全局当前命中。
      注意它渲染出的仍是**纯文本节点 + <mark>**，所以 caretIndexFromPoint 的 TreeWalker
      照样能把点击位置换算成整段偏移——高亮和「点哪改哪」不冲突。 */
  function Hl({text, ms, cur, shades}) {
    const s = String(text == null ? '' : text);
    // 搜索命中优先，不拆散跨 cue 的 mark；底纹不插入字符，不影响点击定位。
    const plain = (start, end) => {
      const parts = []; let at = start;
      for (const range of shades || []) {
        const a = Math.max(at, range.start), b = Math.min(end, range.end);
        if (a >= b) continue;
        if (a > at) parts.push(s.slice(at, a));
        parts.push(<span className="cue-shade" key={a}>{s.slice(a, b)}</span>); at = b;
      }
      if (at < end) parts.push(s.slice(at, end));
      return parts;
    };
    if (!ms || !ms.length) return <>{plain(0, s.length)}</>;
    const out = [];
    let last = 0;
    ms.forEach((m, i) => {
      if (m.start > last) out.push(...plain(last, m.start));
      const on = !!cur && cur.key === m.key && cur.start === m.start;
      out.push(
        <mark key={'m' + i} className={cx('hl', m.locked && 'hl--locked', on && 'hl--cur')}
          data-hl-cur={on ? '1' : undefined}>
          {s.slice(m.start, m.end)}
        </mark>);
      last = m.end;
    });
    if (last < s.length) out.push(...plain(last, s.length));
    return <>{out}</>;
  }

  /** 查找状态机。
      items：本次可查找的文本面 [{key, text, ...}]，key 之外的字段会原样带进命中里
             （翻译面板用它记「这条命中在哪一侧」）。
      onReplace(list, rq)：把一批命中落到数据上，返回真正改动的条数。
      replaceOk(match)：这条命中能不能改（文稿的译文列是只读的，归 Translate Tab）。 */
  function useFind({items, onReplace, replaceOk, onJump}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const [rq, setRq] = useState('');
    const [opts, setOpts] = useState({case: false, word: false, regex: false});
    const [idx, setIdx] = useState(0);
    const inputRef = useRef(null);
    const [focusTick, setFocusTick] = useState(0);

    const error = open && q ? F.compile(q, opts).error : null;
    /* 每条命中都带上 locked=「这条改不了」。判据由调用方给（文稿是「跨了 cue
       边界」），但**标注要在渲染之前完成**——不可替换的命中要在用户按下去之前
       就看得出来，而不是按了没反应。 */
    const raw = open && q && !error ? F.collect(items, q, opts) : [];
    const matches = replaceOk ? raw.map((m) => (replaceOk(m) ? m : Object.assign({}, m, {locked: true}))) : raw;
    const cur = F.current(matches, idx);
    /* 0 条时再算一遍放宽的：中文没有空格，「全词」被汉字黏着时天然查不到——
       不说清楚的话用户会一直改关键词，而问题出在开关上。 */
    const relaxed = (open && q && !error && !matches.length && (opts.word || opts.case))
      ? F.collect(items, q, {regex: opts.regex}).length : 0;

    useEffect(() => { setIdx(0); }, [q, opts.case, opts.word, opts.regex]);
    useEffect(() => { if (open && inputRef.current) inputRef.current.focus(); }, [open, focusTick]);
    // ⌘F / Ctrl+F：一次只挂载一个面板，所以这里不会跟别的 Tab 抢
    useEffect(() => {
      const h = (e) => {
        if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
          e.preventDefault();
          setOpen(true);
          setFocusTick((t) => t + 1);
        }
      };
      window.addEventListener('keydown', h);
      return () => window.removeEventListener('keydown', h);
    }, []);
    // 当前命中滚进视野——滚的是命中区间本身，不是它所在的那张卡
    useEffect(() => {
      if (!cur) return;
      const el = document.querySelector('[data-hl-cur]');
      if (el) el.scrollIntoView({block: 'center', inline: 'nearest'});
      if (onJump) onJump(cur);
    }, [cur && (cur.key + ':' + cur.start)]);

    const go = (dir) => setIdx((i) => F.step(i, matches.length, dir));
    const close = () => { setOpen(false); setIdx(0); };
    const canReplace = (m) => !!m && !m.locked;
    const doReplace = (list, receipt) => {
      const use = list.filter(canReplace);
      if (!use.length) return;
      const n = onReplace(use, rq);
      if (!receipt) return;
      if (n) app.toast(`已替换 ${n} 处`, 'positive', {label: '撤销', undo: true, run: () => app.toast('已撤销')});
      else app.toast('没有需要改动的匹配', 'neutral');
    };
    /* 替换单条之后往前走一格。
       「往前」不是无脑 +1：替换文本里如果还含着查询词（把「苏黎」换成「苏黎老师」），
       原地会重新变成一条命中，不跳就会在同一个位置反复替换；换成别的词时这条命中直接
       消失，序号原地不动就已经指向下一条了。所以要跳的格数 = 替换文本自己命中的条数。 */
    const replaceCur = () => {
      if (!canReplace(cur)) return;
      const self = F.ranges(rq, q, opts).length;
      doReplace([cur], false);
      if (self && matches.length) setIdx((i) => (i + self) % matches.length);
    };

    return {
      open, setOpen: (v) => { setOpen(v); if (v) setFocusTick((t) => t + 1); }, close,
      q, setQ, rq, setRq, opts, setOpts, idx, matches, cur, error, relaxed, inputRef,
      byKey: F.byKey(matches), go, canReplace,
      // 「全部」按**能改的**条数亮，不按总命中数——双语视图下命中可能全在译文那一列，
      // 那时候按钮该是灰的，而不是点下去什么都不发生
      replaceable: matches.filter(canReplace).length,
      replaceCur,
      replaceAll: () => doReplace(matches, true),
      // 换范围 / 换语言之后命中表整个换了一批，序号要归零
      reset: () => setIdx(0),
    };
  }

  /** 查找条。两行：查找 + 导航 / 替换 + 匹配选项。extra 给翻译面板挂替换范围选择器。 */
  function FindBar({find, placeholder, extra, hint}) {
    const f = find;
    if (!f.open) return null;
    const n = f.matches.length;
    const count = f.error ? '正则无效' : !f.q ? '' : n ? (Math.min(f.idx, n - 1) + 1) + ' / ' + n : '无结果';
    const opt = (k, label, tip) => (
      <BCAction key={k} type="button" title={tip} aria-pressed={f.opts[k] ? 'true' : 'false'}
        className={cx('findbar__opt', f.opts[k] && 'is-on')}
        onClick={() => f.setOpts((o) => Object.assign({}, o, {[k]: !o[k]}))}>{label}</BCAction>
    );
    const canCur = f.canReplace(f.cur);
    return (
      <div className="findbar">
        <div className="findbar__row">
          <Field size="s" icon="search" inputRef={f.inputRef} placeholder={placeholder || '查找'}
            value={f.q} invalid={!!f.error} aria-label="查找"
            onChange={(e) => f.setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); f.go(e.shiftKey ? -1 : 1); }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); f.close(); }
            }} />
          <span className={cx('findbar__count t-mono', f.error && 'is-bad')}>{count}</span>
          <IconBtn icon="chevup" size="s" tip="上一个 · ⇧Enter" disabled={!n} onClick={() => f.go(-1)} />
          <IconBtn icon="chevdown" size="s" tip="下一个 · Enter" disabled={!n} onClick={() => f.go(1)} />
          <IconBtn icon="close" size="s" tip="关闭查找 · Esc" onClick={f.close} />
        </div>
        <div className="findbar__row">
          <Field size="s" placeholder="替换为" value={f.rq} aria-label="替换为"
            onChange={(e) => f.setRq(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); f.close(); } }} />
          {extra}
          <div className="findbar__opts">
            {opt('case', 'Aa', '区分大小写')}
            {opt('word', '全词', '全词匹配')}
            {opt('regex', '.*', '正则表达式 · 替换文本按字面插入，不解析 $1')}
          </div>
          <Btn size="s" variant="secondary" disabled={!canCur} onClick={f.replaceCur}>替换</Btn>
          <Btn size="s" variant="secondary" disabled={!f.replaceable} onClick={f.replaceAll}>全部</Btn>
        </div>
        {f.error ? (
          <div className="findbar__note is-bad">
            <Ic n="alert" className="ic--14" />
            {/* 引擎的原文是英文，但它是唯一说得清哪里写错的东西——前面加一句中文，
                别让它看起来像程序崩了 */}
            <span>正则写错了：{f.error}</span>
          </div>)
          : f.relaxed ? (
            <BCAction className="findbar__note findbar__note--act"
              onClick={() => f.setOpts((o) => Object.assign({}, o, {case: false, word: false}))}>
              <Ic n="info" className="ic--14" />
              关掉 Aa / 全词有 {f.relaxed} 条——中文没有空格，词被别的字黏着时全词匹配查不到
            </BCAction>
          ) : hint ? <div className="findbar__note"><Ic n="info" className="ic--14" />{hint}</div> : null}
      </div>
    );
  }

  /** 文本覆盖表：原型的正文是常量，替换/改写要看得见就得有一层可写的覆盖。
      key → 改写后的文本；没有条目就落回原文。snapshot/restore 撑起「撤销」。 */
  /* ---------- AI 收据条（§15.1 三态的第三态） ----------
     绿条「已应用 · 摘要 · 耗时 · 模型」+ 撤销 / 再跑一次 / 完成；撤销后转灰条。
     两处用它：AI 工具的 flow 页，以及**翻译 Tab 跑完之后**——一次 AI run 收尾
     一定要留下可撤销的出口，只弹一条会自己消失的 toast 不算数。 */
  /* 三颗动作**自成一行**，不跟文案挤在一起换行：撤销一旦飘到右上角，就会挨着 ×，
     一颗「移除 42 句译文」和一颗「关掉横幅」隔着几个像素，迟早点错。
     撤销之后那颗位置换成「恢复」——反向出口必须就在原地，
     误点了撤销的人不该只剩「再跑一次」这条要重新花钱的路。 */
  const Receipt = ({text, onUndo, onRedo, onAgain, onDone, undone}) => (
    <div className={cx('aplbar', undone && 'aplbar--undone')}>
      <div className="aplbar__msg">
        {undone ? null : <Ic n="ok" className="ic--16" style={{color: 'var(--green-1100)'}} />}
        <b>{text}</b>
      </div>
      <div className="aplbar__acts">
        {undone
          ? <BCAction className="ccbtn ccbtn--redo" onClick={onRedo}>恢复</BCAction>
          : <BCAction className="ccbtn ccbtn--undo" onClick={onUndo}>撤销</BCAction>}
        {/* 「再跑一次」是 AI 入口：Web 表面的收据只留撤销 / 重做 / 完成（model-surface.js） */}
        {window.BC_SURFACE.ai ? <BCAction className="ccbtn" onClick={onAgain}>再跑一次</BCAction> : null}
        <Btn variant="accent" size="s" onClick={onDone}>完成</Btn>
      </div>
      {/* × 与「完成」同一个动作：收起这条横幅。有些人不会把「完成」读成「关掉它」 */}
      <BCAction className="aplbar__x" onClick={onDone} aria-label="关闭">
        <Ic n="close" className="ic--14" />
      </BCAction>
    </div>
  );

  function useTextEdits(controlled) {
    const [local, setLocal] = useState({});
    const ov = controlled ? controlled.value : local;
    const setOv = controlled ? update => controlled.onChange(typeof update === 'function' ? update(ov) : update) : setLocal;
    return {
      get: (key, fallback) => (key in ov ? ov[key] : fallback),
      has: (key) => key in ov,
      put: (patch) => setOv((prev) => Object.assign({}, prev, patch)),
      // 结构改了（拆行 / 并句）之后这几把 key 指的已经不是原来那一格，整批抹掉
      drop: (keys) => setOv((prev) => { const n = Object.assign({}, prev); keys.forEach((k) => { delete n[k]; }); return n; }),
      snapshot: () => ov,
      restore: (snap) => setOv(snap),
    };
  }

  /* ---------- 悬停预览的两只手（第 51 轮，全局一条） ----------
     摊在一个 helper 里，是因为这条交互要**处处一样**：鼠标移上去画面立刻是那个样子，
     移开就回来，不写文档、不进历史、不弹 toast——用户还没做决定。

     `kind` 决定画布拿它去改哪一份文档（`ctx.peekOf`）；`apply` 是一个纯函数
     `(doc) => doc'`，与真正落笔用的是**同一段代码**——预览要是自己算一遍，松开鼠标
     那一刻画面就会跳，而那一跳正好发生在用户判断「是不是我要的」的时候。

     `win`（第 122 轮）是可选的**播放窗口**：给了它，编辑器就把这一次悬停演成一段真播放
     （播放头 seek 到窗口起点、静音、循环，见 editor-preview.jsx）——动画那一类必须这样，
     「弹出」与「弹入」静止时长得一模一样。样式那一类不给窗口，仍旧只是一张静止的画。 */
  function peekProps(ctx, kind, apply, win) {
    return {
      onMouseEnter: () => ctx.setPeek({kind, apply, win: win || null}),
      onMouseLeave: () => ctx.setPeek(null),
    };
  }

  Object.assign(window, {
    peekProps, SecHead, PRow, ValueRow, ColorPanel, ColorField, TimeField, PanelHead, ChapterTitle, LiveHead, EditableText, Hl, FindBar, useFind, useTextEdits, Receipt});
})();
