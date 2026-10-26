/* 一行字幕按词画（2026-10-09 从 panel-substyle.jsx 拆出）——画廊缩略图、属性页预览条、
   画布与导出预览四处共用这一个组件，「画布 = 缩略图」只能靠同一段代码兑现。

   两条路：
   - **两轴路**（给了 `aw`）：当前词（`activeWord`，caption-style-model-design §4）＋ 动效
     （`motion`，§5）。这是新文档的主路径：变色 / 底块 / 放大 / 上抬 / 下划线 / 扫色，
     念过与没念到的词各自的状态，入场 / 退场 / 循环三段。
   - **旧路**（只给 `anim`）：十九格目录的取帧表（`BC_SA.frame`），品牌库旧卡与没有
     两轴字段的旧轨仍走它。

   时间有两种口径：
   - **循环**（缩略图、预览条、悬停预览）：共用节拍器，一拍一词，`n + 1` 拍一圈；
     动效挂正向延迟的 CSS 动画，每圈按 `cycle` 重挂一次。
   - **时钟**（画布、导出预览，给了 `clock = {t, dur}`，秒）：所有动画暂停在负延迟上，
     画面是播放头那一刻的确定帧——拖播放头、逐帧都对得上。

   颜色只从涂装与 `activeWord` 来（内联样式 ＋ `--aw-c` 一个变量），关键帧只动
   transform / opacity / filter（app/subtitle-active.css），这里不写任何色值。

   分层涂装（caption-editor-redesign §4）的渐变、纹理与描边链挂在**最内层的文字**上
   （`.aw-t`，读行容器传下来的 `--tx-*`）。凡是给一个词或字换颜色的地方都要连带撤掉填充
   （`ink`），否则渐变字身盖在上面，当前词换的色看不见。

   分页（`page`，§4 `layout.pagination`）：一条 cue 按固定词数分成几页，只画当前词所在的
   那一页，`rows` 再把这一页拆成几行。 */
