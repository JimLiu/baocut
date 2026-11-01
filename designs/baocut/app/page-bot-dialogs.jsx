/* Bot 频道的菜单与对话框（docs/design/bot-mode/bot-mode-requirements.md §2.3、§11.2、§11.3 的修订稿）—— 只在 App 入口加载。
   频道头的「名字 ⌄」与侧栏每行的「⋯」是同一份频道菜单；侧栏综合行的筛选与「＋」、分组行的「⋯」与「＋」也在这里。
   对话框由一个模块级的小 store 开（openBotDialog），Bot 页挂一个 BotDialogs 统一画：侧栏与频道头不各自管弹层。 */
(function () {
  const {useState, useSyncExternalStore} = React;
  const B = window.BC_BOT;

  /* ---------- 对话框 store ---------- */

  let current = null;
  const listeners = new Set();
  const subscribe = l => { listeners.add(l); return () => listeners.delete(l); };
  /** 开一个对话框：{kind, channelId?, groupId?, moveChannelId?}；kind 见 BotDialogs。 */
  const openBotDialog = spec => { current = spec; listeners.forEach(l => l()); };
  const closeBotDialog = () => openBotDialog(null);

  /* ---------- 频道图标 ---------- */

  /** 频道图标：S2 workflow 图标，按频道颜色上色（主频道是 Layers、不着色）。放在侧栏行的 icon 槽里时由 S2 定尺寸。 */
  function BotChannelGlyph({channel}) {
    const look = B.channelLook(channel);
    const Icon = window.RSP.Icons[look.icon];
    return <Icon UNSAFE_className={look.color ? `bot-hue bot-hue--${look.color}` : undefined} />;
  }

  /* ---------- 频道菜单 ---------- */

  const menuItem = (id, Icon, label) => {
    const R = window.RSP;
    return <R.MenuItem key={id} id={id} textValue={label}><Icon /><R.Text>{label}</R.Text></R.MenuItem>;
  };

  /**
   * 频道菜单（需求 §11.2、§11.3 修订）：频道设置、重命名、说明、更换图标、移到分组；记忆、新建周期任务、置顶、静音；归档、删除。
   * 主频道不换图标、不进分组、不置顶、不归档、不删除；归档的频道不新建周期任务。「移到分组」是子菜单：各分组（当前的打勾）、不分组（回到综合）、新建分组。
   */
  function channelMenuItems(channel, groups) {
    const R = window.RSP;
    const I = R.Icons;
    const main = channel.kind === 'main';
    const inGroup = groups.some(g => g.id === channel.groupId) ? channel.groupId : 'none';
    const onMove = keys => {
      const key = [...keys][0];
      if (key === 'new') openBotDialog({kind: 'newGroup', moveChannelId: channel.id});
      else if (key) window.BOT_ACTIONS.updateChannel(channel.id, {groupId: key === 'none' ? null : key});
    };
    return [
      <R.MenuSection key="setup">
        {menuItem('settings', I.Settings, '频道设置…')}
        {menuItem('rename', I.Rename, '重命名…')}
        {menuItem('instructions', I.StickyNote, '说明…')}
        {main ? null : menuItem('icon', I.Color, '更换图标…')}
        {main ? null : <R.SubmenuTrigger>
          {menuItem('move', I.FolderMoveTo, '移到分组')}
          <R.Menu aria-label="移到分组" selectionMode="single" disallowEmptySelection selectedKeys={[inGroup]} onSelectionChange={onMove}>
            {groups.length ? <R.MenuSection key="groups">
              {groups.map(g => <R.MenuItem key={g.id} id={g.id} textValue={g.name}><R.Text>{g.name}</R.Text></R.MenuItem>)}
            </R.MenuSection> : null}
            <R.MenuSection key="other">
              <R.MenuItem id="none" textValue="不分组"><R.Text>不分组</R.Text></R.MenuItem>
              <R.MenuItem id="new" textValue="新建分组…"><R.Text>新建分组…</R.Text></R.MenuItem>
            </R.MenuSection>
          </R.Menu>
        </R.SubmenuTrigger>}
      </R.MenuSection>,
      <R.MenuSection key="keep">
        {menuItem('memory', I.Bookmark, '记忆')}
        {channel.archived ? null : menuItem('schedule', I.CalendarAdd, '新建周期任务…')}
        {main || channel.archived ? null : menuItem('pin', channel.pinned ? I.PinOff : I.PinOn, channel.pinned ? '取消置顶' : '置顶')}
        {menuItem('mute', channel.muted ? I.VolumeTwo : I.VolumeOff, channel.muted ? '取消静音' : '静音')}
      </R.MenuSection>,
      main ? null : <R.MenuSection key="end">
        {menuItem('archive', I.Archive, channel.archived ? '恢复' : '归档…')}
        {menuItem('delete', I.Delete, '删除…')}
      </R.MenuSection>,
    ].filter(Boolean);
  }

  /** 频道菜单的动作。记忆在中间整页打开；归档要确认，恢复直接做；其余开对话框。 */
  function runChannelAction(channel, key, app) {
    const A = window.BOT_ACTIONS;
    if (key === 'memory') app.go({r: 'bot', id: channel.id, view: 'memory'});
    else if (key === 'pin') A.updateChannel(channel.id, {pinned: !channel.pinned});
    else if (key === 'mute') A.updateChannel(channel.id, {muted: !channel.muted});
    else if (key === 'archive' && channel.archived) { A.setArchived(channel.id, false); app.toast(`已恢复「${channel.name}」`); }
    else if (['settings', 'schedule', 'rename', 'instructions', 'icon', 'archive', 'delete'].includes(key)) openBotDialog({kind: key, channelId: channel.id});
  }

  /** 侧栏行尾的「⋯」：频道菜单。 */
  function BotChannelActionMenu({channel, groups}) {
    const app = useApp();
    const R = window.RSP;
    return <R.ActionMenu aria-label={`「${channel.name}」的操作`} isQuiet size="S" onAction={k => runChannelAction(channel, String(k), app)}>
      {channelMenuItems(channel, groups)}
    </R.ActionMenu>;
  }

  /** 频道头的「图标 名字 ⌄」：按下打开频道菜单（需求 §11.3 修订）。 */
  function BotChannelTitleMenu({channel, groups}) {
    const app = useApp();
    const R = window.RSP;
    return <R.MenuTrigger>
      {/* 按钮只有一个图标槽：频道图标占着，⌄ 放进文字槽里跟在名字后面 */}
      <R.ActionButton isQuiet UNSAFE_className="bot-channel__menu bot-titled">
        <BotChannelGlyph channel={channel} /><R.Text><span className="bot-titled__name">{channel.name}</span><R.Icons.ChevronDown /></R.Text>
      </R.ActionButton>
      <R.Menu aria-label="频道操作" onAction={k => runChannelAction(channel, String(k), app)}>{channelMenuItems(channel, groups)}</R.Menu>
    </R.MenuTrigger>;
  }

  /* ---------- 侧栏综合行与分组行的操作 ---------- */

  /**
   * 综合行行尾（需求 §11.2 修订）：筛选（状态 ▸ 进行中 / 已归档 / 全部；不是进行中时按钮带底色）与「＋」（新建频道 / 新建分组）。
   * 原来收在底部的「已归档」折叠组由这个筛选代替。
   */
  function BotSidebarTools({status, onStatus}) {
    const R = window.RSP;
    return <R.ActionButtonGroup isQuiet size="S" aria-label="频道列表">
      <R.MenuTrigger>
        <R.ActionButton aria-label={`筛选频道：${B.CHANNEL_STATUS_LABEL[status]}`} UNSAFE_className={cx('bot-toggle', status !== 'active' && 'is-on')}>
          <R.Icons.Filter />
        </R.ActionButton>
        <R.Menu aria-label="筛选频道">
          <R.SubmenuTrigger>
            <R.MenuItem id="status" textValue="状态"><R.Text slot="label">状态</R.Text><R.Text slot="description">{B.CHANNEL_STATUS_LABEL[status]}</R.Text></R.MenuItem>
            <R.Menu aria-label="状态" selectionMode="single" disallowEmptySelection selectedKeys={[status]} onSelectionChange={keys => onStatus([...keys][0])}>
              {B.CHANNEL_STATUS.map(k => <R.MenuItem key={k} id={k} textValue={B.CHANNEL_STATUS_LABEL[k]}><R.Text>{B.CHANNEL_STATUS_LABEL[k]}</R.Text></R.MenuItem>)}
            </R.Menu>
          </R.SubmenuTrigger>
        </R.Menu>
      </R.MenuTrigger>
      <R.MenuTrigger>
        <R.ActionButton aria-label="新建"><R.Icons.Add /></R.ActionButton>
        <R.Menu aria-label="新建" onAction={k => openBotDialog({kind: String(k)})}>
          {menuItem('newChannel', R.Icons.Add, '新建频道…')}
          {menuItem('newGroup', R.Icons.FolderAdd, '新建分组…')}
        </R.Menu>
      </R.MenuTrigger>
    </R.ActionButtonGroup>;
  }

  /** 分组行行尾：「⋯」（新建频道、重命名分组、删除分组）与「＋」（在这个分组里新建频道）。删分组不删频道，组里的回到综合。 */
  function BotGroupTools({group}) {
    const app = useApp();
    const R = window.RSP;
    const onAction = key => {
      if (key === 'delete') { window.BOT_ACTIONS.deleteGroup(group.id); app.toast(`已删除分组「${group.name}」，组里的频道回到综合`); }
      else openBotDialog({kind: key, groupId: group.id});
    };
    return <span className="bot-nav__group-tools">
      <R.ActionMenu aria-label={`分组「${group.name}」的操作`} isQuiet size="S" onAction={k => onAction(String(k))}>
        {menuItem('newChannel', R.Icons.Add, '新建频道…')}
        {menuItem('renameGroup', R.Icons.Rename, '重命名分组…')}
        {menuItem('delete', R.Icons.Delete, '删除分组')}
      </R.ActionMenu>
      <R.ActionButton isQuiet size="S" aria-label={`在「${group.name}」里新建频道`} onPress={() => openBotDialog({kind: 'newChannel', groupId: group.id})}>
        <R.Icons.Add />
      </R.ActionButton>
    </span>;
  }

  /* ---------- 对话框 ---------- */

  /** 只问一个名字的对话框：重命名频道、新建频道、新建分组、重命名分组。名字必填、最多 40 字（BOT-CH-02）。 */
  function NameDialog({title, label, what, initial, note, submitLabel, onSubmit}) {
    const R = window.RSP;
    const [name, setName] = useState(initial || '');
    const err = B.nameError(name, what);
    const save = () => { if (!err) { onSubmit(name.trim()); closeBotDialog(); } };
    return <R.DialogContainer onDismiss={closeBotDialog}>
      <R.Dialog size="S">
        {({close}) => <>
          <R.Heading slot="title">{title}</R.Heading>
          <R.Content>
            {note ? <p className="bot-dialog__note">{note}</p> : null}
            <form onSubmit={e => { e.preventDefault(); save(); }}>
              <R.TextField label={label} value={name} autoFocus maxLength={B.NAME_MAX} onChange={setName}
                isInvalid={!!name.trim() && !!err} errorMessage={err} />
            </form>
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" isDisabled={!!err} onPress={save}>{submitLabel}</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  /**
   * 频道说明（需求 §11.3 修订）：编辑的就是频道的用途（BOT-CH-02，最多 2000 字），协调者与线程都读它；频道头的灰字是它的第一行。
   * 留空表示这个频道什么都能做。
   */
  function InstructionsDialog({channel}) {
    const R = window.RSP;
    const [text, setText] = useState(channel.purpose || '');
    const save = close => { window.BOT_ACTIONS.updateChannel(channel.id, {purpose: text.trim()}); close(); };
    return <R.DialogContainer onDismiss={closeBotDialog}>
      <R.Dialog size="M">
        {({close}) => <>
          <R.Heading slot="title">频道说明</R.Heading>
          <R.Content>
            <p className="bot-dialog__note">{channel.name}</p>
            <R.TextArea aria-label="说明" placeholder="这个频道做什么、智能体该怎么做？" value={text} onChange={setText} maxLength={2000} autoFocus
              description="这个频道里的对话和任务都会照着做。留空表示什么都能做。" UNSAFE_className="bot-dialog__instructions" />
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" onPress={() => save(close)}>保存</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  /** 更换频道图标（需求 §11.2 修订）：上面是大号预览，下面选图标（24 个 S2 workflow 图标）与颜色（10 个 S2 色相）。 */
  function IconDialog({channel}) {
    const R = window.RSP;
    const look = B.channelLook(channel);
    const [icon, setIcon] = useState(look.icon);
    const [color, setColor] = useState(look.color);
    const Preview = R.Icons[icon];
    const save = close => { window.BOT_ACTIONS.updateChannel(channel.id, {icon, color}); close(); };
    const pick = set => keys => { const k = [...keys][0]; if (k) set(String(k)); };
    return <R.DialogContainer onDismiss={closeBotDialog}>
      <R.Dialog size="M">
        {({close}) => <>
          <R.Heading slot="title">更换频道图标</R.Heading>
          <R.Content>
            <div className="bot-icon-pick">
              <span className={`bot-icon-pick__preview bot-hue bot-hue--${color}`} aria-hidden="true"><Preview /></span>
              <h3 className="bot-icon-pick__head">图标</h3>
              <R.ToggleButtonGroup aria-label="图标" isQuiet selectionMode="single" disallowEmptySelection selectedKeys={[icon]} onSelectionChange={pick(setIcon)}
                UNSAFE_className="bot-icon-pick__grid">
                {B.CHANNEL_ICONS.map(name => {
                  const Icon = R.Icons[name];
                  return <R.ToggleButton key={name} id={name} aria-label={B.CHANNEL_ICON_LABEL[name]} UNSAFE_className={`bot-hue bot-hue--${color}`}><Icon /></R.ToggleButton>;
                })}
              </R.ToggleButtonGroup>
              <h3 className="bot-icon-pick__head">颜色</h3>
              <R.ToggleButtonGroup aria-label="颜色" isQuiet selectionMode="single" disallowEmptySelection selectedKeys={[color]} onSelectionChange={pick(setColor)}
                UNSAFE_className="bot-icon-pick__grid bot-icon-pick__grid--colors">
                {B.CHANNEL_COLORS.map(name => <R.ToggleButton key={name} id={name} aria-label={B.CHANNEL_COLOR_LABEL[name]}>
                  <span className={`bot-icon-pick__swatch bot-hue bot-hue--${name}`} />
                </R.ToggleButton>)}
              </R.ToggleButtonGroup>
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

  /** 归档确认（需求 §2.3）：频道收进「已归档」，没解决的任务留着，定时任务暂停；进行中的线程照常跑完。恢复后定时任务不自动继续。 */
  function ArchiveDialog({channel, items}) {
    const app = useApp();
    const R = window.RSP;
    const {open, scheduled} = B.archiveImpact(items, channel.id);
    const body = ['频道会收进「已归档」，随时可以恢复。',
      open ? `它的 ${open} 个没解决的任务照样留着，正在做的会做完。` : '',
      scheduled ? `${scheduled} 个定时任务会暂停，恢复后要你手动继续。` : ''].join('');
    const archive = close => { window.BOT_ACTIONS.setArchived(channel.id, true); close(); app.toast(`已归档「${channel.name}」`); };
    return <R.DialogContainer onDismiss={closeBotDialog}>
      <R.Dialog size="S" role="alertdialog">
        {({close}) => <>
          <R.Heading slot="title">{`归档「${channel.name}」？`}</R.Heading>
          <R.Content><p className="bot-dialog__body">{body}</p></R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            <R.Button variant="accent" onPress={() => archive(close)}>归档</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  /**
   * 删除确认（需求 §2.3、BOT-CH-07）：写明会停掉几个进行中的任务、删掉几个任务与定时任务；项目里的视频与 Space 里的产物不动。
   * 删除无法撤销，旁边给「改为归档」。
   */
  function DeleteDialog({channel, items}) {
    const app = useApp();
    const R = window.RSP;
    const {working, tasks, scheduled} = B.deleteImpact(items, channel.id);
    const parts = [working ? `停掉 ${working} 个正在做的任务` : null, tasks ? `删掉 ${tasks} 个任务${scheduled ? `（含 ${scheduled} 个定时任务）` : ''}` : null];
    const lead = parts.filter(Boolean).length ? `会${parts.filter(Boolean).join('，')}，连同它的消息、文件和记忆。` : '它的消息、文件和记忆都会删掉。';
    const remove = close => {
      window.BOT_ACTIONS.deleteChannel(channel.id);
      close();
      if (app.route.r === 'bot' && app.route.id === channel.id) app.go({r: 'bot'});
      app.toast(`已删除「${channel.name}」`);
    };
    const archive = close => { window.BOT_ACTIONS.setArchived(channel.id, true); close(); app.toast(`已归档「${channel.name}」`); };
    return <R.DialogContainer onDismiss={closeBotDialog}>
      <R.Dialog size="S" role="alertdialog">
        {({close}) => <>
          <R.Heading slot="title">{`删除「${channel.name}」？`}</R.Heading>
          <R.Content>
            <p className="bot-dialog__body">{`${lead}删除后无法恢复。`}</p>
            <p className="bot-dialog__note">项目里的视频和 Space 里登记的产物不受影响。只是不想再看到它，可以改为归档。</p>
          </R.Content>
          <R.ButtonGroup>
            <R.Button variant="secondary" onPress={close}>取消</R.Button>
            {channel.archived ? null : <R.Button variant="secondary" onPress={() => archive(close)}>改为归档</R.Button>}
            <R.Button variant="negative" onPress={() => remove(close)}>删除</R.Button>
          </R.ButtonGroup>
        </>}
      </R.Dialog>
    </R.DialogContainer>;
  }

  /**
   * Bot 页的对话框宿主：settings / schedule（page-bot-channel-dialogs.jsx）、rename / instructions / icon / archive / delete 作用于 channelId；
   * newChannel（可带 groupId，建在那个分组里）、newGroup（可带 moveChannelId，建好把那个频道移进去）、renameGroup 作用于分组。
   */
  function BotDialogs() {
    const app = useApp();
    const spec = useSyncExternalStore(subscribe, () => current);
    const bot = window.useBot();
    if (!spec) return null;
    const A = window.BOT_ACTIONS;
    const channel = spec.channelId ? bot.channels.find(c => c.id === spec.channelId) : null;
    const group = spec.groupId ? bot.groups.find(g => g.id === spec.groupId) : null;
    if (spec.channelId && !channel) return null;
    switch (spec.kind) {
      case 'settings': return <window.BotSettingsDialog channel={channel} onClose={closeBotDialog} />;
      case 'schedule': return <window.BotScheduleDialog channel={channel} onClose={closeBotDialog} />;
      case 'rename':
        return <NameDialog title="重命名频道" label="频道名" what="频道" initial={channel.name} submitLabel="保存"
          onSubmit={name => A.updateChannel(channel.id, {name})} />;
      case 'instructions': return <InstructionsDialog channel={channel} />;
      case 'icon': return <IconDialog channel={channel} />;
      case 'archive': return <ArchiveDialog channel={channel} items={bot.items} />;
      case 'delete': return <DeleteDialog channel={channel} items={bot.items} />;
      case 'newChannel':
        return <NameDialog title="新建频道" label="频道名" what="频道" submitLabel="新建"
          note={group ? `建在「${group.name}」分组里。一件事开一个频道，综合频道照旧。` : '一件事开一个频道，综合频道照旧。Agent、访问模式与预算建好后在频道设置里改。'}
          onSubmit={name => app.go({r: 'bot', id: A.createChannel({name, groupId: group ? group.id : null}).id})} />;
      case 'newGroup':
        return <NameDialog title="新建分组" label="分组名" what="分组" submitLabel="新建分组"
          note={spec.moveChannelId ? '建好后把这个频道移进去。' : '分组只是把频道归在一起，不影响它们怎么工作。'}
          onSubmit={name => {
            const created = A.createGroup(name);
            if (spec.moveChannelId) A.updateChannel(spec.moveChannelId, {groupId: created.id});
          }} />;
      case 'renameGroup':
        return group ? <NameDialog title="重命名分组" label="分组名" what="分组" initial={group.name} submitLabel="保存"
          onSubmit={name => A.renameGroup(group.id, name)} /> : null;
      default: return null;
    }
  }

  Object.assign(window, {openBotDialog, BotChannelGlyph, BotChannelActionMenu, BotChannelTitleMenu, BotSidebarTools, BotGroupTools, BotDialogs});
})();
