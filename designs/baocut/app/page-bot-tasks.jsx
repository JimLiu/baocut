/* Bot 页的任务面板与任务详情（docs/design/bot-mode/bot-mode-requirements.md §11.5–§11.6、§4.4）—— 只在 App 入口加载。
   面板：头部是标题、「显示哪些任务」菜单、「给点建议」、新任务与关闭；建议另放在页签上方；
   四个页签：进行中（按子状态分组，组头带条数）、接下来、定时、已解决。新任务在面板头下面直接输入。
   详情：头部一行（返回、状态、标题与「状态 · 下一步 · N 条进展」、展开、⋯、关闭），下面是事实、问题、步骤、产物、进展与任务线程。 */
(function () {
  const {useState} = React;
  const B = window.BC_BOT;

  /** 任务面板里的一行：状态图标、标题（解决了划掉）、下一步或截止日；行尾「⋯」是快捷操作（需求 §11.5）。 */
  function BotTaskRow({item, selected, onOpen}) {
    const R = window.RSP;
    const status = B.statusOf(item);
    const sub = item.status === 'scheduled' && item.startAt ? `${new Date(item.startAt).toLocaleDateString('zh-CN', {month: 'numeric', day: 'numeric', weekday: 'short'})} 开始`
      : B.nextLine(item) || (item.dueOn ? `${item.dueOn.slice(5).replace('-', '/')} 截止` : null);
    const actions = B.quickActions(item);
    return <li className={cx('bot-row', selected && 'is-selected')}>
      <button type="button" className="bot-row__main" aria-current={selected || undefined} onClick={onOpen}
        aria-label={sub ? `${item.title}，${status.label}，${sub}` : `${item.title}，${status.label}`}>
        <window.BotStatusIcon statusKey={status.key} chip />
        <span className="bot-row__text">
          <span className={cx('bot-row__title', status.strike && 'is-struck')}>{item.title}</span>
          {sub ? <span className="bot-row__sub">{sub}</span> : null}
        </span>
      </button>
      {actions.length ? <span className="bot-row__end">
        <R.ActionMenu aria-label="更多操作" isQuiet size="S" onAction={key => window.BOT_ACTIONS.act(item.id, String(key))}>
          {actions.map(a => <R.MenuItem key={a} id={a} textValue={B.QUICK_LABEL[a]}><R.Text>{B.QUICK_LABEL[a]}</R.Text></R.MenuItem>)}
        </R.ActionMenu>
      </span> : null}
    </li>;
  }

  function BotSection({title, count, children}) {
    return <section className="bot-section" aria-label={count ? `${title}，${count} 个` : title}>
      <h3 className="bot-section__title">{title}{count ? <span className="bot-section__count">{count}</span> : null}</h3>
      <ul className="bot-list">{children}</ul>
    </section>;
  }

  /** 新任务「谁来做」（BOT-TK-02、需求 §4.4）：默认我来做、进接下来；交给智能体时默认也先排着，选「并现在开始」才直接开始。 */
  const ADD_OWNERS = [
    {id: 'user', label: '我来做', owner: 'user', start: false},
    {id: 'agent', label: '交给智能体', owner: 'agent', start: false},
    {id: 'agentNow', label: '交给智能体并现在开始', owner: 'agent', start: true},
  ];

  /**
   * 面板头下面的新任务输入行：回车添加，Esc 收起。添加后切到新任务所在的页签，输入行与「谁来做」留着可以接着加。
   */
  function BotAddTask({channelId, onAdded, onClose}) {
    const R = window.RSP;
    const [title, setTitle] = useState('');
    const [ownerId, setOwnerId] = useState(B.NEW_TASK_DEFAULTS.owner);
    const pick = ADD_OWNERS.find(o => o.id === ownerId);
    const submit = e => {
      e.preventDefault();
      if (!title.trim()) return;
      const task = window.BOT_ACTIONS.addTask({channelId, title, owner: pick.owner, start: pick.start});
      setTitle('');
      onAdded(task);
    };
    return <form className="bot-add" onSubmit={submit} aria-label="新任务">
      <R.TextField aria-label="任务标题" placeholder="添加一个任务…" value={title} onChange={setTitle} autoFocus UNSAFE_className="bot-add__field"
        onKeyDown={e => { if (e.key === 'Escape') onClose(); else e.continuePropagation(); }} />
      <div className="bot-add__bar">
        <R.MenuTrigger>
          <R.ActionButton isQuiet size="S" aria-label={`谁来做：${pick.label}`}>
            {pick.owner === 'user' ? <R.Icons.User /> : <Ic n="agent" className="ic--14" />}<R.Text>{pick.label}</R.Text><R.Icons.ChevronDown />
          </R.ActionButton>
          <R.Menu aria-label="谁来做" selectionMode="single" selectedKeys={[ownerId]} onSelectionChange={keys => setOwnerId([...keys][0] || ownerId)}>
            {ADD_OWNERS.map(o => <R.MenuItem key={o.id} id={o.id} textValue={o.label}><R.Text>{o.label}</R.Text></R.MenuItem>)}
          </R.Menu>
        </R.MenuTrigger>
        <span className="bot-grow" />
        <R.Button size="S" variant="secondary" fillStyle="outline" onPress={onClose}>取消</R.Button>
        <R.Button size="S" variant="accent" type="submit" isDisabled={!title.trim()}>添加</R.Button>
      </div>
    </form>;
  }

  const FILTER_LABEL = {all: '全部', mine: '我的', agent: '智能体的'};
  const TAB_EMPTY = {active: '没有进行中的任务。', upNext: '接下来没有排着的任务。', scheduled: '没有定时的任务。', resolved: '最近 30 天没有解决的任务。'};

  /**
   * 频道右侧的任务面板（BOT-TK-01…05、BOT-SG-05…07、需求 §11.5）。`onHide` 收起右栏（频道头的「任务」开关同一件事）。
   */
  function BotTaskPanel({channelId, selectedId, onHide}) {
    const app = useApp();
    const R = window.RSP;
    const bot = window.useBot();
    const [filter, setFilter] = useState('all');
    const [tab, setTab] = useState('active');
    const [allDone, setAllDone] = useState(false);
    const [adding, setAdding] = useState(false);
    const items = bot.items.filter(i => i.channelId === channelId);
    const sections = B.taskSections(items, filter, Date.now(), allDone);
    const counts = B.tabCounts(sections);
    const open = id => app.go({r: 'bot', id: channelId, task: id});
    const rows = list => list.map(i => <BotTaskRow key={i.id} item={i} selected={i.id === selectedId} onOpen={() => open(i.id)} />);
    const added = task => setTab(B.tabOf(task) || tab);
    const body = k => {
      if (k === 'active') return sections.active.map(g => <BotSection key={g.state} title={B.STATUS[g.state].label} count={g.items.length}>{rows(g.items)}</BotSection>);
      if (k === 'resolved') return sections.done.length || sections.moreDone ? <ul className="bot-list">
        {rows(sections.done)}
        {sections.moreDone && !allDone ? <li><R.ActionButton isQuiet size="S" onPress={() => setAllDone(true)}>{`再显示 ${sections.moreDone} 条`}</R.ActionButton></li> : null}
      </ul> : null;
      return sections[k].length ? <ul className="bot-list">{rows(sections[k])}</ul> : null;
    };
    const empty = k => (k === 'active' && !items.length ? '你在频道里提到的活会出现在这里。' : TAB_EMPTY[k]);
    return <section className="bot-panel" aria-label="任务">
      <div className="bot-panel__head">
        <h2 className="bot-panel__title">任务</h2>
        <R.MenuTrigger>
          <R.ActionButton isQuiet size="S" aria-label={`显示哪些任务：${FILTER_LABEL[filter]}`}>
            <R.Icons.Filter />{filter === 'all' ? null : <R.Text>{FILTER_LABEL[filter]}</R.Text>}
          </R.ActionButton>
          <R.Menu aria-label="显示哪些任务" selectionMode="single" selectedKeys={[filter]} onSelectionChange={keys => setFilter([...keys][0] || filter)}>
            {Object.keys(FILTER_LABEL).map(k => <R.MenuItem key={k} id={k} textValue={FILTER_LABEL[k]}><R.Text>{FILTER_LABEL[k]}</R.Text></R.MenuItem>)}
          </R.Menu>
        </R.MenuTrigger>
        <R.ActionButton isQuiet size="S" aria-label="给点建议" onPress={() => app.toast('现在没有新的建议')}><R.Icons.MagicWand /></R.ActionButton>
        <R.ActionButton isQuiet size="S" aria-label="新任务" aria-expanded={adding} onPress={() => setAdding(!adding)}><R.Icons.Add /></R.ActionButton>
        {onHide ? <R.ActionButton isQuiet size="S" aria-label="收起任务" onPress={onHide}><R.Icons.Close /></R.ActionButton> : null}
      </div>
      {adding ? <BotAddTask channelId={channelId} onAdded={added} onClose={() => setAdding(false)} /> : null}
      {sections.suggested.length ? <div className="bot-panel__suggested"><BotSection title="建议">{sections.suggested.map(i => <li key={i.id} className="bot-suggestion">
        <button type="button" className="bot-row__main" onClick={() => open(i.id)}>
          <window.BotStatusIcon statusKey="suggested" chip />
          <span className="bot-row__text"><span className="bot-row__title">{i.title}</span>
            {i.suggestion && i.suggestion.reason ? <span className="bot-row__sub">{i.suggestion.reason}</span> : null}</span>
        </button>
        <div className="bot-suggestion__actions">
          <R.Button size="S" variant="accent" onPress={() => window.BOT_ACTIONS.accept(i.id, true)}>现在做</R.Button>
          <R.Button size="S" variant="secondary" onPress={() => window.BOT_ACTIONS.accept(i.id, false)}>加入</R.Button>
          <R.Button size="S" variant="secondary" fillStyle="outline" onPress={() => window.BOT_ACTIONS.act(i.id, 'dismiss')}>忽略</R.Button>
        </div>
      </li>)}</BotSection></div> : null}
      <R.Tabs aria-label="任务" density="compact" selectedKey={tab} onSelectionChange={k => setTab(String(k))} UNSAFE_className="bot-tabs">
        <R.TabList aria-label="任务">{B.TASK_TABS.map(k => <R.Tab key={k} id={k}>{counts[k] ? `${B.TAB_LABEL[k]} ${counts[k]}` : B.TAB_LABEL[k]}</R.Tab>)}</R.TabList>
        {B.TASK_TABS.map(k => <R.TabPanel key={k} id={k} UNSAFE_className="bot-tabs__panel">
          <div className="bot-panel__scroll bc-scroll">
            {body(k) || <p className="bot-empty">{empty(k)}</p>}
          </div>
        </R.TabPanel>)}
      </R.Tabs>
    </section>;
  }

  const MENU_LABEL = {...B.QUICK_LABEL, edit: '编辑任务…', redirect: '改变方向…', revertAll: '撤销这个任务的改动…', deleteRecord: '删除记录…'};

  function BotBlock({label, children}) {
    return <section className="bot-detail__block" aria-label={label}><h3 className="bot-detail__block-title">{label}</h3>{children}</section>;
  }

  /**
   * 任务详情（BOT-TK-06、需求 §11.6）：右侧窄栏或占满主区（wide）。改方向、撤销与删除记录的对话框原型里不画。
   * 头部一行：返回（`onBack`，回到任务列表或频道）、状态、标题与一行「状态 · 下一步 · N 条进展」、展开、⋯，
   * 有 `onHide` 时最后是关闭（收起右栏）。收件箱里只有关闭。
   */
  function BotTaskDetail({id, wide, onToggleWide, onBack, onHide}) {
    const app = useApp();
    const R = window.RSP;
    const bot = window.useBot();
    const item = bot.items.find(i => i.id === id);
    if (!item) return <div className="bot-missing"><span>这个任务已经不在了。</span></div>;
    const status = B.statusOf(item);
    const actions = ['edit', ...B.quickActions(item), ...(item.owner === 'agent' && item.status === 'active' ? ['redirect'] : []), 'revertAll', 'deleteRecord'];
    const line = B.nextLine(item);
    const subline = [status.label, line, item.updates.length ? `${item.updates.length} 条进展` : null].filter(Boolean).join(' · ');
    const run = key => (B.QUICK_LABEL[key] ? window.BOT_ACTIONS.act(item.id, key) : app.toast(`原型里没有画「${MENU_LABEL[key].replace('…', '')}」对话框`));
    const q = item.question;
    const thread = item.thread || [];
    const placeholder = item.status === 'resolved' ? '重新打开前，这里的话会让它再做一遍' : q ? '回答它的问题，或者说说别的' : '给这个任务补充点什么';
    return <section className={cx('bot-detail', wide && 'bot-detail--wide')} aria-label="任务">
      <div className="bot-detail__meta bc-scroll">
        <div className="bot-detail__head">
          {onBack ? <R.ActionButton isQuiet size="S" aria-label={onHide ? '回到任务列表' : '回到频道'} onPress={onBack}><R.Icons.ChevronLeft /></R.ActionButton> : null}
          <window.BotStatusIcon statusKey={status.key} chip />
          <div className="bot-detail__heading">
            <h2 className={cx('bot-detail__title', status.strike && 'is-struck')} title={item.title}>{item.title}</h2>
            <span className="bot-detail__subline" title={subline}>{subline}</span>
          </div>
          {onToggleWide ? <R.ActionButton isQuiet size="S" aria-label={wide ? '收回侧栏' : '展开'} onPress={onToggleWide}>{wide ? <R.Icons.FullScreenExit /> : <R.Icons.FullScreen />}</R.ActionButton> : null}
          <R.ActionMenu aria-label="更多操作" isQuiet size="S" onAction={key => run(String(key))}>
            {actions.map(a => <R.MenuItem key={a} id={a} textValue={MENU_LABEL[a]}><R.Text>{MENU_LABEL[a]}</R.Text></R.MenuItem>)}
          </R.ActionMenu>
          {onHide ? <R.ActionButton isQuiet size="S" aria-label="收起任务" onPress={onHide}><R.Icons.Close /></R.ActionButton> : null}
        </div>
        <div className="bot-detail__facts">
          <span>{`优先级：${{high: '高', medium: '中', low: '低'}[item.priority || 'medium']}`}</span>
          {item.dueOn ? <span>{`截止：${item.dueOn}`}</span> : null}
          <span>{item.owner === 'user' ? '我' : '智能体'}</span>
        </div>
        {item.description ? <p className="bot-detail__text">{item.description}</p> : null}
        {item.owner === 'user' ? <p className="bot-detail__note">这件事由你来做，智能体只负责提醒。</p> : null}
        {q ? <section className="bot-detail__waiting" aria-label="等你">
          <h3 className="bot-detail__block-title">等你</h3>
          <p className="bot-detail__text">{q.text}</p>
          <div className="bot-detail__options">{q.options.map((o, n) => <R.Button key={o.label} size="S" variant={q.pick === n ? 'accent' : 'secondary'}
            onPress={() => window.BOT_ACTIONS.reply(item.id, o.label)}>{o.label}</R.Button>)}</div>
          {q.options.some(o => o.description) ? <ul className="bot-detail__items">{q.options.filter(o => o.description).map(o => <li key={o.label} className="bot-detail__note">{`${o.label}：${o.description}`}</li>)}</ul> : null}
        </section> : null}
        {item.steps.length ? <BotBlock label="步骤"><ol className="bot-detail__items">{item.steps.map((s, n) => <li key={n} className={cx(s.state === 'active' && 'is-active')}>{s.text}</li>)}</ol></BotBlock> : null}
        {item.finishedSteps.length ? <BotBlock label="已完成的步骤"><ul className="bot-detail__items">{item.finishedSteps.map((s, n) => <li key={n}>{s.result ? `${s.text} — ${s.result}` : s.text}</li>)}</ul></BotBlock> : null}
        {item.outputs.length ? <BotBlock label="产物"><ul className="bot-detail__items">{item.outputs.map((o, n) => <li key={n} className="bot-detail__output"><R.Icons.FileText /><span>{o.label}</span></li>)}</ul></BotBlock> : null}
        {item.updates.length ? <BotBlock label="进展"><ul className="bot-detail__items">{[...item.updates].reverse().map((u, n) => <li key={n} className="bot-detail__update">
          <span>{u.text}</span><span className="bot-detail__muted">{`${u.by === 'agent' ? '智能体' : '你'} · ${window.BC_AGENT.agoLabel((Date.now() - u.at) / 60000)}`}</span>
        </li>)}</ul></BotBlock> : null}
      </div>
      <div className="bot-detail__thread">
        {item.owner === 'agent' ? <>
          <div className="bot-timeline bc-scroll"><div className="bot-timeline__list">
            {thread.length ? thread.map((m, n) => <window.BotMessage key={n} m={m} />) : <p className="bot-empty bot-empty--center">对话</p>}
          </div></div>
          <window.BotComposer placeholder={placeholder} onSend={t => window.BOT_ACTIONS.reply(item.id, t)}
            above={<window.BotChips chips={thread.length && thread[thread.length - 1].role === 'assistant' ? thread[thread.length - 1].chips : null}
              onPick={t => window.BOT_ACTIONS.reply(item.id, t)} />} />
        </> : <p className="bot-empty bot-empty--center">这件事由你来做，智能体只负责提醒。</p>}
      </div>
    </section>;
  }

  Object.assign(window, {BotTaskPanel, BotTaskRow, BotTaskDetail});
})();
