/* 首次启动引导（2026-10-16 用户要求；步骤、记录与算法在 model-onboarding.js）。只在 App 入口挂（main.jsx），Web 不加载。
   一个 S2 对话框，顶上是步骤条，六步：
   - 连接 Agent：一句欢迎，然后是 设置 › Agent 提供方 主列表那六家，每家一行、都能勾（2026-10-16 用户要求：一家不够）。
     装好的勾上就是启用（立刻生效）；没装、能用 Homebrew / npm 装的勾上就在后台安装，装好后在它自己的终端里登录一次；
     要先处理的（登录过期、版本过旧、跑不起来）与只有官方脚本的不给勾，处理与安装说明在设置里。
   - 语音识别、语音合成、图像生成、音乐生成：多选（2026-10-16 用户要求），默认至少勾一只；写清这次要下多少、连带哪些组件，
     以及在工具里哪儿用。已装好的、正在下的显示成勾上、不能改。
   - 语义搜索：一个包（文字模型 + 多模态模型 + 运行时）。
   要下载的都先过同一个下载确认框（download-dialog.jsx：来源、存放位置、许可；不许商用的模型把许可写在框里、确认按钮写
   「我知道了，下载 …」，与实现的 BatchInstallDialog 同一套）；确认后每只模型成为一条后台任务，引导立刻翻到下一步，不等下完。
   勾上要装的几家 Agent 按顺序一家一家装（同实现 OnboardingHost 的队列；Homebrew 同一时间只能跑一个），轮到哪家才落一条后台任务
   （`agent-install`：没有百分比，能停止，详情里是命令输出）；npm / brew 给不出进度，行上与底部那一行都不写百分比，排着队的与在装的一样只转圈。
   底部一行写这次开始的下载与安装在后台走到哪了；有这一行、主按钮文字又长时，S2 的 ButtonGroup 会自己换到下一行（原生行为，实现里一样）。
   每一步都可以「跳过」；左下角「退出引导」与 Esc 随时退出（不用右上角的 ×：S2 的可关闭对话框会藏掉 ButtonGroup，同 space-viewer.jsx）。
   任何一种关掉都写一条记录（偏好 `onboarding`），以后启动不再弹。 */
