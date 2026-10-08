/* 导出弹层的「音频」页 —— §17.1（2026-09-20 新增）。
   ============================================================================
   要的东西很具体：把这个项目的声音单独写成一个文件（播客、纯音频号、拿去别处配画面、
   把译文配音交给客户听），而不是先导一份 MP4 再去别处扒音轨。所以这一页只回答四件事：

     声音里有什么   与视频页**同一份清单、同一层覆盖表**——一条声音进不进这次导出，
                    两页问的是同一个问题（原声 / 音乐 / 配音 / 背景声）。上面多一排
                    快速选择：成片混音 / 只要原声 / 只要配音 / 只要音乐。
     范围           复用视频页那一节（整片 / 按章节 / 按片段 / 自定义），**同一份状态**：
                    一次导出的取舍只有一份。音频页没有预览，修剪条上的播放头与「取此刻」
                    取的都是编辑器播放头。
     格式与音质     WAV / MP3 / M4A ＋ 码率（有损才有）＋ 立体声 / 单声道。
     人声分几份     音频容器没有「播放器里切语言」这回事（那是 MP4 多音轨才有的），
                    所以开着的人声多于一条时默认**每种一份**：一条人声一个文件，
                    各自带自己的背景声，音乐进每一份；也可以混成一份挑一种烧进去。

   导出出去仍是**一条任务**（与视频页同一条路、同一处取消），进行 / 完成 / 取消态属于
   起它的那个页签。算的东西全在 `model-audio-export.js`，这里只画和接事件。 */
