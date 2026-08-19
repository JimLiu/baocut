// BaoCut Subtitle Studio — 全屏播放 chrome（YouTube 式），只在 StagePane 处于
// 全屏时挂载。player/doc 状态仍归 store.jsx 所有，进出全屏不会产生第二个播放器。
//
// 固定对比度：黑底白控件在浅色/深色下必须完全一致，所以这一层的颜色不走
// light-dark() 令牌（designs/baocut-mac/CLAUDE.md 对全屏 chrome 的同款豁免）。
// 对应原型 designs/baocut-mac/app/stage-fullscreen.jsx。
(() => {
  const { useState, useRef, useEffect, useCallback } = React;
  const { Ic, QBtn, Pop, Menu, fmt, fmtT } = window;
  const TR = window.BCS_TRANSPORT;

  function FullscreenIconButton({ icon, tip, selected, onClick, refEl, className = '', children }) {
    return (
      <button ref={refEl}
        className={'vk-fsbar__btn' + (selected ? ' vk-fsbar__btn--selected' : '') + (className ? ' ' + className : '')}
        data-tip={tip} data-tip-dir="up" aria-label={tip}
        onClick={(e) => { e.stopPropagation(); onClick && onClick(e); }}>
        {children || <Ic name={icon} size={20} />}
      </button>
    );
  }

  // app：store.jsx 的 useApp() 值；player 单独传，因为它每帧都变（usePlayer 订阅）。
  function FullscreenBar({ app, player, duration, onIdle, onExit }) {
    const end = Math.max(0, duration || 0);
    const current = Math.max(0, Math.min(end, player.t || 0));
    const replay = TR.isReplay(player.playing, current, end);
    const progress = end > 0 ? Math.max(0, Math.min(1, current / end)) : 0;
    const [hidden, setHidden] = useState(false);
    const [dragging, setDragging] = useState(false);
    const [volOpen, setVolOpen] = useState(false);
    const [speedOpen, setSpeedOpen] = useState(false);
    const idleTimer = useRef(null);
    const dragCleanup = useRef(null);
    const hiddenRef = useRef(false);
    const playingRef = useRef(player.playing);
    const holdOpenRef = useRef(false);
    const overBar = useRef(false);
    const seekRef = useRef(null);
    const volRef = useRef(null);
    const speedRef = useRef(null);

    const clearIdle = useCallback(() => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = null;
    }, []);

    const setIdle = useCallback((value) => {
      hiddenRef.current = value;
      setHidden(value);
    }, []);

    // 只有播放中、指针不在条上、没有打开浮层时才自动隐藏。
    const armIdle = useCallback(() => {
      clearIdle();
      if (!playingRef.current || overBar.current || holdOpenRef.current) return;
      idleTimer.current = setTimeout(() => {
        idleTimer.current = null;
        if (playingRef.current && !overBar.current && !holdOpenRef.current) setIdle(true);
      }, 3000);
    }, [clearIdle, setIdle]);

    const poke = useCallback(() => {
      if (hiddenRef.current) setIdle(false);
      armIdle();
    }, [armIdle, setIdle]);

    useEffect(() => {
      playingRef.current = player.playing;
      holdOpenRef.current = volOpen || speedOpen;
      if (!player.playing || volOpen || speedOpen) {
        clearIdle();
        setIdle(false);
      } else {
        poke();
      }
    }, [player.playing, volOpen, speedOpen, clearIdle, poke, setIdle]);

    useEffect(() => {
      const move = () => poke();
      const key = () => poke();
      window.addEventListener('mousemove', move);
      window.addEventListener('keydown', key);
      return () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('keydown', key);
        if (dragCleanup.current) dragCleanup.current();
        clearIdle();
        onIdle(false);
      };
    }, [clearIdle, onIdle, poke]);

    useEffect(() => { onIdle(hidden); }, [hidden, onIdle]);

    // 全屏键位（Mac EditorPageInteraction.handleFullscreenKey:195-217，原型
    // editor.jsx:253-282）：K 播放/暂停 · ←/→ ±5s · J/L ±10s · ↑/↓ 音量 ±5% ·
    // M 静音 · C 字幕显隐 · F 退出。这一层随全屏 chrome 一起挂载/卸载，所以
    // 不必再判一次 fullscreen；每个动作写回的都是条上同名按钮写的那份 player
    // 状态（store.jsx 唯一真相），没有第二套音量/静音/字幕开关。
    useEffect(() => {
      const isTyping = () => {
        const el = document.activeElement;
        return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      };
      const onKey = (e) => {
        if (e.metaKey || e.ctrlKey || e.altKey || isTyping()) return;
        const action = TR.fullscreenKeyAction(e.key, e.code);
        if (!action) return;
        // 空格归 main.jsx 的全局处理器（窗口态与全屏态同一语义），两处都接的话
        // 一次按键会 toggle 两次；K 只有全屏态才有，留在这里。
        if (action.type === 'togglePlay' && e.code === 'Space') return;
        e.preventDefault();
        // 长按连发只对连续量（seek / 音量）有意义，开关类按一次就是一次。
        if (e.repeat && action.type !== 'seek' && action.type !== 'volume') return;
        if (action.type === 'togglePlay') { app.togglePlay(); return; }
        if (action.type === 'seek') {
          // 从 ref 读当前时间：player.t 每帧都变，进依赖数组会让监听器每帧重绑。
          app.seek(app.playerRef.current.t + action.delta);
          return;
        }
        if (action.type === 'volume') {
          app.setPlayer((p) => ({
            ...p,
            vol: Math.max(0, Math.min(1, p.vol + action.delta)),
            muted: action.delta > 0 ? false : p.muted,
          }));
          return;
        }
        if (action.type === 'mute') { app.setPlayer((p) => ({ ...p, muted: !p.muted })); return; }
        if (action.type === 'subs') { app.setPlayer((p) => ({ ...p, showSubs: !p.showSubs })); return; }
        if (action.type === 'exit') onExit();
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [app.seek, app.setPlayer, app.togglePlay, app.playerRef, onExit]);

    const seekAt = (clientX) => {
      const el = seekRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
      app.seek(f * end);
    };

    const seekDown = (e) => {
      e.preventDefault();
      e.stopPropagation();
      poke();
      setDragging(true);
      seekAt(e.clientX);
      const move = (ev) => seekAt(ev.clientX);
      const remove = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
        dragCleanup.current = null;
      };
      const up = (ev) => {
        seekAt(ev.clientX);
        setDragging(false);
        remove();
        armIdle();
      };
      const cancel = () => { setDragging(false); remove(); armIdle(); };
      if (dragCleanup.current) dragCleanup.current();
      dragCleanup.current = remove;
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
    };

    const volIcon = player.muted || player.vol === 0 ? 'volume-mute'
      : player.vol < 0.34 ? 'volume-low'
      : player.vol < 0.67 ? 'volume-med' : 'volume';
    const rate = TR.normalizeRate(player.rate);

    return (
      <div className={'vk-fsbar' + (hidden ? ' vk-fsbar--hidden' : '')}
        aria-hidden={hidden}
        inert={hidden ? '' : undefined}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerEnter={() => { overBar.current = true; clearIdle(); setIdle(false); }}
        onPointerLeave={() => { overBar.current = false; armIdle(); }}>
        <div ref={seekRef}
          className={'vk-fsbar__seek' + (dragging ? ' vk-fsbar__seek--dragging' : '')}
          role="slider" tabIndex="0" aria-label="播放位置"
          aria-valuemin="0" aria-valuemax={Math.round(end)} aria-valuenow={Math.round(current)}
          onPointerDown={seekDown}>
          <div className="vk-fsbar__track">
            <div className="vk-fsbar__fill" style={{ width: (progress * 100) + '%' }}></div>
            <span className="vk-fsbar__thumb" style={{ left: (progress * 100) + '%' }}></span>
          </div>
        </div>

        <div className="vk-fsbar__controls">
          <FullscreenIconButton tip={player.playing ? '暂停（空格）'
            : replay ? '从头重播（空格）' : '播放（空格）'}
            onClick={app.togglePlay}>
            {player.playing
              ? <span className="vk-fsbar__pause" aria-hidden="true"><i></i><i></i></span>
              : <Ic name={replay ? 'refresh' : 'play'} size={20} />}
          </FullscreenIconButton>
          <span className="vk-fsbar__time vk-mono">{fmtT(current)}<span> / {fmt(end)}</span></span>
          <span className="vk-spacer"></span>
          <FullscreenIconButton refEl={speedRef} className="vk-fsbar__speed"
            tip={'播放速度 · ' + rate + '×'} onClick={() => setSpeedOpen(true)}>
            <span>{rate + '×'}</span>
          </FullscreenIconButton>
          {speedOpen ? (
            <Menu anchorRef={speedRef} onClose={() => setSpeedOpen(false)} dir="up" align="end" width={128}
              className="vk-fsbar__speedpop"
              items={TR.RATES.map((r) => ({
                label: r + '×', suffix: rate === r ? '✓' : undefined,
                onClick: () => app.setPlayer((p) => ({ ...p, rate: r })),
              }))} />
          ) : null}
          <FullscreenIconButton refEl={volRef} icon={volIcon} tip="音量" onClick={() => setVolOpen(true)} />
          {volOpen ? (
            <Pop anchorRef={volRef} onClose={() => setVolOpen(false)} dir="up" align="center" width={210} className="vk-fsbar__volpop">
              <div className="vk-row">
                <QBtn icon={player.muted ? 'volume-mute' : 'volume'} size="S" tip={player.muted ? '取消静音' : '静音'}
                  onClick={() => app.setPlayer((p) => ({ ...p, muted: !p.muted }))} />
                <input type="range" min="0" max="1" step="0.01" value={player.muted ? 0 : player.vol}
                  style={{ flex: 1 }}
                  onChange={(e) => app.setPlayer((p) => ({ ...p, vol: parseFloat(e.target.value), muted: false }))}
                  aria-label="音量" />
                <span className="vk-mono" style={{ width: 28, textAlign: 'right', fontSize: 11 }}>
                  {Math.round((player.muted ? 0 : player.vol) * 100)}
                </span>
              </div>
            </Pop>
          ) : null}
          <FullscreenIconButton icon="captions" tip={player.showSubs ? '隐藏字幕' : '显示字幕'}
            selected={player.showSubs}
            onClick={() => app.setPlayer((p) => ({ ...p, showSubs: !p.showSubs }))} />
          <FullscreenIconButton icon="fullscreen-exit" tip="退出全屏（Esc）" onClick={onExit} />
        </div>
      </div>
    );
  }

  Object.assign(window, { BCSFullscreenBar: FullscreenBar });
})();
