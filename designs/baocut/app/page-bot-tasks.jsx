/* Bot 页的任务面板与任务详情（docs/design/bot-mode/bot-mode-requirements.md §11.5–§11.6、§4.4）—— 只在 App 入口加载。
   面板：顶上筛选（全部、我的、智能体的）、新建任务与「给点建议」；建议另放一块，下面依次是等你、工作中、接下来（含定时）、已完成。
   详情：头部一行（关闭、状态、展开、编辑、⋯），标题、事实、问题、步骤、产物、进展，下面是任务线程。 */
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
        <window.BotStatusIcon statusKey={status.key} />
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

  function BotSection({title, children}) {
    return <section className="bot-section" aria-label={title}>
      <h3 className="bot-section__title">{title}</h3>
      <ul className="bot-list">{children}</ul>
    </section>;
  }

  /**
   * 新建任务（BOT-TK-02、需求 §4.4）：标题、谁来做。默认「我来做」、进「接下来」；改成交给智能体时可以勾「现在开始」，默认不勾。
   */
  function BotNewTaskDialog({channelId, onClose, onCreated}) {
    const R = window.RSP;
    const [title, setTitle] = useState('');
    const [owner, setOwner] = useState(B.NEW_TASK_DEFAULTS.owner);
    const [start, setStart] = useState(B.NEW_TASK_DEFAULTS.start);
    const valid = !!title.trim();
    const submit = () => {
      if (!valid) return;
      const id = window.BOT_ACTIONS.addTask({channelId, title, owner, start: owner === 'agent' && start});
      onClose();
      onCreated(id);
    };
    return <R.DialogContainer onDismiss={onClose}>
      <R.Dialog size="S">{({close}) => <>
        <R.Heading slot="title">新任务</R.Heading>
        <R.Content><R.Form onSubmit={e => { e.preventDefault(); submit(); }}>
          <R.TextField label="标题" value={title} onChange={setTitle} autoFocus isRequired />
          <R.RadioGroup label="谁来做" value={owner} onChange={setOwner}>
            <R.Radio value="user">我来做</R.Radio>
            <R.Radio value="agent">交给智能体</R.Radio>
          </R.RadioGroup>
          {owner === 'agent' ? <R.Switch isSelected={start} onChange={setStart}>现在开始</R.Switch> : null}
        </R.Form></R.Content>
        <R.ButtonGroup>
          <R.Button variant="secondary" onPress={close}>取消</R.Button>
          <R.Button variant="accent" isDisabled={!valid} onPress={submit}>添加</R.Button>
        </R.ButtonGroup>
      </>}</R.Dialog>
    </R.DialogContainer>;
  }

  /**
   * 频道右侧的任务面板（BOT-TK-01…05、BOT-SG-05…07、需求 §11.5）。
   */
  function BotTaskPanel({channelId, selectedId}) {
    const app = useApp();
    const R = window.RSP;
    const bot = window.useBot();
    const [filter, setFilter] = useState('all');
    const [allDone, setAllDone] = useState(false);
    const [creating, setCreating] = useState(false);
    const items = bot.items.filter(i => i.channelId === channelId);
    const sections = B.taskSections(items, filter, Date.now(), allDone);
    const open = id => app.go({r: 'bot', id: channelId, task: id});
    const rows = list => list.map(i => <BotTaskRow key={i.id} item={i} selected={i.id === selectedId} onOpen={() => open(i.id)} />);
    const nothing = !sections.suggested.length && !sections.needsYou.length && !sections.working.length && !sections.upNext.length && !sections.done.length;
    return <section className="bot-panel" aria-label="任务">
      <div className="bot-panel__head">
        <h2 className="bot-panel__title">任务</h2>
        <R.ActionButton isQuiet size="S" aria-label="给点建议" onPress={() => app.toast('现在没有新的建议')}><R.Icons.MagicWand /></R.ActionButton>
        <R.ActionButton isQuiet size="S" onPress={() => setCreating(true)}><R.Icons.Add /><R.Text>新任务</R.Text></R.ActionButton>
      </div>
      <div className="bot-panel__filter">
        <R.SegmentedControl aria-label="显示哪些任务" selectedKey={filter} onSelectionChange={setFilter}>
          <R.SegmentedControlItem id="all">全部</R.SegmentedControlItem>
          <R.SegmentedControlItem id="mine">我的</R.SegmentedControlItem>
          <R.SegmentedControlItem id="agent">智能体的</R.SegmentedControlItem>
        </R.SegmentedControl>
      </div>
      <div className="bot-panel__scroll bc-scroll">
        {nothing ? <p className="bot-empty">你在频道里提到的活会出现在这里。</p> : <>
          {sections.suggested.length ? <BotSection title="建议">{sections.suggested.map(i => <li key={i.id} className="bot-suggestion">
            <button type="button" className="bot-row__main" onClick={() => open(i.id)}>
              <window.BotStatusIcon statusKey="suggested" />
              <span className="bot-row__text"><span className="bot-row__title">{i.title}</span>
                {i.suggestion && i.suggestion.reason ? <span className="bot-row__sub">{i.suggestion.reason}</span> : null}</span>
            </button>
            <div className="bot-suggestion__actions">
              <R.Button size="S" variant="accent" onPress={() => window.BOT_ACTIONS.accept(i.id, true)}>现在做</R.Button>
              <R.Button size="S" variant="secondary" onPress={() => window.BOT_ACTIONS.accept(i.id, false)}>加入</R.Button>
              <R.Button size="S" variant="secondary" fillStyle="outline" onPress={() => window.BOT_ACTIONS.act(i.id, 'dismiss')}>忽略</R.Button>
            </div>
          </li>)}</BotSection> : null}
          {sections.needsYou.length ? <BotSection title="等你">{rows(sections.needsYou)}</BotSection> : null}
          {sections.working.length ? <BotSection title="工作中">{rows(sections.working)}</BotSection> : null}
          {sections.upNext.length ? <BotSection title="接下来">{rows(sections.upNext)}</BotSection> : null}
          {sections.done.length || sections.moreDone ? <BotSection title="已完成">
            {rows(sections.done)}
            {sections.moreDone && !allDone ? <li><R.ActionButton isQuiet size="S" onPress={() => setAllDone(true)}>{`再显示 ${sections.moreDone} 条`}</R.ActionButton></li> : null}
          </BotSection> : null}
        </>}
      </div>
      {creating ? <BotNewTaskDialog channelId={channelId} onClose={() => setCreating(false)} onCreated={open} /> : null}
    </section>;
  }

  const MENU_LABEL = {...B.QUICK_LABEL, redirect: '改变方向…', revertAll: '撤销这个任务的改动…', deleteRecord: '删除记录…'};

  function BotBlock({label, children}) {
    return <section className="bot-detail__block" aria-label={label}><h3 className="bot-detail__block-title">{label}</h3>{children}</section>;
  }

  /**
   * 任务详情（BOT-TK-06、需求 §11.6）：右侧窄栏或占满主区（wide）。改方向、撤销与删除记录的对话框原型里不画。
   */
  function BotTaskDetail({id, wide, onToggleWide, onClose}) {
    const app = useApp();
    const R = window.RSP;
    const bot = window.useBot();
    const item = bot.items.find(i => i.id === id);
    if (!item) return <div className="bot-missing"><span>这个任务已经不在了。</span></div>;
    const status = B.statusOf(item);
    const actions = [...B.quickActions(item), ...(item.owner === 'agent' && item.status === 'active' ? ['redirect'] : []), 'revertAll', 'deleteRecord'];
    const run = key => (B.QUICK_LABEL[key] ? window.BOT_ACTIONS.act(item.id, key) : app.toast(`原型里没有画「${MENU_LABEL[key].replace('…', '')}」对话框`));
    const q = item.question;
    const thread = item.thread || [];
    const placeholder = item.status === 'resolved' ? '重新打开前，这里的话会让它再做一遍' : q ? '回答它的问题，或者说说别的' : '给这个任务补充点什么';
    return <section className={cx('bot-detail', wide && 'bot-detail--wide')} aria-label="任务">
      <div className="bot-detail__meta bc-scroll">
        <div className="bot-detail__head">
          <R.ActionButton isQuiet size="S" aria-label="回到频道" onPress={onClose}>{wide ? <R.Icons.ChevronLeft /> : <R.Icons.Close />}</R.ActionButton>
          <window.BotStatusLabel statusKey={status.key} />
          <span className="bot-grow" />
          {onToggleWide ? <R.ActionButton isQuiet size="S" aria-label={wide ? '收回侧栏' : '展开'} onPress={onToggleWide}>{wide ? <R.Icons.FullScreenExit /> : <R.Icons.FullScreen />}</R.ActionButton> : null}
          <R.ActionButton isQuiet size="S" aria-label="编辑任务" onPress={() => app.toast('原型里没有画编辑任务对话框')}><R.Icons.Edit /></R.ActionButton>
          <R.ActionMenu aria-label="更多操作" isQuiet size="S" onAction={key => run(String(key))}>
            {actions.map(a => <R.MenuItem key={a} id={a} textValue={MENU_LABEL[a]}><R.Text>{MENU_LABEL[a]}</R.Text></R.MenuItem>)}
          </R.ActionMenu>
        </div>
        <h2 className={cx('bot-detail__title', status.strike && 'is-struck')}>{item.title}</h2>
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