(function () {
  const {useState} = React;
  const X = window.BC_EXPORT;
  const A = window.BC_AEXPORT;

  function ExportAudio({ctx, base, lanes, eff, diff, setLane, setOv, syncBack, range, setRange, span, loud, setLoud, onClose, onStart}) {
    const [fmt, setFmt] = useState('mp3');
    const [kbps, setKbps] = useState(A.DEFAULT_BITRATE);
    const [ch, setCh] = useState('stereo');
    /* null = 还没挑过，跟着 `voiceModeDefault`（一条人声混成一份，两条以上各出一份） */
    const [mode, setMode] = useState(null);
    const [pick, setPick] = useState(null);
    const [pickOpen, setPickOpen] = useState(false);
    const [open, setOpen] = useState(false);          // 原声那一组展开没有

    /* 元素表是「原声」的来源：2026-09-16 起没有主视频，视频元素自带的声音就是原声，
       它与视频页共用同一个 `el:<id>` 开关（关掉 = 画面与声音一起不进这次导出）。 */
    const els = ctx.elements;
    const sounds = A.soundLanes(eff, els);
    const presets = A.presets(lanes, els);
    const preset = A.presetOf(lanes, els, eff);
    const voices = A.voiceLanes(eff, els);
    const m = mode || A.voiceModeDefault(eff, els);
    const p = pick && voices.some((v) => v.id === pick) ? pick : (voices[0] ? voices[0].id : null);
    const parts = A.voiceParts(eff, els, m, p);
    const files = A.audioFiles(base, {eff, els, span, each: range.each, fmt, mode: m, pick: p});
    const est = A.estimate(span.dur, {fmt, kbps, ch, files: files.length});
    const f = A.fmtOf(fmt);
    const sum = A.summary(eff, {els, span, fmt, kbps, ch, mode: m, pick: p});
    const loudTag = loud && loud.on ? '响度 ' + window.BC_LOUD.fmtDb(loud.lufs) + ' LUFS' : '';
    const empty = !files.length || span.empty;

    const start = () => onStart({
      sub: A.taskSub(eff, {els, span, fmt, kbps, ch, mode: m, pick: p}) + (loudTag ? ' · ' + loudTag : ''),
      etaMs: est.ms, file: files.length > 1 ? files.length + ' 个文件' : files[0].name,
      size: files.length > 1 ? est.totalSize : est.size,
    });

    return (
      <>
        <div className="cpsec">声音里有什么</div>
        {presets.length ? (
          <div className="chiprow">
            {presets.map((x) => (
              <Chip key={x.k} on={preset === x.k} title={x.note} onClick={() => setOv((o) => A.applyPreset(lanes, els, o, x.k))}>
                {x.label}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="xlanes xlanes--pick">
          {sounds.map((l) => (l.kind === 'orig' && l.items.length > 1 ? (
            <React.Fragment key={l.key}>
              <div className={cx('xlane', !l.on && 'is-off')}>
                <BCAction type="button" className={cx('xlane__exp', open && 'is-open')} onClick={() => setOpen((v) => !v)}
                  aria-label={open ? '收起原声逐件清单' : '展开原声逐件清单'}>
                  <Ic n="chevright" className="ic--14" />
                </BCAction>
                <div className="xlane__nm">
                  <b>{l.label}<span className="xlane__cnt">{l.items.filter((i) => i.on).length}/{l.items.length} 开</span></b>
                  <span>{open ? '逐件开关' : l.sub}</span>
                </div>
                <Switch ariaLabel={l.label} on={l.on} onChange={(v) => l.items.forEach((i) => setLane(i.key, v))} />
              </div>
              {open ? l.items.map((i) => (
                <div key={i.key} className={cx('xlane xlane--sub', !i.on && 'is-off')}>
                  <Ic n="video" className="ic--14 xlane__ic" />
                  <div className="xlane__nm"><b>{i.label}</b></div>
                  <Switch ariaLabel={i.label} on={i.on} onChange={(v) => setLane(i.key, v)} />
                </div>
              )) : null}
            </React.Fragment>
          ) : (
            <div key={l.key} className={cx('xlane', !l.on && 'is-off')}>
              <Ic n={l.kind === 'orig' || l.kind === 'audio' ? 'vol2' : l.kind === 'dub' ? 'wave' : l.kind === 'el' ? 'audio' : 'audio'}
                className="ic--16 xlane__ic" />
              <div className="xlane__nm"><b>{l.label}</b><span>{l.sub}</span></div>
              <Switch ariaLabel={l.label} on={l.on} onChange={(v) => (l.kind === 'orig' ? l.items : [l]).forEach((i) => setLane(i.key, v))} />
            </div>
          )))}
          {!sounds.length ? <div className="xlane"><div className="xlane__nm"><b>这部视频没有声音</b><span>时间轴上一条带声音的轨或元素都没有</span></div></div> : null}
        </div>
        {diff.length
          ? <div className="xnote xnote--row">
              <span>{diff.length} 处与时间轴不同 · 只对这次导出生效</span>
              <BCAction type="button" className="xlink" onClick={syncBack}>同步到时间轴</BCAction>
            </div>
          : <div className="xnote">开关取自时间轴上的启停 · 与视频页共用一份，只对这次导出生效</div>}
        {sounds.some((l) => l.kind === 'orig')
          ? <div className="xnote">原声跟着视频元素走 · 在这里关掉一件，它的画面在视频页也一起不进这次导出</div>
          : null}

        <window.ExportRange ctx={ctx} range={range} setRange={setRange} span={span} pt={ctx.playT || 0} />

        <div className="cpsec">格式与音质</div>
        <div className="xquick">
          <div className="xquick__f">
            <span className="xquick__lb">格式</span>
            <Segmented size="s" value={fmt} onChange={setFmt} items={A.AUDIO_FORMATS.map((x) => ({k: x.k, label: x.label}))} />
          </div>
          {f.lossless ? null : (
            <div className="xquick__f">
              <span className="xquick__lb">码率</span>
              <Segmented size="s" value={kbps} onChange={setKbps} items={A.BITRATES.map((b) => ({k: b, label: b + 'k'}))} />
            </div>
          )}
          <div className="xquick__f">
            <span className="xquick__lb">声道</span>
            <Segmented size="s" value={ch} onChange={setCh} items={A.CHANNELS.map((c) => ({k: c.k, label: c.label}))} />
          </div>
        </div>
        <div className="xnote">{f.note} · {A.qualityLine(fmt, kbps, ch)}</div>
        <div className="xnote">{ch === 'mono'
          ? (f.lossless ? '单声道 · 体积减半 · 纯人声的视频够用' : '单声道不改码率 · 同样的码率都花在一路声音上，人声更干净')
          : '立体声 · 原声与音乐的左右声场照留'}</div>

        {/* 响度标准化（剧情短片 §5.3）：与视频页共用一份状态，缺省关 */}
        {setLoud ? <window.ExportLoudness value={loud} onChange={setLoud} /> : null}

        {voices.length > 1 ? (
          <>
            <div className="cpsec">人声分几份</div>
            <Segmented size="s" value={m} onChange={setMode}
              items={[{k: 'each', label: '每种一份'}, {k: 'one', label: '混成一份'}]} />
            {m === 'one' ? (
              <Picker label="混进这一份的" value={(voices.find((v) => v.id === p) || voices[0]).label} size="s" open={pickOpen}
                onClick={() => setPickOpen((v) => !v)} onClose={() => setPickOpen(false)} popWidth={220}>
                <Menu>
                  {voices.map((v) => <MenuItem key={v.id} label={v.label} check={v.id === p}
                    onClick={() => { setPick(v.id); setPickOpen(false); }} />)}
                </Menu>
              </Picker>
            ) : null}
            <div className="xdub">
              {parts.map((x, n) => (
                <div key={x.key} className="xdub__i">
                  <span className="xdub__n">{parts.length > 1 ? n + 1 : ''}</span>
                  <Ic n="audio" className="ic--14" />
                  <b className="grow t-truncate">{x.label}</b>
                  <span>{x.sub}</span>
                </div>
              ))}
            </div>
            <div className="xnote">{m === 'each'
              ? '一条人声一个文件 · 各带自己的背景声 · 音乐进每一份'
              : '音频文件里切不了语言 · 其余人声不进文件，要就回「每种一份」'}</div>
          </>
        ) : null}

        <div className="xsum">
          <div className="xsum__row"><span>将导出</span><b>{sum.concat(loudTag ? [loudTag] : []).join(' · ')}</b></div>
          {files.slice(0, 4).map((x) => <div key={x.name} className="xsum__row"><span>文件</span><b className="t-mono">{x.name}</b></div>)}
          {files.length > 4 ? <div className="xsum__row"><span>还有</span><b>{files.length - 4} 个文件</b></div> : null}
          {!files.length ? <div className="xsum__row"><span>文件</span><b>至少留一条声音</b></div> : null}
          <div className="xsum__row"><span>预计</span>
            <b>{empty ? '—' : est.eta + ' · 约 ' + (files.length > 1 ? est.totalSize + '（共 ' + files.length + ' 份）' : est.size)}</b></div>
        </div>
        <div className="xacts">
          <Btn variant="secondary" onClick={onClose}>取消</Btn>
          <Btn variant="accent" icon="export" disabled={empty} onClick={start}>导出 {f.label}</Btn>
        </div>
      </>
    );
  }

  Object.assign(window, {ExportAudio});
})();
