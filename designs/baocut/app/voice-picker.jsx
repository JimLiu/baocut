/* 共享音色选择器 `VoicePicker`（voice-library 设计稿 §2.3，2026-09-24 原型先行）。
   六处要选声音的地方（生成语音面板、克隆声音、翻译配音的每位说话人、工具页工作台、设置页试听、CLI）
   以前各画各的一枚「我的音频」芯片，参考录音是一次性的文件路径。现在同一只控件：
     默认 · 我的声音（+「克隆新音色…」） · 内置音色 · 模型预设 · 临时用一段
   按引擎增减分组：接不了参考音频的引擎，「我的声音」在它下面灰掉并写原因，不装作能用。
   「克隆新音色…」去设置 › 我的声音，走回程（store.voiceHandoff）：存好后回到原来的面板，这只选择器认领新音色。
   值的形状与落地规则在 model-voices.js（pickerGroups / valueLabel / applyToForm），这里只画。
   云端引擎（`cloud:<provider>`，2026-09-24 云端语音合成设计稿 §2.3）：分组变成 默认 · 我的声音（按这家的克隆状态置灰）· 提供方音色（多于 12 只带搜索）· 临时用一段；
   没有「内置音色」组（内置录音对云端没意义），OpenAI 没有临时那一组（不能克隆）。 */
(function () {
  const {useState, useEffect, useRef} = React;
  const TTS = window.BC_TTS;
  const V = window.BC_VOICES;

  const same = (a, b) => !!a && !!b && a.kind === b.kind && (a.id || '') === (b.id || '');
  const ICONS = {my: 'mic', new: 'plus', builtin: 'wave', file: 'upload', voice: 'remote'};

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

  /** 选中后写在控件下面的一句：这只引擎会怎么用它 */
  function VoiceLine({engine, value, lang, text, className}) {
    const app = useApp();
    const v = value || {kind: 'default'};
    let line = null;
    const e = TTS.engineOf(engine);
    if (e.cloud) {
      line = window.BC_CLOUD_TTS.valueLine(e.provider, v, app.voices, {lang: lang && lang !== 'auto' ? lang : null, saved: app.cloudSaved, extra: app.cloudCustom});
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
    return <div className={cx('hint hint--tight', className)}>{line}</div>;
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

  Object.assign(window, {VoicePicker, VoiceLine, VoicePlay});
})();