(function () {
  const WA = window.BC_WA;
  const SA = window.BC_SA;
  const CS = window.BC_CS;

  /* ---------- 共用节拍器 ----------
     画廊里几十张卡共用一个 interval、一个计数，所有订阅者同相位；没人订阅时自己停。
     拍数从 epoch 算（`captionNow` / `captionEpoch`，app/subcaption.jsx 加载时定下），
     与 canvas 那条连续时间线同原点。`prefers-reduced-motion` 下停在第二个词那一帧。 */
  const BEAT_MS = 620;
  const beat = (() => {
    let id = null;
    const subs = new Set();
    const now = () => Math.floor((window.captionNow() - window.captionEpoch) / BEAT_MS);
    return {
      now: now,
      sub(fn) {
        subs.add(fn);
        if (!id) id = setInterval(() => { const t = now(); subs.forEach((f) => f(t)); }, BEAT_MS);
        return () => { subs.delete(fn); if (!subs.size) { clearInterval(id); id = null; } };
      },
    };
  })();
  const REDUCED = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /** 原始拍数；`on` 为假或减少动态时不走表。 */
  function useRawBeat(on) {
    const [t, setT] = React.useState(beat.now());
    React.useEffect(() => { if (on && !REDUCED) return beat.sub(setT); }, [on]);
    return t;
  }

  /** 当前词的下标；`on` 为假时返回 -1。`n` 个词跑 `n + 1` 拍——多出来那一拍是念完之后的
   *  静息，没有它循环回第一个词时看不出「重新开始」。 */
  function useSubBeat(n, on) {
    const t = useRawBeat(on);
    if (!on || !n) return -1;
    if (REDUCED) return Math.min(1, n - 1);
    return t % (n + 1);
  }

  /** 循环口径的一对数：当前词与第几圈（动效按圈重挂）。 */
  function useSubCycle(n, on) {
    const t = useRawBeat(on);
    if (!on || !n) return {cur: -1, cycle: 0};
    if (REDUCED) return {cur: Math.min(1, n - 1), cycle: 0};
    return {cur: t % (n + 1), cycle: Math.floor(t / (n + 1))};
  }

  /** 旧路整行那一档（`group: 'block'`）摆在行上的那一份：签名帧 ＋ 真运动轨。 */
  function lineMotion(anim, cur) {
    const s = SA.lineFrame(anim, cur, REDUCED);
    const run = cur <= 1 && !REDUCED ? SA.motion(anim, BEAT_MS, 'block') : null;
    return run ? Object.assign(s, {animation: run}) : s;
  }

  /** 换色时连带撤掉渐变 / 纹理填充（没装上分层涂装模型时只换色）。 */
  const ink = (c) => (c && window.BC_SURF ? window.BC_SURF.inkVars(c) : null);
  const leaf = (body, key) => <span key={key} className="aw-t">{body}</span>;

  /* 强调词：点选过的词换字体 / 字重 / 色 / 字号（属性页「强调词」那一段） */
  const markStyle = (h) => Object.assign({color: h.color, fontFamily: h.font || 'inherit',
    fontWeight: h.bold ? 800 : 400, fontStyle: h.italic ? 'italic' : 'normal', fontSize: (h.scale || 100) + '%'}, ink(h.color));
  const marked = (highlight, cueId, w, i) => !!(highlight && highlight.on && window.BC_SI.isMarked(highlight, cueId, w, i));

  /* ---------- 旧路 ---------- */
  function LegacyLine({text, anim, cur, plate, highlight, cueId}) {
    const words = React.useMemo(() => WA.split(text), [text]);
    // `blockScaling` 两条把变形原点挪到行心（ui.css 的 `.wd--bs`）：量一次每个词到行心的距离
    const bs = SA.blockScaled(anim);
    const refs = React.useRef([]);
    React.useLayoutEffect(() => {
      if (!bs) return;
      const measure = () => {
        const el = refs.current.filter(Boolean);
        if (!el.length) return;
        const box = el[0].parentElement.getBoundingClientRect();
        const mid = box.left + box.width / 2;
        el.forEach((s) => {
          const r = s.getBoundingClientRect();
          s.style.setProperty('--wa-ox', (mid - (r.left + r.width / 2)).toFixed(1) + 'px');
        });
      };
      measure();
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
    }, [bs, text, anim]);
    if (!SA.hasScope(anim, 'word') && !(highlight && highlight.on)) {
      return plate ? <span style={plate}>{leaf(text)}</span> : leaf(text);
    }
    const run = REDUCED ? null : SA.motion(anim, BEAT_MS, 'word');
    const inner = words.map((w, i) => (
      <React.Fragment key={i}>
        {i ? WA.joint(words[i - 1], w) : ''}
        <span className={cx('wd', bs && 'wd--bs')} ref={(el) => { refs.current[i] = el; }}
          style={Object.assign(SA.frame(anim, i, cur, REDUCED), run && i === cur ? {animation: run} : null)}>
          {window.BC_SI.isMarked(highlight, cueId, w, i) ? <span style={markStyle(highlight)}>{leaf(w)}</span> : leaf(w)}</span>
      </React.Fragment>
    ));
    return plate ? <span style={plate}>{inner}</span> : inner;
  }

  /* ---------- 两轴路 ---------- */
  const EASE = {easeOutQuad: 'cubic-bezier(.25,.46,.45,.94)', easeInQuad: 'cubic-bezier(.55,.085,.68,.53)',
    easeInOutQuad: 'cubic-bezier(.455,.03,.515,.955)', linear: 'linear'};
  const STEPPED = {typewriter: 1, 'typewriter-erase': 1, 'typewriter-cursor': 1};
  const seg = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, {granularity: 'grapheme'}) : null;
  const graphemes = (w) => (seg ? Array.from(seg.segment(w), (s) => s.segment) : Array.from(w));
  const r3 = (x) => Math.round(x * 1000) / 1000;

  /** 一段动效在某个元素上的 CSS：`delay` 秒（相对 cue 起点）。时钟口径暂停在 `delay − t`。 */
  function runCss(stage, e, delay, clock) {
    if (!e || REDUCED) return null;
    const name = 'bc-mo-' + (stage === 'loop' ? 'loop-' : stage === 'out' ? 'out-' : '') + e.preset;
    const dur = Math.max(0.02, e.durationSeconds || 0.3);
    const ease = STEPPED[e.preset] ? 'step-end' : EASE[e.easing] || EASE.easeOutQuad;
    const d = clock ? delay - clock.t : delay;
    const tail = stage === 'loop' ? ' infinite' : ' both';
    const css = {animation: name + ' ' + r3(dur) + 's ' + ease + ' ' + r3(d) + 's' + tail,
      '--mo-k': e.intensity == null ? 1 : e.intensity};
    if (e.tilt) css['--mo-r'] = '-8deg';
    if (clock) css.animationPlayState = 'paused';
    return css;
  }

  /** 一段动效的总时长（含逐个错开）。 */
  const spanOf = (e, count) => (e.durationSeconds || 0) + Math.max(0, count - 1) * (e.staggerSeconds || 0);

  /* 换色的几种模式（caption-editor-redesign §4 补了弹出 / 拉伸 / 发光） */
  const INKED = {color: 1, lift: 1, scale: 1, box: 1, pop: 1, stretch: 1, glow: 1};
  /** 当前那个词的样子（§4.1 的模式之一 ＋ 可选的放大叠加）。 */
  function activeCss(a, box) {
    const s = {};
    const tf = [];
    if (INKED[a.mode] && a.color) Object.assign(s, {color: a.color}, ink(a.color));
    if (a.mode === 'box' && a.box) Object.assign(s, boxCss(a.box));
    if (a.mode === 'lift') tf.push('translateY(' + -(a.lift || 0.22) + 'em)');
    /* 弹出：放大带一点超调（过渡曲线越过 1 再回落），近似「弹性超调入场」的那一下 */
    if (a.mode === 'pop') {
      tf.push('scale(' + (a.scale || 1.22) + ')');
      s.transitionTimingFunction = 'cubic-bezier(.34,1.56,.64,1)';
    }
    /* 拉伸：横向拉宽，左右各让出一点位置（真实渲染按拉伸后的字宽重排，这里是近似） */
    if (a.mode === 'stretch') {
      const k = a.scale || 1.25;
      tf.push('scaleX(' + k + ')');
      s.margin = '0 ' + r3((k - 1) * 0.5) + 'em';
    }
    if (a.mode === 'glow') {
      const g = (a.glow && a.glow.color) || a.color;
      const r = (a.glow && a.glow.radius) || 0.4;
      if (g) s.filter = 'drop-shadow(0 0 ' + r3(r * 0.4) + 'em ' + g + ') drop-shadow(0 0 ' + r3(r) + 'em ' + g + ')';
    }
    if (a.mode === 'underline') {
      s.textDecorationLine = 'underline';
      if (a.color) s.textDecorationColor = a.color;
      s.textDecorationThickness = '0.09em';
      s.textUnderlineOffset = '0.14em';
    }
    const sc = a.mode === 'scale' ? a.scale || 1.15 : a.mode !== 'pop' && a.mode !== 'stretch' && a.scale && a.scale !== 1 ? a.scale : 0;
    if (sc) tf.push('scale(' + sc + ')');
    if (a.tilt) tf.push('rotate(-4deg)');
    if (tf.length) s.transform = tf.join(' ');
    if (box && !(a.mode === 'box' && a.box)) Object.assign(s, {backgroundColor: box.activeColor || box.color});
    return s;
  }

  function boxCss(b) {
    const pad = b.padding || [b.paddingXEm || 0.2, b.paddingYEm || 0.08];
    return {backgroundColor: b.color, borderRadius: (b.radius != null ? b.radius : b.radiusEm || 0) + 'em',
      padding: pad[1] + 'em ' + pad[0] + 'em', margin: '0 ' + -pad[0] + 'em',
      boxDecorationBreak: 'clone', WebkitBoxDecorationBreak: 'clone'};
  }

  /** 念过 / 没念到的词（§4.2）。 */
  function stateCss(a, spoken) {
    const k = spoken ? a.spoken : a.unspoken;
    if (k === 'dim') return {opacity: a.dimOpacity == null ? 0.5 : a.dimOpacity};
    if (k === 'hidden') return {opacity: 0};
    if (k === 'tint') return Object.assign({color: a.spokenColor || a.color}, ink(a.spokenColor || a.color));
    return null;
  }

  /** 两轴路的一行。`cur` 是当前词（−1 = 没有、`≥ n` = 念完）；`clock` 给了就是时钟口径。 */
  function ActiveLine({text, aw, motion, wordBox, cur, cycle, clock, plate, highlight, cueId, next, still, page}) {
    const all = React.useMemo(() => WA.split(text), [text]);
    const a = CS.normActive(aw);
    const m = motion && !still ? motion : null;
    const N = all.length;
    /* 分页：当前词所在那一页（念完停在最后一页，还没开始念时是第一页）。页内下标从 0 起，
       入场的错开与「念到时」的延迟都按页内算——每翻一页，这一页自己从头入场。 */
    const per = page && page.wordsPerPage > 0 && N > page.wordsPerPage ? page.wordsPerPage : 0;
    const pageNo = per ? Math.floor(Math.min(Math.max(cur, 0), N - 1) / per) : 0;
    const p0 = pageNo * per;
    const words = per ? all.slice(p0, p0 + per) : all;
    cur = per && cur >= 0 ? (cur >= N ? words.length : cur - p0) : cur;
    const n = words.length;
    const breaks = page && page.rows && page.rows.length > 1 ? page.rows.reduce((acc, k) => acc.concat((acc[acc.length - 1] || 0) + k), []) : null;
    const plain = a.mode === 'none' && a.spoken === 'keep' && a.unspoken === 'keep' && !m && !wordBox
      && !(highlight && highlight.on) && !per && !breaks;
    if (plain || !n) return plate ? <span style={plate}>{leaf(text)}</span> : leaf(text);

    const wordDur = clock ? (clock.dur > 0 ? clock.dur / N : 0.3) : BEAT_MS / 1000;
    // 时钟口径下这一页从第几秒开始；循环口径每翻一页重挂一次，从 0 算
    const t0 = clock && per ? p0 * wordDur : 0;
    const lastPage = !per || p0 + per >= N;
    const cueDur = clock ? (lastPage ? clock.dur : t0 + n * wordDur) : (n + 1) * wordDur;
    const sweep = a.mode === 'sweep';
    const gUnit = (st) => m && m[st] && m[st].unit === 'grapheme';
    const splitG = sweep || gUnit('in') || gUnit('out') || gUnit('loop');
    const gs = splitG ? words.map(graphemes) : null;
    const gTotal = gs ? gs.reduce((x, g) => x + g.length, 0) : 0;
    let gBase = 0;

    /* 每一段动效该挂在哪一层、延迟多少（§5.2 单位 × 触发） */
    const delayOf = (st, e, i, k, gi) => {
      const stg = e.staggerSeconds || 0;
      if (st === 'out') {
        const total = spanOf(e, e.unit === 'word' ? n : e.unit === 'grapheme' ? gTotal : 1);
        const base = Math.max(clock ? t0 : n * wordDur, cueDur - total - (clock ? 0 : 0.04));
        return base + (e.unit === 'word' ? i * stg : e.unit === 'grapheme' ? gi * stg : 0);
      }
      if (e.trigger === 'spoken') return t0 + i * wordDur + (e.unit === 'grapheme' ? k * stg : 0);
      if (e.unit === 'word') return t0 + i * stg;
      if (e.unit === 'grapheme') return t0 + gi * stg;
      return t0;
    };
    const at = (unit) => (st) => (m && m[st] && (m[st].unit === unit || (unit === 'cue' && m[st].unit === 'line')) ? st : null);
    const layer = (unit, i, k, gi, which) => {
      const st = which === 'out' && !lastPage ? null : at(unit)(which);
      return st ? runCss(st, m[st], st === 'loop' ? (unit === 'cue' ? 0 : (unit === 'word' ? i : gi) * (m.loop.staggerSeconds || 0))
        : delayOf(st, m[st], i, k, gi), clock) : null;
    };

    const progressOf = (i) => (clock ? CS.wordProgress(clock.t, clock.dur, N, i + p0) : 0);
    const inner = words.map((w, i) => {
      const isCur = i === cur;
      const spoken = cur >= 0 && i < cur;
      const st = Object.assign({}, wordBox ? boxCss(wordBox) : null, isCur ? activeCss(a, wordBox) : stateCss(a, spoken));
      if (spoken && sweep) Object.assign(st, {color: a.color}, ink(a.color));
      st.transitionDuration = (a.durationSeconds || 0.16) + 's';
      if (isCur && sweep && a.color) st['--aw-c'] = a.color;
      let body = w;
      if (gs) {
        const g = gs[i];
        const swept = isCur && sweep && clock ? CS.sweptGraphemes(progressOf(i), g.length, a.sweep.unit) : 0;
        const unitWord = sweep && a.sweep.unit === 'word';
        body = g.map((ch, k) => {
          const gi = gBase + k;
          let gst = null;
          if (isCur && sweep) {
            if (clock || REDUCED) gst = k < (REDUCED && !clock ? Math.ceil(g.length / 2) : swept) ? Object.assign({color: a.color}, ink(a.color)) : null;
            else gst = {animation: 'bc-aw-ink 0.01s linear ' + r3(unitWord ? 0 : k * wordDur / g.length) + 's forwards'};
          }
          const gIn = Object.assign({}, layer('grapheme', i, k, gi, 'in'), layer('grapheme', i, k, gi, 'out'));
          const gLoop = layer('grapheme', i, k, gi, 'loop');
          // 每个字自己是最内层：渐变按字铺（填充挂在 `.aw-t` 上，见文件头）
          const core = gLoop ? <span className="aw-g" style={gLoop}>{leaf(ch)}</span> : leaf(ch);
          return gst || Object.keys(gIn).length || gLoop
            ? <span key={k} className="aw-g" style={Object.assign(gIn, gst)}>{core}</span>
            : <React.Fragment key={k}>{core}</React.Fragment>;
        });
        gBase += g.length;
      }
      if (!gs) body = leaf(body);
      if (marked(highlight, cueId, w, i + p0)) body = <span style={markStyle(highlight)}>{body}</span>;
      const guide = isCur && sweep && a.sweep.guide && !REDUCED ? (
        <i className="aw-guide" style={Object.assign({backgroundColor: a.color},
          clock ? {left: r3(progressOf(i) * 100) + '%'} : {animation: 'bc-aw-guide ' + r3(wordDur) + 's linear both'})} />
      ) : null;
      const act = <span className="aw-a" style={st}>{guide}{body}</span>;
      const wl = layer('word', i, 0, 0, 'loop');
      const looped = wl ? <span className="aw-w" style={wl}>{act}</span> : act;
      const wIn = Object.assign({}, layer('word', i, 0, 0, 'in'), layer('word', i, 0, 0, 'out'));
      // 逐行：这一页按 `rows` 在第几个词之后折一行
      const br = i && breaks && breaks.indexOf(i) >= 0;
      return (
        <React.Fragment key={i}>
          {br ? <br /> : i ? WA.joint(words[i - 1], w) : ''}
          {Object.keys(wIn).length ? <span className="aw-w" style={wIn}>{looped}</span> : looped}
        </React.Fragment>
      );
    });
    const lIn = Object.assign({}, layer('cue', 0, 0, 0, 'in'), layer('cue', 0, 0, 0, 'out'));
    const lLoop = layer('cue', 0, 0, 0, 'loop');
    let out = plate ? <span style={plate}>{inner}</span> : <>{inner}</>;
    if (lLoop) out = <span className="aw-ln" style={lLoop}>{out}</span>;
    if (Object.keys(lIn).length) out = <span className="aw-ln" style={lIn}>{out}</span>;
    const preview = next && sweep && a.sweep.nextLine ? <span className="aw-next">{next}</span> : null;
    /* 循环口径每圈换一个 key：入场 / 退场的 CSS 动画从头再跑一遍 */
    return <React.Fragment key={(clock ? 'clock' : 'c' + (cycle || 0)) + 'p' + pageNo}>{out}{preview}</React.Fragment>;
  }

  /** 统一入口：给了 `aw` 走两轴路，否则走旧路（品牌库旧卡、旧轨）。 */
  function WordLine(props) {
    return props.aw ? <ActiveLine {...props} /> : <LegacyLine {...props} />;
  }

  /** 一张卡（或一份涂装）在某个角色上的两轴：目录卡读 `BC_CS` 的正文，品牌库旧卡按 `anim` 查表。 */
  function wordOf(p, role, look) {
    const body = p && CS.byKey(CS.family(p.id));
    if (body && (p.activeWord || !p.anim)) {
      const t = CS.toTrack(body, {role});
      return {aw: t.activeWord, motion: t.motion, wordBox: t.wordBackground, page: t.pagination || null,
        emphasis: role === 'source' ? body.emphasis || null : null};
    }
    /* 带着两轴的卡（品牌库新卡、样式包里的模板卡）：底块与分页也在卡上 */
    if (p && p.activeWord) {
      const box = p.wordBox || (look && look.wordBackground) || null;
      return role === 'source' ? {aw: p.activeWord, motion: p.motion || null, wordBox: box, page: p.pagination || null, emphasis: p.emphasis || null}
        : Object.assign({wordBox: null, page: null, emphasis: null}, CS.forRole({activeWord: p.activeWord, motion: p.motion}, {role}), {aw: CS.normActive({mode: 'none'})});
    }
    const f = CS.fromAnim(role === 'source' ? (p && p.anim) || 'none' : 'none', look && look.activeColor);
    return {aw: f.activeWord, motion: f.motion, wordBox: null};
  }

  /** 一条轨（或这一条 cue 的有效样式）在画面上的两轴；没有两轴字段的旧轨返回 null（走旧路）。 */
  function wordOfTrack(ln, isSrc) {
    if (!ln || !ln.activeWord) return null;
    return isSrc ? {aw: ln.activeWord, motion: ln.motion || null, wordBox: ln.wordBackground || null, page: ln.pagination || null}
      : {aw: CS.normActive({mode: 'none'}), motion: ln.motion || null, wordBox: null, page: null};
  }

  /** 这一份两轴在循环口径下要不要走节拍器。 */
  const wordMoves = (w) => !!w && (CS.moves(w.aw, w.motion) || CS.hasMotion(w.motion) || !!(w.page && w.page.wordsPerPage));

  Object.assign(window, {WordLine, useSubBeat, useSubCycle, subBeatMs: BEAT_MS, subReduced: REDUCED, lineMotion,
    subWordOf: wordOf, subWordOfTrack: wordOfTrack, subWordMoves: wordMoves});
})();
