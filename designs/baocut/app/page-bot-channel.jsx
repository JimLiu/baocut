/* Bot 页的频道对话（docs/design/bot-mode/bot-mode-requirements.md §11.3–§11.4）—— 只在 App 入口加载。
   头部是频道名与用途；时间线里是普通消息，加上 Bot 条目：线程卡（一条任务的占位）、运行记录行（报告、简报、转交……）；
   输入框上方是最后一条智能体消息带的提示芯片。任务线程（page-bot-tasks.jsx）用同一套消息与输入框。 */
(function () {
  const {useState} = React;
  const B = window.BC_BOT;

  /** 一条消息：你说的是右侧气泡，智能体的回复带头像（同 Home 会话的线程）。 */
  function BotMessage({m}) {
    if (m.role === 'user') return <div className="amsg amsg--user bot-msg"><window.RSP.AI.UserMessage>
      <div className="bc-ai-message-text">{m.text}</div>
    </window.RSP.AI.UserMessage></div>;
    return <div className="amsg amsg--ai bot-msg">
      <span className="amsg__av"><Ic n="agent" className="ic--14" /></span>
      <div className="amsg__body"><p>{m.text}</p></div>
    </div>;
  }

  /**
   * 线程卡（BOT-CV-03、需求 §11.4）：频道对话里一条任务的占位，标题、状态与「下一步」实时读任务。
   * 「打开」在右侧打开任务详情；进行中的智能体任务可以「停止」。读屏读出「任务名，状态，下一步」（需求 §11.10）。
   */
  function BotRefCard({workItemId, channelId, onReply}) {
    const app = useApp();
    const R = window.RSP;
    const item = window.useBot().items.find(i => i.id === workItemId);
    const open = () => app.go({r: 'bot', id: channelId, task: workItemId});
    if (!item) return <div className="bot-card" role="group" aria-label="任务详情还没载入"><span className="bot-card__next">任务详情还没载入</span></div>;
    const status = B.statusOf(item);
    const line = B.nextLine(item);
    const stoppable = item.owner === 'agent' && item.status === 'active' && status.key !== 'blocked';
    return <div className="bot-card" role="group" aria-label={line ? `${item.title}，${status.label}，${line}` : `${item.title}，${status.label}`}>
      <window.BotStatusIcon statusKey={status.key} />
      <div className="bot-card__body">
        <div className="bot-card__title-row">
          <span className={cx('bot-card__title', status.strike && 'is-struck')}>{item.title}</span>
          <window.BotStatusLabel statusKey={status.key} />
        </div>
        {line ? <span className="bot-card__next">{line}</span> : null}
      </div>
      <div className="bot-card__actions">
        {stoppable ? <R.ActionButton isQuiet size="S" onPress={() => window.BOT_ACTIONS.act(item.id, 'stop')}><R.Icons.StopProcessing /><R.Text>停止</R.Text></R.ActionButton> : null}
        {onReply ? <R.ActionButton isQuiet size="S" onPress={onReply}><R.Icons.Comment /><R.Text>回复</R.Text></R.ActionButton> : null}
        <R.ActionButton isQuiet size="S" onPress={open}><R.Icons.OpenIn /><R.Text>打开</R.Text></R.ActionButton>
      </div>
    </div>;
  }

  /**
   * 运行记录行（技术方案 §4.3，需求 §11.4）：Runtime 搬进会话的报告、简报、转交、刷新、定时与提醒。
   * 挂在任务上时，上面一行是任务头：一根弯线、任务的状态图标与标题，点标题打开任务。
   * 下面默认收成一行灰字，点开看全文与原文引用。不是用户打的字，不画成用户消息。
   */
  function BotRelayRow({item, channelId}) {
    const app = useApp();
    const R = window.RSP;
    const [open, setOpen] = useState(false);
    const bot = window.useBot();
    const task = item.workItemId ? bot.items.find(i => i.id === item.workItemId) : null;
    const taskStatus = task ? B.statusOf(task) : null;
    const openTask = () => app.go({r: 'bot', id: channelId, task: item.workItemId});
    const label = B.RELAY[item.direction];
    const line = (item.text.split('\n').find(l => l.trim()) || '').trim();
    return <div className="bot-relay">
      {task ? <div className="bot-relay__task">
        <span className="bot-relay__curve" aria-hidden="true" />
        <window.BotStatusIcon statusKey={taskStatus.key} chip />
        <button type="button" className={cx('bot-relay__task-title', taskStatus.strike && 'is-struck')} onClick={openTask}
          aria-label={`打开任务：${task.title}，${taskStatus.label}`}>{task.title}</button>
      </div> : null}
      <div className="bot-relay__head">
        <R.ActionButton isQuiet size="S" aria-expanded={open} aria-label={open ? '收起详情' : '展开详情'} onPress={() => setOpen(!open)}>
          {open ? <R.Icons.ChevronDown /> : <R.Icons.ChevronRight />}
        </R.ActionButton>
        <span className="bot-relay__summary">{line ? `${label} · ${line}` : label}</span>
        {item.workItemId && !task ? <R.ActionButton isQuiet size="S" onPress={openTask}>
          <R.Icons.OpenIn /><R.Text>打开任务</R.Text>
        </R.ActionButton> : null}
      </div>
      {open ? <div className="bot-relay__details">
        {item.text ? <p className="bot-relay__text">{item.text}</p> : null}
        {item.cited.length ? <div className="bot-relay__cited" role="group" aria-label="引用的消息">
          <span className="bot-relay__cited-head">引用的消息</span>
          {item.cited.map((c, i) => <span key={i}><b>{c.author === 'user' ? '你' : 'Bot'}</b>{`：${c.text}`}</span>)}
        </div> : null}
      </div> : null}
    </div>;
  }

  /** 提示芯片（BOT-SG-01/02）：S2 小按钮，推荐的那个用强调色；按下就当作你说了这句。 */
  function BotChips({chips, onPick, disabled}) {
    if (!chips || !chips.length) return null;
    return <div className="bot-chips" role="group" aria-label="建议的回复">
      {chips.map(c => <window.RSP.Button key={c.label} size="S" variant={c.recommended ? 'accent' : 'secondary'} fillStyle="outline"
        isDisabled={disabled} onPress={() => onPick(c.label)}>{c.label}</window.RSP.Button>)}
    </div>;
  }

  /** 输入框：同 Home 会话的 PromptField；`above` 放回复目标与提示芯片。 */
  function BotComposer({placeholder, onSend, above, disabled}) {
    const [draft, setDraft] = useState('');
    const send = () => { const t = draft.trim(); if (!t) return; onSend(t); setDraft(''); };
    return <div className="bot-composer">
      {above}
      <PromptField inputProps={{value: draft, placeholder, 'aria-label': placeholder, disabled, onChange: e => setDraft(e.target.value)}}
        onSubmit={send} canSubmit={!!draft.trim()} />
    </div>;
  }

  /** 时间线：消息、线程卡、运行记录行按顺序排下来。 */
  function BotTimeline({entries, channelId, onReply, empty}) {
    if (!entries.length) return <div className="bot-timeline bc-scroll"><p className="bot-empty bot-empty--center">{empty}</p></div>;
    return <div className="bot-timeline bc-scroll"><div className="bot-timeline__list">
      {entries.map((t, i) => t.kind === 'message' ? <BotMessage key={i} m={t} />
        : t.kind === 'work-item-ref' ? <BotRefCard key={i} workItemId={t.workItemId} channelId={channelId} onReply={onReply ? () => onReply(t.workItemId) : null} />
        : t.kind === 'relay' ? <BotRelayRow key={i} item={t} channelId={channelId} /> : null)}
    </div></div>;
  }

  /**
   * 频道对话（BOT-CV-01…05、需求 §11.3）：头部是频道名与用途、记忆、周期任务、频道设置，最后是右栏的「任务」开关，
   * 带这个频道里等你的任务数（需求 §11.1）。回复一张线程卡（BOT-EX-09）时输入框上方显示「回复「任务名」✕」。
   */
  function BotChannelView({channel, tasksToggle}) {
    const app = useApp();
    const R = window.RSP;
    const bot = window.useBot();
    const entries = bot.timelines[channel.id] || [];
    const [replyTo, setReplyTo] = useState(null);
    const replyItem = replyTo ? bot.items.find(i => i.id === replyTo) : null;
    const waiting = bot.items.filter(i => i.channelId === channel.id && B.needsUser(i)).length;
    const later = what => app.toast(`原型里没有画${what}`);
    const send = text => {
      if (replyTo) { window.BOT_ACTIONS.reply(replyTo, text); setReplyTo(null); app.toast('已转给这条任务'); return; }
      window.BOT_ACTIONS.send(channel.id, text);
    };
    return <section className="bot-channel" aria-label={channel.name}>
      <header className="bot-channel__head">
        <div className="bot-channel__text">
          <h2 className="bot-channel__name">{channel.name}</h2>
          <span className={cx('bot-channel__purpose', !channel.purpose && 'is-empty')} title={channel.purpose || undefined}>
            {channel.purpose || '没有设定用途，什么都能做'}
          </span>
        </div>
        <R.ActionButton isQuiet size="S" onPress={() => later('频道记忆页')}><R.Icons.Bookmark /><R.Text>记忆</R.Text></R.ActionButton>
        <R.ActionButton isQuiet size="S" aria-label="新建周期任务" onPress={() => later('周期任务对话框')}><R.Icons.CalendarAdd /></R.ActionButton>
        <R.ActionButton isQuiet size="S" aria-label="频道设置…" onPress={() => later('频道设置')}><R.Icons.Settings /></R.ActionButton>
        {tasksToggle ? <R.ActionButton isQuiet size="S" aria-expanded={tasksToggle.shown} UNSAFE_className={cx('bot-toggle', tasksToggle.shown && 'is-on')}
          aria-label={waiting ? `任务，${waiting} 个等你` : '任务'} onPress={tasksToggle.onToggle}>
          <R.Icons.ViewList /><R.Text>任务</R.Text>{waiting ? <R.NotificationBadge size="S" value={waiting} /> : null}
        </R.ActionButton> : null}
      </header>
      <BotTimeline entries={entries} channelId={channel.id} onReply={setReplyTo}
        empty="说说你要做什么。费时的活会在后台做，并作为任务出现在右边。" />
      <BotComposer placeholder="说说你要做什么" onSend={send} above={<>
        {replyTo ? <div className="bot-reply" role="status">
          <span className="bot-reply__text">{replyItem ? `回复「${replyItem.title}」` : '回复了一张任务卡'}</span>
          <R.ActionButton isQuiet size="XS" aria-label="不回复这条任务" onPress={() => setReplyTo(null)}><R.Icons.Close /></R.ActionButton>
        </div> : null}
        <BotChips chips={B.openChips(entries)} onPick={send} />
      </>} />
    </section>;
  }

  Object.assign(window, {BotChannelView, BotMessage, BotChips, BotComposer});
})();
