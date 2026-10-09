/* 全屏播放器 —— §11.1（第 222 轮）。

   起因：舞台工具条上的「全屏」此前只是把编辑器三区收掉，舞台吃满**内容区**——顶栏、
   侧边栏还在，窗口也还是窗口，所以点下去只占了屏幕的一部分，而且画面上一个播放控件
   都没有：要暂停得先退出全屏。这一轮把它做成一个真正的播放器：

   ① **真全屏**。两层保险：`.pl` 是 `position: fixed; inset: 0`（盖满窗口，任何环境下都成立），
      同时向浏览器要 `requestFullscreen()`（盖满屏幕）。后者可能被拒（iframe、无用户手势、
      用户设置），拒了也只是退回「盖满窗口」，不弹错——观看这件事不该被一个权限打断。
      浏览器自己的 Esc 会直接退出全屏而不经过我们的键盘层，所以 `fullscreenchange` 是
      唯一可信的真相源：它一说不在全屏了，`fs` 就跟着落下来。
   ② **完整控件**。进度条（章节刻痕 + 悬停时间气泡 + 拖拽）· 播放/暂停 · 上一章/下一章 ·
      音量（悬停展开滑杆，点钮静音）· 时间码 · 字幕四档 · 倍速 · 退出全屏。
   ③ **鼠标不动就隐**。判据在 [model-player.js](model-player.js)（3 秒；暂停 / 悬停在条上 /
      拖着东西 / 开着弹层一律不隐），隐的时候连指针一起隐——不然视频上会永远浮着一支箭头。

   画面本身**不重画**：`StageView` 带 `player` 标记复用（元素、模板、字幕、逐词动效、
   播放头都还是同一份），差别只有「不留 32 内边距、不接编辑手势、字幕按档位过滤」。 */
