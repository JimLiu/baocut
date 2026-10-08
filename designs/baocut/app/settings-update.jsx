/* App 自动更新（§17.7，2026-10-01）：状态宿主 + 设置 › 关于的状态块 + 设置 › 通用的开关行 + 原型演示挡位。
   只属于 App 入口：Web 没有设置页与 App 外壳（§22），文件名落在 WEB_DENY 的 `settings-` 前缀下。
   态、文案与节奏都在 model-app-update.js（BC_UPDATE）；这里只做模拟的检查 / 下载推进和组装。
   宿主挂在 main.jsx 的根上（像 ExportRunner）——离开设置页，后台下载照走，下载好的 toast 照弹。
   原型不在每次加载 15 s 后真起自动检查：那会让别的页面的截图带上 toast。自动检查由演示挡位里的
   「模拟一次自动检查」触发，走的是同一条路径。
   2026-10-01 下午：侧栏页脚「设置」行右侧的更新按钮（AppUpdateSideButton，shell.jsx 按 window 上有没有它来挂，
   Web 入口不加载本文件所以没有）与点它打开的更新窗（UpdateWindow，开合也归这个宿主——toast「查看」从这里打开它）。
   2026-10-05：退出即安装、已下载后照常静默检查（更新的 build 作废旧下载）、下载到 100% 后先校验再进已下载，
   规则都在 BC_UPDATE。这里跟着改：检查结果按 BC_UPDATE.afterCheck 跟进（不再无条件下载 / 提醒）；版本信息与
   缓存路径取当前态里的那一版，不再写死 2.3.0；演示挡位多「模拟退出 BaoCut」与「更新源里有更新的 2.3.1」。
   2026-10-05 晚：「重启并更新」的确认换成停止屏障（InstallBarrier，三个选择，照 packages/ui）；选「等任务结束后安装」
   宿主记下 `waiting`，在跑的数（演示勾「当作没有后台任务在跑」就是 0）到 0 就安装，离开已下载就不等了。
   原型不真停任务：「现在停止并安装」直接安装。 */
