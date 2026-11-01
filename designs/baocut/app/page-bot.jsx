/* Bot 页（docs/design/bot-mode/bot-mode-requirements.md §11，技术方案 §17.1）—— 只在 App 入口加载。
   左边频道侧栏（页面侧栏，由 Shell 放），中间频道对话（或收件箱、频道记忆），右边是一组页签（任务、Make、打开的任务与产物）。
   主区窄于 880 时右栏收起，从频道头部的开关浮出；打开任务或产物时总是显示。

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

  /** 主区的宽：窄于 880 算窄（右栏改成浮层，没有占满）；右栏与占满时左栏的宽按它夹。 */
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

  /** 拖过的宽，按形态各记各的：右栏 tasks / make / detail / output，占满时的左栏 full:tasks / full:make / full:inbox / full:task。 */
  const sideWidths = {};
  /** 右栏的页签簿（按频道各一份、收件箱一份）与每份的占满：照 Home 每个会话各记各的页签与视图，离开 Bot 页再回来还在。 */
  let tabBook = {};
  const fullBook = {};
  const strip = r => Object.fromEntries(Object.entries(r).filter(([, v]) => v != null));
  const FULL_HINT = {tasks: '在左边打开一个任务，它会显示在这里。', make: '按左边的一张产物卡，它会在这里打开。'};

  /**
   * Bot 页（需求 §11.1 的修订稿）：中间频道对话（或收件箱、频道记忆），右栏照 Home 的功能区是一组页签（product-design §3.3）。
   * 路由 {r:'bot', id: 频道, task, out, view: 'inbox' | 'memory'}：task / out 是当前的任务或产物页签，没有就是固定页签（「任务」或「Make」，`side`）。
   * 页签簿按频道各记一份（model-bot.js 的 reconcileSideTabs）：路由里的任务、产物没开就开一个页签；关掉当前页签换到旁边那个。
   * 右栏的开合：宽时默认开着，窄时默认收起、开了是浮层；路由里有任务或产物时总是开着。频道头的「任务」「Make」开关显示右栏并选中
   * 那个固定页签，再按一次收起；页签条的「收起右栏」同一件事。收起不关页签。
   * 宽时中间与右栏之间有分隔条，宽按当前页签的形态（任务面板 340、Make 380、任务更宽、产物最宽），拖过的各记各的。
   * 占满：中间收起，右栏占满主区并分成两栏——左边是当前页签的上一层，右边是当前页签（model-bot.js 的 fullColumns）；两栏之间也能拖。
   * 旧链接的 view: 'task'（任务详情占满主区）进来时换成占满。
   */
  function BotPage({id, task, view, out}) {
    const app = useApp();
    const bot = useBot();
    const [contentRef, mainWidth] = useMainWidth();
    const narrow = mainWidth > 0 && mainWidth < NARROW;
    const [wideHidden, setWideHidden] = useState(false);
    const [narrowShown, setNarrowShown] = useState(false);
    const [side, setSide] = useState('tasks');
    const [book, setBook] = useState(tabBook);
    const [, bump] = useState(0);
    const inbox = view === 'inbox';
    const bookKey = B.sideTabBook({id, view});
    const current = B.reconcileSideTabs(book, {id, view, task, out});
    useEffect(() => { if (current !== book) { tabBook = current; setBook(current); } }, [current, book]);
    const tabs = current[bookKey] || {tabs: [], active: null};
    const active = tabs.tabs.find(t => t.key === tabs.active) || null;
    const panelShown = narrow ? narrowShown : !wideHidden;
    const setShown = shown => (narrow ? setNarrowShown(shown) : setWideHidden(!shown));
    const full = !narrow && !!fullBook[bookKey];
    const setFull = on => { fullBook[bookKey] = on; bump(n => n + 1); };
    const setWidth = (key, width) => { sideWidths[key] = width; bump(n => n + 1); };
    const resetWidth = key => { delete sideWidths[key]; bump(n => n + 1); };
    useEffect(() => {
      if (view !== 'task') return;
      fullBook[bookKey] = true;
      app.replace(strip({r: 'bot', id, task, out}));
    }, [view]);
    const channelId = inbox ? null : id || MAIN;
    const channel = channelId ? bot.channels.find(c => c.id === channelId) : null;
    useEffect(() => { if (channel && channel.unread) BOT_ACTIONS.markRead(channel.id); }, [channelId]);
    const at = next => strip({r: 'bot', id, view: inbox ? 'inbox' : null, ...next});
    const openTask = item => app.go(strip({r: 'bot', id: item.channelId, task: item.id, view: inbox ? 'inbox' : null}));
    const openOutput = taskId => n => app.go(at({task: taskId, out: String(n)}));
    const selectTab = tab => app.go(at(B.sideTabRoute(tab)));
    const selectFixed = kind => { setSide(kind); setShown(true); if (task) app.go(at({})); };
    const hide = () => { setShown(false); setFull(false); if (task) app.replace(at({})); };
    const closeTab = tab => {
      const next = B.closeSideTab(tabs, tab.key);
      if (tabs.active === tab.key) app.replace(at(B.sideTabRoute(next.tabs.find(t => t.key === next.active))));
      tabBook = {...current, [bookKey]: next};
      setBook(tabBook);
    };
    const tabContent = (tab, wide) => (tab.kind === 'output'
      ? <window.BotOutputView key={tab.key} item={bot.items.find(i => i.id === tab.task)} index={tab.index}
        onOpenTask={() => app.go(at({task: tab.task}))} onClose={() => closeTab(tab)} />
      : <window.BotTaskDetail key={tab.key} id={tab.task} wide={wide} onOpenOutput={openOutput(tab.task)} />);
    const fixedContent = kind => (kind === 'make'
      ? <window.BotMakePanel key={channel.id} channelId={channel.id} onOpenOutput={(i, n) => app.go({r: 'bot', id: i.channelId, task: i.id, out: String(n)})} />
      : <window.BotTaskPanel key={channel.id} channelId={channel.id} selectedId={active && active.kind === 'task' ? active.task : null} />);
    const leftContent = left => (left.kind === 'task' ? <window.BotTaskDetail key={`left:${left.task}`} id={left.task} onOpenOutput={openOutput(left.task)} />
      : left.kind === 'inbox' ? <BotInbox selectedId={task} onOpen={openTask} /> : fixedContent(left.kind));

    let center;
    let shown = false;
    if (inbox) {
      center = <BotInbox selectedId={task} onOpen={openTask} />;
      shown = !!task;
    } else if (!channel) {
      center = <div className="bot-missing"><span>这个频道已经不在了。</span>
        <window.RSP.Button variant="secondary" onPress={() => app.go({r: 'bot'})}>去默认频道</window.RSP.Button></div>;
    } else if (view === 'memory') {
      center = <window.BotMemoryPage key={channel.id} channel={channel} />;
    } else {
      shown = !!task || panelShown;
      const fixedOn = kind => shown && !active && side === kind;
      const suggestions = bot.items.filter(i => i.channelId === channel.id && i.status === 'suggested').length;
      center = <window.BotChannelView key={channel.id} channel={channel}
        tasksToggle={{shown: fixedOn('tasks'), onToggle: () => (fixedOn('tasks') ? hide() : selectFixed('tasks'))}}
        makeToggle={{shown: fixedOn('make'), suggestions, onToggle: () => (fixedOn('make') ? hide() : selectFixed('make'))}} />;
    }

    const mode = B.sideMode(active, side);
    const sized = shown && !narrow && !full && mainWidth > 0 ? B.sideWidth(mode, sideWidths[mode], mainWidth) : null;
    let body = null;
    if (shown && full) {
      const cols = B.fullColumns(active, side, inbox);
      const key = `full:${cols.left.kind}`;
      const split = B.fullSplit(cols.left.kind, sideWidths[key], mainWidth);
      body = <div className="bot-side__body bot-side__body--split">
        <div className="bot-side__col" style={{width: split.width}}>{leftContent(cols.left)}</div>
        <window.BotSideSeam {...split} start label="调整两栏宽度" onResize={w => setWidth(key, B.fullSplit(cols.left.kind, w, mainWidth).width)} onReset={() => resetWidth(key)} />
        <div className="bot-side__col bot-side__col--main">
          {cols.right ? tabContent(cols.right, mainWidth - split.width >= 720) : <p className="bot-side__hint">{FULL_HINT[cols.left.kind]}</p>}
        </div>
      </div>;
    } else if (shown) {
      body = <div className="bot-side__body">{active ? tabContent(active, false) : fixedContent(side)}</div>;
    }
    const waiting = channel ? bot.items.filter(i => i.channelId === channel.id && B.needsUser(i)).length : 0;
    const suggestions = channel ? bot.items.filter(i => i.channelId === channel.id && i.status === 'suggested').length : 0;
    return <div className={cx('bot', full && shown && 'bot--side-full')} ref={contentRef}>
      <window.BotDialogs />
      <div className="bot__main">{center}</div>
      {sized ? <window.BotSideSeam {...sized} onResize={w => setWidth(mode, B.sideWidth(mode, w, mainWidth).width)} onReset={() => resetWidth(mode)} /> : null}
      {shown ? <aside className={cx('bot__side', `bot__side--${mode}`, narrow && 'bot__side--overlay')} style={sized ? {width: sized.width} : undefined} aria-label="右栏">
        <window.BotSideTabs fixed={!inbox} side={side} active={tabs.active} tabs={tabs.tabs} waiting={waiting} suggestions={suggestions}
          full={full} onToggleFull={narrow ? null : () => setFull(!full)} onFixed={selectFixed} onSelect={selectTab} onClose={closeTab} onHide={hide} />
        <div id="bot-side-panel" role="tabpanel" className="bot-side__panel" aria-labelledby={window.botSideTabId(tabs.active || `fixed:${side}`)}>{body}</div>
      </aside> : null}
    </div>;
  }

  Object.assign(window, {BotPage, BotSidebar, useBot, BOT_ACTIONS, BotStatusIcon, BotStatusLabel});
})();
