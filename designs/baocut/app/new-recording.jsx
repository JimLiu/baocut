/* 录制的入口与过程（product-design §3.2.1、§4.8、§5.9；屏幕录制设计 docs/design/screen-recording §4、§11、§13）。只在 App 入口加载。
     · 入口：Home 快捷开始标题行尾的「录制」、Space「新建」菜单的「录制新视频」、编辑器视频素材栏的「录制」、
       智能体会话里的录制卡（`record` 工具，面板按它的请求预先填好）。四处都打开同一块录制面板（`BC_RECORDER.open`）。
     · 面板 → 控制条：开始后只剩一个小控制条（真实应用里是一个独立的置顶窗口，录制时 BaoCut 收起）。原型不真的录，
       控制条只走倒计时、计时、暂停与收尾；停止时按面板的选择从示例录制裁出一段（BC_REC.takeFrom）。
     · Home 顶上的「没有收完的录制」：恢复，或删掉录下的文件（要确认，不能撤销）。
     · 设置 › 通用 ›「屏幕录制」：三个全局快捷键、缺省帧率、缺省倒计时、录制时收起 BaoCut。
   演示里的屏幕、窗口与设备名都是虚构的。「把 BaoCut 也录进去」、磁盘空间提醒、「开始录制」快捷键、缺省帧率与倒计时
   是原型先行的部分（BC_REC 文件头）。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;
  const REC = window.BC_REC;

  const DISPLAYS = [
    {id: 'd1', label: '内建显示器（2560 × 1600）· 主屏幕', w: 2560, h: 1600},
    {id: 'd2', label: '外接显示器（3840 × 2160）', w: 3840, h: 2160},
  ];
  const WINDOWS = [
    {id: 'w1', label: '文稿编辑器 — 第 5 讲提纲', w: 1680, h: 1050},
    {id: 'w2', label: '浏览器 — 课程主页', w: 1920, h: 1200},
    {id: 'w3', label: '终端 — build', w: 1280, h: 800},
  ];
  /* 项目所在那块磁盘的剩余空间（演示值）：内建屏 30 fps 够录，外接 4K 屏会出提醒 */
  const FREE_BYTES = 4.8e9;
  const CAMERAS = [{id: 'none', label: '不用'}, {id: 'c1', label: '内建摄像头'}];
  const MICS = [{id: 'none', label: '不用'}, {id: 'default', label: '系统默认'}, {id: 'm1', label: '外接麦克风'}];
  /* 光标三选一：另画光标之后能在编辑器里改大小、隐藏，也是自动缩放跟随的依据；录进画面之后改不了。 */
  const CURSORS = [
    {id: 'separate', label: '另画光标', note: '之后可以改光标大小，或者隐藏。'},
    {id: 'baked', label: '录进画面', note: ''},
    {id: 'none', label: '不要光标', note: '没有光标，也就没有自动缩放。'},
  ];
  const KEYS = [
    {id: 'off', label: '不录', note: ''},
    {id: 'shortcuts', label: '只录快捷键', note: ''},
    {id: 'all', label: '全部按键', note: '全部按键会录下你输入的文字。'},
  ];
  const COUNTDOWNS = [{id: '0', label: '不倒计时'}, {id: '3', label: '3 秒'}, {id: '5', label: '5 秒'}];

  /* ---------- 设置（本机记住；读写包在 try 里，存不下就用缺省） ---------- */

  const SETTINGS_KEY = () => window.BC_SURFACE.storageKey('bc-recording-settings');
  function loadSettings() {
    try {
      const raw = window.localStorage.getItem(SETTINGS_KEY());
      const v = raw ? JSON.parse(raw) : null;
      return Object.assign({}, REC.SETTINGS_DEFAULTS, v, {shortcuts: Object.assign({}, REC.SETTINGS_DEFAULTS.shortcuts, v && v.shortcuts)});
    } catch (e) { return Object.assign({}, REC.SETTINGS_DEFAULTS); }
  }
  function saveSettings(v) {
    try { window.localStorage.setItem(SETTINGS_KEY(), JSON.stringify(v)); } catch (e) { /* 存不下：这一次照常生效 */ }
  }

  /* ---------- 录制宿主的状态：一次只有一个面板 / 控制条；智能体的请求各记各的状态 ---------- */

  const store = {session: null, requests: {}, takes: 0, subs: new Set()};
  const emit = () => store.subs.forEach((f) => f());
  function useRecorder() {
    const [, tick] = useState(0);
    useEffect(() => {
      const f = () => tick((n) => n + 1);
      store.subs.add(f);
      return () => { store.subs.delete(f); };
    }, []);
    return store;
  }
  const setRequest = (id, patch) => {
    store.requests = Object.assign({}, store.requests, {[id]: Object.assign({}, store.requests[id], patch)});
    emit();
  };
  /**
   * 打开录制面板。`mode`：`new`（Home / Space：录成一个新视频）、`into`（编辑器：放到这部视频播放头处的新轨道上，
   * 停止时调 `onDone({rec, sources})`）、`agent`（会话里的录制卡：`request` 预先填好面板）。正在录时不再开第二个。
   */
  function open(opts) {
    if (store.session) return false;
    store.session = Object.assign({phase: 'panel'}, opts);
    if (opts.mode === 'agent' && opts.request) setRequest(opts.request.id, {state: 'waiting'});
    emit();
    return true;
  }
  const busy = () => !!store.session;
  window.BC_RECORDER = {open, busy, subscribe: (f) => { store.subs.add(f); return () => store.subs.delete(f); }};

  function Pick({label, items, value, onChange, isDisabled}) {
    return <R.Picker label={label} selectedKey={value} onSelectionChange={(k) => onChange(String(k))} isDisabled={isDisabled}>
      {items.map((x) => <R.PickerItem key={x.id} id={x.id}>{x.label}</R.PickerItem>)}
    </R.Picker>;
  }

  /** 录制面板：录什么、设备、光标与键盘、帧率、倒计时。区域框选还没有（与实现一致）。`request` 是智能体预先填好的选项。 */
  function RecordingDialog({mode, request, onClose, onStart}) {
    const pre = request || {};
    const settings = loadSettings();
    const [source, setSource] = useState(pre.source || 'display');
    const [display, setDisplay] = useState('d1');
    const [win, setWin] = useState('w1');
    const [includeSelf, setIncludeSelf] = useState(false);
    const [camera, setCamera] = useState(pre.camera || 'none');
    const [mic, setMic] = useState(pre.mic || 'default');
    const [system, setSystem] = useState(!!pre.system);
    const [cursor, setCursor] = useState(pre.cursor || 'separate');
    const [keys, setKeys] = useState('shortcuts');
    const [fps, setFps] = useState(settings.fps);
    const [countdown, setCountdown] = useState(settings.countdown);
    const cursorNote = CURSORS.find((x) => x.id === cursor).note;
    const keysNote = KEYS.find((x) => x.id === keys).note;
    const target = source === 'window' ? WINDOWS.find((w) => w.id === win) : DISPLAYS.find((d) => d.id === display);
    const disk = REC.diskLine(FREE_BYTES, REC.bytesPerMinute(target.w, target.h, Number(fps), camera !== 'none'));
    const title = mode === 'agent' ? '为这条会话录制' : mode === 'into' ? '录制到这部视频' : '录制屏幕';
    return <R.DialogContainer onDismiss={onClose}>
      <R.Dialog size="M">
        {({close}) => <>
          <R.Heading slot="title">{title}</R.Heading>
          <R.Content>
            <div className="nrec">
              {mode === 'agent' ? <p className="nrec__lead">智能体请你录一段。核对一下选项，准备好了再开始。</p>
                : mode === 'into' ? <p className="nrec__lead">录好的屏幕、摄像头与声音放在播放头处的新轨道上，一起移动、拆分、修剪。</p> : null}
              <R.RadioGroup label="录什么" orientation="horizontal" value={source} onChange={setSource}>
                <R.Radio value="display">整块屏幕</R.Radio>
                <R.Radio value="window">一个窗口</R.Radio>
                <R.Radio value="area" isDisabled>一个区域</R.Radio>
              </R.RadioGroup>
              {source === 'window'
                ? <Pick label="窗口" items={WINDOWS} value={win} onChange={setWin} />
                : <Pick label="屏幕" items={DISPLAYS} value={display} onChange={setDisplay} />}
              {REC.showsIncludeSelf(source) ? <R.Switch isSelected={includeSelf} onChange={setIncludeSelf}>把 BaoCut 也录进去</R.Switch> : null}
              <p className="nrec__note">{REC.showsIncludeSelf(source) ? REC.selfNote(source, includeSelf) + ' ' : ''}在屏幕上框选区域还不支持。</p>
              <div className="nrec__pair">
                <Pick label="摄像头" items={CAMERAS} value={camera} onChange={setCamera} />
                <Pick label="麦克风" items={MICS} value={mic} onChange={setMic} />
              </div>
              <R.Switch isSelected={system} onChange={setSystem}>系统声音</R.Switch>
              <p className="nrec__note">这台电脑上各个应用放出的声音</p>
              <div className="nrec__pair">
                <Pick label="鼠标" items={CURSORS} value={cursor} onChange={setCursor} />
                <Pick label="键盘" items={KEYS} value={keys} onChange={setKeys} />
              </div>
              {cursorNote || keysNote ? <p className="nrec__note">{[cursorNote, keysNote].filter(Boolean).join(' ')}</p> : null}
              <div className="nrec__pair">
                <Pick label="帧率" items={REC.FPS} value={fps} onChange={setFps} />
                <Pick label="倒计时" items={COUNTDOWNS} value={countdown} onChange={setCountdown} />
              </div>
              {disk.low ? <R.InlineAlert variant="notice">
                <R.Heading>{disk.title}</R.Heading>
                <R.Content>{disk.text}</R.Content>
              </R.InlineAlert> : <p className="nrec__note">{disk.text}</p>}
            </div>
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" onPress={() => onStart({countdown: Number(countdown), camera, mic, system, cursor, source, hide: settings.hideWindow})}>开始录制</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  /** 录制中的控制条：倒计时 → 计时；暂停与继续；停止收尾；丢弃要确认（不能撤销）。`onTick` 把状态报给录制卡。 */
  function RecordingBar({countdown, onStop, onDiscard, onTick}) {
    const [left, setLeft] = useState(countdown);
    const [elapsed, setElapsed] = useState(0);
    const [paused, setPaused] = useState(false);
    const [asking, setAsking] = useState(false);
    useEffect(() => {
      if (paused || asking) return undefined;
      const id = setInterval(() => {
        if (left > 0) setLeft((n) => n - 1);
        else setElapsed((n) => n + 1);
      }, 1000);
      return () => clearInterval(id);
    }, [left, paused, asking]);
    useEffect(() => { if (onTick) onTick(left > 0 ? {state: 'countdown', left} : {state: paused ? 'paused' : 'recording', elapsed}); }, [left, elapsed, paused]);
    const status = left > 0 ? `${left} 秒后开始…` : paused ? `已暂停 · ${REC.clock(elapsed)}` : `正在录制 · ${REC.clock(elapsed)}`;
    return <div className="nrec-bar" role="toolbar" aria-label="录制控制条">
      <span className={cx('nrec-bar__dot', (paused || left > 0) && 'is-idle')} aria-hidden="true" />
      <span className="nrec-bar__status" role="status">{status}</span>
      {asking ? <>
        <span className="nrec-bar__ask">丢弃这次录制？录下的内容不能找回。</span>
        <R.ActionButton size="S" isQuiet onPress={() => setAsking(false)}>继续录</R.ActionButton>
        <R.Button size="S" variant="negative" onPress={onDiscard}>丢弃</R.Button>
      </> : <>
        <R.ActionButton size="S" isQuiet isDisabled={left > 0} onPress={() => setPaused((p) => !p)}>{paused ? '继续' : '暂停'}</R.ActionButton>
        <R.ActionButton size="S" isQuiet onPress={() => setAsking(true)}>丢弃</R.ActionButton>
        <R.Button size="S" variant="accent" isDisabled={left > 0} onPress={() => onStop(elapsed)}>停止</R.Button>
      </>}
    </div>;
  }

  /** 录制面板与控制条的宿主：挂在 App 根上，四个入口共用。 */
  function RecordingHost() {
    const app = useApp();
    const st = useRecorder();
    const s = st.session;
    if (!s) return null;
    const req = s.mode === 'agent' && s.request ? s.request : null;
    const end = () => { st.session = null; emit(); };
    const demoProject = () => window.BC_DATA.projects.find((p) => p.recording);
    if (s.phase === 'panel') {
      return <RecordingDialog mode={s.mode} request={req}
        onClose={() => {
          end();
          if (req) { setRequest(req.id, {state: 'cancelled'}); app.toast('已取消录制。'); }
        }}
        onStart={(choice) => {
          st.session = Object.assign({}, s, {phase: 'bar', choice});
          emit();
          if (choice.hide) app.toast('录制时 BaoCut 会收起，屏幕上只留控制条');
        }} />;
    }
    return <RecordingBar countdown={s.choice.countdown}
      onTick={req ? (x) => setRequest(req.id, x) : null}
      onDiscard={() => { end(); if (req) setRequest(req.id, {state: 'discarded'}); app.toast('录制已丢弃。'); }}
      onStop={(seconds) => {
        end();
        st.takes += 1;
        if (s.mode === 'into') {
          const take = REC.takeFrom(window.BC_DATA.recordingDemo, st.takes, Object.assign({seconds: Math.max(seconds, 24)}, s.choice), window.BC_DATA.recordingSources);
          if (s.onDone) s.onDone(take);
          app.toast(`录好了（${REC.clock(take.rec.duration)}），已放到播放头处的新轨道上`, 'positive');
          return;
        }
        const p = demoProject();
        if (req) setRequest(req.id, {state: 'done', elapsed: p.recording.duration, title: p.title, project: p.id});
        app.toast(`录好了（${REC.clock(p.recording.duration)}），已放进新视频「${p.title}」`, 'positive',
          {label: '打开', run: () => app.go({r: 'editor', id: p.id})});
      }} />;
  }

  /** Home 快捷开始标题行尾的「录制」。 */
  function HomeRecord() {
    const st = useRecorder();
    return <R.TooltipTrigger placement="bottom">
      <R.ActionButton isQuiet size="S" isDisabled={!!st.session} onPress={() => open({mode: 'new'})}>
        <R.Icons.DeviceLaptop /><R.Text>录制</R.Text>
      </R.ActionButton>
      <R.Tooltip>不经过智能体，把屏幕录成一个新视频</R.Tooltip>
    </R.TooltipTrigger>;
  }

  /** Home 顶上的「没有收完的录制」（§11）：恢复后打开放进去的视频；删除要确认，不能撤销。 */
  function HomeRecovery() {
    const app = useApp();
    const [gone, setGone] = useState([]);
    const list = (window.BC_DATA.recordingRecovery || []).filter((r) => gone.indexOf(r.id) < 0);
    const r = REC.recoveryText(list);
    if (!r) return null;
    const p = window.BC_DATA.projects.find((x) => x.recording);
    const recover = () => {
      setGone((g) => g.concat([r.id]));
      app.toast('已恢复录制，放进了新视频', 'positive', {label: '打开', run: () => app.go({r: 'editor', id: p.id})});
    };
    const remove = () => app.confirm({title: '删除这次录制？', body: '录下的文件会被删除，不能撤销。', tone: 'negative', confirmLabel: '删除',
      run: () => { setGone((g) => g.concat([r.id])); app.toast('已删除录制。'); }});
    return <div className="nrec-recover" role="region" aria-label={r.title}>
      <span className="nrec-recover__ic"><Ic n="alert" className="ic--16" /></span>
      <div className="nrec-recover__b">
        <div className="t-title-sm">{r.title}</div>
        <div className="t-detail">{r.body}</div>
        {r.more ? <div className="t-detail-xs nrec-recover__more">{r.more}</div> : null}
      </div>
      <Btn variant="secondary" size="s" onClick={remove}>删除</Btn>
      <Btn variant="accent" size="s" onClick={recover}>恢复</Btn>
    </div>;
  }

  /** 会话里智能体的录制卡（§13）：等你开始 → 倒计时 / 正在录制 → 已放进视频；面板按请求预先填好。 */
  function RecordingCard({request}) {
    const app = useApp();
    const st = useRecorder();
    const r = st.requests[request.id] || {state: 'waiting'};
    const line = REC.cardLine(r.state, r);
    const other = !!st.session && !(st.session.request && st.session.request.id === request.id);
    const act = () => {
      if (line.action === 'panel') open({mode: 'agent', request});
      else if (line.action === 'video') app.go({r: 'editor', id: r.project || request.project});
    };
    const failed = line.tone === 'negative';
    return <section className={cx('dlcard', 'nrec-card', `is-${r.state}`)} aria-label="屏幕录制">
      <header className="dlcard__head">
        <span className="dlcard__ic"><Ic n={failed ? 'alert' : 'video'} className="ic--16" /></span>
        <span className="dlcard__titles">
          <span className="dlcard__title">屏幕录制</span>
          <span className="dlcard__name">{request.source === 'window' ? '一个窗口' : '整块屏幕'}{request.camera && request.camera !== 'none' ? ' · 摄像头' : ''}{request.mic && request.mic !== 'none' ? ' · 麦克风' : ''}</span>
        </span>
        {line.live ? <span className="nrec-card__live" aria-hidden="true" /> : null}
      </header>
      <span className={cx('dlcard__line', failed && 'dlcard__err')} role="status">{line.text}</span>
      {line.action ? <div className="dlcard__foot">
        <span className="dlcard__time" />
        <Btn variant={line.action === 'panel' ? 'accent' : 'secondary'} size="s" disabled={line.action === 'panel' && other} onClick={act}>{line.actionLabel}</Btn>
      </div> : null}
    </section>;
  }

  /** 设置 › 通用 ›「屏幕录制」。快捷键点一次进录制态，再点一次落一个演示绑定（真 App 捕获真实按键）。 */
  function RecordingSettingsGroup() {
    const app = useApp();
    const Row = window.ShellRow;
    const [v, setV] = useState(loadSettings);
    const [rec, setRec] = useState(null);
    const put = (patch) => setV((s) => { const n = Object.assign({}, s, patch); saveSettings(n); return n; });
    return <section className="setpage__group" aria-label="屏幕录制">
      <h2>屏幕录制</h2>
      <div className="setpage__card">
        {REC.SHORTCUT_ROWS.map((r) => <Row key={r.k} label={r.label} desc={r.desc}>
          <BCAction className={cx('chip', 'chip--click', rec === r.k && 'is-on')}
            style={{fontFamily: 'var(--mono)', minWidth: 68, justifyContent: 'center'}}
            onClick={() => {
              if (rec === r.k) {
                put({shortcuts: Object.assign({}, v.shortcuts, {[r.k]: '⌃⌥' + v.shortcuts[r.k].slice(-1)})});
                setRec(null);
                app.toast('已改绑（原型落一个演示绑定；真 App 捕获真实按键）');
              } else setRec(r.k);
            }}>
            {rec === r.k ? '按下按键…' : v.shortcuts[r.k]}
          </BCAction>
        </Row>)}
        <Row label="缺省帧率" desc="录制面板里的帧率从这里起。60 fps 的文件大约大一倍。">
          <Segmented size="s" value={v.fps} onChange={(x) => put({fps: x})} items={REC.FPS.map((f) => ({k: f.id, label: f.label}))} />
        </Row>
        <Row label="缺省倒计时">
          <Segmented size="s" value={v.countdown} onChange={(x) => put({countdown: x})} items={COUNTDOWNS.map((c) => ({k: c.id, label: c.label}))} />
        </Row>
        <Row label="录制时收起 BaoCut" desc="屏幕上只留一个小控制条，它不会被录进去。">
          <Switch ariaLabel="录制时收起 BaoCut" on={v.hideWindow} onChange={(x) => put({hideWindow: x})} />
        </Row>
      </div>
      <div className="signpost" style={{marginTop: 8}}>录制中在任何地方都能用，BaoCut 收起时也一样。</div>
    </section>;
  }

  Object.assign(window, {HomeRecord, HomeRecovery, RecordingHost, RecordingCard, RecordingSettingsGroup, RecordingDialog, RecordingBar});
})();
