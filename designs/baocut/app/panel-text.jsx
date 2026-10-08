/* Text 面板（§13.5，第 142 轮）。选中决定属性页，paneView 承接样式/动画子页。
   字体、字号、颜色分行；时间在高频区，尺寸与旋转渐进展开。
   字符与装饰样式都写逐元素文档；Styles / Animations 视图见 panel-text-design.jsx。
   字体、取色、时间、数值输入均复用 panel-shared.jsx 的 Spectrum 控件。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const P = window.BC_POSE;
  const E = window.BC_EL;
  const B = window.BC_BAR;
  const NO_ANIM = {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}};

  /* 预设库在 `panel-textpreset.jsx`（第 59 轮拆出去）：51 条预设 + 两种目录格版式，
     那一段与这一栏的其余部分没有共享状态，留在这里只会把文件推过 600 行。 */

  /* ---------- Edit text ---------- */
  /* `member` 有值时这一页编的是**文本组里的一条成员**（第 58.1 轮）：返回键回到组视图
     而不是预设库——从哪一层钻进来就回哪一层，否则用户得重新点一遍组才能看第二条成员。
     成员没有自己的摆位与起止（那是组的），所以「变换」不出，「时间」换成它自己的延迟。 */
  function PropsView({ctx, id, kind, pose, st, set, anim, group, member, imgEdit, onStyles, onAnims, onAdjust, onBack, onDelete, onGroup, onAdd}) {
    const app = useApp();
    const [pop, setPop] = useState(null);
    const tg = (k) => setPop(pop === k ? null : k);
    const animOn = !window.BC_TA.isStatic(anim);
    // 图片成员没有字符样式可调（也没有文字动画目录），那几段整段不出
    const img = !!member && member.kind === 'image';
    return (
      <>
        {/* 页头规则（2026-09-24，§13）：返回图标钮 ＋ 左对齐标题；成员页右侧灰字是成员名，
            返回回到组。删除只在页脚那颗红钮。 */}
        <window.PanelHead title={img ? '编辑图片' : '编辑文本'} aside={member ? member.name : null}
          onBack={onBack} backTip={member ? '返回文本组' : '返回文字'} />
        <div className="pscroll bc-scroll text-inspector">
          {group ? (
            <BCAction className="memrow" style={{background: 'var(--blue-100)'}} onClick={onGroup}>
              <span className="mth"><Ic n="elements" className="ic--16" /></span>
              <span className="tt"><b>{group.name}</b><span>属于一个文本组 · {group.n} 个成员</span></span>
              <NavChevron />
            </BCAction>
          ) : null}

          {/* 文字内容是**这个元素自己的**（`elDocs[id].text`）：画布上那一块、时间轴那条
              与这一格读写同一份，改完三处一起变。此前它是一个 `defaultValue` 占位。
              图片成员没有文字，那一格换成它的素材名。 */}
          {img ? (
            /* 图片成员走**图片属性那一份控件**（第 58.2 轮，`panel-image.jsx`）：替换 /
               动画 / 调整 / 圆角 / 不透明度 / 旋转 / 翻转，与图片栏里的整页是同一段代码。
               此前这里只有一行只读的素材名——点进来什么都改不了。 */
            <>
              <window.ImagePreview v={Object.assign({}, imgEdit.v, {name: st.text})} />
              <div className="t-detail" style={{padding: '0 2px 2px'}}>{st.text}</div>
              <window.ImageBody v={imgEdit.v} set={imgEdit.set}
                onAnims={onAnims} onAdjust={onAdjust}
                onReplace={(name) => set({text: name})} />
            </>
          ) : (
            <Field area aria-label="文本内容" value={st.text} onChange={(e) => set({text: e.target.value})} />
          )}

          {img ? null : <>
            <SecHead action={<Btn variant="tertiary" size="s"
              onClick={() => app.toast('文字样式保存：品牌库原型尚未接通此操作')}>保存样式</Btn>}>字体与排版</SecHead>

            <div className="txrow">
              <div style={{flex: '1 1 auto', minWidth: 0, position: 'relative'}}>
                <Picker wide value={String(st.font).split(' ')[0]} open={pop === 'font'} onClick={() => tg('font')} />
                {pop === 'font' ? <FontPicker inline value={st.font} onPick={(n) => { set({font: n}); setPop(null); }} /> : null}
              </div>
              <div style={{flex: 'none', position: 'relative'}}>
                <Picker value={st.size + 'px'} open={pop === 'size'} onClick={() => tg('size')} />
                <Popover open={pop === 'size'} onClose={() => setPop(null)} align="right" dir="down" width={132}>
                  {B.SIZES.indexOf(st.size) < 0
                    ? <div className="mdi is-on"><span className="nm">{st.size}px</span><Ic n="check" className="ic--14" /></div>
                    : null}
                  {B.SIZES.map((sz) => (
                    <BCAction size="M" key={sz} className={cx('mdi', st.size === sz && 'is-on')}
                      onClick={() => { set({size: sz}); setPop(null); }}>
                      <span className="nm">{sz}px</span>
                      {st.size === sz ? <Ic n="check" className="ic--14" /> : null}
                    </BCAction>
                  ))}
                </Popover>
              </div>
            </div>
            <div className="text-control-row" style={{marginTop: 12}}>
              <span>文字颜色</span>
              <ColorField value={st.color} scope="文字" open={pop === 'color'} onToggle={() => tg('color')}
                onPick={(c, live) => { set({color: c}); if (!live) setPop(null); }} inline />
            </div>

            <div className="txrow" style={{marginTop: 8}}>
              <div className="seg">
                <BCAction className={cx('seg__b', st.bold && 'is-on')} style={{fontWeight: 800}}
                  aria-label="加粗" aria-pressed={!!st.bold} onClick={() => set({bold: !st.bold})}>B</BCAction>
                <BCAction className={cx('seg__b', st.italic && 'is-on')} style={{fontStyle: 'italic'}}
                  aria-label="斜体" aria-pressed={!!st.italic} onClick={() => set({italic: !st.italic})}>I</BCAction>
              </div>
              <Segmented value={st.align} onChange={(v) => set({align: v})}
                items={window.BC_EL.ALIGNS} />
              <div style={{position: 'relative', marginLeft: 'auto'}}>
                <div className="seg">
                  <BCAction className={cx('seg__b', pop === 'sp' && 'is-on')} aria-label="行高与字距" onClick={() => tg('sp')}>
                    {/* 行高 / 字距那一组的入口摆 S2 的 `LineHeight` 原件（第 89.2 轮）：
                        此前是通用的「列表」图标——三条等长横线，画的是列表不是行距，
                        而同一枚 `list` 在别处正是「生成章节 / 列表视图」的意思。 */}
                    <Ic n="line-height" className="ic--14" /><Ic n="chevdown" className="ic--14" />
                  </BCAction>
                </div>
                <Popover open={pop === 'sp'} onClose={() => setPop(null)} align="right" dir="down" width={240} className="pop--pad">
                  <ValueRow label="行高" value={st.lineHeight} min={0.8} max={3} step={0.1} onChange={(v) => set({lineHeight: v})} />
                  <ValueRow label="字距" value={st.letterSpacing} min={-5} max={30} onChange={(v) => set({letterSpacing: v})} />
                </Popover>
              </div>
            </div>

            {/* 两枚大按钮：样式 / 动画；图标与画布条子上的那两枚是同一枚 */}
            <div className="txrow" style={{marginTop: 12}}>
              <BCAction className="tbtn" onClick={onStyles}><Ic n="styles" className="ic--16" />样式</BCAction>
              <BCAction className="tbtn" onClick={onAnims}>
                <Ic n="anim" className="ic--16" />动画
                {/* 设过动画的那一枚冒一个蓝点，不整枚变色 */}
                {animOn ? <span className="tbtn__dot" /> : null}
              </BCAction>
            </div>
          </>}

          <SecHead aside={T.timecode(st.tEnd - st.tStart)}>时间</SecHead>
          {member ? (
            /* 成员的起止是**算出来的**：组起点 + 自己的延迟，一直到组的结尾。
               能改的只有延迟——改起止等于把这一条从组里拆出去。 */
            <>
              <div className="sec">
                <ValueRow label="延迟" value={st.delay} min={0} max={2} step={0.01} unit="s"
                  onChange={(v) => set({delay: v})} />
              </div>
              <div className="txtime txtime--ro">
                <Ic n="clock" className="ic--16" style={{color: 'var(--gray-600)'}} />
                <span className="txtime__l">开始</span>
                <span className="t-mono">{T.timecode(st.tStart)}</span>
                <i className="txtime__sep" />
                <span className="txtime__l">结束</span>
                <span className="t-mono">{T.timecode(st.tEnd)}</span>
              </div>
              <div className="hint">起止跟着组走，这里只调它在组里晚多久进场。</div>
            </>
          ) : (
            <div className="txtime">
              <div className="text-time-cell"><span>开始</span>
                <TimeField value={st.tStart} playT={ctx.playT} onChange={(v) => set({tStart: Math.max(0, Math.min(v, st.tEnd - 0.1))})} /></div>
              <div className="text-time-cell"><span>结束</span>
                <TimeField value={st.tEnd} playT={ctx.playT} onChange={(v) => set({tEnd: Math.min(D.DUR, Math.max(v, st.tStart + 0.1))})} /></div>
            </div>
          )}

          {/* 几何段（钉点 + 距边 + 宽；原「尺寸与旋转」折叠段）：文字高度随内容，H 只读；
              纵向钉点原型舞台没有 verticalAlign 可跟，走会话记忆（台账同日一条）。
              成员的摆位归组，不出这一段。 */}
          {member ? null : (
            <window.ElementGeometry ctx={ctx} id={id} kind={kind} pose={pose}
              disabled={window.geometryReadOnly(ctx)}>
              <window.RotateRow v={st} set={set} />
            </window.ElementGeometry>
          )}
          <BCAction className="danger" onClick={onDelete}>
            <Ic n="trash" className="ic--16" />{member ? '从组里删掉' : '删除文本'}
          </BCAction>
          {img ? null : (
            <Btn variant="secondary" icon="plus" style={{width: '100%', marginTop: 8}} onClick={onAdd}>
              添加文本框
            </Btn>
          )}
        </div>
      </>
    );
  }

  /* Styles / Animations 的工作台视图在 panel-text-design.jsx。 */

  /* ---------- 文本组 ---------- */
  function GroupView({ctx, el, onBack, onMember, onDelete}) {
    const app = useApp();
    const [scale, setScale] = useState(100);
    const [stagger, setStagger] = useState(0.13);
    const span = (ctx.elDocs[el ? el.id : ''] || {});
    const tStart = span.start == null ? 30 : span.start;
    const tEnd = span.end == null ? 38 : span.end;
    const setTStart = (v) => ctx.setElDoc(el.id, {start: v});
    const setTEnd = (v) => ctx.setElDoc(el.id, {end: v});
    /* 成员表跟着**这一组**走：时间轴的成员行读同一份（`TL.rows` 优先取 `e.members`），
       两处各写一份错峰值迟早对不上。演示那一组的成员仍在 data.js。 */
    const members = (el && el.members) || D.textGroup.members;
    return (
      <>
        <window.PanelHead title="文本组" aside={`${members.length} 个成员`} onBack={onBack} backTip="返回文字" />
        <div className="pscroll bc-scroll">
          <div className="aicard">
            <b>{(el && el.name) || D.textGroup.preset}</b>
            <span>点一条成员进它自己的属性页，返回键回到这里。整组的起止在下面，成员之间的错峰不变。</span>
          </div>
          <SecHead>成员</SecHead>
          <div className="col">
            {members.map((m) => (
              <BCAction className="memrow" key={m.id} onClick={() => onMember(m)}>
                <span className="mth"><Ic n={m.icon} className="ic--16" /></span>
                <span className="tt"><b>{m.name} · {m.text}</b><span>延迟 {m.delay}s</span></span>
                <NavChevron style={{color: 'var(--gray-500)'}} />
              </BCAction>
            ))}
          </div>
          <SecHead>组</SecHead>
          <div className="sec">
            <ValueRow label="缩放" value={scale} min={20} max={300} unit="%" onChange={setScale} />
            <ValueRow label="入场错峰" value={stagger} min={0} max={1} step={0.01} unit="s" onChange={setStagger} />
          </div>
          <div className="hint">错峰 = 成员依次进场的间隔。</div>
          <SecHead aside={`总长 ${T.timecode(D.DUR, {decimals: 0})}`}>时间</SecHead>
          <div className="sec">
            <PRow label="开始"><div className="push"><TimeField value={tStart} playT={ctx.playT} onChange={setTStart} /></div></PRow>
            <PRow label="结束"><div className="push"><TimeField value={tEnd} playT={ctx.playT} onChange={setTEnd} /></div></PRow>
          </div>
          <div className="hint">改这里 = 整组平移，成员之间的错峰不变。</div>
          <Btn variant="secondary" size="s" style={{width: '100%', marginTop: 12}}
            onClick={() => app.toast('已解组 · 3 个元素恢复独立', 'positive', {label: '撤销', undo: true, run: () => app.toast('已撤销')})}>
            解组
          </Btn>
          <BCAction className="danger" onClick={onDelete}><Ic n="trash" className="ic--16" />删除整组</BCAction>
        </div>
      </>
    );
  }

  const DEMO = 'e-txt';                     // 画布上那一块演示文字（`D.elements` 里的那条）

  function TextPanel({ctx}) {
    const app = useApp();
    const [cat, setCat] = useState('all');
    /* 在哪一页由**选中**决定：点画布或时间轴上的文字元素 → Edit text；选中的是整组 → 组视图；
       选中的是组里的一条成员 → 那条成员自己的属性页；没选中 → 预设库。
       Styles / Animations 是画布也够得着的子页，所以走 `ctx.paneView`。 */
    const selText = ctx.sel && ctx.sel.kind === 'element'
      && (ctx.sel.elKind === 'text' || ctx.sel.elKind === 'textgroup') ? ctx.sel : null;
    /* 成员选中（第 58.1 轮）：时间轴的成员行早就在发 `{kind:'member'}` 了，这一栏此前
       只认 `element`——于是从时间轴点一条成员，右边翻出来的是预设库。 */
    const selMem = ctx.sel && ctx.sel.kind === 'member' ? ctx.sel : null;
    const grp = selMem && ctx.groupOf ? ctx.groupOf(selMem.id) : null;
    const member = grp ? (grp.members || []).filter((m) => m.id === selMem.id)[0] || null : null;
    const sub = ctx.paneView === 'styles' ? 'styles'
      : ctx.paneView === 'anims' ? 'anims'
      : ctx.paneView === 'adjust' ? 'adjust' : 'props';
    const view = member ? sub
      : !selText ? 'add'
      : selText.elKind === 'textgroup' ? 'group' : sub;

    // 这一页编的是**被选中的那一个**（元素或成员），不再是写死的那一块（第 58 轮）
    const ID = member ? member.id : selText ? selText.id : DEMO;
    const el = member ? null : (ctx.elements || []).filter((x) => x.id === ID)[0] || null;
    const inGroup = member ? grp : (el && el.kind === 'textgroup' ? el : null);

    /* 起止与时间轴同一份；位置、容器宽与旋转是画布手柄改的那一份（`pose`，§14.2），
       几何段直接写 pose（宽是画幅宽百分比，与画布同一口径）。原「尺寸与旋转」里那条 880 基准的
       px 容器宽随之退场。
       成员没有这两样：它的起止是组起点 + 自己的延迟（`BC_TL.memberSpan`，与时间轴
       上那一条读同一个函数），摆位归组。 */
    const span = ctx.elDocs[ID] || {};
    const pose = Object.assign({x: 50, y: 18, w: 60, scale: 1, rot: 0}, span.pose);
    const mspan = member ? window.BC_TL.memberSpan(grp, member) : null;
    const stv = Object.assign({}, E.fromStage('text', ctx.elStyleOf(ID)), {
      text: span.text == null ? '本地优先的视频工具' : span.text,
      rot: pose.rot,
      flipX: !!pose.flipX, flipY: !!pose.flipY,
      delay: member ? member.delay || 0 : 0,
      tStart: mspan ? mspan.start : span.start == null ? 0 : span.start,
      tEnd: mspan ? mspan.end : span.end == null ? D.DUR : span.end,
    });
    const set = (patch) => {
      const shared = E.toStage('text', patch);
      if (Object.keys(shared).length) ctx.setElStyle(shared, ID);
      if (patch.text != null) ctx.setElDoc(ID, {text: patch.text});
      if (patch.delay != null) ctx.setElDoc(ID, {delay: patch.delay});
      if (patch.tStart != null) ctx.setElDoc(ID, {start: patch.tStart});
      if (patch.tEnd != null) ctx.setElDoc(ID, {end: patch.tEnd});
      const pp = {};
      ['rot', 'flipX', 'flipY'].forEach((k) => { if (patch[k] != null) pp[k] = patch[k]; });
      if (Object.keys(pp).length) ctx.setElPose(ID, pp);
    };

    // 图片成员的那几项（替换 / 圆角 / 不透明度 / 旋转 / 翻转 / 调整）与图片栏共用
    const imgEdit = window.useImageEdit(ctx, ID);

    /* 点一格 = **在播放头那里造一个元素**（第 58 轮）。此前它只是选中画布上那一块演示
       文字：目录点了半天，时间轴上一条都不多。落点、时长、成员错峰的判据全在纯层
       `BC_EL.newText`，面板只负责把播放头与序号递进去。 */
    const add = (p) => {
      const e = E.newText(p, {playT: ctx.playT, total: ctx.filmEnd, seq: ctx.nextSeq()});
      ctx.addElement(e);
      ctx.setPaneView(null);
      app.toast(`${e.kind === 'textgroup' ? '文本组' : '文本'} · ${T.timecode(e.start)} → ${T.timecode(e.end)}`,
        'positive', {label: '撤销', undo: true, run: () => ctx.removeElement(e.id)});
    };
    /* 撤销把刚删的那一条**原样**放回去（文字、样式、摆位、起止都在 `el` 里），
       不是重新选中一块没删掉的。 */
    const del = () => {
      /* 成员删的是**组里的那一条**：拿掉最后一条时整组一起走（一个没有成员的组
         在画布与时间轴上都是一条什么都不画的空行）。 */
      if (member) {
        const prev = grp.members;
        const last = prev.length <= 1;
        ctx.removeMember(grp, member.id);
        app.toast(last ? '已删除整组 · 那是最后一条成员' : `已从组里删掉「${member.name}」`, 'positive',
          {label: '撤销', undo: true, run: () => {
            if (last) { ctx.restoreElement(grp); return; }
            ctx.setElDoc(grp.id, {members: prev});
            ctx.pick({kind: 'member', id: member.id, member});
          }});
        return;
      }
      const wasGroup = view === 'group';
      ctx.removeElement(ID);
      app.toast(wasGroup ? '已删除整组' : '已删除文本', 'positive',
        el ? {label: '撤销', undo: true, run: () => ctx.restoreElement(el)} : null);
    };
    const backToLib = () => ctx.pick(null);
    // 子页的返回：回这一层自己的属性页（成员的属性页也是一层，不能退回到组）
    const toProps = () => { ctx.setPaneView(null); if (member) return;
      ctx.pick({kind: 'element', id: ID, elKind: 'text'}); };
    const toGroup = () => ctx.pick({kind: 'element', id: inGroup.id, elKind: 'textgroup'});
    /* 点一条成员 = 进它自己的属性页，返回键回到组（第 58.1 轮）。此前图片成员会被
       甩到「图片」面板——那一栏是素材库，没有这条成员的任何属性，是个死胡同。 */
    const drillMember = (m) => {
      ctx.setPaneView(null);
      ctx.pick({kind: 'member', id: m.id, member: m});
    };

    return (
      <div className="pview">
        {view === 'add'    ? <window.TextAddView cat={cat} setCat={setCat} onAdd={add} /> : null}
        {view === 'adjust' ? <window.ImageAdjust v={Object.assign({}, imgEdit.v, {name: stv.text})}
                               set={imgEdit.set} onBack={() => ctx.setPaneView(null)} /> : null}
        {view === 'props'  ? <PropsView ctx={ctx} id={ID} kind={el ? el.kind : 'text'} pose={pose} st={stv} set={set} member={member} imgEdit={imgEdit}
                               anim={(ctx.elDocs[ID] || {}).anim || NO_ANIM}
                               group={inGroup ? {name: inGroup.name, n: (inGroup.members || []).length} : null}
                               onStyles={() => ctx.setPaneView('styles')}
                               onAnims={() => ctx.setPaneView('anims')}
                               onAdjust={() => ctx.setPaneView('adjust')}
                               onBack={member ? toGroup : backToLib} onDelete={del} onAdd={() => add(null)}
                               onGroup={toGroup} /> : null}
        {view === 'styles' ? <window.TextStylesView key={ID} ctx={ctx} id={ID} st={stv} set={set} onBack={toProps} /> : null}
        {view === 'anims'  ? (member && member.kind === 'image' ? (
          <>
            <window.PanelHead title="动画" onBack={toProps} backTip="返回编辑图片" />
            <div className="pscroll bc-scroll">
              <window.AnimSection pick={imgEdit.v.anim || {in: {k: 'none'}, out: {k: 'none'}, loop: {k: 'none'}}}
                setPick={(a) => ctx.setElDoc(ID, {anim: a})} ctx={ctx} peekId={grp ? grp.id : ID} />
            </div>
          </>
        ) : <window.TextAnimsView key={ID} ctx={ctx} id={ID} peekId={grp ? grp.id : ID}
              anim={(ctx.elDocs[ID] || {}).anim || NO_ANIM}
              setAnim={(a) => ctx.setElDoc(ID, {anim: a})}
              onBack={toProps} />) : null}
        {view === 'group'  ? <GroupView ctx={ctx} el={el} onBack={backToLib} onDelete={del}
                               onMember={drillMember} /> : null}
      </div>
    );
  }

  Object.assign(window, {TextPanel});
})();
