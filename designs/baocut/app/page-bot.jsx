/* Bot 页（docs/design/bot-mode/bot-mode-requirements.md §11，技术方案 §17.1）—— 只在 App 入口加载。
   左边频道侧栏（页面侧栏，由 Shell 放），中间频道对话（或收件箱、展开的任务详情），右边任务面板或任务详情。
   主区窄于 880 时右栏收起，从频道头部的开关浮出；打开任务详情时总是显示。

   演示态（频道、任务、时间线）是这一页自己的：一个模块级的小 store，侧栏与页面共读，不进 store.jsx。
   规则（分组、排序、状态对照）在 model-bot.js，与 packages/ui 的 model/bot.ts 同一份。 */
(function () {
  const {useState, useEffect, useRef, useCallback, useSyncExternalStore} = React;
  const B = window.BC_BOT;
  const MAIN = 'chan_main';
  const NARROW = 880;

  /* ---------- 演示 store ---------- */
  let state = null;
  const listeners = new Set();
  const read = () => state || (state = {...B.demo(Date.now()), seq: 0});
  const write = fn => { state = fn(read()); listeners.forEach(l => l()); };
  const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };
  const nextId = prefix => { const n = read().seq + 1; write(s => ({...s, seq: n})); return `${prefix}_${n}`; };
  const message = (role, text, extra) => ({kind: 'message', role, text, at: Date.now(), ...extra});
  const pushTimeline = (s, channelId, entries) => ({...s, timelines: {...s.timelines, [channelId]: [...(s.timelines[channelId] || []), ...entries]}});
  const patchItem = (s, id, fn) => ({...s, items: s.items.map(i => (i.id === id ? fn(i) : i))});

  const BOT_ACTIONS = {
    /** 任务行与详情里的快捷操作（需求 §11.5）。 */
    act: (id, action) => write(s => patchItem(s, id, i => B.applyAction(i, action, Date.now()))),
    /** 新建任务（需求 §4.4）；返回新任务。 */
    addTask: ({channelId, title, owner, start}) => {
      const task = B.newTask({id: nextId('wi'), channelId, title, owner, start}, Date.now());
      write(s => ({...s, items: [...s.items, task]}));
      return task;
    },
    /** 频道里说一句话：演示里智能体答应下来，开一个任务并放一张线程卡（BOT-CV-03）。 */
    send: (channelId, text) => {
      const id = nextId('wi');
      write(s => {
        const task = {...B.newTask({id, channelId, title: text.length > 24 ? text.slice(0, 24) + '…' : text, owner: 'agent', start: true}, Date.now()),
          steps: [{text: '读一下上下文', state: 'active'}], thread: [{role: 'user', text, at: Date.now()}]};
        return pushTimeline({...s, items: [...s.items, task]}, channelId, [
          message('user', text),
          message('assistant', '好，在后台开一个任务做这件事，有结果或要你决定时在这里告诉你。'),
          {kind: 'work-item-ref', workItemId: id},
        ]);
      });
    },
    /** 任务线程里说一句话或回答问题：问题清掉，任务回到工作中。 */
    reply: (id, text) => write(s => patchItem(s, id, i => ({...i, question: undefined, updatedAt: Date.now(),
      ...(i.status === 'active' ? {active: {state: 'working'}} : {}), thread: [...(i.thread || []), {role: 'user', text, at: Date.now()}]}))),
    /** 建议：现在做、加入接下来、忽略（BOT-SG-05…07）。 */
    accept: (id, now) => write(s => patchItem(s, id, i => ({...i, suggestion: undefined, updatedAt: Date.now(),
      ...(now ? {status: 'active', active: {state: 'working'}} : {status: 'upNext'})}))),
    /** Make 面板的模板「＋」：在这个频道建一条定时任务（BOT-MK-05）；返回新任务。 */
    schedule: (channelId, template) => {
      const task = B.taskFromTemplate({id: nextId('wi'), channelId, template}, Date.now());
      write(s => ({...s, items: [...s.items, task]}));
      return task;
    },
    markRead: channelId => write(s => ({...s, channels: s.channels.map(c => (c.id === channelId && c.unread ? {...c, unread: false} : c))})),
  };

  /** Bot 页与侧栏共读的演示态。 */
  function useBot() {
    return useSyncExternalStore(subscribe, read);
  }

  /* ---------- 状态图标 ---------- */

  /** 状态图标（16px）；`chip` 时垫一块 24px 的圆角底（任务行、详情头、运行记录行的任务头）。
      图标不朗读：文字由旁边的标签或行的读屏名称给出；工作中画转圈。 */
  function BotStatusIcon({statusKey, chip}) {
    const row = B.STATUS[statusKey];
    const Icon = row.icon ? window.RSP.Icons[row.icon] : null;
    return <span className={cx('bot-status', `bot-status--${row.tone}`, chip && 'bot-status--chip')} aria-hidden="true">
      {Icon ? <Icon /> : <window.RSP.ProgressCircle size="S" isIndeterminate aria-label={row.label} />}
    </span>;
  }
  /** 图标加文字的状态标签。 */
  function BotStatusLabel({statusKey}) {
    const row = B.STATUS[statusKey];
    return <span className={`bot-status-label bot-status--${row.tone}`}><BotStatusIcon statusKey={statusKey} /><span>{row.label}</span></span>;
  }

  /* ---------- 频道侧栏 ---------- */

  /**
   * 频道侧栏（BOT-CH-02、需求 §11.2）：顶上「等你处理」，然后是综合（默认频道），其余频道缩进挂在它下面（置顶的在前、其余按最近活动），
   * 用一根拐角线连着；这一组的最后一行是「新建频道」。归档的收在最下面一组（另一个导航，因为「新建频道」是按钮不是链接）。
   * 每行：频道名（有未读时加粗、行尾一颗绿点），等你的任务数，置顶、静音与私密的小图标；行尾「⋯」是设置、记忆、置顶、静音、归档与删除。
   */
  function BotSidebar() {
    const app = useApp();
    const R = window.RSP;
    const bot = useBot();
    const route = app.route;
    const rows = B.channelSummaries(bot.channels, bot.items);
    const groups = B.channelGroups(rows);
    const total = B.needsYouTotal(rows);
    const [showArchived, setShowArchived] = useState(false);
    const href = r => window.BC_APP_IA.hrefFor(r);
    const selected = route.r !== 'bot' ? null : route.view === 'inbox' ? href({r: 'bot', view: 'inbox'}) : href({r: 'bot', id: route.id || MAIN});
    const later = what => app.toast(`原型里没有画${what}`);
    const row = ({channel, unread, counts}) => {
      const main = channel.kind === 'main';
      const detail = [channel.name, unread ? '有未读' : null, counts.needsYou ? `${counts.needsYou} 个任务等你` : null,
        channel.muted ? '已静音' : null, channel.private ? '私密' : null].filter(Boolean).join('，');
      const to = href({r: 'bot', id: channel.id});
      const child = !main && !channel.archived;
      return <R.SideNavItem key={channel.id} id={channel.id} textValue={channel.name} href={to} data-bot-row="" data-bot-child={child ? '' : undefined}>
        <R.SideNavItemContent>
          <R.SideNavItemLink href={to} aria-label={channel.pinned ? `${detail}，已置顶` : detail}>
            {main ? <R.Icons.Layers /> : null}
            <R.Text><span className="bot-nav__line" title={channel.purpose || channel.name}>
              <span className={cx('bot-nav__title', unread && 'is-unread')}>{channel.name}</span>
              <span className="bot-nav__tail" aria-hidden="true">
                {channel.pinned && !main ? <R.Icons.PinOn /> : null}
                {channel.private ? <R.Icons.Lock /> : null}
                {channel.muted ? <R.Icons.VolumeOff /> : null}
                {counts.needsYou ? <R.NotificationBadge size="S" value={counts.needsYou} /> : unread ? <span className="bot-nav__dot" /> : null}
              </span>
            </span></R.Text>
          </R.SideNavItemLink>
          <R.ActionMenu aria-label="更多操作" isQuiet size="S" onAction={() => later('频道设置、置顶、静音与归档')}>
            <R.MenuItem id="settings" textValue="频道设置…"><R.Icons.Settings /><R.Text>频道设置…</R.Text></R.MenuItem>
            <R.MenuItem id="memory" textValue="记忆"><R.Icons.Bookmark /><R.Text>记忆</R.Text></R.MenuItem>
            {main || channel.archived ? null : <R.MenuItem id="pin" textValue={channel.pinned ? '取消置顶' : '置顶'}><R.Icons.PinOn /><R.Text>{channel.pinned ? '取消置顶' : '置顶'}</R.Text></R.MenuItem>}
            <R.MenuItem id="mute" textValue={channel.muted ? '取消静音' : '静音'}><R.Icons.VolumeOff /><R.Text>{channel.muted ? '取消静音' : '静音'}</R.Text></R.MenuItem>
            {main ? null : <R.MenuItem id="archive" textValue={channel.archived ? '恢复' : '归档'}><R.Icons.Archive /><R.Text>{channel.archived ? '恢复' : '归档'}</R.Text></R.MenuItem>}
            {main ? null : <R.MenuItem id="delete" textValue="删除…"><R.Icons.Delete /><R.Text>删除…</R.Text></R.MenuItem>}
          </R.ActionMenu>
        </R.SideNavItemContent>
      </R.SideNavItem>;
    };
    return (
      <div className="hside hside--home hside--bot" style={{width: app.sidebar.width || app.sidebar.last}}>
        <h2 className="app-section-title">频道</h2>
        <div className="hside__nav bc-scroll">
          {/* 分组的键加 `group:`：与条目同名时集合的前后链接成环 */}
          <R.SideNav aria-label="频道" selectedRoute={selected} UNSAFE_className="bot-nav__tree">
            <R.SideNavSection id="group:inbox">
              <R.SideNavItem id="inbox" textValue="等你处理" href={href({r: 'bot', view: 'inbox'})} data-bot-row="">
                <R.SideNavItemContent><R.SideNavItemLink href={href({r: 'bot', view: 'inbox'})} aria-label={total ? `等你处理，${total} 个任务等你` : '等你处理'}>
                  <R.Icons.Bell />
                  <R.Text><span className="bot-nav__line"><span className="bot-nav__title">等你处理</span>
                    {total ? <span className="bot-nav__tail" aria-hidden="true"><R.NotificationBadge size="S" value={total} /></span> : null}
                  </span></R.Text>
                </R.SideNavItemLink></R.SideNavItemContent>
              </R.SideNavItem>
            </R.SideNavSection>
            <R.SideNavSection id="group:channels">
              {groups.active.map(row)}
            </R.SideNavSection>
          </R.SideNav>
          <R.ActionButton isQuiet size="M" UNSAFE_className="bot-nav__new" onPress={() => later('新建频道对话框')}>
            <R.Icons.Add /><R.Text>新建频道</R.Text>
          </R.ActionButton>
          {groups.archived.length ? <R.SideNav aria-label="已归档的频道" selectedRoute={selected} UNSAFE_className="bot-nav__archived">
            <R.SideNavSection id="group:archived">
              <R.SideNavHeader><span className="bot-nav__section">
                <R.ActionButton isQuiet size="S" aria-expanded={showArchived} aria-label="已归档" onPress={() => setShowArchived(!showArchived)}>
                  {showArchived ? <R.Icons.ChevronDown /> : <R.Icons.ChevronRight />}
                </R.ActionButton>{`已归档 (${groups.archived.length})`}
              </span></R.SideNavHeader>
              {showArchived ? groups.archived.map(row) : []}
            </R.SideNavSection>
          </R.SideNav> : null}
        </div>
      </div>
    );
  }

  /* ---------- 收件箱 ---------- */

  /** 等你处理（需求 §11.8）：全部频道里待你审阅与需要你输入的任务，按频道分组；点一行在右侧打开任务。 */
  function BotInbox({selectedId, onOpen}) {
    const bot = useBot();
    const groups = bot.channels.map(c => ({channel: c, items: bot.items.filter(i => i.channelId === c.id && B.needsUser(i))})).filter(g => g.items.length);
    return <section className="bot-inbox bc-scroll" aria-label="等你处理">
      <h2 className="bot-inbox__title">等你处理</h2>
      {groups.length ? groups.map(g => <section key={g.channel.id} className="bot-inbox__group" aria-label={g.channel.name}>
        <h3 className="bot-section__title">{g.channel.name}</h3>
        <ul className="bot-list">{g.items.map(i => <window.BotTaskRow key={i.id} item={i} selected={i.id === selectedId} onOpen={() => onOpen(i)} />)}</ul>
      </section>) : <p className="bot-empty">现在没有等你处理的任务。</p>}
    </section>;
  }

  /* ---------- 页面 ---------- */

  /** 量主区宽度：窄了任务面板改成浮层。 */
  function useNarrow() {
    const [narrow, setNarrow] = useState(false);
    const observer = useRef(null);
    const ref = useCallback(el => {
      if (observer.current) observer.current.disconnect();
      if (!el) return;
      observer.current = new ResizeObserver(([entry]) => setNarrow(entry.contentRect.width < NARROW));
      observer.current.observe(el);
    }, []);
    return [ref, narrow];
  }

  /**
   * Bot 页（需求 §11.1）：中间频道对话（或收件箱、展开的任务详情），右边任务面板、Make 面板或任务详情。
   * 路由 {r:'bot', id: 频道, task: 打开的任务, view: 'inbox' | 'task'}。
   * 右栏的开合由频道头的「任务」「Make」两个开关、面板与详情的关闭按钮管：宽时默认开着，窄时默认收起、开了是浮层；两种宽度各记各的。
   * 两个开关切右栏里放哪一块（`side`）；打开任务时右栏是详情，「任务」开关算开着。
   */
  function BotPage({id, task, view}) {
    const app = useApp();
    const bot = useBot();
    const [contentRef, narrow] = useNarrow();
    const [wideHidden, setWideHidden] = useState(false);
    const [narrowShown, setNarrowShown] = useState(false);
    const [side, setSide] = useState('tasks');
    const panelShown = narrow ? narrowShown : !wideHidden;
    const setShown = shown => (narrow ? setNarrowShown(shown) : setWideHidden(!shown));
    const channelId = view === 'inbox' ? null : id || MAIN;
    const channel = channelId ? bot.channels.find(c => c.id === channelId) : null;
    useEffect(() => { if (channel && channel.unread) BOT_ACTIONS.markRead(channel.id); }, [channelId]);
    const to = next => app.go({r: 'bot', ...(id ? {id} : {}), ...(task ? {task} : {}), ...(view ? {view} : {}), ...next});
    const strip = r => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null));
    const openTask = (item, inbox) => app.go(strip({r: 'bot', id: inbox ? item.channelId : id, task: item.id, view: inbox ? 'inbox' : null}));
    const closeDetail = () => app.go(strip({r: 'bot', id, view: view === 'inbox' ? 'inbox' : null}));
    const backToList = () => { setSide('tasks'); setShown(true); closeDetail(); };
    const hide = () => { setShown(false); if (task) closeDetail(); };
    const showSide = which => { setSide(which); setShown(true); if (task) closeDetail(); };
    let center;
    let right = null;
    if (view === 'inbox') {
      center = <BotInbox selectedId={task} onOpen={i => openTask(i, true)} />;
      if (task) right = <window.BotTaskDetail id={task} wide={false} onHide={closeDetail} />;
    } else if (!channel) {
      center = <div className="bot-missing"><span>这个频道已经不在了。</span>
        <window.RSP.Button variant="secondary" onPress={() => app.go({r: 'bot'})}>去默认频道</window.RSP.Button></div>;
    } else if (view === 'task' && task) {
      center = <window.BotTaskDetail id={task} wide onToggleWide={() => to({view: null})} onBack={backToList} />;
    } else {
      const tasksOn = !!task || (panelShown && side === 'tasks');
      const makeOn = !task && panelShown && side === 'make';
      const suggestions = bot.items.filter(i => i.channelId === channel.id && i.status === 'suggested').length;
      center = <window.BotChannelView key={channel.id} channel={channel}
        tasksToggle={{shown: tasksOn, onToggle: () => (tasksOn ? hide() : showSide('tasks'))}}
        makeToggle={{shown: makeOn, suggestions, onToggle: () => (makeOn ? hide() : showSide('make'))}} />;
      if (task) right = <window.BotTaskDetail id={task} wide={false} onToggleWide={() => to({view: 'task'})} onBack={backToList} onHide={hide} />;
      else if (panelShown && side === 'make') right = <window.BotMakePanel key={channel.id} channelId={channel.id} onHide={hide} onOpenTask={i => app.go({r: 'bot', id: i.channelId, task: i.id})} />;
      else if (panelShown) right = <window.BotTaskPanel key={channel.id} channelId={channel.id} selectedId={null} onHide={hide} />;
    }
    return <div className="bot" ref={contentRef}>
      <div className="bot__main">{center}</div>
      {right ? <aside className={cx('bot__side', task && 'bot__side--detail', !task && side === 'make' && 'bot__side--make', narrow && 'bot__side--overlay')}>{right}</aside> : null}
    </div>;
  }

  Object.assign(window, {BotPage, BotSidebar, useBot, BOT_ACTIONS, BotStatusIcon, BotStatusLabel});
})();
