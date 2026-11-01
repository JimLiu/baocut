/* Bot 频道记忆页（docs/design/bot-mode/bot-mode-requirements.md §11.7）—— 只在 App 入口加载。
   从频道菜单的「记忆」进来，占中间整页、没有右栏（路由 {r:'bot', id, view:'memory'}）；「回到频道」与标题「记忆 · 频道名」
   照 Home 的会话头放在标题栏里（BotPage 放进去，BotMemoryHead）。上面切「这个频道 / 所有频道」，中间是可以直接改的 Markdown 文本，下面是用量（频道 16 KB、所有频道 8 KB）与清空、放弃修改、保存。
   演示里存在 Bot 页的 store（BOT_ACTIONS.setMemory）；实现里的「你编辑时被改过了」冲突提示原型不画。 */
(function () {
  const {useState, useEffect} = React;
  const B = window.BC_BOT;

  function BotMemoryHead({channel}) {
    const app = useApp();
    const R = window.RSP;
    return <div className="hhd bot-head">
      <R.ActionButton isQuiet size="S" aria-label="回到频道" onPress={() => app.go({r: 'bot', id: channel.id})}><R.Icons.ChevronLeft /></R.ActionButton>
      <h1 className="hhd__title">{`记忆 · ${channel.name}`}</h1>
    </div>;
  }

  function BotMemoryPage({channel}) {
    const app = useApp();
    const R = window.RSP;
    const bot = window.useBot();
    const [scope, setScope] = useState('channel');
    const key = scope === 'user' ? 'user' : channel.id;
    const saved = (bot.memories || {})[key] || '';
    const [text, setText] = useState(saved);
    const [clearing, setClearing] = useState(false);
    useEffect(() => setText(saved), [key]);
    const usage = B.memoryUsage(text, scope);
    const dirty = text !== saved;
    const save = () => { window.BOT_ACTIONS.setMemory(key, text); app.toast('已保存'); };
    const clear = () => { window.BOT_ACTIONS.setMemory(key, ''); setText(''); setClearing(false); };
    return <section className="bot-memory" aria-label="记忆">
      <div className="bot-memory__inner">
        <div className="bot-memory__head">
          <R.SegmentedControl aria-label="记忆" selectedKey={scope} onSelectionChange={k => setScope(String(k))}>
            <R.SegmentedControlItem id="channel">这个频道</R.SegmentedControlItem>
            <R.SegmentedControlItem id="user">所有频道</R.SegmentedControlItem>
          </R.SegmentedControl>
        </div>
        <p className="bot-memory__lead">{scope === 'user' ? '在每个频道都适用的偏好。和频道自己的记忆冲突时，以频道的为准。' : '智能体在这里记着的东西。你随时可以修改或清空。'}</p>
        <textarea className={cx('bot-memory__text', usage.over && 'is-invalid')} aria-label={scope === 'user' ? '所有频道' : '这个频道'}
          aria-invalid={usage.over || undefined} spellCheck={false} value={text} onChange={e => setText(e.target.value)} />
        <div className="bot-memory__foot">
          <span className={cx('bot-memory__usage', usage.over ? 'is-over' : usage.near && 'is-near')} aria-live="polite">{usage.label}</span>
          <R.Button variant="secondary" fillStyle="outline" isDisabled={!saved} onPress={() => setClearing(true)}>清空…</R.Button>
          <R.Button variant="secondary" isDisabled={!dirty} onPress={() => setText(saved)}>放弃修改</R.Button>
          <R.Button variant="accent" isDisabled={!dirty || usage.over} onPress={save}>保存</R.Button>
        </div>
      </div>
      <R.DialogContainer onDismiss={() => setClearing(false)}>
        {clearing ? <R.Dialog size="S" role="alertdialog">
          {({close}) => <>
            <R.Heading slot="title">清空这份记忆？</R.Heading>
            <R.Content><p className="bot-dialog__body">智能体会忘掉这里写的所有内容。这无法撤销。</p></R.Content>
            <R.ButtonGroup>
              <R.Button variant="secondary" onPress={close}>取消</R.Button>
              <R.Button variant="negative" onPress={clear}>清空</R.Button>
            </R.ButtonGroup>
          </>}
        </R.Dialog> : null}
      </R.DialogContainer>
    </section>;
  }

  Object.assign(window, {BotMemoryHead, BotMemoryPage});
})();
