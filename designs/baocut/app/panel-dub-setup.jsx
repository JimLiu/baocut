/* 翻译配音 · 设置页（§15.6，2026-09-16 改版；从 panel-dub.jsx 拆出）。
   改版前这一页要先挑引擎、再挑语言（语言表随引擎变）、五节铺开、两张模型门卡压在主按钮上、
   按钮置灰——在 400 px 宽的面板里滚三屏才到「开始」。现在只问两件事：**配成哪种语言**、
   **声音像本人还是像母语**；引擎按这两个答案自动选（已装的优先，`BC_DUB.pickEngine`），
   时长 / 注音 / 混音 / 风格 / 翻译用的模型折进「更多设置」，默认值就能开始。
   「注音」一节（2026-09-23）只在配音语言要注音时画（v1 只有中文，BC_READINGS.needsReadings）。
   - 第一行是一句人话摘要（与其他工具页的 ToolSetup 同形）：「用 Qwen3-TTS 0.6B 克隆 3 位说话人的原声，把 62 句配成 English」；
   - 语言行下面一句说清有没有译文、要不要先翻译、会不会替换已有的那条配音；
   - 取向两张卡照旧（像本人 / 像母语），每张卡写清这只引擎在这门语言上怎么实现；
   - 声音明细按取向 × 引擎变形：克隆 → 折成一行「3 位说话人 · 各取连续几句当参考」可展开；母语预设 → 每人一只 Picker；
     描述 → 必填的一句；内置母语参考 → 一行；要自己传 → 文件 chip；
   - 引擎一行：自动选的写「按语言与声音自动选 · 已装的优先」，仍可手动换；
   - 模型没装：**一张**门卡列出缺的模型与总体积，主按钮**不置灰**、写「下载模型并配成…」，按下先下载再开始；
     另一只引擎已装好时给「换用已装的 X」；
   - 只重配选中句时顶部一张卡说明范围，语言与引擎锁定为那条配音原来的。
   「删除之前的全部配音」不再出现在这里——那是产物管理，在音频 Tab 的配音组菜单里。 */
