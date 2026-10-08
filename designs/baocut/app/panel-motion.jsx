/* 「运动」一组 —— 元素的整段运动（Agent 剪辑工具缺口方案 G11a；数据形状见 model-keyframes.js 文首）。
   挂在元素几何段之下（`ElementGeometry` 的尾巴，不挂在 `GeometryView` 本身上——版面编辑器的模板层
   没有时间轴，不长出这一组）；多选只读时整组不画。

   一行一个属性：起 → 止两个数 + 一个缓动。填了就写 `0%` / `100%` 两帧（缓动写在止帧上，线性不写），
   清空任一格或点行尾 × 就删掉该属性的关键帧；多于两帧或时刻不在两端的只读回显「N 个关键帧 · 清除」，
   改别的属性不碰它（写入只替换那一个属性的数组）。没有帧的属性从组头「添加」菜单加一行草稿，
   两格空着、露出静态值，第一次提交才落盘。

   图片 / 视频静态时盖满画布、运动中露底：先不写，行里回显这一笔，下面给一条提示、「仍然保留」开关与
   「不改了」；打开开关才写，并在这次
   会话里记住这件元素（命令行的 `--allow-uncovered` 是一次性标志，不是文档字段，所以这里不落盘）。 */
(function () {
  const {useState} = React;
  const K = window.BC_KF;
  const P = window.BC_POSE;

  /* 会话内放行露底的元素 id（不落盘；与钉点、锁比同一种会话记忆） */
  const ALLOW = new Set();
  const COVER_KINDS = {image: true, video: true};

  const fmtT = (s) => (Math.round(s * 10) / 10).toFixed(1) + ' s';

  /** 静态值：文档没有关键帧时这一属性取的值（草稿行的 placeholder、另一端的缺省） */
  function staticOf(ctx, id, pose, k) {
    if (k === 'x') return pose.x;
    if (k === 'y') return pose.y;
    if (k === 'scale') return pose.scale || 1;
    if (k === 'rot') return pose.rot || 0;
    if (k === 'opacity') {
      const st = ctx.elStyleOf ? ctx.elStyleOf(id) : null;
      return st && st.opacity != null ? st.opacity / 100 : 1;
    }
    return 0;
  }

  function EaseMenu({value, disabled, onPick}) {
    const [open, setOpen] = useState(false);
    const known = K.EASE_MENU.some((m) => m.k === (value || 'linear'));
    return (
      <Picker size="s" value={K.easeLabel(value)} open={open} disabled={disabled}
        onClick={() => setOpen((v) => !v)} onClose={() => setOpen(false)} popAlign="right" className="kfrow__ease">
        <Menu>
          {K.EASE_MENU.map((m) => (
            <MenuItem key={m.k} label={m.label} check={(value || 'linear') === m.k}
              onClick={() => { setOpen(false); onPick(m.k); }} />
          ))}
          {/* Agent 写进来的其它合法缓动名原样显示、原样保留 */}
          {!known ? <MenuItem label={String(value)} check sub="文档里的缓动，保留" onClick={() => setOpen(false)} /> : null}
        </Menu>
      </Picker>
    );
  }

  /** 起止两帧可编辑的一行（含草稿行：`frames` 为 null） */
  function MotionRow({row, frames, stat, disabled, onEnd, onEase, onClear}) {
    const ui = row.ui || 1;
    const shown = (v) => (v == null ? null : v * ui);
    const back = (v) => v / ui;
    const draft = !frames;
    return (
      <div className={window.cx('kfrow', draft && 'is-draft')}>
        <div className="kfrow__h">
          <span className="lab" title={row.tip}>{row.label}</span>
          <EaseMenu value={frames ? frames[1].ease : null} disabled={disabled || draft}
            onPick={onEase} />
          <IconBtn icon="close" size="s" tip={draft ? '收起这一行' : '清除这一行的运动'}
            disabled={disabled} onClick={onClear} />
        </div>
        <div className="kfrow__f">
          <NumField label="起" value={shown(frames ? frames[0].v : null)} placeholder={String(+(stat * ui).toFixed(row.digits))}
            unit={row.unit} digits={row.digits} step={row.step} min={row.min} max={row.max} disabled={disabled}
            tip={row.label + ' · 起（元素开始时）'}
            onChange={(v) => onEnd(0, back(v))} onEmpty={onClear} />
          <Ic n="fwd" className="ic--14 kfrow__arr" />
          <NumField label="止" value={shown(frames ? frames[1].v : null)} placeholder={String(+(stat * ui).toFixed(row.digits))}
            unit={row.unit} digits={row.digits} step={row.step} min={row.min} max={row.max} disabled={disabled}
            tip={row.label + ' · 止（元素结束时）'}
            onChange={(v) => onEnd(1, back(v))} onEmpty={onClear} />
        </div>
      </div>
    );
  }

  /** 多段关键帧：只读回显 + 清除（Agent 经 `edit apply` 写的逐点运动，界面不逐点编辑） */
  function MultiRow({label, n, disabled, onClear}) {
    return (
      <div className="kfrow kfrow--ro">
        <span className="lab">{label}</span>
        <Ic n="keyframe" className="ic--14 kfrow__kf" />
        <span className="kfrow__n">{n} 个关键帧</span>
        <span className="kfrow__dot">·</span>
        <BCAction type="button" className="kfrow__clr" disabled={disabled} onClick={onClear}>清除</BCAction>
      </div>
    );
  }

  /* 露底判定要的盒子：舞台上量到的像素盒（`ElementGeometry` 的 measure）——静态盒 = 不含关键帧 */
  function coverCheck(kind, id, pose, m, doc, kf) {
    if (!COVER_KINDS[kind] || ALLOW.has(id) || !m) return null;
    const stat = {x: pose.x, y: pose.y, w: m.boxW, h: m.boxH, scale: pose.scale || 1, rot: pose.rot || 0};
    const dur = Math.max(0, (doc.end || 0) - (doc.start || 0));
    return K.uncovered(stat, kf, dur, {w: m.frameW, h: m.frameH});
  }

  function ElementMotion({ctx, id, kind, pose, m}) {
    const doc = (ctx.elDocs || {})[id] || {};
    const kf = doc.keyframes || null;
    const [drafts, setDrafts] = useState([]);
    const [adding, setAdding] = useState(false);
    const [pending, setPending] = useState(null); // {kf, u}：被露底拦下、等「仍然保留」的那一笔
    const caps = P.caps(kind);
    const rows = K.MOTION_ROWS.filter((r) => r.k !== 'rot' || caps.rot);

    const write = (next) => {
      const u = next ? coverCheck(kind, id, pose, m, doc, next) : null;
      if (u) { setPending({kf: next, u}); return; }
      setPending(null);
      ctx.setElDoc(id, {keyframes: next});
    };
    const clearRow = (k) => {
      setDrafts((d) => d.filter((x) => x !== k));
      setPending(null);
      if (K.count(kf, k)) ctx.setElDoc(id, {keyframes: K.clearProp(kf, k)});
    };
    /* 被露底拦下的那一笔先在行里回显（还没写入），接着改也在它上面改 */
    const view = pending ? pending.kf : kf;

    const visible = rows.filter((r) => K.count(kf, r.k) > 0 || K.count(pending && pending.kf, r.k) > 0
      || drafts.indexOf(r.k) >= 0);
    const addable = rows.filter((r) => visible.indexOf(r) < 0);
    /* 没有两帧编辑器的属性（纵向缩放 / 圆角）若被 Agent 写了关键帧，只读回显；音量包络归「声音」一组 */
    const extra = ['scaleY', 'radius'].filter((k) => K.count(kf, k) > 0)
      .concat(rows.every((r) => r.k !== 'rot') && K.count(kf, 'rot') ? ['rot'] : []);

    const addMenu = addable.length ? (
      <Picker size="s" value="添加" icon="plus" open={adding} onClick={() => setAdding((v) => !v)}
        onClose={() => setAdding(false)} popAlign="right">
        <Menu>
          {addable.map((r) => (
            <MenuItem key={r.k} label={r.label} onClick={() => { setAdding(false); setDrafts((d) => d.concat([r.k])); }} />
          ))}
        </Menu>
      </Picker>
    ) : null;

    return (
      <>
        <SecHead aside={visible.length || extra.length ? '起 → 止' : '从元素开始到结束'} action={addMenu}>运动</SecHead>
        <div className="sec kfsec">
          {!visible.length && !extra.length ? (
            <div className="kfsec__empty">没有运动。从「添加」挑一项，填起止两个值。</div>
          ) : null}
          {visible.map((r) => {
            const st = K.rowState(view, r.k);
            const stat = staticOf(ctx, id, pose, r.k);
            if (st === 'multi') {
              return <MultiRow key={r.k} label={r.label} n={K.count(kf, r.k)} onClear={() => clearRow(r.k)} />;
            }
            return (
              <MotionRow key={r.k} row={r} frames={st === 'simple' ? K.framesOf(view, r.k) : null} stat={stat}
                onEnd={(end, v) => write(K.editEnd(view, r.k, end, v, stat))}
                onEase={(e) => write(K.editEase(view, r.k, e, stat))}
                onClear={() => clearRow(r.k)} />
            );
          })}
          {extra.map((k) => (
            <MultiRow key={k} label={K.PROP_LABEL[k]} n={K.count(kf, k)} onClear={() => clearRow(k)} />
          ))}
          {pending ? (
            <div className="hint hint--warn kfsec__warn">
              运动到 {fmtT(pending.u.t)} 时画面开始露底，这一刻差画面短边的 {pending.u.gap}%。它静止时盖满画布，
              运动全程也要盖满。这一笔还没写入。
              <div className="kfsec__warnact">
                <Switch on={false} label="仍然保留" className="kfsec__allow"
                  onChange={() => { ALLOW.add(id); const next = pending.kf; setPending(null); ctx.setElDoc(id, {keyframes: next}); }} />
                <BCAction type="button" className="kfrow__clr" onClick={() => setPending(null)}>不改了</BCAction>
              </div>
            </div>
          ) : null}
          {ALLOW.has(id) && COVER_KINDS[kind] && K.any(kf) ? (
            <div className="kfsec__note">已允许露底（仅这次会话）</div>
          ) : null}
        </div>
      </>
    );
  }

  Object.assign(window, {ElementMotion});
})();