(function () {
  const {useState} = React;
  const S = window.RSP;
  const OB = window.BC_ONBOARDING;
  const LM = window.BC_LOCALMODELS;
  const D = window.BC_DATA;
  const AS = window.BC_AGENT_SETUP;
  const mb = (n) => LM.mb(n);

  /* 每一步的标题与开头一句 */
  const HEAD = {
    agent: '欢迎使用 BaoCut',
    asr: '下载语音识别模型',
    tts: '下载语音合成模型',
    semantic: '安装语义搜索',
    image: '下载图像生成模型',
    music: '下载音乐生成模型',
  };
  const LEAD = {
    asr: '转录、加字幕和剪口播，都要先把说的话转成文字。模型装在这台电脑上，不联网也能用。',
    tts: '语音合成模型能把文字念出来、用一段录音克隆声音，也能给视频翻译配音。挑一两只先下，其余以后在 设置 › 语音合成 里下。',
    semantic: '按意思找讲话内容和画面：Space 搜索、写作按主题选材、配画面、翻译记忆都用它。装好后在后台给已有的视频建索引。',
    image: '在本机按一句话生成图片，做封面、配图都行。模型很大，生成也慢。',
    music: '在本机按风格或歌词生成配乐和歌曲，结果可以直接加到视频的音乐轨。生成很慢，30 秒约要几分钟。',
  };
  /* 下好之后在哪儿用（只写工具页里有入口的那几类） */
  const WHERE = {
    tts: {icon: 'wave', title: '在 工具 › 生成语音 里用', body: '写一段文字，或选 Space 里的文档、字幕，挑模型和音色就能生成。没装的模型在那里也能下载。'},
    image: {icon: 'image', title: '在 工具 › 生成图片 里用', body: '写一句描述就能出图；Agent 做封面时也会用它。'},
    music: {icon: 'music', title: '在 工具 › 生成音乐 里用', body: '选风格、写歌词，生成的音乐存进 Space，可以加到视频里。'},
  };
  const BG_NOTE = '下载前会先列出来源和存放位置，确认后才开始；下载在后台进行，不用等下完。';

  function Where({w}) {
    return (
      <div className="onb-where">
        <Ic n={w.icon} className="ic--20" />
        <div><b>{w.title}</b><p>{w.body}</p></div>
      </div>
    );
  }

  /** 一张模型卡（多选）：右边是状态（已安装 / 进度 / 要下多少），下面一句说明，选中时再写这次一起下哪几件。
      已装好的、正在下的勾上且不能改 */
  function ModelCard({m, sel, recommended, note, ready, half, total, pct, line, onToggle}) {
    const fixed = ready || pct >= 0;
    // 点在勾选框自己的 label 上时交给它，不然点一下会切两次
    const click = (e) => { if (!fixed && !e.target.closest('label')) onToggle(); };
    return (
      <div className={cx('onb-model', sel && !fixed && 'is-on', fixed && 'is-fixed')} onClick={click}>
        <span className="onb-model__hd">
          <Checkbox on={sel || fixed} disabled={fixed} onChange={onToggle} label={m.name} />
          {recommended ? <Chip tone="accent">推荐</Chip> : null}
          {OB.nonCommercial(m) ? <Chip tone="notice">仅限非商用</Chip> : null}
          <span className="grow" />
          {pct >= 0 ? <span className="onb-model__pg"><Progress value={pct} thin label={`正在下载 ${m.name}`} /><span className="t-detail-xs t-mono">{Math.round(pct)}%</span></span>
            : ready ? <span className="onb-model__ok"><Ic n="ok" className="ic--14" />已安装</span>
            : <span className="t-detail-xs">{half ? '缺组件 · ' : ''}{mb(total)}</span>}
        </span>
        {note ? <span className="onb-model__desc">{note}</span> : null}
        {line ? <span className="onb-model__plan">{line}</span> : null}
      </div>
    );
  }

  /** 第一步：这台电脑上的 Agent，主列表每家一行、都能勾（行怎么分、下面那句怎么写在 model-onboarding.js）。
      装好的勾选框就是 设置 › Agent 提供方 里那个启用开关，改了立刻生效；没装的勾上记在 `picks`，按「后台安装」时才装；
      这次引导里已经在装（或排在队里）的勾上且不能改，右边是不定进度；没装成的可以再勾上重装。
      `jobStatus(hid)`：这一家在引导队列里的状态（running / done / error），不在队列里是 null */
  function AgentStep({app, ov, rows, picks, onPick, jobStatus}) {
    const ok = ov.state === 'ready';
    const status = ov.state === 'missing'
      ? {title: ov.title, body: '勾上想用的，BaoCut 在后台安装；装好后用你已有的账号登录一次就能用。'}
      : {title: ok ? `已连接 ${ov.harness.name}` : ov.title, body: ok ? `新会话默认用 ${ov.harness.name} · ${AS.modelLabel(ov.harness, app.prefs.agentModels)}。` : ov.body};
    return (
      <div className="onb-agent">
        <p className="onb-lead">说出想做的视频，Agent 帮你转录、加字幕、翻译、配音和剪辑。BaoCut 调用这台电脑上的 Agent（比如 Claude Code、Codex），用你自己的账号，不另外收费。</p>
        <div className={cx('onb-status', ok && 'is-ok')} role="status">
          <Ic n={ok ? 'ok' : ov.state === 'missing' ? 'info' : 'alert'} className="ic--16" />
          <div><b>{status.title}</b><p>{status.body}</p></div>
        </div>
        <div className="onb-models" role="group" aria-label="这台电脑上的 Agent"><div>
          {rows.map((r) => {
            const {h, kind} = r;
            const now = jobStatus(h.id);
            const busy = now === 'running';
            const can = !busy && (kind === 'use' || kind === 'install');
            const on = busy || (kind === 'use' ? h.enabled : kind === 'install' && picks.indexOf(h.id) >= 0);
            const planned = on && kind === 'install' && !busy;
            const toggle = (v) => {
              if (!can) return;
              if (kind === 'use') app.setHarnessOn(h.id, v);
              else onPick(h.id, v);
            };
            const badge = AS.badge(h);
            const label = <span className="onb-agent__nm"><window.AgentIcon h={h} />{h.name}</span>;
            return (
              <div key={h.id} className={cx('onb-model', on && can && 'is-on', !can && 'is-fixed')}
                onClick={(e) => { if (can && !e.target.closest('label')) toggle(!on); }}>
                <span className="onb-model__hd">
                  <Checkbox on={on} disabled={!can} onChange={toggle} label={label} aria-label={h.name} />
                  <span className="grow" />
                  {busy ? <span className="onb-model__pg"><Progress indeterminate thin label={`正在安装 ${h.name}`} /></span>
                    : <Chip tone={badge.tone}>{badge.label}</Chip>}
                </span>
                <span className={planned ? 'onb-model__plan' : 'onb-model__desc'}>
                  {OB.agentLine(r, {picked: on, running: busy, failed: now === 'error'}, AS)}
                </span>
              </div>
            );
          })}
        </div></div>
        <p className="onb-note">勾上的都会出现在新会话的 Agent 菜单里；安装在后台进行，不用等装完。默认用哪一个、装更多，在 设置 › Agent 提供方 里改。</p>
      </div>
    );
  }

  /* Agent 的安装队列（同实现 OnboardingHost，product-design §7.6）：不在引导组件里跑（引导关掉也得接着装），在模块里排队，
     一家跑完（装好、没装成或被停止）才起下一家。每家交给 agent-setup-runs.jsx 起跑（与 设置 › Agent 提供方 的 ▶ 同一个）：
     轮到哪家才落一条后台任务（「安装 Agent · 名字」，没有百分比，任务页能直接停止，详情里是命令输出）。那一家已经在别处跑着时起不了，
     记成没装成（同实现：请求被拒是 `failed`）。装好写进探测补丁（找到了、还要登录一次）。
     `jobs`：[{id, name, h, method, tid, failed}]，tid 是开始运行后那条任务；`live`：在跑那一家的 tid。 */
  const runs = {jobs: [], live: null, app: null};

  function startNextAgent() {
    const app = runs.app;
    const job = !runs.live && app ? runs.jobs.find((j) => !j.tid && !j.failed) : null;
    if (!job) return;
    const {h, method} = job;
    const tid = window.BC_AGENT_RUNS.start(app, h, method, 'install', {onEnd: (result) => {
      runs.live = null;
      if (result === 'done') {
        app.patchHarness(h.id, {found: true, loggedIn: false});
        app.toast(`已装好 ${h.name} · 还需要在终端里运行 ${AS.loginCmd(h)} 登录一次`, 'positive');
      }
      startNextAgent();
    }});
    if (!tid) { job.failed = true; startNextAgent(); return; }
    job.tid = tid;
    runs.live = tid;
  }

  /** 勾上的几家排进队（没装成的再勾上是重新排队：去掉上一次的那一条）；前面没有在跑的就立刻起第一家 */
  function enqueueAgents(app, rows) {
    runs.app = app;
    runs.jobs = runs.jobs.filter((j) => !rows.some((r) => r.h.id === j.id))
      .concat(rows.map((r) => ({id: r.h.id, name: r.h.name, h: r.h, method: r.method, tid: null, failed: false})));
    startNextAgent();
  }

  function OnboardingAsk({app}) {
    const fresh = !!app.onboarding.fresh;
    const models = D.setModels;
    const comps = D.setComponents;
    const [semSt] = window.BC_SEMSTATE.useSemantic();
    const [step, setStep] = useState(0);
    const [got, setGot] = useState([]);       // 这次引导里下好或正在下的组件（安装表用，后面几步不重复算）
    const [queued, setQueued] = useState([]); // 这次引导里开始的下载与 Agent 安装：[{id, name, tid, agent?}]
    const [agentPicks, setAgentPicks] = useState([]); // Agent 一步勾上、等按「后台安装」的那几家（没装的默认不勾：要用的是自己的订阅）
    const [picks, setPicks] = useState({});   // 每一步的勾选：第一次翻到时按默认值起，之后记住
    const [semPick, setSemPick] = useState(true);
    const speakers = {};
    ((D.models || {}).local || []).forEach((m) => { speakers[m.id] = m.speakers; });
    const on = OB.installTable(models, comps, app.modelInstalled, fresh, got);
    const k = OB.STEPS[step].k;
    const s = OB.stepOf(k);
    const list = OB.choices(k, models, speakers);
    const cur = picks[k] || OB.initialPicks(k, list, comps, on);
    const setCur = (ids) => setPicks((p) => ({...p, [k]: ids}));
    const toggle = (id) => setCur(cur.indexOf(id) >= 0 ? cur.filter((x) => x !== id) : cur.concat([id]));
    const pctOf = (id) => (app.modelDl && id in app.modelDl ? app.modelDl[id] : -1);
    const ov = AS.overview(app.harnessList, app.harness && app.harness.id);
    const taskOf = (q) => (app.tasks || []).find((t) => t.id === q.tid);
    const agentRows = OB.agentRows(app.harnessList, AS);
    // 一家在引导队列里的状态：排着队与在装都是 running；不在队列里是 null
    const agentStatus = (hid) => {
      const job = runs.jobs.find((j) => j.id === hid);
      return job ? OB.agentJobStatus(job, app.tasks) : null;
    };
    // 这次引导里开始的一件现在的状态：Agent 看队列，模型看它的任务（还没有任务算在跑）
    const statusOf = (q) => { if (q.agent) return agentStatus(q.id); const t = taskOf(q); return t ? t.status : 'running'; };
    const toInstall = agentRows.filter((r) => r.kind === 'install' && agentPicks.indexOf(r.h.id) >= 0 && agentStatus(r.h.id) !== 'running');
    const pickAgent = (hid, v) => setAgentPicks((p) => (v ? p.concat([hid]) : p.filter((x) => x !== hid)));

    const pkg = ((D.semantic || {}).packages || [])[0];
    const semUnsupported = semSt.platform === 'unsupported';
    const semInstalled = semSt.install !== 'none';
    const semQueued = !!pkg && queued.some((q) => q.id === pkg.id);
    const semHave = semSt.half && pkg && semSt.half.pkg === pkg.id ? semSt.half.have : [];
    const semPlan = OB.pkgPlan(pkg, semInstalled || semUnsupported || semQueued);
    const semNeed = {parts: semPlan.parts.filter((x) => semHave.indexOf(x.id) < 0)};
    semNeed.total = semNeed.parts.reduce((n, x) => n + x.size, 0);

    // 这一步要下什么：勾上的、还没装好、也不在下的
    const want = list.filter((c) => cur.indexOf(c.m.id) >= 0 && pctOf(c.m.id) < 0 && !LM.ready(c.m, comps, on)).map((c) => c.m);
    const plan = k === 'semantic' ? (semPick ? semNeed : {parts: [], total: 0}) : OB.plan(want, comps, on);
    const primary = k === 'agent' ? OB.agentPrimary(toInstall.length) : OB.primary(k, plan);

    const close = (how, started) => {
      const extra = started || [];
      const models = queued.filter((q) => !q.agent);
      app.closeOnboarding(OB.record(how, k, models.map((q) => q.id).concat(extra)));
      const running = (list) => list.filter((q) => statusOf(q) === 'running').length;
      const live = running(models) + extra.length;
      const agents = running(queued.filter((q) => q.agent));
      const bits = (live ? [`${live} 个模型在后台下载`] : []).concat(agents ? [`${agents} 个 Agent 在后台安装`] : []);
      if (bits.length) app.toast(`${bits.join('，')}，完成后就能用`, 'positive', {label: '查看后台任务', run: () => app.go({r: 'tasks'})});
    };
    const next = (started) => { if (OB.isLast(k)) close('done', started); else setStep(step + 1); };

    const downloadSem = () => {
      const have = {};
      semHave.forEach((id) => { have[id] = true; });
      window.BC_DLASK.open({
        name: pkg.name, parts: pkg.parts, on: have, perPart: true,
        run: (outcome) => {
          const failed = outcome && outcome.failed;
          if (failed) {
            const kept = semHave.length > 0 || outcome.done.length > 0;
            app.addTask({kind: 'model-install', title: `下载「${pkg.name}」`, sub: '本机模型', status: 'error', pct: null,
              semPkg: pkg.id, kept, error: `${failed.name}没下成，可以在 设置 › 语义索引 里${kept ? '补齐' : '换个来源再下'}`});
            app.toast(`「${pkg.name}」没下完：${failed.name}没下成`, 'negative');
            next();
            return;
          }
          // 不在引导组件里跑（引导关掉也得接着走）：与设置 › 语义索引同一个安装，落一条后台任务
          setQueued((q) => q.concat([{id: pkg.id, name: pkg.name, tid: window.BC_SEMSTATE.install(app, pkg)}]));
          next([pkg.id]);
        },
      });
    };
    const installAgents = () => {
      enqueueAgents(app, toInstall);
      setQueued((q) => q.filter((x) => !(x.agent && toInstall.some((r) => r.h.id === x.id)))
        .concat(toInstall.map((r) => ({id: r.h.id, name: r.h.name, agent: true}))));
      setAgentPicks([]);
      next();
    };
    const download = () => {
      if (k === 'semantic') { downloadSem(); return; }
      const ids = want.map((m) => m.id);
      window.askModelDownload(app, ids, (outcome) => {
        const failed = outcome && outcome.failed;
        if (failed) {
          // 下好的部分留着（与设置里同一种「缺部分组件」）；没下成的落一条失败的后台任务，补齐在设置里
          setGot((g) => g.concat(outcome.done));
          want.forEach((m) => { if (outcome.done.indexOf(m.id) >= 0) app.setModelInstalled(m.id, true); });
          // `model`：任务页「去补齐」按它去那一类的设置页（同一步的模型都是同一类）
          const kept = outcome.done.length > 0;
          app.addTask({kind: 'model-install', title: `下载「${want.map((m) => m.name).join('、')}」`, sub: '本机模型', status: 'error', pct: null,
            model: want[0].id, kept, error: `${failed.name}没下成，可以在设置里${kept ? '补齐' : '换个来源再下'}`});
          app.toast(`没下完：${failed.name}没下成，详情在后台任务里`, 'negative');
          next();
          return;
        }
        setGot((g) => g.concat(plan.parts.map((x) => x.id).filter((id) => ids.indexOf(id) < 0)));
        const items = want.map((m) => ({id: m.id, name: m.name, tid: app.downloadModel(m.id)}));
        setQueued((q) => q.concat(items));
        next(ids);
      }, {on});
    };

    // Agent 安装给不出进度：pct 是 null，那一行只写名字
    const bg = OB.bgLine(queued.map((q) => {
      const t = q.agent ? null : taskOf(q);
      return {name: q.name, pct: q.agent ? null : t ? t.pct : 0, status: statusOf(q), agent: !!q.agent};
    }));

    const cards = list.map((c) => {
      const sel = cur.indexOf(c.m.id) >= 0;
      const p = OB.plan([c.m], comps, on);
      const pct = pctOf(c.m.id);
      return <ModelCard key={c.m.id} m={c.m} sel={sel} recommended={c.recommended} note={c.note}
        ready={LM.ready(c.m, comps, on)} half={LM.half(c.m, comps, on)} total={p.total} pct={pct}
        line={sel && pct < 0 ? OB.planLine(p) : null} onToggle={() => toggle(c.m.id)} />;
    });
    const unsupported = (what) => <p className="onb-note"><Ic n="info" className="ic--14" />这台电脑不支持本机{what}，这一步可以直接跳过。</p>;

    return (
      <S.DialogContainer onDismiss={() => close('esc')}>
        <S.Dialog size="L" aria-label="欢迎使用 BaoCut">
          <S.Heading slot="title">{HEAD[k]}</S.Heading>
          <S.Content>
            <Steps items={OB.STEPS} cur={step} label="引导步骤" className="onb-steps" />

            {k === 'agent' ? <AgentStep app={app} ov={ov} rows={agentRows} picks={agentPicks} onPick={pickAgent} jobStatus={agentStatus} /> : null}

            {s.cat ? (
              <div className="onb-pick">
                <p className="onb-lead">{LEAD[k]}</p>
                {!list.length ? unsupported(s.label)
                  : <div className="onb-models" role="group" aria-label={HEAD[k]}><div>{cards}</div></div>}
                {WHERE[k] && list.length ? <Where w={WHERE[k]} /> : null}
                {list.length ? <p className="onb-note">{BG_NOTE}</p> : null}
                {k === 'asr' ? <p className="onb-note onb-alt">不想下载？也可以以后在 设置 › API 提供方 里添加云端识别。</p> : null}
              </div>
            ) : null}

            {k === 'semantic' && pkg ? (
              <div className="onb-pick">
                <p className="onb-lead">{LEAD.semantic}</p>
                {semUnsupported ? unsupported('语义搜索') : <>
                  <div className="onb-models"><div>
                    <div className={cx('onb-model', semPick && !semInstalled && !semQueued && 'is-on', (semInstalled || semQueued) && 'is-fixed')}
                      onClick={(e) => { if (!semInstalled && !semQueued && !e.target.closest('label')) setSemPick(!semPick); }}>
                      <span className="onb-model__hd">
                        <Checkbox on={semPick || semInstalled || semQueued} disabled={semInstalled || semQueued} onChange={setSemPick} label={pkg.name} />
                        <Chip tone="accent">推荐</Chip>
                        <span className="grow" />
                        {semInstalled ? <span className="onb-model__ok"><Ic n="ok" className="ic--14" />已安装</span>
                          : semQueued ? <span className="t-detail-xs">在后台下载</span>
                          : <span className="t-detail-xs">{semHave.length ? '缺组件 · ' : ''}{mb(semNeed.total)}</span>}
                      </span>
                      <span className="onb-model__desc">{pkg.model}</span>
                      {semPick && semNeed.parts.length
                        ? <span className="onb-model__plan">{'一起下载：' + semNeed.parts.map((x) => `${x.name} ${mb(x.size)}`).join(' · ')}</span> : null}
                    </div>
                  </div></div>
                  {semInstalled ? null : <p className="onb-note">{BG_NOTE}</p>}
                </>}
              </div>
            ) : null}
          </S.Content>
          <S.Footer>
            <div className="onb-foot">
              <Btn variant="quiet" onClick={() => close('exit')}>退出引导</Btn>
              {bg ? <span className="onb-bg" role="status"><Ic n="download" className="ic--14" />{bg}</span> : null}
            </div>
          </S.Footer>
          <S.ButtonGroup>
            {primary.kind !== 'next' ? <Btn variant="secondary" onClick={() => next()}>跳过</Btn> : null}
            <Btn variant="accent" autoFocus
              onClick={() => (primary.kind === 'download' ? download() : primary.kind === 'install' ? installAgents() : next())}>{primary.label}</Btn>
          </S.ButtonGroup>
        </S.Dialog>
      </S.DialogContainer>
    );
  }

  /* 关着的时候整个卸载：每次（原型里模拟的）启动都从第一步开始 */
  function OnboardingDialog() {
    const app = useApp();
    return app.onboarding ? <OnboardingAsk app={app} /> : null;
  }

  /* 原型开关里的一段（shell.jsx 委托到这里，不属于产品 UI）：模拟一次第一次启动（全新安装 / 老用户升级）、清掉记录。
     模拟启动先收起原型开关（`onLaunch`），不然引导会叠在它下面 */
  function OnboardingTweaks({onLaunch}) {
    const app = useApp();
    const launch = (fresh) => { if (onLaunch) onLaunch(); app.launchOnboarding(fresh); };
    return (
      <div className="tweaks__sec">
        <div className="tweaks__lb">首次启动引导<em>第一次启动弹一次（老用户升级到这一版也弹一次），走完或退出都记下、不再弹。「模拟」先清掉记录（全新安装还把本机模型与语义搜索改成没装）；地址带 ?onboarding=1 或 =installed 也能模拟，但有记录时不弹。当前记录：{OB.recordText(app.prefs.onboarding)}</em></div>
        <div className="tweaks__rad">
          <BCAction className="tweaks__opt" onClick={() => launch(true)}>模拟 · 全新安装</BCAction>
          <BCAction className="tweaks__opt" onClick={() => launch(false)}>模拟 · 老用户升级</BCAction>
          <BCAction className="tweaks__opt" onClick={() => app.setPref('onboarding', null)}>清除记录</BCAction>
        </div>
      </div>
    );
  }

  Object.assign(window, {OnboardingDialog, OnboardingTweaks});
})();