(function () {
  const {useState, useRef, useEffect, useCallback} = React;
  const D = window.BC_DATA;
  const T = window.BC_TIME;
  const PL = window.BC_PLAYER;
  const SUB = window.BC_SUB;
  const TL = window.BC_TL;
  const L = window.BC_LAYOUT;

  /* ---------- 进度条 ---------- */

  function SeekBar({ctx, dur, out, seekOut, onScrub}) {
    const ref = useRef(null);
    const [hoverT, setHoverT] = useState(null);
    const [drag, setDrag] = useState(false);
    const pct = PL.seekPct(out, dur) * 100;
    const ticks = PL.chapterTicks(ctx.chapters, ctx.duration).map((p) => p);

    const timeOf = (clientX) => {
      const el = ref.current; if (!el) return 0;
      const r = el.getBoundingClientRect();
      return PL.timeAt(clientX, {left: r.left, width: r.width}, dur);
    };
    const onDown = (e) => {
      e.preventDefault();
      setDrag(true); onScrub(true);
      seekOut(timeOf(e.clientX));
      const move = (ev) => { setHoverT(timeOf(ev.clientX)); seekOut(timeOf(ev.clientX)); };
      const up = () => {
        setDrag(false); onScrub(false);
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    };
    /* 气泡跟着**指针**走，不是跟着播放头：这是「松手会落到哪一秒」的预告。
       报时间还不够——长片里「01:47」说明不了自己在哪，所以气泡上还有一格画面
       与章节名。缩略帧的配方在 model-timeline.js，与时间轴上视频块那条缩略图带
       同一份：进度条上看见的那一格，就是时间轴上那一段里的那一格。 */
    const hoverTL = hoverT == null ? null : (ctx.tmap ? ctx.tmap.unfold(hoverT) : hoverT);
    const bubble = hoverT == null ? null : PL.chapterAt(ctx.chapters, hoverTL);
    /* 预览格按项目画幅长：竖屏片子给一格 16:9 的预览，是在预告一个不存在的画面。 */
    const ph = Math.min(PL.PREV_MAX_H, Math.round(PL.PREV_W / L.ratioValue(ctx.ratio)));
    const pw = Math.round(ph * L.ratioValue(ctx.ratio));

    return (
      <div className={window.cx('plseek', drag && 'is-drag')} ref={ref}
        onMouseDown={onDown}
        onMouseMove={(e) => setHoverT(timeOf(e.clientX))}
        onMouseLeave={() => { if (!drag) setHoverT(null); }}>
        <div className="plseek__track">
          <div className="plseek__fill" style={{width: pct + '%'}} />
          {ticks.map((p, i) => <i key={i} className="plseek__tick" style={{left: p + '%'}} />)}
          <div className="plseek__knob" style={{left: pct + '%'}} />
        </div>
        {hoverT == null ? null : (
          <div className="plseek__bub" style={{left: PL.seekPct(hoverT, dur) * 100 + '%'}}>
            <div className="plseek__th" style={{width: pw, height: ph,
              background: TL.frameAt(ctx.clips, hoverTL)}} />
            <b className="t-mono">{T.timecode(hoverT)}</b>
            {bubble ? <span>{bubble.title}</span> : null}
          </div>
        )}
      </div>
    );
  }

  /* ---------- 音量：钮 + 悬停展开的滑杆 ---------- */

  function VolumeControl({ctx, onHold}) {
    const {vol, setVol, muted, setMuted} = ctx;
    return (
      <div className="plvol"
        onMouseDown={() => onHold(true)}
        onMouseUp={() => onHold(false)}
        onMouseLeave={() => onHold(false)}>
        <IconBtn icon={PL.volumeIcon(vol, muted)} size="m" className="plbtn"
          tip={muted ? '取消静音 M' : '静音 M'} onClick={() => setMuted(!muted)} />
        <div className="plvol__sl">
          <Slider value={muted ? 0 : vol} step={5}
            onChange={(v) => { setVol(v); setMuted(v === 0); }} />
        </div>
      </div>
    );
  }

  /* 向浏览器要真全屏。**必须在用户手势的那一拍里调用**——浏览器只认 transient
     activation，事后补要一律被拒（拒了不报错，页面会安静地留在窗口里）。所以工具条
     那枚钮直接调它，覆盖层挂载时再要一次兜底（幂等：已经在全屏就什么都不做），
     将来多出别的入口也不至于漏。要不到就退回「盖满窗口」——盖满窗口本身已经是可看的。 */
  function enterFullscreen() {
    const el = document.documentElement;
    if (!el.requestFullscreen || document.fullscreenElement) return;
    const p = el.requestFullscreen();
    if (p && p.catch) p.catch(() => {});
  }

  /* ---------- 全屏播放器 ---------- */

  function PlayerOverlay({ctx}) {
    const {playing, setPlaying, playT, seek, duration, setFs} = ctx;
    const rootRef = useRef(null);
    const [pop, setPop] = useState(null);          // 'caps' | 'speed'
    const [hovering, setHovering] = useState(false);
    const [scrubbing, setScrubbing] = useState(false);
    const [volDragging, setVolDragging] = useState(false);
    /* product-design §5.3：舞台上隐藏了字幕时从关闭起步，否则显示画面上实有的全部字幕 */
    const [capMode, setCapMode] = useState(() => (ctx.subsOn ? PL.defaultCaptionMode(SUB.tracks(ctx.subStyle)) : 'off'));

    /* 成片时钟（第 197 轮，与 transport 同一口径）：已剪段不占时间，进度条与时间码
       都读折过的秒；拖到某一点再折回时间轴时钟去 seek。观看面尤其不能露出缝——
       用户在这里看的就是「成片长什么样」。 */
    const tmap = ctx.tmap;
    const dur = ctx.outDuration || duration;
    const out = tmap ? tmap.fold(playT) : playT;
    const seekOut = useCallback((o) => seek(tmap ? tmap.unfold(o) : o), [tmap, seek]);

    /* ---------- 空闲隐藏 ---------- */
    const [keysOpen, setKeysOpen] = useState(false);
    const [poked, setPoked] = useState(() => Date.now());
    const [tick, setTick] = useState(0);
    const poke = useCallback(() => setPoked(Date.now()), []);
    useEffect(() => {
      /* 只在「有可能隐」的时候起表：暂停时判据恒为 false，没必要每 250ms 醒一次。 */
      if (!playing) return;
      const id = window.setInterval(() => setTick((n) => n + 1), 250);
      return () => window.clearInterval(id);
    }, [playing]);
    /* 键表开着也算「按住」：照着表按键试的时候，条子在手底下消失是最扫兴的一种聪明。 */
    const holding = {playing, hovering, scrubbing, volDragging, pop: pop || (keysOpen ? 'keys' : null),
      idleMs: Date.now() - poked};
    const hidden = PL.chromeHidden(holding);
    void tick;                                     // 计时器只为触发重算，值本身不用

    /* ---------- 真全屏：向浏览器要，要不到就退回盖满窗口 ---------- */
    useEffect(() => {
      enterFullscreen();                          // 兜底；主路在工具条那枚钮的 onClick 上
      /* 浏览器的 Esc 不经过我们的键盘层，所以以 `fullscreenchange` 为准：
         它一说退出了，编辑器那格 `fs` 就跟着落下来，两边不会各说各的。 */
      const sync = () => { if (!document.fullscreenElement) setFs(false); };
      document.addEventListener('fullscreenchange', sync);
      return () => {
        document.removeEventListener('fullscreenchange', sync);
        if (document.fullscreenElement && document.exitFullscreen) {
          const p = document.exitFullscreen();
          if (p && p.catch) p.catch(() => {});
        }
      };
    }, [setFs]);

    /* ---------- 键盘（全屏时播放器独占，见 editor-keys.jsx 的让位） ---------- */
    const capModes = PL.captionModes(SUB.tracks(ctx.subStyle));
    /* 档位上再补一行语言（`原文（English）`）：项目里可能有好几条译文轨，
       只写「译文」两个字的话，用户得先切一次才知道切到了哪一门。 */
    const capTrackLabel = (m) => {
      if (!m.role) return null;
      const t = SUB.tracks(ctx.subStyle)
        .filter((x) => !x.hidden)
        .find((x) => (x.role === 'source') === (m.role === 'source'));
      return t ? SUB.label(t) : null;
    };
    const cycleCaptions = useCallback(() => {
      const keys = capModes.map((m) => m.k);
      setCapMode((k) => keys[(Math.max(0, keys.indexOf(k)) + 1) % keys.length]);
    }, [capModes.map((m) => m.k).join()]);
    useEffect(() => {
      const onKey = (e) => {
        if (window.hasOpenPopover && window.hasOpenPopover() && e.key !== 'Escape') return;
        const a = PL.hotkey(e);
        if (!a) return;
        e.preventDefault(); e.stopPropagation();
        poke();
        const CH = ctx.chapters, TL = window.BC_TIMELINE;
        /* 键表自己接两个键：`?` 开合，Esc 先关表再谈退全屏——开着一张表按 Esc，
           所有人期待的都是「关掉这张表」，不是「连片子一起退出」。 */
        if (a === 'keys') { setKeysOpen(!keysOpen); return; }
        if (a === 'exit' && keysOpen) { setKeysOpen(false); return; }
        if (a === 'play') setPlaying(!playing);
        else if (a === 'exit') setFs(false);
        else if (a === 'mute') ctx.setMuted(!ctx.muted);
        else if (a === 'captions') cycleCaptions();
        else if (a === 'back') seekOut(PL.stepTime(out, -5, dur));
        else if (a === 'fwd') seekOut(PL.stepTime(out, 5, dur));
        else if (a === 'back10') seekOut(PL.stepTime(out, -10, dur));
        else if (a === 'fwd10') seekOut(PL.stepTime(out, 10, dur));
        else if (a === 'prev-chapter') seek(TL.prevChapterStart(CH, playT));
        else if (a === 'next-chapter') seek(TL.nextChapterStart(CH, playT));
        else if (a === 'vol-up') { ctx.setVol(PL.stepVolume(ctx.vol, 10)); ctx.setMuted(false); }
        else if (a === 'vol-down') { const v = PL.stepVolume(ctx.vol, -10); ctx.setVol(v); ctx.setMuted(v === 0); }
        else if (a === 'start') seekOut(0);
        else if (a === 'end') seekOut(dur);
        else if (/^pct-/.test(a)) seekOut(PL.pctTime(a, dur));
      };
      window.addEventListener('keydown', onKey, true);
      return () => window.removeEventListener('keydown', onKey, true);
    });

    const chapter = PL.chapterAt(ctx.chapters, playT);
    const btn = PL.playButtonState({playing, out, dur}), atEnd = btn === 'replay';   // 与 transport 同一条判据
    const capLabel = (capModes.find((m) => m.k === capMode) || capModes[0]).label;

    return (
      <div className={window.cx('pl', hidden && 'is-idle')} ref={rootRef}
        onMouseMove={poke}
        /* 画面上单击 = 播放/暂停，双击 = 退出全屏（双击时那两下先各切一次播放，
           净效果不变，与常见播放器一致）。点在 chrome 上的不算——那一层自己吞掉。 */
        onClick={(e) => { if (!e.target.closest('.pl__chrome')) { poke(); setPlaying(!playing); } }}
        onDoubleClick={(e) => { if (!e.target.closest('.pl__chrome')) setFs(false); }}>
        <div className="pl__view">
          <window.StageView ctx={ctx} player={{capMode}} />
        </div>

        <div className="pl__chrome" onClick={(e) => e.stopPropagation()}>
          <div className="pl__top">
            <div className="pl__title">{ctx.proj.title}</div>
            {chapter ? <div className="pl__sub">{chapter.title}</div> : null}
          </div>

          {keysOpen ? (
            <div className="plkeys" onClick={() => setKeysOpen(false)}>
              <div className="plkeys__card" onClick={(e) => e.stopPropagation()}>
                <div className="plkeys__hd">键盘快捷键</div>
                {PL.KEYS.map((r) => (
                  <div className="plkeys__row" key={r.a}>
                    <span className="grow">{r.label}</span>
                    <i className="plkeys__k t-mono">{r.keys}</i>
                  </div>
                ))}
                <div className="plkeys__ft">按 Esc 关掉这张表，再按一次退出全屏。</div>
              </div>
            </div>
          ) : null}

          <div className="pl__bar"
            onMouseEnter={() => { setHovering(true); poke(); }}
            onMouseLeave={() => setHovering(false)}>
            <SeekBar ctx={ctx} dur={dur} out={out} seekOut={seekOut} onScrub={setScrubbing} />

            <div className="pl__row">
              <IconBtn icon={PL.PLAY_ICON[btn]} size="l" className="plbtn plbtn--play"
                tip={atEnd ? '重播' : playing ? '暂停 Space' : '播放 Space'}
                onClick={() => { if (atEnd) seekOut(0); setPlaying(atEnd ? true : !playing); }} />
              <IconBtn icon="prev" size="m" className="plbtn" tip="上一章 ⇧←"
                onClick={() => seek(window.BC_TIMELINE.prevChapterStart(ctx.chapters, playT))} />
              <IconBtn icon="next" size="m" className="plbtn" tip="下一章 ⇧→"
                onClick={() => seek(window.BC_TIMELINE.nextChapterStart(ctx.chapters, playT))} />
              <VolumeControl ctx={ctx} onHold={setVolDragging} />
              <span className="pl__tc t-mono">
                {T.timecode(out)}<i> / {T.timecode(dur)}</i>
              </span>

              <div className="spacer" />

              <div style={{position: 'relative'}}>
                <IconBtn icon="captions" size="m" className="plbtn" on={capMode !== 'off'}
                  tip={'字幕 · ' + capLabel + ' · C'}
                  onClick={() => setPop(pop === 'caps' ? null : 'caps')} />
                <Popover open={pop === 'caps'} onClose={() => setPop(null)} dir="up" align="right"
                  width={186}>
                  <Menu>
                    <MenuHead>字幕</MenuHead>
                    {capModes.map((m) => (
                      <MenuItem key={m.k} label={m.label} on={m.k === capMode}
                        sub={capTrackLabel(m)}
                        onClick={() => { setCapMode(m.k); setPop(null); }} />
                    ))}
                  </Menu>
                </Popover>
              </div>

              <div style={{position: 'relative'}}>
                <BCAction className="plspeed" onClick={() => setPop(pop === 'speed' ? null : 'speed')}>
                  {ctx.speed}x
                </BCAction>
                <Popover open={pop === 'speed'} onClose={() => setPop(null)} dir="up" align="right"
                  width={128}>
                  <Menu>
                    {D.speeds.map((s) => (
                      <MenuItem key={s} label={s + 'x'} on={s === ctx.speed}
                        onClick={() => { ctx.setSpeed(s); setPop(null); }} />
                    ))}
                  </Menu>
                </Popover>
              </div>

              <IconBtn icon="help" size="m" className="plbtn" on={keysOpen} tip="键盘快捷键 ?"
                onClick={() => setKeysOpen(!keysOpen)} />
              <IconBtn icon="exitfs" size="m" className="plbtn" tip="退出全屏 Esc"
                onClick={() => setFs(false)} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  Object.assign(window, {PlayerOverlay, enterFullscreen});
})();
