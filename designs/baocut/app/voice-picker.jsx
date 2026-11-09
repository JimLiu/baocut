/* 共享音色选择器 `VoicePicker`（voice-library 设计稿 §2.3，2026-09-24 原型先行）。
   六处要选声音的地方（生成语音面板、克隆声音、翻译配音的每位说话人、工具页工作台、设置页试听、CLI）
   以前各画各的一枚「我的音频」芯片，参考录音是一次性的文件路径。现在同一只控件：
     默认 · 我的声音（+「克隆新音色…」） · 内置音色 · 模型预设 · 临时用一段
   按引擎增减分组：接不了参考音频的引擎，「我的声音」在它下面灰掉并写原因，不装作能用。
   「克隆新音色…」去设置 › 我的声音，走回程（store.voiceHandoff）：存好后回到原来的面板，这只选择器认领新音色。
   值的形状与落地规则在 model-voices.js（pickerGroups / valueLabel / applyToForm），这里只画。
   云端引擎（`cloud:<provider>`，2026-09-24 云端语音合成设计稿 §2.3）：分组变成 默认 · 我的声音（按这家的克隆状态写现状）· 提供方音色（多于 12 只带搜索）· 临时用一段；
   没有「内置音色」组（内置录音对云端没意义），OpenAI 没有临时那一组（不能克隆）。
   2026-11-09：云端下「我的声音」里还没在这家建好克隆的不再置灰成死胡同（以前写着「首次用时上传」，其实 Runtime 只认有效克隆）。
   选它就去补那一步（cloneStatus 的 fix）：没传过 / 参考换过 → 就地确认上传，选上它、控件下报进度，建好就能合成；
   没说明是谁的声音 → 就地补一句本人声明再上传；缺授权录音 / 样本太短 → 带着回程去我的声音补录，存好就上传、带你回来；
   上次没建成 → 去我的声音看原因和一键办法。只有这家根本不能克隆时才置灰。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const TTS = window.BC_TTS;
  const V = window.BC_VOICES;

  const same = (a, b) => !!a && !!b && a.kind === b.kind && (a.id || '') === (b.id || '');
  const ICONS = {my: 'mic', new: 'plus', builtin: 'wave', file: 'upload', voice: 'remote'};
  /** 控件下那一句后面的按钮：补哪一步就写哪一步 */
  const FIX_LABEL = {upload: (n) => `上传到 ${n}`, declare: () => '说明是谁的声音', authorize: () => '去补录授权声明', sample: () => '去换样本', diagnose: () => '看原因'};

  /** 我的声音里的一只在这家还用不了、但补得上（BC_CLOUD_TTS.cloneStatus 的 fix）：就地上传，或带着回程去我的声音补那一步。
   *  `ctx` = {pickKey, from, reopen}：回程认领用，同 VoicePicker。 */
  function fixVoiceClone(app, v, pid, ctx) {
    const C = window.BC_CLOUD_TTS;
    const c = ctx || {};
    const opt = {saved: app.cloudSaved, extra: app.cloudCustom};
    const p = C.providerById(pid, app.cloudCustom) || {id: pid, name: pid};
    const st = C.cloneStatus(v, p, opt);
    const away = (h) => {
      app.setVoiceHandoff(Object.assign({key: c.pickKey, from: c.from || '刚才的面板', route: app.route, reopen: c.reopen || null, target: {kind: 'cloud', id: pid}}, h));
      app.go({r: 'settings', sec: 'voices'});
    };
    if (st.fix === 'upload') {
      app.confirm({title: `上传到 ${p.name}？`, body: C.uploadNotice(v, p), confirmLabel: '上传', run: () => window.startVoiceClone(app, v, [pid])});
    } else if (st.fix === 'declare') {
      /* 本人声明就地补：同保存时那一行勾选（写进音色档），补完接着走下一步（多半是上传；Gemini 没授权录音就去补录） */
      app.confirm({title: `「${v.name}」是谁的声音？`, confirmLabel: '是本人或已获许可',
        body: `上传到 ${p.name} 建克隆之前，要先说明这是你本人的声音，或已获本人许可。确认后记在这只音色上，往别家上传也不再问；没获许可的声音请别上传。`,
        run: () => {
          const next = Object.assign({}, v, {consent: 'self'});
          app.setVoices((list) => list.map((x) => (x.id === v.id ? Object.assign({}, x, {consent: 'self'}) : x)));
          if (C.cloneStatus(next, p, opt).fix) fixVoiceClone(app, next, pid, c);
        }});
    } else if (st.fix === 'authorize') away({open: 'consent:' + v.id, task: 'consent'});
    else if (st.fix === 'sample') away({open: `retake:${v.id}:${pid}`, task: 'sample'});
    else if (st.fix === 'diagnose') away({voiceId: v.id});
  }

  /** @param pickKey 这只选择器的身份（回程认领用），如 'panel-tts' / 'dub:s1' / 'quick:indextts2'
   *  @param from    人读的来处，写在设置页的回程条上
   *  @param reopen  回来时编辑器要翻开的 {tab, paneView | ai}（面板的子页不在路由里） */
  function VoicePicker({engine, value, onChange, pickKey, from, reopen, lang, size = 's', popWidth = 280, popAlign = 'left', file = true, builtin = true, preset = true, defaultLabel, defaultSub, disabled, className}) {
    const app = useApp();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const fileInput = useRef(null);
    const voices = app.voices;
    const groups = V.pickerGroups(engine, voices, {file, builtin, preset, defaultLabel, defaultSub, query, lang, saved: app.cloudSaved, extra: app.cloudCustom});
    const handoff = app.voiceHandoff;
    useEffect(() => {
      if (handoff && handoff.key === pickKey && handoff.voiceId) {
        onChange({kind: 'my', id: handoff.voiceId});
        app.setVoiceHandoff(null);
      }
    }, [handoff]);
    const goClone = () => {
      app.setVoiceHandoff({key: pickKey, from: from || '刚才的面板', route: app.route, reopen: reopen || null});
      app.go({r: 'settings', sec: 'voices'});
    };
    const pick = (it) => {
      setOpen(false);
      if (it.disabled) return;
      if (it.kind === 'new') return goClone();
      if (it.kind === 'file') return fileInput.current.click();
      onChange({kind: it.kind, id: it.id});
      /* 还没在这家建好的：先选上（控件下那一句报状态、生成被拦着），再去补那一步；在传的就等它 */
      const v = it.fix && it.fix !== 'wait' ? voices.find((x) => x.id === it.id) : null;
      if (v) fixVoiceClone(app, v, TTS.engineOf(engine).provider, {pickKey, from, reopen});
    };
    return (
      <>
        <Picker size={size} value={V.valueLabel(value, voices, defaultLabel, engine)} open={open} popWidth={popWidth} popAlign={popAlign}
          disabled={disabled} className={className} onClick={() => setOpen((v) => !v)} onClose={() => setOpen(false)}>
          <Menu>
            {groups.map((g, gi) => (
              <React.Fragment key={g.k}>
                {gi ? <MenuRule /> : null}
                {g.k !== 'default' ? <MenuHead>{g.label}</MenuHead> : null}
                {g.search ? (
                  <div className="vpk-search">
                    <Field size="s" icon="search" value={query} aria-label="搜音色" placeholder={`搜 ${g.total} 只音色 · 名字或 id`}
                      onChange={(e) => setQuery(e.target.value)} onClick={(e) => e.stopPropagation()} />
                  </div>
                ) : null}
                {g.items.map((it) => (
                  <MenuItem key={it.kind + (it.id || '')} icon={ICONS[it.kind]} label={it.label} wrap
                    sub={it.disabled ? it.why : it.sub} disabled={it.disabled}
                    on={same(it, value)} onClick={() => pick(it)} />
                ))}
              </React.Fragment>
            ))}
          </Menu>
        </Picker>
        <input ref={fileInput} type="file" accept="audio/*,video/*" hidden onChange={(e) => {
          const f = e.target.files[0];
          e.target.value = '';
          if (f) onChange({kind: 'file', name: f.name});
        }} />
      </>
    );
  }

  /** 选中后写在控件下面的一句：这只引擎会怎么用它。云端下选中的我的声音还没建好时，后面跟一个补那一步的按钮
   *  （`pickKey / from / reopen` 同 VoicePicker，去我的声音补时回程用） */
  function VoiceLine({engine, value, lang, text, className, pickKey, from, reopen}) {
    const app = useApp();
    const v = value || {kind: 'default'};
    let line = null;
    let fix = null;
    const e = TTS.engineOf(engine);
    if (e.cloud) {
      const C = window.BC_CLOUD_TTS;
      const opt = {lang: lang && lang !== 'auto' ? lang : null, saved: app.cloudSaved, extra: app.cloudCustom};
      line = C.valueLine(e.provider, v, app.voices, opt);
      const m = v.kind === 'my' ? app.voices.find((x) => x.id === v.id) : null;
      const st = m ? C.cloneStatus(m, e.provider, opt) : null;
      if (st && !st.ok && FIX_LABEL[st.fix]) {
        const p = C.providerById(e.provider, app.cloudCustom) || {name: e.provider};
        fix = {label: FIX_LABEL[st.fix](p.name), run: () => fixVoiceClone(app, m, e.provider, {pickKey, from, reopen})};
      } else if (st && st.fix === 'wait') fix = {wait: true};
    } else if (v.kind === 'my') {
      const m = app.voices.find((x) => x.id === v.id);
      const p = V.profileFor(engine);
      line = !m ? '这只音色已经删了 · 换一只，或退回默认'
        : !p.ok ? `${p.why} · ${p.alt}`
          : `${V.metaLine(m)} · ${p.line} · ${V.RUN_LINE}`;
    } else if (v.kind === 'builtin') {
      const b = TTS.builtinRef(v.id);
      line = b ? `${b.dur} 秒 · 随 BaoCut 自带 · 原文自动带上` : null;
    } else if (v.kind === 'file') {
      line = '只这一次，不进音色库 · 5–15 秒、一个人说话的干净录音效果最好';
    } else if (v.kind === 'preset') {
      const p = TTS.PRESETS.find((x) => x.id === v.id);
      line = p ? p.sub : null;
    } else {
      line = `不给录音就用按语言挑的内置音色（${TTS.defaultBuiltin(lang || 'auto', text || '').label}）`;
    }
    if (!line) return null;
    if (!fix) return <div className={cx('hint hint--tight', className)}>{line}</div>;
    return (
      <div className={cx('hint hint--tight vpk-fix', className)}>
        {fix.wait ? <window.RSP.ProgressCircle size="S" isIndeterminate aria-label="正在上传" /> : null}
        <span className="vpk-fix__line">{line}</span>
        {fix.run ? <Btn variant="secondary" size="s" onClick={fix.run}>{fix.label}</Btn> : null}
      </div>
    );
  }

  /* ---------- 试听一只音色的参考录音：同一时刻只响一段 ---------- */
  let sounding = null;
  function VoicePlay({v, size = 's', tip}) {
    const [on, setOn] = useState(false);
    const el = useRef(null);
    useEffect(() => () => { if (el.current) el.current.pause(); }, []);
    useEffect(() => { if (el.current) { el.current.pause(); el.current = null; setOn(false); } }, [v && v.file]);
    const toggle = () => {
      if (!v || !v.file) return;
      if (!el.current) {
        const a = new Audio('assets/' + v.file);
        a.onplay = () => setOn(true);
        a.onpause = () => setOn(false);
        a.onended = () => { setOn(false); a.currentTime = 0; };
        el.current = a;
      }
      const a = el.current;
      if (!a.paused) { a.pause(); a.currentTime = 0; return; }
      if (sounding && sounding !== a) { sounding.pause(); sounding.currentTime = 0; }
      sounding = a;
      a.play().catch(() => setOn(false));
    };
    return <IconBtn icon={on ? 'pause' : 'play'} size={size} tip={on ? '停止' : tip || '听参考录音'} onClick={toggle} disabled={!v || !v.file} />;
  }

  Object.assign(window, {VoicePicker, VoiceLine, VoicePlay, fixVoiceClone});
})();
