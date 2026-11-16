/* Home 的「录制」（product-design §3.2.1；屏幕录制设计 docs/design/screen-recording §4）：
   快捷开始标题行尾的「录制」不经过 Agent，打开录制面板；开始后只剩一个小控制条（真实应用里是一个独立的置顶窗口，
   录制时 BaoCut 收起）。原型不真的录，控制条只走计时、暂停与收尾三种状态。演示里的屏幕、窗口与设备名都是虚构的。 */
(function () {
  const {useState, useEffect} = React;
  const R = window.RSP;

  const DISPLAYS = [
    {id: 'd1', label: '内建显示器（2560 × 1600）· 主屏幕'},
    {id: 'd2', label: '外接显示器（3840 × 2160）'},
  ];
  const WINDOWS = [
    {id: 'w1', label: '文稿编辑器 — 第 5 讲提纲'},
    {id: 'w2', label: '浏览器 — 课程主页'},
    {id: 'w3', label: '终端 — build'},
  ];
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

  function Pick({label, items, value, onChange, isDisabled}) {
    return <R.Picker label={label} selectedKey={value} onSelectionChange={(k) => onChange(String(k))} isDisabled={isDisabled}>
      {items.map((x) => <R.PickerItem key={x.id} id={x.id}>{x.label}</R.PickerItem>)}
    </R.Picker>;
  }

  /** 录制面板：录什么、设备、光标与键盘、倒计时。区域框选还没有（与实现一致）。 */
  function RecordingDialog({onClose, onStart}) {
    const [source, setSource] = useState('display');
    const [display, setDisplay] = useState('d1');
    const [win, setWin] = useState('w1');
    const [camera, setCamera] = useState('none');
    const [mic, setMic] = useState('default');
    const [system, setSystem] = useState(false);
    const [cursor, setCursor] = useState('separate');
    const [keys, setKeys] = useState('shortcuts');
    const [countdown, setCountdown] = useState('3');
    const cursorNote = CURSORS.find((x) => x.id === cursor).note;
    const keysNote = KEYS.find((x) => x.id === keys).note;
    return <R.DialogContainer onDismiss={onClose}>
      <R.Dialog size="M">
        {({close}) => <>
          <R.Heading slot="title">录制屏幕</R.Heading>
          <R.Content>
            <div className="nrec">
              <R.RadioGroup label="录什么" orientation="horizontal" value={source} onChange={setSource}>
                <R.Radio value="display">整块屏幕</R.Radio>
                <R.Radio value="window">一个窗口</R.Radio>
                <R.Radio value="area" isDisabled>一个区域</R.Radio>
              </R.RadioGroup>
              {source === 'window'
                ? <Pick label="窗口" items={WINDOWS} value={win} onChange={setWin} />
                : <Pick label="屏幕" items={DISPLAYS} value={display} onChange={setDisplay} />}
              <p className="nrec__note">BaoCut 自己的窗口不会录进去。在屏幕上框选区域还不支持。</p>
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
              <Pick label="倒计时" items={COUNTDOWNS} value={countdown} onChange={setCountdown} />
            </div>
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" onPress={() => onStart({countdown: Number(countdown)})}>开始录制</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  const clock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

  /** 录制中的控制条：倒计时 → 计时；暂停与继续；停止收尾；丢弃要确认（不能撤销）。 */
  function RecordingBar({countdown, onStop, onDiscard}) {
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
    const status = left > 0 ? `${left} 秒后开始…` : paused ? `已暂停 · ${clock(elapsed)}` : `正在录制 · ${clock(elapsed)}`;
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

  /** 「录制」按钮 + 面板 + 控制条。录完的视频放进名为「录制」的项目（每次一部新视频），这里只给提示。 */
  function HomeRecord() {
    const app = window.useApp ? window.useApp() : null;
    const [phase, setPhase] = useState(null);
    const toast = (text, tone) => app && app.toast ? app.toast(text, tone) : null;
    return <>
      <R.TooltipTrigger placement="bottom">
        <R.ActionButton isQuiet size="S" isDisabled={!!phase} onPress={() => setPhase({kind: 'panel'})}>
          <R.Icons.DeviceLaptop /><R.Text>录制</R.Text>
        </R.ActionButton>
        <R.Tooltip>不经过智能体，把屏幕录成一个新视频</R.Tooltip>
      </R.TooltipTrigger>
      {phase && phase.kind === 'panel'
        ? <RecordingDialog onClose={() => setPhase(null)} onStart={({countdown}) => setPhase({kind: 'bar', countdown})} /> : null}
      {phase && phase.kind === 'bar'
        ? <RecordingBar countdown={phase.countdown}
            onStop={(s) => { setPhase(null); toast(`录好了（${clock(s)}），已放进「录制」项目里的新视频`, 'positive'); }}
            onDiscard={() => { setPhase(null); toast('录制已丢弃'); }} /> : null}
    </>;
  }

  Object.assign(window, {HomeRecord, RecordingDialog, RecordingBar});
})();
