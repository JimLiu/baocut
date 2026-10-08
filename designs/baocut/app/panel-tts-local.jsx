/* 本地语音模型的三样共用件（2026-09-26，§13.6 / §17.3 / §17.5）——只 App 有（Web 没有语音合成，§22）：
   - `TtsKnobs`：「高级」折叠里的数值旋钮（IndexTTS 2.5 语速；VoxCPM2 引导强度 / 采样步数；OmniVoice 语速 / 引导强度 / 采样步数）。
     默认收起；没拨过的键不进表单、合成时也不传（副题写「按模型默认」），「恢复默认」把键删掉而不是写回默认值。
   - `OmniDescribe`：OmniVoice 的「描述」不是一句自由文字，是按类挑项（性别 / 年龄 / 音高 / 风格，念英语多英语口音、念中文多汉语方言），
     每类至多一项；上面一排三组现成挑法当起点。
   - `withModelLicense`：权重不许商用（data.js 该行 `license.commercialUse: false`：OmniVoice、Qwen-Image-2.1）的模型，
     第一次下载前弹「许可」确认；可商用的直接下。音频面板的下载卡、设置 › 本地模型的下载 / 补齐、配音设置的「下载缺的模型」、
     生成图片的下载卡都经这里；末尾那句按模型的类说（合成的声音 / 画出的图）。
   词表、区间与拼接规则在 model-tts.js（`LOCAL_KNOBS` / `OMNI_DESIGN`），这里只画。
   文件名落在 `panel-tts*` 下：model-surface.test.js 的 WEB_DENY 按前缀把它挡在 BaoCutWeb.html 之外。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;
  const TTS = window.BC_TTS;

  /* ---------- 许可 ---------- */
  /** 这只模型要不要先确认许可：只有明确写了不许商用的才要 */
  const licenseOf = (id) => {
    const m = D.setModels.find((x) => x.id === id);
    return m && m.license && m.license.commercialUse === false ? m.license : null;
  };
  /** 许可地址里的上游主（huggingface.co/k2-fsa/OmniVoice → k2-fsa），找不到就写许可名 */
  const licenseOwner = (lic) => (String(lic.url || '').split('://')[1] || '').split('/')[1] || lic.name;
  /** 许可提要一行（与 App 设置 › 本地模型同一句）：「CC-BY-NC-4.0 · 只许非商业用途 · 商用要向 k2-fsa 另行申请」 */
  const licenseBrief = (lic) => `${lic.name} · 只许非商业用途 · 商用要向 ${licenseOwner(lic)} 另行申请`;

  /** 许可确认末尾那一句：用它做出的东西也只能用在非商业内容里（图像模型说画出的图，其余说合成的声音） */
  const licenseUse = (cat) => cat === 'image'
    ? '用它画出的图也只能用在非商业内容里；做要商用的视频请换别的图像模型。'
    : '用它合成的声音也只能用在非商业内容里；做要商用的视频请换别的语音模型。';

  /** 下载前的许可闸：`ids` 里有不许商用的就先弹一次确认（几只一起下也只问一次），确认了才 `run`；都可商用直接 `run`。 */
  function withModelLicense(app, ids, run) {
    const list = [].concat(ids || []).map((id) => ({id, lic: licenseOf(id), m: D.setModels.find((x) => x.id === id)})).filter((x) => x.lic);
    if (!list.length) { run(); return; }
    app.confirm({
      title: '许可',
      body: (
        <div className="ttslic">
          {list.map((x) => (
            <div key={x.id} className="ttslic__item">
              <b>{x.m.name}</b>
              <span>{licenseBrief(x.lic)}</span>
              <span className="t-detail-xs">{x.lic.url}</span>
            </div>
          ))}
          {[...new Set(list.map((x) => licenseUse(x.m.cat)))].map((line) => <span key={line} className="t-detail">{line}</span>)}
        </div>
      ),
      confirmLabel: '我知道了，下载',
      run,
    });
  }

  /* ---------- 数值旋钮 ---------- */
  /** `bench` 为真时按工作台的行式（`ttsw__row`）画，否则按面板的 `PRow`。
   *  `timed`：这一次按目标时长合成（配音），语速那一只灰掉并说明。 */
  function TtsKnobs({engine, knobs, onChange, bench, timed}) {
    const [open, setOpen] = useState(false);
    const list = TTS.knobsOf(engine);
    if (!list.length) return null;
    const any = list.some((d) => (knobs || {})[d.k] != null);
    const readout = (d) => {
      const v = TTS.knobValue(engine, knobs, d.k);
      return d.unit ? (+v).toFixed(2) + d.unit : d.step >= 1 ? String(v) : (+v).toFixed(1);
    };
    const rows = list.map((d) => {
      const off = timed && d.k === 'speed';
      const set = (knobs || {})[d.k] != null;
      const slider = <Slider className={bench ? 'ttsw__slider' : undefined} value={TTS.knobValue(engine, knobs, d.k)} min={d.min} max={d.max} step={d.step}
        disabled={off} onChange={(v) => onChange(TTS.setKnob(engine, knobs, d.k, v))} />;
      const note = off ? '按目标时长合成时不起作用' : `${d.min}–${d.max}${d.unit || ''} · 默认 ${d.dflt}${d.unit || ''}${set ? '' : '（没改）'}${d.sub ? ' · ' + d.sub : ''}`;
      return bench ? (
        <React.Fragment key={d.k}>
          <div className="ttsw__row">
            <span className="ttsw__lab">{d.label}</span>
            {slider}
            <span className="t-mono t-detail-xs">{readout(d)}</span>
          </div>
          <div className="ttsknobs__note t-detail-xs">{note}</div>
        </React.Fragment>
      ) : (
        <React.Fragment key={d.k}>
          <window.PRow label={d.label}>
            {slider}
            <span className="t-mono t-detail-xs" style={{width: 44, textAlign: 'right'}}>{readout(d)}</span>
          </window.PRow>
          <div className="ttsknobs__note t-detail-xs">{note}</div>
        </React.Fragment>
      );
    });
    return (
      <div className={cx('ttsknobs', bench && 'ttsknobs--bench')}>
        <BCAction className="dubfold" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Ic n={open ? 'chevdown' : 'chevright'} className="ic--14" />
          <b>高级</b>
          <span>{TTS.knobLine(engine, knobs, {duration: timed})}</span>
        </BCAction>
        {open ? (
          <div className="ttsknobs__body">
            {rows}
            <div className="ttsknobs__ft">
              <span className="t-detail-xs grow">没改过的不传给模型，用它自己的默认</span>
              {any ? <BCAction className="viewall" onClick={() => onChange({})}>恢复默认</BCAction> : null}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  /* ---------- OmniVoice 的描述：按类挑项 ---------- */
  function OmniDescribe({sel, lang, onChange, bench}) {
    const cats = TTS.omniCats(lang);
    const instruct = TTS.omniInstruct(sel);
    const problem = TTS.omniProblem(sel, lang);
    const note = TTS.omniLangNote(lang);
    const same = (a, b) => TTS.omniInstruct(a) === TTS.omniInstruct(b);
    const chips = (c) => (
      <div className={bench ? 'ttsw__chips' : 'chiprow grow'}>
        {c.items.map((v) => (
          <Chip key={v} pill on={(sel || {})[c.k] === v} aria-pressed={(sel || {})[c.k] === v}
            onClick={() => onChange(TTS.omniToggle(sel, c.k, v))}>{TTS.omniItemLabel(c.k, v)}</Chip>
        ))}
      </div>
    );
    const row = (key, label, body) => bench
      ? <div className="ttsw__row ttsomni__row" key={key}><span className="ttsw__lab">{label}</span>{body}</div>
      : <div className="prow2 ttsomni__row" key={key}><span className="lab">{label}</span>{body}</div>;
    return (
      <div className="ttsomni">
        {row('presets', '现成', (
          <div className={bench ? 'ttsw__chips' : 'chiprow grow'}>
            {TTS.OMNI_PRESETS.map((p) => (
              <Chip key={p.k} pill on={same(sel, p.sel)} onClick={() => onChange(TTS.omniFit(p.sel, lang))}>{p.label}</Chip>
            ))}
          </div>
        ))}
        {cats.map((c) => row(c.k, c.label, chips(c)))}
        <div className={cx('hint hint--tight', (problem || note) && 'hint--warn', bench && 'ttsw__indent')}>
          {problem || (note ? `${note}。` : '')}
          {!problem ? `交给模型的描述：${instruct}。每类至多挑一项，不挑的那类由模型自己定；${lang === 'en' ? '英语口音只在念英语时生效' : lang === 'zh' ? '汉语方言只在念中文时生效' : '语言选成中文或英语时还能挑方言或口音'}。` : null}
        </div>
      </div>
    );
  }

  Object.assign(window, {TtsKnobs, OmniDescribe, withModelLicense, ttsLicenseOf: licenseOf, ttsLicenseBrief: licenseBrief});
})();
