/* 覆盖层上的录制卡（录屏界面重设计 §2「录制卡」）：宽 416，两块叠放的半透明卡，圆角 16。只在 App 入口加载。
     · 第一块：圆形关闭（36，回到启动器）、开始按钮（高 44、全圆角、强调色，两行：「开始录制」与落点的一句小字）、
       圆形齿轮（36，倒计时「关 / 3 秒 / 5 秒 / 10 秒」，改的是设置里同一项）。没有选定目标时开始按钮 60% 不透明、不可点。
     · 第二块：摄像头与麦克风两个并排的小控件（高 42，带「开 / 关 / 未连接 / 允许」药丸，麦克风带电平填充），点开是设备菜单；
       药丸是「允许」时点它打开系统设置。
     · 没选麦克风、设置里开着「没有麦克风时先确认」时，按开始先出确认（RecMicConfirm），带「不再提示」。 */
(function () {
  const {useState} = React;
  const R = window.RSP;
  const REC = window.BC_REC;
  const H = window.BC_REC_HOST;

  /** 录制卡第二块的小控件：点开是设备菜单（第一项「不用」）。 */
  function DeviceMini({kind}) {
    const app = useApp();
    const st = H.useRecorder();
    const D = REC.DEMO;
    const isCam = kind === 'camera';
    const list = isCam ? D.cameras : D.mics;
    const value = isCam ? st.choice.camera : st.choice.mic;
    const dev = list.find((d) => d.id === value) || null;
    const perm = isCam ? st.perms.camera : st.perms.mic;
    const p = REC.pill({on: !!dev, connected: dev ? dev.connected : true, permission: perm});
    const level = H.useLevel(!isCam && p.state === 'on');
    const icon = isCam ? <R.Icons.Camera /> : <R.Icons.Microphone />;
    const inner = <>
      {!isCam && p.state === 'on' ? <span className="rc-dev__lvl" style={{width: `${Math.round(level * 100)}%`}} aria-hidden="true" /> : null}
      <span className="rc-dev__ic">{icon}</span>
      <span className="rc-dev__name">{REC.deviceName(kind, dev)}</span>
      <span className={cx('rec-pill', `rec-pill--${p.state}`)}>{p.label}</span>
    </>;
    if (p.action === 'open-settings') {
      return <button type="button" className="rc-dev" aria-label={`${isCam ? '摄像头' : '麦克风'}：允许`}
        onClick={() => H.openPermission(app, isCam ? 'camera' : 'mic')}>{inner}</button>;
    }
    return <R.MenuTrigger>
      <R.ActionButton UNSAFE_className="rc-dev" aria-label={isCam ? '摄像头' : '麦克风'}>{inner}</R.ActionButton>
      <R.Menu aria-label={isCam ? '摄像头' : '麦克风'} selectionMode="single" selectedKeys={[value]}
        onSelectionChange={(keys) => { const k = [...keys][0]; if (k) H.setChoice(isCam ? {camera: String(k)} : {mic: String(k)}); }}>
        <R.MenuItem id="none" textValue={isCam ? '不用摄像头' : '不用麦克风'}>{isCam ? '不用摄像头' : '不用麦克风'}</R.MenuItem>
        {list.map((d) => <R.MenuItem key={d.id} id={d.id} textValue={d.label}>
          <R.Text>{d.label}</R.Text>{d.connected === false ? <R.Text slot="description">未连接</R.Text> : null}
        </R.MenuItem>)}
      </R.Menu>
    </R.MenuTrigger>;
  }

  function RecCard({mode, ready, onStart, onClose, cardRef}) {
    const st = H.useRecorder();
    return <div className="rc" ref={cardRef} onClick={(e) => e.stopPropagation()}>
      <div className="rc__block rc__main">
        <R.TooltipTrigger placement="bottom">
          <R.ActionButton UNSAFE_className="rc__circle" aria-label="取消" onPress={onClose}><R.Icons.Close /></R.ActionButton>
          <R.Tooltip>取消，回到启动器</R.Tooltip>
        </R.TooltipTrigger>
        <button type="button" className="rc__start" disabled={!ready} onClick={onStart}>
          <span className="rc__dot" aria-hidden="true" />
          <span className="rc__lines"><b>开始录制</b><small>{REC.startNote(mode)}</small></span>
        </button>
        <R.MenuTrigger>
          <R.ActionButton UNSAFE_className="rc__circle" aria-label="倒计时"><R.Icons.Settings /></R.ActionButton>
          <R.Menu aria-label="录制选项" selectionMode="single" selectedKeys={[st.settings.countdown]}
            onSelectionChange={(keys) => { const k = [...keys][0]; if (k != null) H.setSettings({countdown: String(k)}); }}>
            <R.MenuSection>
              <R.Header><R.Heading>倒计时</R.Heading></R.Header>
              {REC.COUNTDOWNS.map((c) => <R.MenuItem key={c.id} id={c.id} textValue={c.label}>{c.label}</R.MenuItem>)}
            </R.MenuSection>
          </R.Menu>
        </R.MenuTrigger>
      </div>
      <div className="rc__block rc__devs">
        <DeviceMini kind="camera" />
        <DeviceMini kind="mic" />
      </div>
    </div>;
  }

  /** 没有选择麦克风时的确认（§2）：返回 / 不用麦克风继续，带「不再提示」（关掉设置里的「没有麦克风时先确认」）。 */
  function RecMicConfirm({onBack, onGo}) {
    const [never, setNever] = useState(false);
    return <R.DialogContainer onDismiss={onBack}>
      <R.Dialog size="S">
        <R.Heading slot="title">没有选择麦克风</R.Heading>
        <R.Content>
          <p className="rc-ask__p">这次录制不会有你的声音。选一个麦克风，或者不用麦克风继续。</p>
          <R.Checkbox isSelected={never} onChange={setNever}>不再提示</R.Checkbox>
        </R.Content>
        <R.ButtonGroup>
          <R.Button variant="secondary" onPress={onBack}>返回</R.Button>
          <R.Button variant="accent" onPress={() => { if (never) H.setSettings({confirmNoMic: false}); onGo(); }}>不用麦克风继续</R.Button>
        </R.ButtonGroup>
      </R.Dialog>
    </R.DialogContainer>;
  }

  Object.assign(window, {RecCard, RecMicConfirm});
})();
