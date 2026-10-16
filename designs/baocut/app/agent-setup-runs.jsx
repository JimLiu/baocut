/* Agent 的安装与升级在应用里运行（product-design §7.6；同实现 Runtime 的 `agent-setup` 运行与 agent-setup-task.ts 的那一行）。
   设置 › Agent 提供方的 ▶ 与首次启动引导的安装队列都从这里起跑。每次运行是一条后台任务：「安装 Agent · 名字」/「升级 Agent · 名字」，
   在哪写实际运行的命令；没有百分比，在跑时任务页、胶囊、设置里的命令框都能停（停走 store.cancelTask，不问，再交给 `stopped`）。
   输出一拍一行记在任务的 `log` 里，由 BC_AGENT_SETUP.demoRun 编，正式版是子进程的真实输出；设置里的命令框读的就是这条任务
   （BC_AGENT_SETUP.setupRun）。同一家同一时间只跑一条（同 Runtime）：那一家已经在跑时 `start` 不起、返回 null；不同的几家可以同时跑，
   引导里一家一家装是它自己排的队。定时器在模块里，不跟着哪个画面卸载：关掉引导、离开设置都接着跑。 */
(function () {
  const S = window.BC_AGENT_SETUP;
  const TICK = 380;   // 一拍出一行输出
  const live = {};    // tid → {timer, hid, onEnd}
  const failText = (code) => `没有成功（退出码 ${code}）。上面的输出里写了原因；如果需要输入密码，请在终端里运行。`;
  const running = (hid) => Object.keys(live).some((tid) => live[tid].hid === hid);

  /** 起跑一次。`action`：install | upgrade；`fail`：演示失败（原型开关）；`onEnd(result)`：跑完（done / error）或被停（stopped）时调用一次 */
  function start(app, h, plan, action, opts) {
    const o = opts || {};
    if (!plan || !S.runnable(plan) || running(h.id)) return null;
    const upgrade = action === 'upgrade';
    const out = S.demoRun(plan, h, upgrade, !!o.fail);
    const tid = app.addTask({kind: upgrade ? 'agent-upgrade' : 'agent-install', agent: h.id, cmd: plan.cmd, shown: true,
      title: `${upgrade ? '升级' : '安装'} Agent · ${h.name}`, sub: `${plan.cmd} · 本机`,
      phase: '正在运行', pct: null, cancellable: true, log: ['$ ' + plan.cmd]});
    let i = 0;
    const timer = setInterval(() => {
      if (i < out.lines.length) {
        const line = out.lines[i++];
        app.patchTask(tid, (t) => ({log: S.appendLog(t.log, [line])}));
        return;
      }
      clearInterval(timer);
      delete live[tid];
      if (out.code === 0) app.patchTask(tid, {status: 'done', outcome: 'done', phase: null});
      else app.patchTask(tid, {status: 'error', outcome: 'error', phase: null, code: out.code, error: failText(out.code)});
      if (o.onEnd) o.onEnd(out.code === 0 ? 'done' : 'error');
    }, TICK);
    live[tid] = {timer, hid: h.id, onEnd: o.onEnd};
    return tid;
  }

  /** 停掉了一次（记录已由 store.cancelTask 改成已取消）：收掉定时器，告诉起跑的那一方 */
  function stopped(tid) {
    const r = live[tid];
    if (!r) return;
    clearInterval(r.timer);
    delete live[tid];
    if (r.onEnd) r.onEnd('stopped');
  }

  Object.assign(window, {BC_AGENT_RUNS: {start, stopped, running}});
})();