(function () {
  const {useState, useRef, useEffect, useContext, createContext} = React;
  const U = window.BC_UPDATE;
  const D = window.BC_DATA;
  const Ctx = createContext(null);
  const nowSec = () => Math.floor(Date.now() / 1000);
  const VERIFY_MS = 900;   // 演示里的校验段有多长

  function AppUpdateProvider({children}) {
    const app = useApp();
    const [st, setSt] = useState({k: 'idle'});
    const [demo, setDemo] = useState({feedNew: true, feedNext: false, failCheck: false, failVerify: false, noTasks: false});
    const live = useRef({});
    live.current = {app, demo, st};
    const timer = useRef(null);
    const toasted = useRef(null);   // 已经弹过「已下载」toast 的 build
    const [win, setWin] = useState(false);   // 更新窗开着吗
    const [barrier, setBarrier] = useState(null);   // 停止屏障：开着时是 BC_UPDATE.restartAsk 的结果
    const [waiting, setWaiting] = useState(false);  // 在等后台任务结束后安装
    const winOrigin = useRef(null);          // 关窗后焦点还给谁（侧栏按钮）
    const stop = () => { clearTimeout(timer.current); clearInterval(timer.current); timer.current = null; };
    useEffect(() => stop, []);
    const dispatch = (ev) => setSt((s) => U.reduce(s, ev));
    /* 检查结果要看落到哪个态再决定跟进，所以这里同步算出下一态（定时器回调里 live.current.st 已是最新渲染的态）。 */
    const land = (ev) => {
      const next = U.reduce(live.current.st, ev);
      live.current.st = next;
      setSt(next);
      return next;
    };

    /* 下载：进度走到 100% 后停一小段「正在校验」（BC_UPDATE 把 pct = 100 画成校验中），再进已下载或校验失败。 */
    function download(auto) {
      stop();
      dispatch({type: 'download'});
      let pct = 0;
      timer.current = setInterval(() => {
        pct += 7;
        if (pct < 100) { dispatch({type: 'progress', pct}); return; }
        stop();
        dispatch({type: 'progress', pct: 100});
        timer.current = setTimeout(() => {
          timer.current = null;
          if (live.current.demo.failVerify) { dispatch({type: 'fail', msg: U.DEMO_ERRORS.verify}); return; }
          const info = live.current.st.info;
          if (!info) return;
          dispatch({type: 'downloaded', path: U.demoPath(info)});
          if (!auto) return;
          const t = U.readyToast(info, toasted.current);
          if (!t) return;
          toasted.current = info.build;
          live.current.app.toast(t.text, 'positive', {label: t.action, run: () => restart()});
        }, VERIFY_MS);
      }, 220);
    }

    function check(auto) {
      // 自动检查：「有新版本」「已下载」时静默（显示态不变，按钮与更新窗都留着）——判据在 BC_UPDATE
      if (auto && !U.mayAutoCheck(live.current.st)) return;
      // 演示的本机系统版本不随检查变：起查前是「需要 macOS X」，新结果照样带上（App after_check：不下载、不提醒）
      const unmet = live.current.st.systemUnmet;
      stop();
      dispatch({type: 'check', auto});
      timer.current = setTimeout(() => {
        timer.current = null;
        const {app: a, demo: d} = live.current;
        a.setPref('appUpdateLastCheck', nowSec());
        if (d.failCheck) {
          setDemo((x) => ({...x, failCheck: false}));
          land({type: 'fail', msg: U.DEMO_ERRORS.check});
          return;
        }
        // 更新源里有什么：勾了 2.3.1 就是它，否则看 2.3.0 那一格，都没勾就是没有比正在跑的新的
        const found = d.feedNext ? U.DEMO_INFO_NEXT : d.feedNew ? U.DEMO_INFO : null;
        if (!found) { land({type: 'none'}); return; }
        const next = land(unmet ? {type: 'found', info: found, systemUnmet: unmet} : {type: 'found', info: found});
        const then = U.afterCheck(next, auto, U.autoUpdateOn(a.prefs));
        if (then === 'download') { download(true); return; }
        if (then !== 'notify') return;
        const t = U.availableToast(next.info);
        a.toast(t.text, null, {label: t.action, run: () => openWin()});
      }, 1200);
    }

    function install() {
      setWaiting(false);   // 从这里起不再等（同 packages/ui 的 installNow）
      stop();
      dispatch({type: 'install'});
      timer.current = setTimeout(() => {
        live.current.app.toast('原型演示：正式版这时退出 BaoCut，换上新版本后重新打开');
        setSt((s) => (s.k === 'installing' ? {k: 'ready', info: s.info, path: U.demoPath(s.info)} : s));
      }, 2000);
    }

    /* 正常退出（原型演示）：已下载就在退出途中装好、不重新打开；不另加确认——退出本来就停 Runtime 与后台任务。
       原型不真退，态不变，只用 toast 说正式版这时做什么。 */
    function quit() {
      live.current.app.toast(U.quitDemoText(live.current.st));
    }

    /* 在跑的后台任务：演示勾了「当作没有后台任务在跑」就一个都没有。 */
    const runningOf = (a, d) => (d.noTasks ? [] : U.barrierTasks(a.tasks));

    /* 「重启并更新」：有后台任务在跑先过停止屏障，没有就直接装。从不替用户重启。 */
    function restart() {
      const {app: a, demo: d} = live.current;
      const ask = U.restartAsk(runningOf(a, d));
      if (ask) setBarrier(ask);
      else install();
    }

    /* 「等任务结束后安装」：数着在跑的，数到 0 就安装；包没了（离开已下载）就不等了。 */
    const waitingFor = waiting ? runningOf(app, demo).length : null;
    useEffect(() => {
      if (waitingFor === null) return;
      if (st.k !== 'ready' && st.k !== 'installing') setWaiting(false);
      else if (st.k === 'ready' && waitingFor === 0) install();
    }, [st.k, waitingFor]);

    function openWin(origin) {
      winOrigin.current = origin || null;
      setWin(true);
    }
    function closeWin() {
      setWin(false);
      const el = winOrigin.current;
      winOrigin.current = null;
      if (el && el.isConnected) setTimeout(() => el.focus(), 0);
    }
    /* 窗只在侧栏按钮该显示的态里开着：变成安装中 / 空闲 / 检查失败这类态时自己关，并复位——
       不然演示里安装中两秒后回到已下载，窗会自己再冒出来。 */
    const winOn = win && U.sideButton(st).visible;
    useEffect(() => { if (win && !winOn) closeWin(); }, [win, winOn]);

    function act(k) {
      const a = live.current.app;
      if (k === 'later') closeWin();
      else if (k === 'check') check(false);
      else if (k === 'download') download(false);
      else if (k === 'cancel') { stop(); dispatch({type: 'cancel'}); }
      else if (k === 'restart') restart();
      else if (k === 'stopWaiting') setWaiting(false);
      else if (k === 'retry') {
        const ev = U.retryEvent(live.current.st);
        if (ev.type === 'download') download(false); else check(false);
      } else if (k === 'downloadPage') a.toast('原型演示：在浏览器中打开 ' + U.DOWNLOAD_PAGE);
    }

    function jump(k) {
      stop();
      const a = live.current.app;
      if (k === 'idle' && a.prefs.appUpdateLastCheck == null) a.setPref('appUpdateLastCheck', nowSec() - 3 * 3600);
      setSt(U.demoState(k));
    }

    const value = {st, act, demo, setDemo, jump, autoCheck: () => check(true), quit, win: winOn, openWin, closeWin, waitingFor};
    return (
      <Ctx.Provider value={value}>
        {children}
        {winOn ? <UpdateWindow /> : null}
        <InstallBarrier ask={barrier} onClose={() => setBarrier(null)}
          onStop={() => { setBarrier(null); install(); }}
          onWait={() => { setBarrier(null); setWaiting(true); }} />
      </Ctx.Provider>
    );
  }

  const useAppUpdate = () => useContext(Ctx);

  /* ---------- 侧栏更新按钮（§17.7「侧栏更新按钮与更新窗」） ----------
     页脚「设置」行右侧的 accent 方钮，边长 = 行高（CSS aspect-ratio）。显示与否、图标、角点、提示全看
     BC_UPDATE.sideButton；不显示时返回 null，「设置」行占满。 */
  function UpdateRing({pct}) {
    const r = 6.5;
    const len = 2 * Math.PI * r;
    return (
      <svg className="sideupd__ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle cx="8" cy="8" r={r} className="sideupd__ring-bg" />
        <circle cx="8" cy="8" r={r} className="sideupd__ring-fg" transform="rotate(-90 8 8)"
          strokeDasharray={`${(len * Math.max(0, Math.min(100, pct))) / 100} ${len}`} />
      </svg>
    );
  }

  function AppUpdateSideButton() {
    const u = useAppUpdate();
    if (!u) return null;
    const b = U.sideButton(u.st);
    if (!b.visible) return null;
    return (
      <Tip label={b.tip}>
        <BCAction type="button" className="sideupd" aria-label={b.tip} aria-haspopup="dialog"
          onClick={(e) => u.openWin(e.currentTarget)}>
          {b.glyph === 'ring' ? <UpdateRing pct={b.pct} /> : <Ic n={b.glyph} className="ic--16" />}
          {b.dot ? <span className={'sideupd__dot sideupd__dot--' + b.dot} /> : null}
        </BCAction>
      </Tip>
    );
  }

  /* ---------- 安装前的停止屏障（架构设计 §2.6，照 packages/ui 的 install-barrier） ----------
     「现在停止并安装」/「等任务结束后安装」/「稍后」；焦点先落在「等」上。停了之后仍可能在远端运行或计费的任务列在正文里。 */
  function InstallBarrier({ask, onClose, onStop, onWait}) {
    return (
      <Dialog open={!!ask} title={ask ? ask.title : ''} onClose={onClose}
        footer={ask ? [
          <Btn key="c" variant="secondary" onClick={onClose}>{ask.cancelLabel}</Btn>,
          <Btn key="w" variant="secondary" autoFocus onClick={onWait}>{ask.waitLabel}</Btn>,
          <Btn key="s" variant="accent" onClick={onStop}>{ask.stopLabel}</Btn>,
        ] : null}>
        {ask ? (
          <>
            <p>{ask.body}</p>
            {ask.remoteTitle ? (
              <>
                <p>{ask.remoteTitle}</p>
                <ul className="upddlg__notes">
                  {ask.remote.map((t) => <li key={t.id}>{t.title}{t.where ? ` · ${t.where}` : ''}</li>)}
                </ul>
              </>
            ) : null}
          </>
        ) : null}
      </Dialog>
    );
  }

  /* ---------- 更新窗（模态，宽 480） ----------
     头：App 图标 40 + 标题 + 「BaoCut 2.3.0 · Build 57」+ 关闭；正文：当前版本一句、「更新内容」、全部说明（可滚）；
     底栏随态（BC_UPDATE.dialog）。×、Esc、点背景、「稍后」都只关窗；「重启并更新」走与关于页、toast 同一个动作。 */
  function UpdateWindow() {
    const app = useApp();
    const u = useAppUpdate();
    const d = U.dialog(u.st, {lang: U.langCode(app.uiLang), current: D.app, waiting: u.waitingFor});
    if (!d) return null;
    const f = d.footer;
    return (
      <BCModal onClose={u.closeWin} labelledBy="upddlg-t" className="upddlg-host">
        <div className="upddlg">
          <div className="upddlg__hd">
            <img className="upddlg__icon" src="assets/app-icon.svg" alt="" />
            <div className="grow">
              <div className="dlg__t" id="upddlg-t">{d.title}</div>
              <div className="upddlg__sub">{d.sub}</div>
            </div>
            <IconBtn icon="close" size="s" tip="关闭" onClick={u.closeWin} />
          </div>
          <div className="upddlg__b bc-scroll">
            {d.current || d.note ? <p className="upddlg__cur">{[d.current, d.note].filter(Boolean).join('')}</p> : null}
            <div className="t-section">{d.notesTitle}</div>
            <ul className="upddlg__notes">
              {d.notes.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </div>
          <div className="upddlg__f">
            <div className="upddlg__left">
              {f.left && f.left.progress != null ? (
                <>
                  <Progress thin value={f.left.progress} className="upddlg__pg" />
                  <span className="upddlg__pct">{f.left.text}</span>
                </>
              ) : null}
              {f.left && f.left.error ? <span className="upddlg__err">{f.left.error}</span> : null}
              {f.left && f.left.note ? <span className="t-detail">{f.left.note}</span> : null}
            </div>
            {f.buttons.map((b) => (
              <Btn key={b.k} variant={b.variant} onClick={() => u.act(b.k)}>{b.label}</Btn>
            ))}
          </div>
        </div>
      </BCModal>
    );
  }

  /* ---------- 设置 › 关于 ---------- */
  function UpdateStatus() {
    const app = useApp();
    const u = useAppUpdate();
    const v = U.view(u.st, {lang: U.langCode(app.uiLang), lastCheck: app.prefs.appUpdateLastCheck, now: nowSec(),
      waiting: u.waitingFor});
    return (
      <div className="upd" aria-live="polite">
        {v.line ? <div className={cx('upd__line', v.tone && 'upd__line--' + v.tone)}>{v.line}</div> : null}
        {v.progress != null ? <Progress thin value={v.progress} className="upd__pg" /> : null}
        {v.notes && v.notes.lines.length ? (
          <ul className="upd__notes" aria-label="这一版的更新说明">
            {v.notes.lines.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        ) : null}
        {v.warn ? <div className="upd__line upd__line--negative">{v.warn}</div> : null}
        {v.actions.length || v.link ? (
          <div className="upd__btns">
            {v.actions.map((b) => (
              <Btn key={b.k} size="s" variant={b.variant} disabled={b.disabled} onClick={() => u.act(b.k)}>{b.label}</Btn>
            ))}
            {v.link ? <BCAction type="button" className="viewall" onClick={() => u.act(v.link.k)}>{v.link.label}</BCAction> : null}
          </div>
        ) : null}
        {v.sub ? <div className="t-detail-xs">{v.sub}</div> : null}
      </div>
    );
  }

  function UpdateDemo() {
    const u = useAppUpdate();
    const app = useApp();
    const cur = U.demoKeyOf(u.st);
    const flag = (k) => (x) => u.setDemo((d) => ({...d, [k]: x}));
    const running = app.tasks.filter((t) => t.status === 'running').length;
    return (
      <div className="upd-demo" aria-label="原型演示场景">
        <b>原型演示 · 切换更新状态</b>
        <div className="upd-demo__chips">
          {U.DEMO_STATES.map((s) => <Chip key={s.k} on={cur === s.k} onClick={() => u.jump(s.k)}>{s.label}</Chip>)}
        </div>
        <div className="upd-demo__opts">
          <Btn size="s" variant="secondary" disabled={!U.mayAutoCheck(u.st)} onClick={u.autoCheck}>模拟一次自动检查</Btn>
          <Btn size="s" variant="secondary" onClick={u.quit}>模拟退出 BaoCut</Btn>
          <Checkbox on={u.demo.feedNew} onChange={flag('feedNew')} label="更新源里有 2.3.0（Build 57）" />
          <Checkbox on={u.demo.feedNext} onChange={flag('feedNext')} label="更新源里有更新的 2.3.1（Build 58）" />
          <Checkbox on={u.demo.failCheck} onChange={flag('failCheck')} label="让下一次检查失败" />
          <Checkbox on={u.demo.failVerify} onChange={flag('failVerify')} label="让下载的文件校验失败" />
          <Checkbox on={u.demo.noTasks} onChange={flag('noTasks')} label={`当作没有后台任务在跑（现有 ${running} 个）`} />
        </div>
        <p className="t-detail-xs" style={{marginTop: 8}}>
          自动检查在正式版里启动 {U.FIRST_CHECK_DELAY_S} 秒后跑一次、之后每 {U.CHECK_INTERVAL_H} 小时一次；原型不起定时器，用上面的按钮代替。
          自动下载开着时它会在后台下载并弹出「已下载」，关着时只提示可以更新。
          已下载时它照样静默检查：更新源里有更新的 build 就作废旧下载、换成新版本。
        </p>
      </div>
    );
  }

  function AppUpdateAbout() {
    const app = useApp();
    return (
      <>
        <div className="t-title" style={{marginBottom: 4}}>关于</div>
        <Card layer className="about-card">
          <div className="t-heading-sm">BaoCut</div>
          <div className="t-detail t-mono">{D.app.version} ({D.app.build})</div>
          <UpdateStatus />
          <div className="t-body-sm about-card__tag">
            {'本地优先的视频编辑器。转录、翻译、剪辑都在你自己的机器上跑；要用云端模型是你的选择，不是默认。'}
          </div>
        </Card>
        <div className="about-foot">
          <Btn variant="secondary" size="s" onClick={() => app.replace({r: 'settings', sec: 'agent'})}>Agent</Btn>
          <div className="row gap12" style={{flexWrap: 'wrap', justifyContent: 'center'}}>
            {['使用条款', '隐私政策', '开源许可', '反馈'].map((l) => (
              <BCAction key={l} className="viewall" style={{marginLeft: 0}} onClick={() => app.toast('打开 ' + l)}>{l}</BCAction>
            ))}
          </div>
        </div>
        <UpdateDemo />
      </>
    );
  }

  /* ---------- 设置 › 通用 ----------
     开发构建与 App Store 版没有更新可管，这一行不出现。 */
  function AppUpdateAutoRow() {
    const app = useApp();
    const u = useAppUpdate();
    if (!u || u.st.k === 'unsupported') return null;
    const Row = window.ShellRow;
    return (
      <Row label={U.AUTO_ROW.label} desc={U.AUTO_ROW.desc}>
        <Switch ariaLabel={U.AUTO_ROW.label} on={U.autoUpdateOn(app.prefs)}
          onChange={(x) => app.setPref('appAutoUpdate', x)} />
      </Row>
    );
  }

  Object.assign(window, {AppUpdateProvider, useAppUpdate, AppUpdateAbout, AppUpdateAutoRow, AppUpdateSideButton});
})();
