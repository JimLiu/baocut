/* Bot 页的 Make 面板（docs/design/bot-mode/bot-mode-requirements.md §6、§11.5）—— 只在 App 入口加载。
   右栏的另一种内容，由频道头的「Make」开关打开，和任务面板二选一：
   最上面是建议（第一条是带预览的大卡，其余一行一条），然后是最近的产物，最后一排周期任务模板。 */
(function () {
  const {useState, useRef} = React;
  const B = window.BC_BOT;

  /** 建议大卡的预览：按建议的种类画一个示意（竖版是三块 9:16，字幕是一帧画面加两行字幕条），不是真缩略图。 */
  function BotMakePreview({kind}) {
    if (kind === 'shorts') return <div className="bot-make__art" aria-hidden="true">
      {[0, 1, 2].map(n => <span key={n} className="bot-make__frame bot-make__frame--tall" />)}
    </div>;
    if (kind === 'subtitles') return <div className="bot-make__art" aria-hidden="true">
      <span className="bot-make__frame bot-make__frame--wide"><span className="bot-make__caption" /><span className="bot-make__caption bot-make__caption--short" /></span>
    </div>;
    return <div className="bot-make__art" aria-hidden="true"><window.RSP.Icons.Lightbulb /></div>;
  }

  /** 第一条建议（BOT-MK-04）：预览、种类标签与标题、理由；「现在做」「加入」，右上角 ✕ 是忽略。 */
  function BotMakeHero({item, channelName}) {
    const R = window.RSP;
    const kind = (item.suggestion && item.suggestion.kind) || 'task';
    const reason = item.suggestion && item.suggestion.reason;
    return <section className="bot-make__hero" aria-label={`建议：${item.title}`}>
      <BotMakePreview kind={kind} />
      <span className="bot-make__dismiss">
        <R.ActionButton isQuiet size="S" aria-label={`忽略「${item.title}」`} onPress={() => window.BOT_ACTIONS.act(item.id, 'dismiss')}><R.Icons.Close /></R.ActionButton>
      </span>
      <div className="bot-make__hero-body">
        <div className="bot-make__hero-title">
          <span className="bot-make__tag">{B.SUGGESTION_KIND[kind]}</span>
          <span className="bot-make__name">{item.title}</span>
        </div>
        {reason || channelName ? <span className="bot-make__reason">{[channelName, reason].filter(Boolean).join(' · ')}</span> : null}
        <div className="bot-make__actions">
          <R.Button size="S" variant="accent" onPress={() => window.BOT_ACTIONS.accept(item.id, true)}>现在做</R.Button>
          <R.Button size="S" variant="secondary" onPress={() => window.BOT_ACTIONS.accept(item.id, false)}>加入</R.Button>
        </div>
      </div>
    </section>;
  }

  /** 其余的建议：一行一条，行尾「现在做」和 ⋯（加入、忽略）。 */
  function BotMakeRow({item, channelName}) {
    const R = window.RSP;
    const reason = item.suggestion && item.suggestion.reason;
    return <li className="bot-row bot-make__row">
      <span className="bot-row__main">
        <window.BotStatusIcon statusKey="suggested" chip />
        <span className="bot-row__text">
          <span className="bot-row__title">{item.title}</span>
          {reason || channelName ? <span className="bot-row__sub">{[channelName, reason].filter(Boolean).join(' · ')}</span> : null}
        </span>
      </span>
      <span className="bot-row__end">
        <R.Button size="S" variant="secondary" onPress={() => window.BOT_ACTIONS.accept(item.id, true)}>现在做</R.Button>
        <R.ActionMenu aria-label="更多操作" isQuiet size="S" onAction={key => (key === 'add' ? window.BOT_ACTIONS.accept(item.id, false) : window.BOT_ACTIONS.act(item.id, 'dismiss'))}>
          <R.MenuItem id="add" textValue="加入"><R.Text>加入</R.Text></R.MenuItem>
          <R.MenuItem id="dismiss" textValue="忽略"><R.Text>忽略</R.Text></R.MenuItem>
        </R.ActionMenu>
      </span>
    </li>;
  }

  /** 产物卡：名字、种类 · （全部频道时的频道名）· 多久以前，下面是种类图标的占位预览；点了在右栏推开这个产物（返回是产出它的任务）。 */
  function BotOutputCard({output, channelName, onOpen}) {
    const kind = B.OUTPUT_KIND[output.kind] || B.OUTPUT_KIND.doc;
    const Icon = window.RSP.Icons[kind.icon];
    const meta = [kind.label, channelName, window.BC_AGENT.agoLabel((Date.now() - output.at) / 60000)].filter(Boolean).join(' · ');
    return <li className="bot-make__output">
      <button type="button" className="bot-make__output-btn" onClick={onOpen} aria-label={`打开「${output.label}」，${meta}`}>
        <span className="bot-make__output-name">{output.label}</span>
        <span className="bot-make__output-meta"><Icon /><span>{meta}</span></span>
        <span className="bot-make__output-thumb" aria-hidden="true"><Icon /></span>
      </button>
    </li>;
  }

  function BotMakeSection({title, count, children}) {
    return <section className="bot-make__section" aria-label={count ? `${title}，${count} 个` : title}>
      <h3 className="bot-section__title">{title}{count ? <span className="bot-section__count">{count}</span> : null}</h3>
      {children}
    </section>;
  }

  /** 模板卡（BOT-MK-05）：图标、「＋」建立、名字、做什么与频率。 */
  function BotTemplateCard({template, onAdd}) {
    const R = window.RSP;
    return <li className="bot-make__template">
      <div className="bot-make__template-top">
        <R.Icons.Calendar />
        <R.ActionButton isQuiet size="S" aria-label={`建立「${template.title}」`} onPress={onAdd}><R.Icons.Add /></R.ActionButton>
      </div>
      <span className="bot-make__template-name">{template.title}</span>
      <span className="bot-make__template-text">{template.text}</span>
      <span className="bot-make__template-every">{template.every}</span>
    </li>;
  }

  /**
   * 右栏「Make」页签的内容（BOT-MK-01、04、05，需求 §6）：顶上一行切「这个频道 / 全部频道」，行尾是「给点建议」；标题与收起在页签条上。
   * 建议按 ✕ 忽略、「现在做」开工、「加入」排进接下来；产物点了在右栏开它的页签；模板「＋」在这个频道建一条定时任务。
   */
  function BotMakePanel({channelId, onOpenOutput}) {
    const app = useApp();
    const R = window.RSP;
    const bot = window.useBot();
    const [scope, setScope] = useState('channel');
    const strip = useRef(null);
    const archived = bot.channels.filter(c => c.archived).map(c => c.id);
    const g = B.makeGallery(bot.items, channelId, scope, Date.now(), archived);
    const nameOf = id => (scope === 'all' ? (bot.channels.find(c => c.id === id) || {}).name : null);
    const [hero, ...rest] = g.suggestions;
    const cards = list => <ul className="bot-make__grid">{list.map((o, n) => <BotOutputCard key={`${o.item.id}-${n}`} output={o}
      channelName={nameOf(o.item.channelId)} onOpen={() => onOpenOutput(o.item, o.index)} />)}</ul>;
    const addTemplate = template => {
      const task = window.BOT_ACTIONS.schedule(channelId, template);
      app.toast(`已建立「${task.title}」，下一次 ${new Date(task.startAt).toLocaleString('zh-CN', {month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit'})}`);
    };
    return <section className="bot-panel bot-make" aria-label="Make">
      <div className="bot-make__scope">
        <R.SegmentedControl aria-label="看哪些频道" selectedKey={scope} onSelectionChange={k => setScope(String(k))}>
          <R.SegmentedControlItem id="channel">这个频道</R.SegmentedControlItem>
          <R.SegmentedControlItem id="all">全部频道</R.SegmentedControlItem>
        </R.SegmentedControl>
        <R.ActionButton isQuiet size="S" aria-label="给点建议" onPress={() => app.toast('现在没有新的建议')}><R.Icons.MagicWand /></R.ActionButton>
      </div>
      <div className="bot-panel__scroll bot-make__body bc-scroll">
        {hero ? <BotMakeHero item={hero} channelName={nameOf(hero.channelId)} /> : <p className="bot-make__none">现在没有建议。按上面的「给点建议」，让它看看接下来能做什么。</p>}
        {rest.length ? <BotMakeSection title="更多建议" count={rest.length}>
          <ul className="bot-list">{rest.map(i => <BotMakeRow key={i.id} item={i} channelName={nameOf(i.channelId)} />)}</ul>
        </BotMakeSection> : null}
        {g.today.length ? <BotMakeSection title="今天的产物" count={g.today.length}>{cards(g.today)}</BotMakeSection> : null}
        {g.earlier.length ? <BotMakeSection title="更早的产物">{cards(g.earlier)}</BotMakeSection> : null}
        {!g.today.length && !g.earlier.length ? <BotMakeSection title="产物"><p className="bot-empty">任务做出来的视频、字幕和文档会出现在这里。</p></BotMakeSection> : null}
        <BotMakeSection title="周期任务模板">
          <div className="bot-make__strip-wrap">
            <ul className="bot-make__strip bc-scroll" ref={strip}>{B.MAKE_TEMPLATES.map(t => <BotTemplateCard key={t.id} template={t} onAdd={() => addTemplate(t)} />)}</ul>
            <span className="bot-make__more">
              <R.ActionButton isQuiet size="S" aria-label="看后面的模板" onPress={() => strip.current && strip.current.scrollBy({left: 180, behavior: 'smooth'})}><R.Icons.ChevronRight /></R.ActionButton>
            </span>
          </div>
        </BotMakeSection>
      </div>
    </section>;
  }

  Object.assign(window, {BotMakePanel});
})();
