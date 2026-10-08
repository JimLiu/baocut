/* 字幕属性页里「倒鸭子」那一段 —— 设计稿 §3.3 的面板规格。

   源语言轨带 `kinetic` 时（画廊「倒鸭子」那张卡落下去），属性页的文字 / 描边 / 阴影 /
   底板四段让位（canvas 不读它们），换成这一段：预设、动感、配色、换一版，一节「镜头与
   排版」，一节「主角词与断段」（阶段 C 的实例记录），一节「调整布局」（固定块）。

   写路径只有一条：`ctx.setSubTrack(track.id, {kinetic})`——`kinetic` 是**整条轨**的
   （跨句的东西没有「仅这一条」可言），不走 cue 覆盖表；`BC_SUB.CUE_KEYS` 里也没有它。
   每一笔都是 deepMerge 出来的新对象，撤销走编辑器现成的历史。 */
(function () {
  const DZ = window.BC_DZ;
  const WA = window.BC_WA;

  const pct = (v) => Math.round(v * 100);

  function DaoyaziProps({ctx, track, cue, first, aside}) {
    const app = useApp();
    const kin = track.kinetic;
    const [scope, setScope] = React.useState('track');
    const set = (patch, continuous) => ctx.setSubTrack(track.id, {kinetic: DZ.deepMerge(kin, patch)},
      continuous ? 'subtitle:' + track.id + ':kinetic:' + Object.keys(patch).join(',') : null);

    /* 面板自己也编译一份计划：换一版的「当前动画段」要知道播放头落在哪一段，检视行
       要印段数与诊断。画幅按舞台当下的比例；量宽用模型的默认量尺（面板不量字）。 */
    const rv = window.BC_LAYOUT.ratioValue(ctx.ratio);
    const aspect = typeof rv === 'number' && rv > 0 ? {w: rv, h: 1} : {w: 16, h: 9};
    const bilingual = !!window.BC_SUB.stackOrder(ctx.subStyle);
    const plan = React.useMemo(() => DZ.planFor(ctx.cues, kin, {
      aspect, split: WA.split, highlight: track.highlight, bilingual, duration: ctx.duration,
    }), [ctx.cues, kin, aspect.w, track.highlight, bilingual]);
    const seqIdx = DZ.seqIndexAt(plan, ctx.playT);
    const seq = seqIdx >= 0 ? plan.sequences[seqIdx] : null;

    const reseed = () => {
      if (scope === 'sequence' && seq) {
        const seqSeeds = Object.assign({}, kin.seqSeeds, {[seq.key]: ((kin.seqSeeds || {})[seq.key] || 0) + 1});
        set({seqSeeds});
        app.toast('已给这一段换了一版 · 其余段不动');
      } else {
        set({seed: DZ.reseed(kin.seed)});
        app.toast('已换一版 · 种子 ' + DZ.reseed(kin.seed));
      }
    };

    const light = kin.preset === 'light';
    const palettes = DZ.PALETTES;
    const cueText = cue ? (ctx.cueText ? ctx.cueText(cue.id) : cue.text) : '';
    const heroes = (cue && kin.heroes[cue.id]) || [];
    const toggleHero = (i) => {
      const list = heroes.indexOf(i) >= 0 ? heroes.filter((x) => x !== i) : heroes.concat(i).sort((a, b) => a - b);
      const next = Object.assign({}, kin.heroes);
      if (list.length) next[cue.id] = list; else delete next[cue.id];
      set({heroes: next});
    };
    const breakHere = !!(cue && kin.breaks.indexOf(cue.id) >= 0);
    const toggleBreak = (on) => set({breaks: on ? kin.breaks.concat(cue.id) : kin.breaks.filter((id) => id !== cue.id)});

    const edit = ctx.kineticEdit;
    const pinned = Object.keys(kin.pins || {});
    const motion = kin.camera.motion === 'stopAndGo' ? 'stopAndGo' : 'smooth';
    const selected = edit && edit.selectedKey;
    const selPinned = selected && kin.pins[selected];
    const rotateSelected = () => {
      const block = plan.sequences.flatMap((s) => s.blocks).find((b) => b.key === selected);
      if (!block) return;
      const cur = kin.pins[selected] || {center: block.localCenter, rotDeg: block.rotDeg};
      set({pins: Object.assign({}, kin.pins, {[selected]: {center: cur.center, rotDeg: (cur.rotDeg + 90) % 360}})});
    };
    const togglePin = () => {
      const block = plan.sequences.flatMap((s) => s.blocks).find((b) => b.key === selected);
      if (!block) return;
      const pins = Object.assign({}, kin.pins);
      if (selPinned) delete pins[selected]; else pins[selected] = {center: block.localCenter, rotDeg: block.rotDeg};
      set({pins});
    };

    return (
      <React.Fragment>
        <SecHead first={first} aside={aside}>倒鸭子</SecHead>
        <div className="sec">
          <PRow label="预设">
            <Segmented size="s" value={kin.preset} onChange={(v) => set({preset: v})}
              items={[{k: 'standard', label: '标准'}, {k: 'light', label: '轻动感'}]} />
          </PRow>
          <ValueRow label="动感" value={light ? Math.min(kin.intensity, 40) : kin.intensity} min={0} max={light ? 40 : 100} unit="" onChange={(v) => set({intensity: v}, true)} />
          <PRow label="配色">
            <BCChoiceGroup className="dzsws" value={kin.paletteIdx} onChange={paletteIdx => set({paletteIdx})} aria-label="配色">
              {palettes.map((p, i) => (
                <BCAction key={p.id} type="button" choiceKey={i}  aria-label={p.name} title={p.name}
                  className={cx('dzsw', kin.paletteIdx === i && 'is-on')}
                  style={{background: 'linear-gradient(135deg, ' + p.accent + ' 0 50%, ' + p.secondary + ' 50% 100%)', boxShadow: 'inset 0 0 0 3px ' + p.primary}}
                   />
              ))}
            </BCChoiceGroup>
          </PRow>
          <PRow label="布局">
            <Btn size="s" variant="secondary" onClick={reseed}>换一版</Btn>
            <span className="t-detail-xs dzseed">种子 {kin.seed}{seq && (kin.seqSeeds || {})[seq.key] ? ' · 本段 +' + kin.seqSeeds[seq.key] : ''}</span>
          </PRow>
          <PRow label="换给">
            <Segmented size="s" value={scope} onChange={setScope}
              items={[{k: 'track', label: '整轨'}, {k: 'sequence', label: '当前动画段'}]} />
          </PRow>
          <p className="hint">{scope === 'track' ? '换一版改整轨的种子，每一段都重排。' : '只改播放头所在动画段的种子，写进该段的实例记录。'}</p>
        </div>

        <SecHead aside={plan.aspectKind === 'vertical' ? '竖版' : plan.aspectKind === 'square' ? '方版' : '横版'}>镜头与排版</SecHead>
        <div className="sec">
          <PRow label="旋转">
            <Segmented size="s" value={kin.camera.maxTurnDeg === 0 || light ? 'none' : 'turn'} onChange={(v) => set({camera: {maxTurnDeg: v === 'none' ? 0 : 90}})}
              items={[{k: 'none', label: '不旋转'}, {k: 'turn', label: '直角转向'}]} />
          </PRow>
          {light ? <p className="hint">轻动感不旋转、停留更久，动感最高 40。</p> : null}
          <PRow label="镜头运动">
            <Segmented size="s" value={motion} onChange={(v) => set({camera: {motion: v}})}
              items={[{k: 'smooth', label: '平滑'}, {k: 'stopAndGo', label: '停走'}]} />
          </PRow>
          <p className="hint">{motion === 'smooth' ? '镜头在两句之间一直在飞，到达时正好开口。' : '镜头停在当前行上，下一行开口前一小段才挪过去。'}</p>
          <ValueRow label="镜头速度" value={kin.speed} min={0.5} max={2} step={0.1} unit="×" onChange={(v) => set({speed: Math.round(v * 10) / 10}, true)} />
          {motion === 'smooth'
            ? <ValueRow label="镜头停留" value={pct(kin.camera.dwell == null ? (light ? 0.35 : 0.25) : kin.camera.dwell)} min={0} max={60} step={5} unit="%" onChange={(v) => set({camera: {dwell: v / 100}}, true)} />
            : <ValueRow label="镜头提前量" value={pct(kin.camera.anticipation)} min={0} max={100} step={5} unit="%" onChange={(v) => set({camera: {anticipation: v / 100}}, true)} />}
          <ValueRow label="文字占屏" value={pct(kin.fit == null ? plan.fit : kin.fit)} min={50} max={95} unit="%" onChange={(v) => set({fit: v / 100}, true)} />
          <ValueRow label="文字密度" value={pct(kin.density == null ? plan.density : kin.density)} min={30} max={100} step={5} unit="%" onChange={(v) => set({density: v / 100}, true)} />
          <PRow label="逐词出现"><Switch on={kin.reveal === 'word'} onChange={(v) => set({reveal: v ? 'word' : 'block'})} label={kin.reveal === 'word' ? '一个词一个词冒出来' : '整块一起出现'} /></PRow>
          <ValueRow label="历史文字" value={kin.presentation.history.maxBlocks} min={0} max={12} unit=" 行" onChange={(v) => set({presentation: {history: {maxBlocks: v}}}, true)} />
          <ValueRow label="历史透明度" value={pct(kin.presentation.history.opacity)} min={0} max={100} step={5} unit="%" onChange={(v) => set({presentation: {history: {opacity: v / 100}}}, true)} />
          <PRow label="字幕区域">
            <Segmented size="s" value={kin.viewportMode} onChange={(v) => set({viewportMode: v})}
              items={[{k: 'center', label: '居中'}, {k: 'bottom', label: '下方'}, {k: 'full', label: '全画面'}]} />
          </PRow>
          <PRow label="背景">
            <Segmented size="s" value={kin.presentation.mode} onChange={(v) => set({presentation: {mode: v}})}
              items={[{k: 'overlay', label: '透明'}, {k: 'stage', label: '纯色'}]} />
          </PRow>
          {kin.presentation.mode === 'stage' ? <p className="hint">纯色底只盖住字幕区域里的画面，不删素材、不改声音。</p> : null}
          <PRow label="段落结束">
            <Segmented size="s" value={kin.presentation.ending} onChange={(v) => set({presentation: {ending: v}})}
              items={[{k: 'hold', label: '停住'}, {k: 'overviewIfRoom', label: '有空余时拉远'}]} />
          </PRow>
        </div>

        <SecHead aside={cue ? '当前这一条' : null}>主角词与断段</SecHead>
        <div className="sec">
          <p className="hint">点一个词做主角：它独占一行、字号 1.5 倍。强调词在上面「强调词」那一段选，两者可以同时有。</p>
          <div className="subprops__words" aria-label="选择主角词">
            {cue ? WA.split(cueText).map((word, i) => (
              <BCAction key={i} className={cx('subprops__word', heroes.indexOf(i) >= 0 && 'is-on')}
                aria-pressed={heroes.indexOf(i) >= 0} onClick={() => toggleHero(i)}>{word}</BCAction>
            )) : <span className="hint">先将播放头移到一条字幕上。</span>}
          </div>
          {cue ? <PRow label="断段"><Switch on={breakHere} onChange={toggleBreak} label="在这一条前另起一段" /></PRow> : null}
          <p className="hint">停顿、换人、超过 12 秒 / 16 行 / 48 词也会自动断段；这里只加不减。</p>
        </div>

        <SecHead aside={pinned.length ? '已固定 ' + pinned.length + ' 行' : null}>调整布局</SecHead>
        <div className="sec">
          <div className="row gap4 wrap">
            <Btn size="s" variant={edit ? 'accent' : 'secondary'} onClick={() => ctx.setKineticEdit(edit ? null : {selectedKey: null})}>{edit ? '完成调整' : '调整布局'}</Btn>
            <Btn size="s" variant="secondary" disabled={!edit || !selected} onClick={rotateSelected}>旋转 90°</Btn>
            <Btn size="s" variant="secondary" disabled={!edit || !selected} onClick={togglePin}>{selPinned ? '解除固定' : '固定位置'}</Btn>
            <Btn size="s" variant="secondary" disabled={!pinned.length} onClick={() => { set({pins: {}}); app.toast('已恢复自动排版'); }}>恢复自动</Btn>
          </div>
          <p className="hint">{edit ? '画面上现在是这一段的全貌：拖一行就固定它，其余行自动绕开。' : '固定行优先，其余行绕开；改字体后有冲突会提示，不会擅自移动。'}</p>
          <dl className="dzkv">
            <dt>动画段</dt><dd>{plan.sequences.length}{seq ? ' · 当前第 ' + (seqIdx + 1) + ' 段' : ''}</dd>
            <dt>行</dt><dd>{plan.sequences.reduce((a, s) => a + s.blocks.length, 0)}</dd>
            <dt>诊断</dt><dd>{plan.diagnostics.length ? plan.diagnostics.map((d) => d.code).join('、') : '无'}</dd>
          </dl>
        </div>
      </React.Fragment>
    );
  }

  Object.assign(window, {DaoyaziProps});
})();
