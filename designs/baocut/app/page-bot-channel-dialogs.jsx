/* Bot 频道设置与新建周期任务（docs/design/bot-mode/bot-mode-requirements.md §2.3、§11.3 的修订稿）—— 只在 App 入口加载。
   两个对话框都从频道菜单打开，由 page-bot-dialogs.jsx 的 BotDialogs 挂出来。
   频道设置照实现的 channel-dialog 排，但名称和用途不在这里：改名与说明各有自己的菜单项。
   周期任务照会话的「定时运行」排（agent-schedule.jsx），目标固定是这个频道：到点在这里建一条任务。 */
(function () {
  const {useState} = React;
  const B = window.BC_BOT;
  const SC = window.BC_AGENT_SCHEDULE;

  /**
   * 频道设置（BOT-CH-03）：Agent 与模型、默认与最高访问模式、产物语言、静音、私密、同时工作的任务数、停下阈值、预算；
   * 下面是导出、归档、删除（主频道只有导出）。
   */
  function BotSettingsDialog({channel, onClose}) {
    const app = useApp();
    const R = window.RSP;
    const D = window.BC_DATA;
    const main = channel.kind === 'main';
    const [d, setD] = useState(() => ({...B.channelSettings(channel), muted: !!channel.muted}));
    const set = (key, value) => setD(x => ({...x, [key]: value}));
    const harness = D.agent.harnesses.find(h => h.id === d.driverId);
    const save = close => {
      const {muted, ...settings} = d;
      window.BOT_ACTIONS.updateChannel(channel.id, {muted, settings});
      close();
      app.toast('已保存频道设置');
    };
    const manage = kind => window.openBotDialog({kind, channelId: channel.id});
    return <R.DialogContainer onDismiss={onClose}>
      <R.Dialog size="M">
        {({close}) => <>
          <R.Heading slot="title">频道设置</R.Heading>
          <R.Content>
            <p className="bot-dialog__note">{channel.name}</p>
            <form className="bot-settings" onSubmit={e => { e.preventDefault(); save(close); }}>
              <div className="bot-settings__row">
                <R.Picker label="Agent" selectedKey={d.driverId || 'default'}
                  onSelectionChange={k => setD(x => ({...x, driverId: k === 'default' ? null : String(k), model: null}))}>
                  <R.PickerItem id="default">跟随默认</R.PickerItem>
                  {D.agent.harnesses.map(h => <R.PickerItem key={h.id} id={h.id}>{h.name}</R.PickerItem>)}
                </R.Picker>
                <R.Picker label="模型" isDisabled={!harness} selectedKey={d.model || 'default'} onSelectionChange={k => set('model', k === 'default' ? null : String(k))}>
                  <R.PickerItem id="default">Agent 默认模型</R.PickerItem>
                  {(harness ? harness.models : []).map(m => <R.PickerItem key={m.id} id={m.id}>{m.name}</R.PickerItem>)}
                </R.Picker>
              </div>
              <div className="bot-settings__row">
                <R.Picker label="默认访问模式" selectedKey={d.defaultAccessMode || 'default'} onSelectionChange={k => set('defaultAccessMode', k === 'default' ? null : String(k))}>
                  <R.PickerItem id="default">跟随全局默认</R.PickerItem>
                  {D.agent.modes.map(m => <R.PickerItem key={m.k} id={m.k}>{m.label}</R.PickerItem>)}
                </R.Picker>
                <R.Picker label="任务可用的最高访问模式" selectedKey={d.maxAccessMode || 'none'} onSelectionChange={k => set('maxAccessMode', k === 'none' ? null : String(k))}>
                  <R.PickerItem id="none">不限</R.PickerItem>
                  {D.agent.modes.map(m => <R.PickerItem key={m.k} id={m.k}>{m.label}</R.PickerItem>)}
                </R.Picker>
              </div>
              <R.TextField label="产物语言" placeholder="与对话相同" value={d.outputLanguage} maxLength={35} onChange={v => set('outputLanguage', v)} />
              <div className="bot-settings__switch">
                <R.Switch isSelected={d.muted} onChange={v => set('muted', v)}>静音通知</R.Switch>
                <p className="bot-dialog__note">只计入徽标和「等你处理」列表</p>
              </div>
              <div className="bot-settings__switch">
                <R.Switch isSelected={d.private} onChange={v => set('private', v)}>私密</R.Switch>
                <p className="bot-dialog__note">其他频道读不到它的任务和记忆</p>
              </div>
              <div className="bot-settings__row">
                <R.NumberField label="同时工作的任务数" minValue={1} maxValue={B.MAX_CONCURRENT} step={1} value={d.concurrentThreads}
                  onChange={v => Number.isFinite(v) && set('concurrentThreads', v)} />
                <R.NumberField label="多少分钟没有进展就停下任务" description="留空则使用所有频道的设置" minValue={1} maxValue={24 * 60} step={1}
                  value={d.stallMinutes == null ? Number.NaN : d.stallMinutes} onChange={v => set('stallMinutes', Number.isFinite(v) ? v : null)} />
              </div>
              <div className="bot-settings__row bot-settings__row--budget">
                <R.TextField label="每日预算" description="留空表示不设预算" inputMode="decimal" value={d.dailyBudget} onChange={v => set('dailyBudget', v)} />
                <R.TextField label="每月预算" inputMode="decimal" value={d.monthlyBudget} onChange={v => set('monthlyBudget', v)} />
                <R.TextField label="币种" maxLength={3} value={d.currency} onChange={v => set('currency', v)} />
              </div>
              {main ? <p className="bot-dialog__note">这是默认频道，不能归档或删除。</p> : null}
            </form>
            <div className="bot-settings__manage">
              <R.Button variant="secondary" fillStyle="outline" onPress={() => app.toast('原型里不导出：实现里选一个文件夹，导出频道的消息、任务和记忆')}>导出…</R.Button>
              {main ? null : <>
                <R.Button variant="secondary" fillStyle="outline" onPress={() => {
                  if (channel.archived) { window.BOT_ACTIONS.setArchived(channel.id, false); close(); app.toast(`已恢复「${channel.name}」`); } else manage('archive');
                }}>{channel.archived ? '恢复' : '归档'}</R.Button>
                <R.Button variant="negative" fillStyle="outline" onPress={() => manage('delete')}>删除频道…</R.Button>
              </>}
            </div>
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" onPress={() => save(close)}>保存</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  const CADENCES = [{k: 'hourly', label: '每小时'}, {k: 'daily', label: '每天'}, {k: 'weekly', label: '每周'}, {k: 'cron', label: '自定义'}];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

  /**
   * 新建周期任务（BOT-MK-05 的自定义版）：名称、每次做什么、频率（每小时 / 每天 / 每周 / cron）与下一次、发给这个频道、跑满次数就停。
   * 建好是任务面板「定时」里的一条，和 Make 面板的模板「＋」建的一样。
   */
  function BotScheduleDialog({channel, onClose}) {
    const app = useApp();
    const R = window.RSP;
    const [d, setD] = useState({name: '', prompt: '', cadence: {type: 'weekly', days: [1], time: '09:00'}, limit: false, maxRuns: 5});
    const set = patch => setD(x => ({...x, ...patch}));
    const setC = patch => setD(x => ({...x, cadence: {...x.cadence, ...patch}}));
    const pick = type => set({cadence: type === 'hourly' ? {type, minute: 0} : type === 'weekly' ? {type, days: [1], time: d.cadence.time || '09:00'}
      : type === 'cron' ? {type, expr: SC.toCron(d.cadence)} : {type, time: d.cadence.time || '09:00'}});
    const data = {prompt: d.prompt, cadence: d.cadence, maxRuns: d.limit ? d.maxRuns : null};
    const error = SC.validate(data);
    const next = !SC.validate({...data, prompt: 'x'}) ? SC.nextRun(d.cadence, new Date()) : null;
    const save = close => {
      const name = d.name.trim() || d.prompt.trim().slice(0, 24);
      const every = SC.describe(d.cadence);
      const task = window.BOT_ACTIONS.schedule(channel.id, {title: name, every: d.limit ? `${every}，共 ${d.maxRuns} 次` : every, text: d.prompt.trim(),
        next: () => SC.nextRun(d.cadence, new Date()).getTime()});
      close();
      app.toast(`已建立「${name}」· ${every}`, 'positive', {label: '查看', run: () => app.go({r: 'bot', id: channel.id, task: task.id})});
    };
    return <R.DialogContainer onDismiss={onClose}>
      <R.Dialog size="M">
        {({close}) => <>
          <R.Heading slot="title">新建周期任务</R.Heading>
          <R.Content>
            <div className="asch-form">
              <R.TextField label="名称" description="不填就用这段话的开头" value={d.name} onChange={v => set({name: v})} />
              <R.TextArea label="每次做什么" value={d.prompt} onChange={v => set({prompt: v})} isRequired autoFocus
                description="到点时在这个频道建一条任务，交给智能体去做" />
              <div className="asch-field">
                <span className="asch-label">频率</span>
                <R.SegmentedControl aria-label="频率" selectedKey={d.cadence.type} onSelectionChange={k => pick(String(k))}>
                  {CADENCES.map(c => <R.SegmentedControlItem key={c.k} id={c.k}>{c.label}</R.SegmentedControlItem>)}
                </R.SegmentedControl>
                <div className="asch-cadence">
                  {d.cadence.type === 'hourly' ? <R.NumberField label="第几分" minValue={0} maxValue={59} value={d.cadence.minute} onChange={v => setC({minute: v || 0})} /> : null}
                  {d.cadence.type === 'weekly' ? <R.ToggleButtonGroup aria-label="星期几" selectionMode="multiple" size="S"
                    selectedKeys={(d.cadence.days || []).map(String)} onSelectionChange={keys => setC({days: [...keys].map(Number)})}>
                    {WEEK_ORDER.map(n => <R.ToggleButton key={n} id={String(n)}>{`周${SC.WEEKDAYS[n]}`}</R.ToggleButton>)}
                  </R.ToggleButtonGroup> : null}
                  {d.cadence.type === 'daily' || d.cadence.type === 'weekly'
                    ? <R.TextField label="时刻" value={d.cadence.time} onChange={v => setC({time: v})} UNSAFE_className="asch-time" /> : null}
                  {d.cadence.type === 'cron' ? <R.TextField label="cron 表达式" value={d.cadence.expr} onChange={v => setC({expr: v})}
                    description="五段：分 时 日 月 周，按本机时区" UNSAFE_className="asch-cron" /> : null}
                </div>
                <p className="t-detail">{next ? `${SC.describe(d.cadence)} · 下一次：${SC.whenLabel(next, new Date())}` : error && error !== '写一段每次要发的话' ? error : '没有下一次'}</p>
              </div>
              <div className="asch-field">
                <span className="asch-label">发给</span>
                <span className="bot-settings__target">{`每次在频道「${channel.name}」里建一条任务`}</span>
              </div>
              <div className="asch-limit">
                <R.Checkbox isSelected={d.limit} onChange={v => set({limit: v})}>跑满次数就停</R.Checkbox>
                {d.limit ? <R.NumberField aria-label="最多运行次数" minValue={1} value={d.maxRuns} onChange={v => set({maxRuns: v})} UNSAFE_className="asch-max" /> : null}
              </div>
              <p className="asch-note t-detail">BaoCut 开着才会跑；没开着时错过的不补跑。频道归档后暂停，恢复后要你手动继续。</p>
            </div>
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" isDisabled={!!error} onPress={() => save(close)}>建立</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  Object.assign(window, {BotSettingsDialog, BotScheduleDialog});
})();
