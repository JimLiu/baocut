/* 画布浮动工具条 · `···` 溢出菜单 —— §14.3。
   分段与词表来自 `BC_BAR`（`model-toolbar.js`）：
   `more` 的每一组是一段，段间一条横分隔线；组里再嵌一层数组就是**一行图标钮**
   （`[['bold','italic'], ['align-left','align-center','align-right']]` = 两行）。
   行尾 `›` 开二级飞出，飞出里才是真控件。 */
(function () {
  const {useState, useRef} = React;
  const D = window.BC_DATA;
  const B = window.BC_BAR;
  const P = window.BC_POSE;
  const T = window.BC_TIME;
  const E = window.BC_EL;

  /* ---------- 二级飞出 ---------- */
  /* Adjust timing 飞出 —— 三行：时长 / 开始 / 结束（第 82 轮做实）。
     此前只有「开始」是真的，而且写在飞出自己的 local state 里——关掉再打开就回去了；
     「时长」与「结束」是两个只读的字。现在三行读写的都是 `ctx.elDocs[id]`，与元素属性页
     的 Timing 段、时间轴上那一条是同一份（第 44 轮「一份真值」那条，这里补上）。
     改时长 = 移动结束（开始不动），与属性页同一条。 */
  function TimingSub({el, ctx, style}) {
    const doc = (ctx.elDocs || {})[el.id] || {};
    const start = doc.start == null ? el.start : doc.start;
    const rawEnd = doc.end == null ? el.end : doc.end;
    const endless = rawEnd == null;              // overlay / vframe：铺到成片结尾
    const end = endless ? D.DUR : rawEnd;
    const write = (patch) => ctx.setElDoc(el.id, patch);
    return (
      /* 点在飞出里不该把飞出关掉：`.msub` 是那一行 `.mpi` 的子节点，click 冒上去正好
         命中它的「开 / 关二级」开关。第 84 轮补这一条 —— 此前点一下时长那个输入框，
         飞出当场消失，三个格子只能用滑杆调，键盘根本进不去。 */
      <div className="msub" style={style} onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>
        <div className="mval">时长
          <div style={{marginLeft: 'auto'}}>
            {/* `pad`：这一行没有播放头钮（时长不是一个时间点），留出那一格
                才能与下面「开始 / 结束」两行的输入框对齐 */}
            <window.TimeField value={Math.max(0, end - start)} pad
              onChange={(v) => write({end: start + Math.max(0.1, v)})} />
          </div>
        </div>
        <div className="mval">开始
          <div style={{marginLeft: 'auto'}}>
            <window.TimeField value={start} playT={ctx.playT}
              onChange={(v) => write({start: Math.min(v, end - 0.1)})} />
          </div>
        </div>
        <div className="mval">结束
          {endless ? <span className="v">视频结尾</span> : (
            <div style={{marginLeft: 'auto'}}>
              <window.TimeField value={end} playT={ctx.playT}
                onChange={(v) => write({end: Math.max(v, start + 0.1)})} />
            </div>
          )}
        </div>
      </div>
    );
  }

  /* 层级飞出。图标按方向分两枚：往前的两行一枚、往后的两行一枚；
     此前四行共用一枚 `elements`，读不出方向。四行与快捷键和 App 的画布「层级」一致
     （F / ⌘↑ / ⌘↓ / B）；落到轨道次序上（timeline-trackorder.jsx `arrangeElement`），
     走到画面与字幕这一叠的最上 / 最下就灰掉。 */
  function OrderSub({el, ctx, style}) {
    const app = useApp();
    const rows = [
      {d: 'front', n: '移到最前', k: 'F', ic: 'layerup'},
      {d: 'forward', n: '前移一层', k: '⌘↑', ic: 'layerup'},
      {d: 'backward', n: '后移一层', k: '⌘↓', ic: 'layerdown'},
      {d: 'back', n: '移到最后', k: 'B', ic: 'layerdown'},
    ];
    return (
      <div className="msub" style={style} onMouseDown={(e) => e.stopPropagation()}>
        {rows.map((r, i) => {
          const off = !window.canArrange(ctx, el.id, r.d);
          return (
            <React.Fragment key={r.n}>
              {/* 往前的两行与往后的两行之间一条线（第 82.1 轮补） */}
              {i === 2 ? <div className="mprule" /> : null}
              <BCAction size="M" disabled={off} className="mpi"
                title={off ? (i < 2 ? '已经在最前面' : '已经在最后面') : undefined}
                onClick={() => !off && window.arrangeElement(ctx, el.id, r.d, app.toast)}>
                <Ic n={r.ic} className="ic--14" />
                <span className="nm">{r.n}</span><i className="kbd">{r.k}</i>
              </BCAction>
            </React.Fragment>
          );
        })}
      </div>
    );
  }

  /* 行高 / 字距 / 不透明度…这一族的飞出：滑杆 ＋ **可输入的数字框**。
     第 44 轮立的规则是「凡是滑杆行，行尾都是可输入的框」，这一处漏了，
     一直是个只读读数。敲的时候不夹，失焦或回车才解析——与 `ValueRow` 同一条。 */
  function ValueSubRow({label, value, min, max, step, unit, onChange}) {
    const [draft, setDraft] = useState(null);
    const commit = () => {
      if (draft === null) return;
      const n = parseFloat(draft);
      setDraft(null);
      if (isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
    };
    return (
      <div className="mval">
        {label ? <span className="mvlab">{label}</span> : null}
        <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
        <Field size="s" className="valin-f t-mono" value={draft === null ? value : draft}
          onChange={(e) => setDraft(e.target.value)} onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { commit(); e.target.blur(); }
            if (e.key === 'Escape') { setDraft(null); e.target.blur(); }
          }} />
        {unit ? <span className="valin-u">{unit}</span> : null}
      </div>
    );
  }

  function ValueSub({value, min, max, step, unit, onChange, style}) {
    return (
      <div className="msub" style={style} onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>
        <ValueSubRow value={value} min={min} max={max} step={step} unit={unit} onChange={onChange} />
      </div>
    );
  }

  /* 「音量档位」的飞出（240 宽、**两行 dB**，不是一根百分比滑杆）。
     两行读写的就是属性页「控制」那两格（`mindb` / `maxdb`），两处同一份值；两根互为
     边界——最小不得越过最大、反之亦然（最小的上界是最大 −1，最大的下界是最小 +1）。
     上下界照属性页那张 `sliders` 表取（−120…0 / −40…60），不放宽到 ±500——
     那么宽的范围摆成滑杆没法用。 */
  function VolumeSub({mindb, maxdb, onChange, style}) {
    const spec = D.elementSpecs.wave.sliders;
    const lo = spec.filter((s) => s.k === 'mindb')[0];
    const hi = spec.filter((s) => s.k === 'maxdb')[0];
    const M = E.SHARED.wave;                     // 写的是共用袋里的键（`waveMinDb` …）
    const rows = [
      {k: M.mindb, name: '最小音量', v: mindb, min: lo.min, max: Math.min(lo.max, maxdb - 1)},
      {k: M.maxdb, name: '最大音量', v: maxdb, min: Math.max(hi.min, mindb + 1), max: hi.max},
    ];
    return (
      <div className="msub" style={style} onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}>
        {rows.map((r) => (
          <ValueSubRow key={r.k} label={r.name} value={r.v} min={r.min} max={r.max} unit="dB"
            onChange={(v) => onChange({[r.k]: v})} />
        ))}
      </div>
    );
  }

  /* ---------- 溢出菜单 ---------- */
  function OverflowMenu({el, kind, pane, ctx, st, set, onClose, anchorRef}) {
    const app = useApp();
    const [sub, setSub] = useState(null);
    const subAnchor = useRef(null);
    /* 智能裁剪是 AI 入口：Web 表面从溢出菜单里拿掉这一条（model-surface.js） */
    const groups = (B.more(kind) || []).map((g) => (window.BC_SURFACE.ai ? g : g.filter((id) => id !== 'crop-video')));
    const num = (k, d) => (st[k] == null ? d : st[k]);
    /* 摆位真相在 `elDocs[id].pose`——画面、属性页的「旋转 / 翻转」、四角手柄读的都是它。
       第 85 轮起这张菜单也写它（此前那四枚图标钮写的是样式袋里的 `fx`/`fy`/`w`/`h`，
       全仓没有一处读，于是点了没反应，「已适应画布」还照报不误）。 */
    const pose = P.poseOf((ctx.elDocs || {})[el.id]);
    const toast = (m, opt) => { onClose(); app.toast(m, opt ? 'positive' : undefined,
      opt ? {label: '撤销', undo: true, run: () => app.toast('已撤销')} : undefined); };

    /* 一行图标钮（`[['bold','italic'], …]`） */
    /* 字符样式那三件（B / I / 三对齐）写的是**这一类自己的画布键**（第 89.1 轮）：
       `set` 收的是画布样式袋的原始键名，而计时的字符样式是 `cntBold` / `cntItalic` /
       `cntAlign`（与文字元素错开，见 `BC_EL.SHARED.counter`）。照原样写 `align` 的话，
       在计时的菜单里点「居右」会去改**文字元素**的对齐——画面上什么都不动，而某条
       还没设过对齐的标题会悄悄跟着变。没有对照表的类型（字幕）恒等回落。 */
    const K = (k) => (E.SHARED[kind] || {})[k] || k;
    const rowBtn = (id) => {
      const it = B.item(id);
      const on = id === 'bold' ? st[K('bold')] : id === 'italic' ? st[K('italic')]
        : id.indexOf('align-') === 0 ? st[K('align')] === id.slice(6)
        // 大小写不是二态：不在「原样」那一档就算生效
        : id === 'case' ? !!st.upper
        : id === 'flip-horizontal' ? !!pose.flipX : id === 'flip-vertical' ? !!pose.flipY : false;
      /* 适应 / 填满画布（`fit-canvas` / `fill-canvas`）：量元素**此刻**在画面上的
         盒子与画面框，倍率交给纯函数 `BC_POSE.fitPose` 算（`model-pose.test.js` 钉住）。
         量出来的比一张逐类型的宽高比表可靠——图片是 62% 高、贴纸看素材、形状看路径。 */
      const fitCanvas = (mode) => {
        const trigger = anchorRef && anchorRef.current;
        const fr = trigger && (trigger.closest('.frame') || trigger.closest('.stage')?.querySelector('.frame'));
        const box = fr && fr.querySelector('[data-el="' + el.id + '"]');
        if (!fr || !box) { toast('画面上找不到这一条，先让它出现在当前时间点'); return; }
        const next = P.fitPose(pose, {w: box.offsetWidth, h: box.offsetHeight},
          {w: fr.clientWidth, h: fr.clientHeight}, mode);
        if (!next) { toast('这一条现在没有可量的尺寸'); return; }
        const prev = {x: pose.x, y: pose.y, w: pose.w};
        ctx.setElPose(el.id, next);
        onClose();
        // 真改了摆位，撤销就得真撤回去——不是再报一句「已撤销」
        app.toast(mode === 'fill' ? '已填满画布（短边贴齐，长边裁出画面）'
          : '已适应画布（长边贴齐，短边留边）', 'positive',
          {label: '撤销', undo: true, run: () => { ctx.setElPose(el.id, prev); app.toast('已撤销'); }});
      };
      const hit = () => {
        if (id === 'bold') set({[K('bold')]: !st[K('bold')]});
        else if (id === 'italic') set({[K('italic')]: !st[K('italic')]});
        else if (id.indexOf('align-') === 0) set({[K('align')]: id.slice(6)});
        /* 大小写是**四档循环**（原样 → 全大写 → 首字母大写 → 全小写 → 原样），
           档位读属性页那一份词表（`D.subtitle.cases`），不是这里再写一遍。
           第 102 轮之前它是单独一段里的一行，按下去只报一句「大小写循环：…」的
           说明——把一个动作画成了一条帮助文本。 */
        else if (id === 'case') {
          const list = D.subtitle.cases;
          const at = Math.max(0, list.findIndex((c) => (c.k || '') === (st.upper || '')));
          const next = list[(at + 1) % list.length];
          set({upper: next.k});
          app.toast('大小写：' + next.name);
        }
        // 镜像写 pose，与属性页那两枚「水平 / 垂直翻转」、画面上的 `scaleX(-1)` 同一份
        else if (id === 'flip-horizontal') ctx.setElPose(el.id, {flipX: !pose.flipX});
        else if (id === 'flip-vertical') ctx.setElPose(el.id, {flipY: !pose.flipY});
        else if (id === 'fit-canvas') fitCanvas('fit');
        else if (id === 'fill-canvas') fitCanvas('fill');
      };
      const style = id === 'bold' ? {fontWeight: 800} : id === 'italic' ? {fontStyle: 'italic'} : null;
      /* 四枚图标钮（第 43 轮）：垂直翻转 · 水平翻转 ·
         适应画布（对角双箭头）· 填满画布（四角括号）。此前后两枚是宽文字钮，
         于是这一段在条子上排成两行、跟前两枚不是一套东西。 */
      const ICON = {'flip-horizontal': 'fliph', 'flip-vertical': 'flipv',
                    'fit-canvas': 'expand', 'fill-canvas': 'fullscreen',
                    // 大小写第 102 轮进这一行，与对齐同簇
                    case: null,
                    /* 三对齐出图标（第 82.1 轮）：此前是「左 / 中 / 右」三个汉字，
                       与同一行的 B / I 两枚字母混在一起，读起来像五个并排的字。 */
                    'align-left': 'align-left', 'align-center': 'align-center',
                    'align-right': 'align-right'};
      /* 大小写那一枚画的是**当前那一档的样张**（`Aa` / `AB` / `Ab` / `ab`），不是
         「大小写」三个字：这一行摆的是图标钮，塞进三个汉字会把整行撑歪；而样张
         顺带把当下是哪一档也说了。 */
      const glyph = id === 'case'
        ? (D.subtitle.cases.find((c) => (c.k || '') === (st.upper || '')) || D.subtitle.cases[0]).demo
        : null;
      return (
        <BCAction key={id} className={cx('mb2', on && 'is-on')} style={style}
          title={it.label} onClick={hit}>
          {ICON[id] ? <Ic n={ICON[id]} className="ic--14" />
            : glyph ? <b style={{fontSize: 12}}>{glyph}</b> : it.label}
        </BCAction>
      );
    };

    // 二级菜单仍保留 DOM 父子关系，顶层绘制让它不受父菜单的滚动裁切。
    const subOf = (id) => (
      id === 'arrange' ? <OrderSub el={el} ctx={ctx} />
      : id === 'adjust-timing' ? <TimingSub el={el} ctx={ctx} />
      /* 行高与字距走 `K()`（第 102 轮）：字幕轨里这两个键叫 `lh` / `spacing`（核心的
         键名），量纲也不同——行高是 **90–200%** 而不是 0.8–3 倍，字距下限是 −10
         （字幕样式目录里最紧的一档换算过来是 −6，卡在 −5 上就调不回它原本的样子）。
         此前这两行照文字元素的键与量纲写死，在字幕的菜单里拉它们等于往元素样式袋里
         写两个没人读的数。 */
      : id === 'line-height' ? (kind === 'subtitle'
        ? <ValueSub value={num(K('lineHeight'), 130)} min={90} max={200} unit="%" onChange={(v) => set({[K('lineHeight')]: v})} />
        : <ValueSub value={st.lineHeight} min={0.8} max={3} step={0.1} onChange={(v) => set({lineHeight: v})} />)
      : id === 'letter-spacing' ? (kind === 'subtitle'
        ? <ValueSub value={num(K('letterSpacing'), 0)} min={-10} max={30} onChange={(v) => set({[K('letterSpacing')]: v})} />
        : <ValueSub value={st.letterSpacing} min={-5} max={30} unit="px" onChange={(v) => set({letterSpacing: v})} />)
      : id === 'opacity' ? <ValueSub value={num('opacity', 100)} min={0} max={100} unit="%" onChange={(v) => set({opacity: v})} />
      /* 圆角飞出：一个开关 ＋ **四格输入 ＋ 中间一枚链条**，不是一根滑杆
         （第 84 轮）。与属性页共用 `window.RoundCorners` 那一份，两处不各写一遍。 */
      : id === 'round-corners' ? (
        <div className="msub msub--pad" onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}>
          <window.RoundCorners v={st} set={set} head />
        </div>
      )
      /* 「音量档位」读写的是**共用样式袋里那两个键**（`waveMinDb` / `waveMaxDb`），
         与属性页「控制」那两格同一份；查不到就回落到当前这一款自己的窗（10 款里
         示波器 / 环形波是 −120 / −10），不是表尾那对兜底的 −80 / 40。 */
      : id === 'volume-levels' ? (() => {
        const cur = E.WAVES.filter((w) => w.k === st[E.SHARED.wave.style])[0] || E.WAVES[0];
        return <VolumeSub mindb={num(E.SHARED.wave.mindb, cur.minDb)}
          maxdb={num(E.SHARED.wave.maxdb, cur.maxDb)} onChange={set} />;
      })()
      : null
    );

    /* 普通行（可能带二级飞出） */
    const Row = ({id}) => {
      // Promotion is offered only when this cue actually has a custom style.
      if (id === 'apply-style-to-global') {
        const tid = (ctx.sel && ctx.sel.trackId) || (window.BC_SUB.tracks(ctx.subStyle)[0] || {}).id;
        if (ctx.subScope !== 'cue' || !ctx.curCue || !tid
          || !window.BC_SUB.overriddenKeys(ctx.subStyle, ctx.curCue.id, tid).length) return null;
      }
      const it = B.item(id);
      const open = sub === id;
      const hasSub = !!it.sub;                     // 飞出本体画在弹层外面，这里只出那枚 ›
      /* 逐枚换过图标（第 82.1 轮）：行高是「双头竖箭头 ＋ 三条文本行」、
         字距是「AV ＋ 双头横箭头」、层级是三张叠纸、属性是两根滑杆——此前这四处
         分别借的是 `list`（三条杠）/ `text`（一个 T）/ `elements`（2×2 网格）/
         `settings`（齿轮），语义都不对。 */
      const icon = {
        copy: 'copy', arrange: 'layers', properties: 'tune', 'adjust-timing': 'clock',
        'text-styles': 'styles', animation: 'anim',
        delete: 'trash', opacity: 'opacity', 'round-corners': 'round-corners', 'line-height': 'line-height',
        'letter-spacing': 'letter-spacing', 'volume-levels': 'audio', 'replace-image': 'upload',
        'replace-video': 'refresh', 'replace-sticker': 'upload', 'crop-video': 'sparkle',
        'detach-audio': 'link', 'save-to-brand-kit': 'brand',
        // 第 84 轮补的三行：滤镜是交叠圆，效果借 AI 星，调整与属性同一枚旋钮
        filters: 'filters', effects: 'sparkle', adjust: 'tune',
        case: 'text', 'apply-style-to-global': 'captions', 'hide-subs': 'eyeoff', disable: 'eyeoff',
      }[id] || 'more';
      const hit = () => {
        if (hasSub) { setSub(open ? null : id); return; }
        if (id === 'delete') {
          onClose();
          ctx.clipboard.remove();                       // 第 115 轮接真删除 + 历史栈
        } else if (id === 'properties') {
          onClose();
          ctx.setTab(pane || 'elements');
          ctx.setPaneHidden(false);
        } else if (id === 'text-styles' || id === 'animation') {
          /* 第 42 轮：菜单里的这两件开的是右面板的子页，与面板上那两个大按钮同一个落点。
             第 84 轮起落点由条子给（`pane`），不再在这里第二次判类型——判两遍就会漂
             （视频那一栏此前根本没进过这张表）。 */
          onClose();
          ctx.setTab(pane || 'elements');
          ctx.setPaneHidden(false);
          ctx.setPaneView(id === 'animation' ? 'anims' : 'styles');
        } else if (id === 'filters' || id === 'effects' || id === 'adjust') {
          /* 三件都开右面板的子页（BaoCut 只有一个面板栏，滤镜与效果收成同一页的
             两个 tab，调整另是一页）。 */
          onClose();
          ctx.setTab(pane || 'elements');
          ctx.setPaneHidden(false);
          ctx.setPaneView(id === 'adjust' ? 'adjust' : id);
        } else if (id === 'replace-sticker') {
          onClose(); ctx.setTab('elements'); ctx.setPaneHidden(false); ctx.setPaneView(null);
        } else if (id === 'hide-subs') { onClose(); ctx.setSubsOn(false); }
        /* 停用片段（v2 的「隐藏」）：画面与导出跳过它，条子随选中框一起消失；在时间线上右键可重新启用。 */
        else if (id === 'disable') toast('已停用这个片段：画面与导出都跳过它，在时间线上右键可重新启用', true);
        else if (id === 'detach-audio') toast('已把这一段的声音分离成独立音频轨', true);
        /* 「应用到所有字幕」在**仅这一条**那一档有第二层意思（第 102 轮）：把这一条
           自己改过的那几项推上去，成为全部字幕的样式，覆盖表随之清空。这正是用户
           调完一条满意之后想做的事——此前那一档下按这一颗只会报一句与覆盖表无关的
           假回执，而画面上那一条仍然是唯一特殊的一条。 */
        else if (id === 'apply-style-to-global') {
          const cue = ctx.curCue;
          const tid = (ctx.sel && ctx.sel.trackId)
            || (window.BC_SUB.tracks(ctx.subStyle)[0] || {}).id;
          const hit = ctx.subScope === 'cue' && cue && tid
            ? window.BC_SUB.overriddenKeys(ctx.subStyle, cue.id, tid) : [];
          if (hit.length) {
            const o = window.BC_SUB.cueOverride(ctx.subStyle, cue.id, tid) || {};
            // 真改了文档，撤销就得真撤回去——不是再报一句「已撤销」（同 fitCanvas 那条）
            const before = window.BC_SUB.byId(ctx.subStyle, tid) || {};
            const prev = {};
            hit.forEach((k) => { prev[k] = before[k]; });
            ctx.setSubTrack(tid, o);
            ctx.clearSubCue(cue.id, tid, null);
            ctx.setSubScope('all');
            onClose();
            app.toast('已把这一条改过的 ' + hit.length + ' 项推给全部 ' + ctx.cues.length + ' 条字幕',
              'positive', {label: '撤销', undo: true, run: () => {
                ctx.setSubTrack(tid, prev);
                ctx.setSubCue(cue.id, tid, o);
                ctx.setSubScope('cue');
                app.toast('已撤销 · 这一条又是它自己的样式了');
              }});
          } else toast('已把这套样式应用到全部 ' + ctx.cues.length + ' 条字幕', true);
        }
        /* 第 115 轮接真剪贴板：造一个偏 2% 的副本并选中它（⌘D 是同一条）。 */
        else if (id === 'copy') { onClose(); ctx.clipboard.duplicate(); }
        /* 第 82 轮放回文字的菜单，第 84.1 轮再放回图片与视频的（用户裁决
           「也放回去」）。条子上仍然没有——第 79 轮那条规则收窄成「条子上不放」。
           **图片与视频这两条真的写一笔**：品牌页第 84.1 轮补了视频 / 图片两节，
           存完切过去看得见那一条。 */
        else if (id === 'save-to-brand-kit') {
          if ((kind === 'video' || kind === 'image') && ctx.saveToBrand) {
            const doc = (ctx.elDocs || {})[el.id] || {};
            const name = doc.asset || el.asset || el.name;
            const isVid = kind === 'video';
            const sec = isVid ? '视频' : '图片';
            // 已经在里面了就照实说一句，不要再报一次「已存到」——那是一句假回执
            const dup = D.brand.media.concat(ctx.brandMedia || [])
              .some((x) => x.kind === kind && x.name === name);
            if (dup) { onClose(); app.toast(`${name} 已经在品牌库的「${sec}」一节里了`); return; }
            const look = isVid ? window.videoSourceOf(name) : window.imageSourceOf(name);
            ctx.saveToBrand({kind, name, meta: (look || {}).meta || null, grad: (look || {}).grad || null});
            toast(`已把 ${name} 存到品牌库 · 在品牌栏的「${sec}」一节`, true);
          } else if (kind === 'subtitle') {
            /* 字幕这一条第 102 轮补进菜单末段。落点是品牌页的「字幕样式」一节——那一节本来就写着「在字幕面板里
               『存为样式』，就会出现在这里」，缺的只是这个入口。 */
            toast('已把当前字幕样式存到品牌库 · 在品牌栏的「字幕样式」一节', true);
          } else toast('已存到 Brand kit · 跨视频可用', true);
        }
        else if (id === 'crop-video') { onClose(); ctx.cropInstance(el.id); }
        else if (id === 'replace-image' || id === 'replace-video') {
          onClose();
          if (id === 'replace-video') ctx.openVideoReplace(el.id);
          else { ctx.setTab('image'); ctx.setPaneHidden(false); }
        } else toast(it.label + '：本轮为骨架');
      };
      return (
        <BCAction size="M" selected={hasSub ? open : undefined} aria-haspopup={hasSub ? "dialog" : undefined}
          aria-expanded={hasSub ? open : undefined} ref={(node) => { if (open) subAnchor.current = node; }}
          className={cx('mpi', open && 'is-on', it.tone === 'neg' && 'mpi--neg')}
          onClick={(e) => { e.stopPropagation(); hit(); }}>
          <Ic n={icon} className="ic--14" />
          <span className="nm">{kind === 'subtitle' ? ({'line-height': 'Line Height', 'letter-spacing': 'Letter Spacing', 'save-to-brand-kit': 'Save to Brand Kit', 'hide-subs': 'Hide', 'apply-style-to-global': 'Apply Style to All Subtitles'}[id] || it.label) : it.label}</span>
          {id === 'delete' ? <i className="kbd">⌫</i> : null}
          {hasSub ? <Ic n="chevright" className="ic--14" /> : null}
        </BCAction>
      );
    };
    // 飞出位置以打开它的那一行为准。
    const openSub = sub ? subOf(sub) : null;
    const videoMenu = kind === 'video' ? B.videoMenuLayout(
      anchorRef?.current?.getBoundingClientRect() || {top: 300, bottom: 332}, window.innerHeight) : null;

    return (
      <Popover open onClose={onClose} anchorRef={anchorRef}
        dir={videoMenu ? videoMenu.dir : 'down'} align={kind === 'video' ? 'right' : 'left'}
        className={cx('mpop bc-scroll', kind === 'video' && 'mpop--video')} width={216}>
        <div className="bc-scroll" style={videoMenu ? {maxHeight: videoMenu.maxHeight, overflowY: 'auto'} : null}>
        {groups.map((g, gi) => (
          <React.Fragment key={gi}>
            {gi ? <div className="mprule" /> : null}
            {B.isRow(g)
              /* 一个 group 就是**一行**，子数组是行内的簇
                 （`[['bold','italic'], ['align-left','align-center','align-right']]`
                 是一行：B I 与三对齐之间只空一档，不换行）。
                 第 82.1 轮之前这里每个子数组各占一行，于是 B/I 与三对齐分成了两行。 */
              ? <div className="mprow">{g.map((row, ri) => (
                <div className="mpgrp" key={ri}>{row.map(rowBtn)}</div>
              ))}</div>
              : g.map((id) => <Row key={id} id={id} />)}
          </React.Fragment>
        ))}
        </div>
        {/* 飞出的宽度由这一层给（里面那枚 `.msub` 的 `width` 被 `cloneElement` 抹成
            `auto`）：默认 200，「音量档位」那一枚 240——
            两行 dB 各要一条名字 ＋ 滑杆 ＋ 数字框，200 里滑杆只剩十来个像素。 */}
        <Popover open={!!openSub} onClose={() => setSub(null)} anchorRef={subAnchor} dir="right"
          width={sub === 'volume-levels' ? 240 : 200}>
          {openSub ? React.cloneElement(openSub, {style: {position: 'static', width: 'auto', padding: 0, boxShadow: 'none'}}) : null}
        </Popover>
      </Popover>
    );
  }

  Object.assign(window, {OverflowMenu, TimingSub, OrderSub, ValueSub, VolumeSub});
})();
