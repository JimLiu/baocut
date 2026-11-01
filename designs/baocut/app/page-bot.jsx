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
    /** 频道菜单与对话框（page-bot-dialogs.jsx）：改名、说明、图标、分组、置顶、静音。 */
    updateChannel: (id, patch) => write(s => ({...s, channels: s.channels.map(c => (c.id === id ? {...c, ...patch} : c))})),
    /** 归档与恢复（需求 §2.3）：演示里只改标记，定时任务的暂停不演示。 */
    setArchived: (id, archived) => write(s => ({...s, channels: s.channels.map(c => (c.id === id ? {...c, archived} : c))})),
    /** 删除频道：连同它的任务与时间线。 */
    deleteChannel: id => write(s => {
      const timelines = {...s.timelines};
      delete timelines[id];
      return {...s, channels: s.channels.filter(c => c.id !== id), items: s.items.filter(i => i.channelId !== id), timelines};
    }),
    /** 新建频道（需求 §2.3）：只问名字，可以直接建在一个分组里；返回新频道。 */
    createChannel: ({name, groupId}) => {
      const id = nextId('chan');
      const channel = {id, kind: 'custom', name, purpose: '', lastActivityAt: Date.now(), unread: false, groupId: groupId || null};
      write(s => ({...s, channels: [...s.channels, channel], timelines: {...s.timelines, [id]: []}}));
      return channel;
    },
    /** 记忆（需求 §11.7）：key 是频道 id，或 'user'（所有频道共用的偏好）；清空就是存空字符串。 */
    setMemory: (key, text) => write(s => ({...s, memories: {...s.memories, [key]: text}})),
    /** 分组：建、改名、删（删分组不删频道，组里的回到综合）。 */
    createGroup: name => {
      const group = {id: nextId('grp'), name};
      write(s => ({...s, groups: [...s.groups, group]}));
      return group;
    },
    renameGroup: (id, name) => write(s => ({...s, groups: s.groups.map(g => (g.id === id ? {...g, name} : g))})),
    deleteGroup: id => write(s => ({...s, groups: s.groups.filter(g => g.id !== id),
      channels: s.channels.map(c => (c.groupId === id ? {...c, groupId: null} : c))})),
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
   * 频道侧栏（BOT-CH-02、需求 §11.2 修订）：顶上「等你处理」；然后是综合（默认频道），没分组的频道缩进挂在它下面，用一根拐角线连着；
   * 每个分组另起一段（文件夹图标、名字、展开开关，行尾「⋯」与「＋」），组里的频道挂在组下；最后一行是「新建频道」（建在综合下）。
   * 段内置顶的在前、其余按最近活动。综合行行尾是筛选（状态：进行中 / 已归档 / 全部，代替原来底部的「已归档」折叠组）与「＋」（新建频道、新建分组）。
   * 每行：频道图标、频道名（有未读时加粗、行尾一颗绿点），等你的任务数，置顶、静音、私密与已归档的小图标；行尾「⋯」是频道菜单（page-bot-dialogs.jsx）。
   */
  function BotSidebar() {
    const app = useApp();
    const R = window.RSP;
    const bot = useBot();
    const route = app.route;
    const rows = B.channelSummaries(bot.channels, bot.items);
    const [status, setStatus] = useState('active');
    const [collapsed, setCollapsed] = useState(() => new Set());
    const tree = B.channelTree(rows, bot.groups, status);
    const total = B.needsYouTotal(rows);
    const href = r => window.BC_APP_IA.hrefFor(r);
    const selected = route.r !== 'bot' ? null : route.view === 'inbox' ? href({r: 'bot', view: 'inbox'}) : href({r: 'bot', id: route.id || MAIN});
    const toggleGroup = id => setCollapsed(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    const row = ({channel, unread, counts}) => {
      const main = channel.kind === 'main';
      const detail = [channel.name, unread ? '有未读' : null, counts.needsYou ? `${counts.needsYou} 个任务等你` : null, channel.pinned && !main && !channel.archived ? '已置顶' : null,
        channel.muted ? '已静音' : null, channel.private ? '私密' : null, channel.archived ? '已归档' : null].filter(Boolean).join('，');
      const to = href({r: 'bot', id: channel.id});
      return <R.SideNavItem key={channel.id} id={channel.id} textValue={channel.name} href={to} data-bot-row="" data-bot-child={main ? undefined : ''}>
        <R.SideNavItemContent>
          <R.SideNavItemLink href={to} aria-label={detail}>
            <window.BotChannelGlyph channel={channel} />
            <R.Text><span className="bot-nav__line" title={channel.purpose || channel.name}>
              <span className={cx('bot-nav__title', unread && 'is-unread', channel.archived && 'is-archived')}>{channel.name}</span>
              <span className="bot-nav__tail" aria-hidden="true">
                {channel.archived ? <R.Icons.Archive /> : null}
                {channel.pinned && !main && !channel.archived ? <R.Icons.PinOn /> : null}
                {channel.private ? <R.Icons.Lock /> : null}
                {channel.muted ? <R.Icons.VolumeOff /> : null}
                {counts.needsYou ? <R.NotificationBadge size="S" value={counts.needsYou} /> : unread ? <span className="bot-nav__dot" /> : null}
              </span>
            </span></R.Text>
          </R.SideNavItemLink>
          {main ? <window.BotSidebarTools status={status} onStatus={setStatus} /> : <window.BotChannelActionMenu channel={channel} groups={bot.groups} />}
        </R.SideNavItemContent>
      </R.SideNavItem>;
    };
    const groupSection = ({group, rows: members}) => {
      const open = !collapsed.has(group.id);
      return <R.SideNavSection key={group.id} id={`group:${group.id}`}>
        <R.SideNavHeader><span className="bot-nav__group">
          <R.ActionButton isQuiet size="S" UNSAFE_className="bot-nav__group-toggle bot-titled" aria-expanded={open} onPress={() => toggleGroup(group.id)}>
            <R.Icons.Folder /><R.Text><span className="bot-titled__name">{group.name}</span>{open ? <R.Icons.ChevronDown /> : <R.Icons.ChevronRight />}</R.Text>
          </R.ActionButton>
          <window.BotGroupTools group={group} />
        </span></R.SideNavHeader>
        {open ? members.map(row) : []}
      </R.SideNavSection>;
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
              {[tree.main, ...tree.loose].filter(Boolean).map(row)}
            </R.SideNavSection>
            {tree.groups.map(groupSection)}
          </R.SideNav>
          <R.ActionButton isQuiet size="M" UNSAFE_className="bot-nav__new" onPress={() => window.openBotDialog({kind: 'newChannel'})}>
            <R.Icons.Add /><R.Text>新建频道</R.Text>
          </R.ActionButton>
          {status !== 'active' && !tree.loose.length && !tree.groups.some(g => g.rows.length)
            ? <p className="bot-empty">{status === 'archived' ? '没有归档的频道。' : '还没有别的频道。'}</p> : null}
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
  /** 主区的宽：窄于 880 算窄；右栏的宽按它夹。 */
  function useMainWidth() {
    const [width, setWidth] = useState(0);
    const observer = useRef(null);
    const ref = useCallback(el => {
      if (observer.current) observer.current.disconnect();
      if (!el) return;
      observer.current = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
      observer.current.observe(el);
    }, []);
    return [ref, width];
  }

  /** 拖过的右栏宽，按形态（tasks / make / detail / output）各记各的；离开 Bot 页再回来还在。 */
  const sideWidths = {};

  /**
   * Bot 页（需求 §11.1）：中间频道对话（或收件箱、展开的任务详情、频道记忆），右边任务面板、Make 面板、任务详情或推开的产物。
   * 路由 {r:'bot', id: 频道, task: 打开的任务, out: 从任务里推开的产物下标, view: 'inbox' | 'task' | 'memory'}。
   * 右栏的开合由频道头的「任务」「Make」两个开关、面板与详情的关闭按钮管：宽时默认开着，窄时默认收起、开了是浮层；两种宽度各记各的。
   * 两个开关切右栏里放哪一块（`side`）；打开任务时右栏是详情，「任务」开关算开着。
   * 宽时中间与右栏之间有分隔条：任务面板默认 340、Make 380，任务详情默认更宽，推开产物时右栏把中间压到 440 左右；拖过的宽按形态记住。
   * 产物页可以「占满」：中间收起，右栏占满主区。
   */
  function BotPage({id, task, view, out}) {
    const app = useApp();
    const bot = useBot();
    const [contentRef, mainWidth] = useMainWidth();
    const narrow = mainWidth > 0 && mainWidth < NARROW;
    const [wideHidden, setWideHidden] = useState(false);
    const [narrowShown, setNarrowShown] = useState(false);
    const [side, setSide] = useState('tasks');
    const [full, setFull] = useState(false);
    const [, setWidthsSeen] = useState(0);
    useEffect(() => setFull(false), [task, out]);
    const panelShown = narrow ? narrowShown : !wideHidden;
    const setShown = shown => (narrow ? setNarrowShown(shown) : setWideHidden(!shown));
    const channelId = view === 'inbox' ? null : id || MAIN;
    const channel = channelId ? bot.channels.find(c => c.id === channelId) : null;
    useEffect(() => { if (channel && channel.unread) BOT_ACTIONS.markRead(channel.id); }, [channelId]);
    const strip = r => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null));
    const to = next => app.go(strip({r: 'bot', id, task, view, ...next}));
    const openTask = (item, inbox) => app.go(strip({r: 'bot', id: inbox ? item.channelId : id, task: item.id, view: inbox ? 'inbox' : null}));
    const closeDetail = () => app.go(strip({r: 'bot', id, view: view === 'inbox' ? 'inbox' : null}));
    const backToList = () => { setSide('tasks'); setShown(true); closeDetail(); };
    const hide = () => { setShown(false); if (task) closeDetail(); };
    const showSide = which => { setSide(which); setShown(true); if (task) closeDetail(); };
    const openOutput = n => to({out: String(n)});
    const item = task ? bot.items.find(i => i.id === task) : null;
    const outIndex = task && out != null ? Number(out) : null;
    /* 推开的产物：返回回到任务详情，关闭收起右栏（收件箱里回到收件箱） */
    const outputView = onClose => <window.BotOutputView item={item} index={outIndex} full={full} onBack={() => to({out: null})}
      onToggleFull={narrow ? null : () => setFull(!full)} onClose={onClose} />;
    let center;
    let right = null;
    let mode = side;
    if (view === 'inbox') {
      center = <BotInbox selectedId={task} onOpen={i => openTask(i, true)} />;
      if (task && outIndex != null) right = outputView(closeDetail);
      else if (task) right = <window.BotTaskDetail id={task} wide={false} onHide={closeDetail} onOpenOutput={openOutput} />;
    } else if (!channel) {
      center = <div className="bot-missing"><span>这个频道已经不在了。</span>
        <window.RSP.Button variant="secondary" onPress={() => app.go({r: 'bot'})}>去默认频道</window.RSP.Button></div>;
    } else if (view === 'memory') {
      center = <window.BotMemoryPage key={channel.id} channel={channel} />;
    } else if (view === 'task' && task) {
      center = <window.BotTaskDetail id={task} wide onToggleWide={() => to({view: null, out: null})} onBack={backToList} onOpenOutput={openOutput} />;
      if (outIndex != null) right = outputView(() => to({out: null}));
    } else {
      const tasksOn = !!task || (panelShown && side === 'tasks');
      const makeOn = !task && panelShown && side === 'make';
      const suggestions = bot.items.filter(i => i.channelId === channel.id && i.status === 'suggested').length;
      center = <window.BotChannelView key={channel.id} channel={channel}
        tasksToggle={{shown: tasksOn, onToggle: () => (tasksOn ? hide() : showSide('tasks'))}}
        makeToggle={{shown: makeOn, suggestions, onToggle: () => (makeOn ? hide() : showSide('make'))}} />;
      if (task && outIndex != null) right = outputView(hide);
      else if (task) right = <window.BotTaskDetail id={task} wide={false} onToggleWide={() => to({view: 'task'})} onBack={backToList} onHide={hide} onOpenOutput={openOutput} />;
      else if (panelShown && side === 'make') right = <window.BotMakePanel key={channel.id} channelId={channel.id} onHide={hide}
        onOpenOutput={(i, n) => app.go({r: 'bot', id: i.channelId, task: i.id, out: String(n)})} />;
      else if (panelShown) right = <window.BotTaskPanel key={channel.id} channelId={channel.id} selectedId={null} onHide={hide} />;
    }
    if (task) mode = outIndex != null ? 'output' : 'detail';
    const sized = right && !narrow && mainWidth > 0 && !full ? B.sideWidth(mode, sideWidths[mode], mainWidth) : null;
    const resize = w => { sideWidths[mode] = B.sideWidth(mode, w, mainWidth).width; setWidthsSeen(n => n + 1); };
    const reset = () => { delete sideWidths[mode]; setWidthsSeen(n => n + 1); };
    return <div className={cx('bot', full && right && 'bot--side-full')} ref={contentRef}>
      <window.BotDialogs />
      <div className="bot__main">{center}</div>
      {sized ? <window.BotSideSeam {...sized} onResize={resize} onReset={reset} /> : null}
      {right ? <aside className={cx('bot__side', `bot__side--${mode}`, narrow && 'bot__side--overlay')} style={sized ? {width: sized.width} : undefined}>{right}</aside> : null}
    </div>;
  }

  Object.assign(window, {BotPage, BotSidebar, useBot, BOT_ACTIONS, BotStatusIcon, BotStatusLabel});
})();