(function () {
  const {useState, useEffect} = React;
  const D = window.BC_DATA;
  const TTS = window.BC_TTS;
  const DUB = window.BC_DUB;
  const T = window.BC_TIME;

  /** 说话人一行：色点 + 名字 + 句数 + 右侧（预设 Picker / 参考窗摘要） */
  function SpeakerRow({sp, count, preset, presets, onPreset, refLine, engine, voice, onVoice}) {
    const [pop, setPop] = useState(false);
    const app = useApp();
    const V = window.BC_VOICES;
    const mine = voice && voice.kind === 'my' ? app.voices.find((v) => v.id === voice.id) : null;
    return (
      <div className="dubsp">
        <span className="spkdot" style={{background: `oklch(0.6 0.14 ${sp.hue})`}} />
        <b>{sp.name}</b>
        <span className="t-detail-xs">{count} 句</span>
        <span className="spacer" />
        {onVoice ? (
          <span className="dubsp__voice">
            <span className="t-detail-xs">{mine ? `${V.metaLine(mine)} · 全程这一段、同一颗种子` : refLine}</span>
            <window.VoicePicker engine={engine} value={voice || {kind: 'default'}} builtin={false} preset={false} file={false}
              defaultLabel="自动取参考窗" defaultSub="从这位说话人的整句里取连续几句当参考" popAlign="right" popWidth={300}
              pickKey={'dub:' + sp.id} from="「翻译配音」设置页" reopen={{tab: 'aitools', ai: 'dub'}} onChange={onVoice} />
          </span>
        ) : onPreset ? (
          <Picker size="s" value={preset || '选一个'} open={pop} popWidth={220} popAlign="right"
            onClick={() => setPop((v) => !v)} onClose={() => setPop(false)}>
            <Menu>
              {presets.native.length ? <MenuHead>母语</MenuHead> : null}
              {presets.native.map((p) => (
                <MenuItem key={p.id} label={p.id} sub={p.sub} on={p.id === preset} onClick={() => { onPreset(p.id); setPop(false); }} />
              ))}
              {presets.native.length && presets.others.length ? <MenuRule /> : null}
              {presets.others.length ? <MenuHead>{presets.native.length ? '其他 · 会带口音' : '全部 · 都会带口音'}</MenuHead> : null}
              {presets.others.map((p) => (
                <MenuItem key={p.id} label={p.id} sub={p.sub} on={p.id === preset} onClick={() => { onPreset(p.id); setPop(false); }} />
              ))}
            </Menu>
          </Picker>
        ) : <span className="t-detail-xs">{refLine}</span>}
      </div>
    );
  }

  /** 取向卡：单选卡片，写清这只引擎在这门语言上怎么做 */
  function PriorityCard({opt, on, onPick}) {
    return (
      <div className={cx('prio', on && 'is-on', !opt.available && 'is-off')} onClick={opt.available ? onPick : undefined}>
        <span className="prio__hd">
          <window.RSP.Radio value={opt.id} isDisabled={!opt.available}>{opt.name}</window.RSP.Radio>
          <Chip>{opt.short}</Chip>
        </span>
        <span className="prio__desc">{opt.desc}</span>
        <span className="prio__how">{opt.available ? opt.how : '这只引擎不会念这门语言'}</span>
      </div>
    );
  }

  /** 引擎专属的其他设置：一句话风格 / 情绪 / 参考原文；按 `r[key]` 读写，缺省用 `default` */
  function ExtraSettings({engine, r, set}) {
    const items = DUB.extraSettings(engine);
    if (!items.length) return null;
    const val = (s) => (r[s.key] === undefined || r[s.key] === null ? s.default : r[s.key]);
    return (
      <>
        {items.map((s) => (
          s.kind === 'text' ? (
            <window.PRow key={s.key} label={s.label}>
              <Field size="s" className="grow" value={val(s) || ''} placeholder={s.placeholder} onChange={(e) => set({[s.key]: e.target.value})} />
            </window.PRow>
          ) : s.kind === 'segmented' ? (
            <window.PRow key={s.key} label={s.label}>
              <Segmented size="s" value={val(s)} items={s.items} onChange={(k) => set({[s.key]: k})} />
            </window.PRow>
          ) : (
            <div key={s.key} className="hint hint--tight">{s.label} · {s.hint}</div>
          )
        ))}
        {items.some((s) => s.kind === 'text' || s.kind === 'segmented')
          ? <div className="hint hint--tight">{items.filter((s) => s.kind === 'text' || s.kind === 'segmented').map((s) => s.hint).join('；')}</div>
          : null}
      </>
    );
  }

  /** 声音明细：按取向 × 引擎变形。克隆时折成一行可展开——参考窗只是给人看的，不是要做的决定。 */
  function VoiceDetail({r, set, d, acc, presets, cap}) {
    const app = useApp();
    const {cues, spIds, countOf, langName, engName} = d;
    const [who, setWho] = useState(false);
    // 「克隆新音色…」的回程：每人一行的选择器只在折行展开时才在，先把折行翻开，认领的是那一行自己
    const handoff = app.voiceHandoff;
    useEffect(() => {
      if (handoff && handoff.voiceId && String(handoff.key).startsWith('dub:')) setWho(true);
    }, [handoff]);
    const RefChip = window.TtsRefChip;
    if (r.priority === 'voice') {
      return (
        <>
          <BCAction className="dubfold" onClick={() => setWho((v) => !v)} aria-expanded={who}>
            <Ic n={who ? 'chevdown' : 'chevright'} className="ic--14" />
            <span>{spIds.length} 位说话人 · 各取连续几整句当参考，全程同一段同一颗种子</span>
          </BCAction>
          {who ? (
            <div className="dubsps">
              {spIds.map((id) => (
                <SpeakerRow key={id} sp={D.speakers[id]} count={countOf(id)} engine={r.engine}
                  refLine={TTS.referenceLine(TTS.referenceWindow(cues, id))}
                  voice={(r.voices || {})[id]} onVoice={(val) => {
                    const next = {...(r.voices || {})};
                    if (val.kind === 'default') delete next[id]; else next[id] = val;
                    set({voices: next});
                  }} />
              ))}
            </div>
          ) : null}
        </>
      );
    }
    if (acc.kind === 'preset' || acc.kind === 'preset-any') {
      return (
        <>
          <div className="dubsps">
            {spIds.map((id) => (
              <SpeakerRow key={id} sp={D.speakers[id]} count={countOf(id)} preset={r.presets[id]} presets={presets}
                onPreset={(p) => set({presets: {...r.presets, [id]: p}})} />
            ))}
          </div>
          <div className="hint hint--tight">{acc.kind === 'preset-any'
            ? `${engName} 没有${langName}母语预设 · 预设都是中英双语，口音比克隆轻`
            : `母语预设 ${presets.native.map((p) => p.id).join(' / ')} 排在前面，说话人之间靠不同预设区分`}</div>
        </>
      );
    }
    if (acc.kind === 'ref') {
      return (
        <>
          <window.PRow label="母语参考">
            <span className="t-detail-xs">{acc.items[0].name} · {acc.items[0].dur.toFixed(1)} s · 内置</span>
            <Btn variant="secondary" size="s" onClick={() => app.toast(`试听 ${acc.items[0].label}…`)}>试听</Btn>
          </window.PRow>
          <div className="hint hint--tight">{engName} 没有预设，用内置的{acc.items[0].label}当母语参考；所有说话人同一个声音。</div>
        </>
      );
    }
    return (
      <>
        <window.PRow label="母语参考">
          <RefChip file={r.ref} onPick={() => set({ref: {name: 'native-ref.wav', dur: 8.4}})} onClear={() => set({ref: null, refText: ''})} />
        </window.PRow>
        {/* OmniVoice 把参考当作正文前面那一截来续：不带原文会吞掉每句开头，所以上传的母语参考要写原文（2026-09-26） */}
        {r.ref && window.BC_TTS.refTextRequired(r.engine) ? (
          <window.PRow label="参考原文">
            <Field size="s" className="grow" value={r.refText || ''} placeholder="必填 · 这段录音说的是什么（不写会吞掉每句开头）"
              onChange={(e) => set({refText: e.target.value})} />
          </window.PRow>
        ) : null}
        <div className="hint hint--tight">{engName} 没有{langName}母语示例 · 传一段 5–10 秒的{langName}母语录音，所有说话人同一个声音。</div>
      </>
    );
  }

  function DubSetup({ctx, r, set, d, onStart, onWhole}) {
    const app = useApp();
    const {cues, spIds, only, translated, langName, engName, needTranslate, plan, pace, scope, missing, alt, problem, step, cta, llmNeeded, wantReadings} = d;
    const readingsLang = window.BC_READINGS.needsReadings(r.lang);
    const [pop, setPop] = useState(null);
    const [more, setMore] = useState(false);
    const cap = DUB.capabilities(r.engine);
    const prios = DUB.priorityOptions(r.engine, r.lang);
    const acc = DUB.accentSource(r.engine, r.lang);
    const presets = DUB.presetsFor(r.engine, r.lang);
    const fitName = (TTS.FIT.find((f) => f.id === r.fit) || {}).name;
    const overN = plan ? plan.over + plan.retranslate : 0;
    const locked = !!(scope && scope.ids && scope.ids.length);
    const ModelPick = window.ToolModelPick;
    const moreSub = [cap.style ? '风格' : cap.emotion ? '情绪' : null, '时长', readingsLang ? '注音' : null, locked ? null : '混音', llmNeeded ? '翻译用的模型' : null].filter(Boolean).join(' · ');

    return (
      <>
        {locked ? (
          <div className="aicard">
            <b>只重新生成选中的 {scope.ids.length} 句</b>
            <span>语言与引擎沿用「配音 · {langName}」原来的；取向、声音、时长策略可以改，只影响这几句，其余句子不动。</span>
            <div className="row gap8"><Btn variant="secondary" size="s" onClick={onWhole}>改为整条重配</Btn></div>
          </div>
        ) : null}

        {/* 第一句人话：这一步会用谁、对多少句、做什么——与其他工具页同形（§15.2） */}
        <div className="tsetup tsetup--compact">
          <div className="tsetup__sum"><Ic n="wave" className="ic--16" /><span>{step}</span></div>
        </div>

        <window.SecHead first>配成哪种语言</window.SecHead>
        {locked ? (
          <window.PRow label="配音语言"><b>{langName}</b><Chip>沿用</Chip></window.PRow>
        ) : (
          <LanguageCombobox value={r.lang} onChange={(code) => set({lang: code})} label="配音语言"
            only={only} marks={TTS.dubLangMarks(only, translated)} heading={`能配的语言 · ${only.length}`} />
        )}
        <div className="hint hint--tight">
          {locked ? `${scope.ids.length} 句 · 沿用这条配音的语言与引擎` : `${DUB.langLine({lang: r.lang, langName, translated: !needTranslate, dubs: ctx.dubs})} · ${cues.length} 句 · ${T.timecode(ctx.duration, {decimals: 0})}`}
        </div>

        <window.SecHead aside={DUB.voiceSummary(r, spIds.length)}>声音</window.SecHead>
        <window.RSP.RadioGroup aria-label="声音取向" value={r.priority} onChange={d.pickPriority} UNSAFE_className="prios">
          {prios.map((p) => <PriorityCard key={p.id} opt={p} on={r.priority === p.id} onPick={() => d.pickPriority(p.id)} />)}
        </window.RSP.RadioGroup>
        <div className="hint hint--tight">两档不能兼得：像本人就会带原语言口音，发音地道就换了声音。可以先配一版听，再回来换。</div>
        <VoiceDetail r={r} set={set} d={d} acc={acc} presets={presets} cap={cap} />

        <window.PRow label="引擎">
          <Picker size="s" value={engName} open={pop === 'g'} popWidth={280} disabled={locked}
            onClick={() => setPop(pop === 'g' ? null : 'g')} onClose={() => setPop(null)}>
            <div className="menu__hd t-detail-xs" style={{textTransform: 'none', letterSpacing: 0}}>按语言与声音自动选的排前面 · 已装的优先</div>
            <Menu>
              {TTS.ENGINES.map((e) => {
                const speaks = TTS.engineSpeaks(e.id, r.lang);
                const on = app.modelInstalled(DUB.modelNeeded({engine: e.id, lang: r.lang, priority: r.priority}));
                return (
                  <MenuItem key={e.id} label={e.name} on={e.id === r.engine}
                    sub={speaks ? `${on ? '已安装 · ' : ''}${DUB.capabilityLine(e.id)}` : `不会念${langName}`}
                    disabled={!speaks} onClick={() => { d.pickEngine(e.id); setPop(null); }} />
                );
              })}
            </Menu>
          </Picker>
          <span className="t-detail-xs">{r.engineAuto ? '自动选的 · 已装的优先' : '手动选的'}</span>
        </window.PRow>

        {/* 在哪儿跑：只有局域网里确实有台已配对节点报得出这只模型时才画这一行
            ——一台都没有时它是废话。引擎不变，换的只是权重在谁的显卡上。 */}
        {d.peers.length ? (
          <window.PRow label="在哪儿跑">
            <Picker size="s" value={d.nodeName || '这台 Mac'} open={pop === 'nd'} popWidth={280} disabled={locked}
              onClick={() => setPop(pop === 'nd' ? null : 'nd')} onClose={() => setPop(null)}>
              <Menu>
                <MenuItem label="这台 Mac" sub="用装在本机的模型" on={!d.nodeOn}
                  onClick={() => { d.pickNode(null); setPop(null); }} />
                {d.peers.map((n) => (
                  <MenuItem key={n.id} label={n.name} sub="局域网里的另一台电脑" on={n.id === d.nodeOn}
                    onClick={() => { d.pickNode(n.id); setPop(null); }} />
                ))}
              </Menu>
            </Picker>
            {d.nodeOn ? <span className="t-detail-xs">{d.nodeHint}</span> : null}
          </window.PRow>
        ) : null}

        {/* 更多设置：默认折起，改了默认值就在摘要里露出来 */}
        <BCAction className="dubfold dubfold--sec" onClick={() => setMore((v) => !v)} aria-expanded={more}>
          <Ic n={more ? 'chevdown' : 'chevright'} className="ic--14" />
          <b>更多设置</b>
          <span>{moreSub}</span>
        </BCAction>
        {more ? (
          <>
            <ExtraSettings engine={r.engine} r={r} set={set} />

            <window.SecHead>时长</window.SecHead>
            <div className="tsetup__rows">
              <div className="tsetup__row">
                <Switch on={r.review} onChange={(v) => set({review: v})} label="配音前对比两种语言的时长" />
                <span className="t-detail-xs">
                  {plan ? `按语速库估算 · ${overN ? overN + ' 句译文比原声长得多，AI 缩写或自己改' : '每句都装得下，只走一眼对比'}`
                    : '翻译完逐句对比原声与译文时长，长得多的交 AI 缩写或自己改'}
                </span>
              </div>
            </div>
            <window.PRow label="超长时">
              <Picker size="s" value={fitName} open={pop === 'f'} popWidth={240}
                onClick={() => setPop(pop === 'f' ? null : 'f')} onClose={() => setPop(null)}>
                <Menu>
                  {TTS.FIT.map((f) => <MenuItem key={f.id} label={f.name} sub={f.desc} on={f.id === r.fit} onClick={() => { set({fit: f.id}); setPop(null); }} />)}
                </Menu>
              </Picker>
            </window.PRow>
            {/* 能按目标时长合成的引擎（OmniVoice，2026-09-26）：要压的句直接按压到的长度出声；放在「超长时」下面，它说的就是那一项 */}
            {cap.duration ? <div className="hint hint--tight">{engName} 能按目标时长合成：选「压到下一句前」时，超出原句的那句直接按要压到的长度出声，不再事后加速（每句最长 {cap.duration} 秒）；要压过 1.35× 的句照旧事后加速（按时长硬压会吞字），装得下的句照自然语速念，其余策略照旧。</div> : null}
            <div className="hint hint--tight">{TTS.paceLine(pace, r.lang)} · 超过 1.35× 的句在轨上标橙。</div>

            {readingsLang ? (
              <>
                <window.SecHead>注音</window.SecHead>
                <div className="tsetup__rows">
                  <div className="tsetup__row">
                    <Checkbox on={r.readings !== false} onChange={(v) => set({readings: v})} label="合成前标注多音字" />
                    <span className="t-detail-xs">生成前多一步：词典先标、模型按上下文校对，读错的逐句点开改</span>
                  </div>
                </div>
              </>
            ) : null}

            {!locked ? (
              <>
                <window.SecHead>混音</window.SecHead>
                <div className="tsetup__rows">
                  <div className="tsetup__row">
                    <Switch on={r.separate} onChange={(v) => set({separate: v})} label="分离背景声" />
                    <span className="t-detail-xs">配音只替换人声，音乐与环境声留下</span>
                  </div>
                </div>
                <window.PRow label="原声">
                  <Segmented size="s" value={r.original} items={TTS.ORIGINAL.map((o) => ({k: o.id, label: o.name}))} onChange={(k) => set({original: k})} />
                </window.PRow>
                <div className="hint hint--tight">{r.separate ? '背景声单独成轨，原声轨只剩人声——' : '不分离时原声整条'}{r.original === 'mute' ? '静音' : '压低到 −18 dB'}，配音轨行头能随时切回原声。</div>
              </>
            ) : null}

            {llmNeeded && ModelPick ? (
              <>
                <window.SecHead>翻译与整理译文</window.SecHead>
                <window.PRow label="用">
                  <ModelPick value={r.llm} onChange={(m) => set({llm: m.id})} />
                </window.PRow>
                <div className="hint hint--tight">{[needTranslate ? '翻译字幕' : '', r.review ? 'AI 缩写译文' : '', wantReadings ? '多音字校对' : ''].filter(Boolean).join('、')}走这只云端模型；{d.nodeOn ? `合成在 ${d.nodeName} 上跑。` : '合成全程在本机。'}</div>
              </>
            ) : null}
          </>
        ) : null}

        {missing.list.length ? (
          <div className="aicard aicard--warn">
            <b>还要下载 {missing.list.map((m) => m.name).join(' 与 ')} · {missing.sizeLabel}</b>
            <span>按下面的按钮会先下载、装好就接着配{alt ? `；不想等就换用已装的 ${alt.name}` : ''}。下载不占任务队列。</span>
            <div className="row gap8" style={{marginTop: 4}}>
              {alt ? <Btn variant="secondary" size="s" onClick={() => d.pickEngine(alt.engine)}>换用已装的 {alt.name}</Btn> : null}
              <BCAction className="viewall" onClick={() => app.go({r: 'settings', sec: 'local', tab: 'tts'})}>管理本地模型…</BCAction>
            </div>
          </div>
        ) : null}

        <div className="flowcta">
          <Btn variant="accent" style={{width: '100%'}} onClick={onStart}>{cta}</Btn>
        </div>
        <div className={'hint' + (problem ? ' hint--warn' : '')}>
          {problem || (locked ? '只重新合成这几句，写回同一条配音轨；做完能撤销。'
            : `${d.where} · 完成后写进时间轴「配音 · ${langName}」${r.separate ? '与「背景声」' : ''}轨，一键可撤销。`)}
        </div>
      </>
    );
  }

  Object.assign(window, {DubSetup});
})();
