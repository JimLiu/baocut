/* 外壳页 —— 远端算力（§17.3；2026-09-17 起是侧栏「服务」里的一项，§17.6）与设置页共用的行。
   替代第 26 轮那版 page-stubs.jsx 的骨架；第 110 轮起「Agent 设置」并入 Settings › Agent。 */
(function () {
  const {useState} = React;
  const D = window.BC_DATA;

  /* 设置页与远端页共用的一行 */
  function Row({label, desc, children, mono}) {
    return (
      <window.BCControlLabel.Provider value={typeof label === "string" ? label : null}><div className="setrow">
        <span className="nm">
          <b>{label}</b>
          {desc ? <span>{desc}</span> : null}
        </span>
        {mono ? <span className="t-mono t-detail">{mono}</span> : null}
        {children}
      </div></window.BCControlLabel.Provider>
    );
  }

  /* ================= 远端算力 ================= */
  function NodeCard({n, onDrop}) {
    const app = useApp();
    const [pop, setPop] = useState(false);
    const online = n.state === 'online';
    return (
      <Card layer style={{padding: 12, marginTop: 8}}>
        <div className="row gap8">
          <span className="sidedot" style={{background: online ? 'var(--green-900)' : 'var(--gray-400)'}} />
          <span className="grow">
            <b className="t-title-sm">{n.name}</b>
            <span className="t-detail-xs" style={{display: 'block'}}>
              {n.addr} · {n.meta}{window.BC_SERVICES.nodeTaskMeta(n) ? ' · ' + window.BC_SERVICES.nodeTaskMeta(n) : ''}
            </span>
          </span>
          <Chip tone={online ? 'positive' : 'neutral'}>{online ? '在线' : '离线'}</Chip>
          <div style={{position: 'relative'}}>
            <IconBtn icon="more" size="s" tip="更多" onClick={() => setPop((v) => !v)} />
            <Popover open={pop} onClose={() => setPop(false)} align="right" dir="down" width={210}>
              <Menu>
                <MenuItem icon="ok" label="诊断这台节点"
                  onClick={() => { setPop(false); app.toast('doctor：闭集根因 + 可复制的诊断报告'); }} />
                <MenuItem icon="copy" label="复制地址"
                  onClick={() => { setPop(false); app.toast('已复制 ' + n.addr); }} />
                <MenuRule />
                <MenuItem icon="trash" label="取消配对" tone="negative"
                  onClick={() => { setPop(false); onDrop(n); }} />
              </Menu>
            </Popover>
          </div>
        </div>
      </Card>
    );
  }

  /* 共享这台 Mac 的服务卡：2026-09-17 起与 MCP / Web 共用 page-services.jsx 的 `ServiceCard`，
     起停走 store 的 `flipService('remote')`，侧栏「服务」段的状态点与快捷按钮读同一份（§17.6）。 */
  /** `tab` = 路由带来的落点；默认落在「共享这台 Mac」——这一页现在住在「服务」里，先回答开没开。 */
  function RemotePage({tab: tab0}) {
    const app = useApp();
    const [tab, setTab] = useState(tab0 === 'nodes' ? 'nodes' : 'share');
    const [paired, setPaired] = useState(D.remote.paired);
    const shareOn = app.shareOn;
    const st = app.svcStates.remote;
    const phase = st.phase; // 'starting' | 'stopping'：节点进程在起/停的那一两秒
    const [pairing, setPairing] = useState(null);
    const S = D.remote.share;
    /* 配对码可选（2026-09-27）：缺省开，关掉 = `worker.pairMode=open`，运行期热改、不重启节点 */
    const [requireCode, setRequireCode] = useState(S.requireCode !== false);
    /* 节点主人按任务开放（`worker.tasks.<task>`，缺省全开；没装模型的任务开不了） */
    const [tasksOff, setTasksOff] = useState([]);
    const taskRows = window.BC_SERVICES.remoteTaskRows(S.taskModels, tasksOff);
    const flipTask = (k, on) => setTasksOff((off) => (on ? off.filter((x) => x !== k) : off.concat(k)));

    const drop = (n) => app.confirm({
      title: `取消与「${n.name}」的配对？`,
      body: '这台电脑之后不再出现在转录和配音的模型列表里。随时可以重新配对。',
      tone: 'negative', confirmLabel: '取消配对',
      run: () => { setPaired((p) => p.filter((x) => x.id !== n.id)); app.toast('已取消配对', 'positive'); },
    });

    return (
      <window.Page title="远端算力" actions={
        <Segmented value={tab} onChange={setTab}
          items={[{k: 'share', label: '共享这台 Mac'}, {k: 'nodes', label: '使用其他电脑'}]} />
      }>
        <div className="t-body-sm t-subdued" style={{maxWidth: 640}}>
          {tab === 'share'
            ? <>把这台 Mac 的算力共享给局域网里的其他电脑：转录、配音、生成图片、分离人声、下载与导出视频。<b>文件只在你的局域网内传输</b>，只有结果送回去——不经过任何服务器。</>
            : <>把转录、配音、出图、分离、下载与导出交给局域网里另一台更快的电脑。<b>文件只在你的局域网内传输</b>，只有结果回来——不经过任何服务器。</>}
        </div>

        {tab === 'nodes' ? (
          <>
            <div className="t-section" style={{marginTop: 24}}>已配对</div>
            {paired.length
              ? paired.map((n) => <NodeCard key={n.id} n={n} onDrop={drop} />)
              : <Empty title="还没有配对的节点">在另一台电脑上打开「共享这台 Mac」，这里就能看到它。</Empty>}

            <div className="t-section" style={{marginTop: 24}}>附近</div>
            {D.remote.nearby.map((n) => (
              <Card layer key={n.id} style={{padding: 12, marginTop: 8}}>
                <div className="row gap8">
                  <Ic n="remote" className="ic--16" />
                  <span className="grow">
                    <b className="t-title-sm">{n.name}</b>
                    <span className="t-detail-xs" style={{display: 'block'}}>{n.meta}</span>
                  </span>
                  <Btn variant="accent" size="s" onClick={() => setPairing(n)}>配对</Btn>
                </div>
              </Card>
            ))}
            <div className="row gap8" style={{marginTop: 12}}>
              <Btn variant="secondary" size="s" icon="search"
                onClick={() => app.toast('正在查找附近的电脑…')}>查找附近的电脑</Btn>
              <Btn variant="secondary" size="s"
                onClick={() => app.toast('按地址添加：输入 host:port')}>按地址添加…</Btn>
            </div>
          </>
        ) : (
          <>
            <window.ServiceCard id="remote" st={st} subMono={shareOn && !phase}
              title={phase ? window.BC_SERVICES.stateLabel('remote', st) : shareOn ? '正在共享这台 Mac' : '共享已关闭'}
              sub={phase ? S.nodeName : shareOn ? `${S.nodeName} · ${S.addr}` : '其他设备看不到这台 Mac。'}
              foot={<>
                <Checkbox on={!!app.prefs.shareAutoStart} onChange={(v) => app.setPref('shareAutoStart', v)} label="打开 BaoCut 时自动开始共享" />
                <span className="t-detail-xs">退出 BaoCut 时共享会一起停止。</span>
              </>} />
            <div className="t-detail" style={{marginTop: 8, maxWidth: 640}}>
              任务的输入只在局域网内传输，只有结果送回去；任务结束后不在这台 Mac 上留下任何内容。
            </div>

            {shareOn && !phase ? (
              <Card layer style={{padding: 16, marginTop: 12, maxWidth: 640}}>
                <Row label="节点名" mono={S.nodeName} />
                <Row label="地址" mono={S.addr} />
                {/* 配对码块自带开关：缺省开；关掉后块内只剩一行提醒（原先卡下方单独的「新设备必须输入配对码」并入这里） */}
                <div className="pairblk">
                  <div className="pairblk__head">
                    <b>配对码</b>
                    <Switch on={requireCode} ariaLabel="新设备需要输入配对码"
                      onChange={(v) => { setRequireCode(v); app.toast(v ? '新设备需要输入配对码' : '已关闭配对码：局域网里的设备可以直接连上'); }} />
                  </div>
                  {requireCode ? (
                    <div className="pairblk__body">
                      <span className="grow">
                        <span className="t-mono pairblk__code">{S.code}</span>
                        <span className="t-detail-xs" style={{display: 'block'}}>在对方设备上输入这个码。10 分钟后失效。</span>
                      </span>
                      <Btn variant="secondary" size="s" onClick={() => app.toast('已生成新的配对码')}>重新生成</Btn>
                    </div>
                  ) : (
                    <div className="t-detail pairblk__off">
                      局域网里任何设备都能直接连上这台 Mac，不用输入配对码；已配对的设备不受影响。只在你能控制的网络里关掉它。
                    </div>
                  )}
                </div>
                <div className="row gap8" style={{marginTop: 16}}>
                  <b className="t-title-sm grow">提供给其他电脑的任务</b>
                  <span className="t-detail-xs">{window.BC_SERVICES.remoteTaskSummary(taskRows)}</span>
                </div>
                {taskRows.map((t) => (
                  <Row key={t.k} label={t.name} desc={t.desc}>
                    {t.models.length ? <div className="row gap6 rtask__chips">{t.models.map((m) => <Chip key={m}>{m}</Chip>)}</div> : null}
                    <Switch on={t.on} disabled={t.disabled} ariaLabel={'提供' + t.name}
                      onChange={(v) => flipTask(t.k, v)} />
                  </Row>
                ))}
                <Row label="并发任务数">
                  <Chip>{S.jobs}</Chip>
                </Row>
                <Row label="让其它 App 也能用这台节点"
                  desc="提供 /v1/audio/transcriptions、/v1/audio/speech 与 /v1/models 三个 OpenAI-compatible 端点">
                  <Switch on={false} onChange={() => app.toast('OpenAI-compatible 端点：本轮为骨架')} />
                </Row>
                <Row label="已配对的设备" desc={S.peers.map((p) => `${p.name} · ${p.seen}见过`).join('、')}>
                  <Btn variant="quiet" size="s" onClick={() => app.toast('已吊销')}>吊销</Btn>
                </Row>
                <Row label="状态" mono={S.activity} />
              </Card>
            ) : (
              <div className="t-detail" style={{marginTop: 12}}>开始共享后会显示一个 6 位配对码，对方输入即可连上；也可以关掉配对码，让局域网里的设备直接连。</div>
            )}
          </>
        )}

        <Dialog open={!!pairing} title={`与「${pairing ? pairing.name : ''}」配对`}
          onClose={() => setPairing(null)}
          footer={[
            <Btn key="c" variant="secondary" onClick={() => setPairing(null)}>取消</Btn>,
            <Btn key="k" variant="accent" onClick={() => {
              setPaired((p) => p.concat([{id: pairing.id, name: pairing.name,
                addr: '192.168.1.31:24350', meta: pairing.meta + ' · bcut 1.12', state: 'online'}]));
              setPairing(null);
              app.toast('已配对 · 它现在会出现在转录和配音的模型列表里', 'positive');
            }}>配对</Btn>,
          ]}>
          <div className="t-body-sm">在那台电脑的「共享这台 Mac」里读出 6 位配对码，输在这里。</div>
          <div style={{width: 160, marginTop: 12}}><Field placeholder="481 924" /></div>
        </Dialog>
      </window.Page>
    );
  }

  /* Agent 设置那一页（第 109 轮）在第 110 轮并入 Settings › Agent：见 page-settings-agent.jsx。 */

  Object.assign(window, {RemotePage, ShellRow: Row});
})();
