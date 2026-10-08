/* Agent 回复正文：Markdown 渲染与逐字显示（只在 App 入口加载）。

   - 解析用 markdown-it（build.mjs 打进 generated/app.js，挂 window.BC_MARKDOWN_IT）：html 关掉、链接自动识别、
     不做排版替换（引号与破折号不改写，命令粘进 shell 原样能跑）。token 流直接转成 React 元素，不拼 HTML 字符串——
     代码块的复制按钮与正文里的文件路径都是 S2 控件。
   - 全文留在 store，`useRevealedText` 只放出一截：每帧按积压成比例前进（BC_AGENT_STREAM.revealStep），
     切点落在字素簇边界；流式结束立刻显示全文，首次挂载整段显示（历史消息不逐字）。
   - 回复按块拆开（BC_AGENT_STREAM.splitBlocks），每块一个 memo 组件：流式时只有最后一块的文字在变，
     前面的块不重新解析；最后一块先经 closeStreamingTail 补齐没写完的标记再渲染。 */
(function () {
  const {useState, useEffect, useRef, useMemo, memo} = React;
  const ST = window.BC_AGENT_STREAM;
  const TURN = window.BC_AGENT_TURN;
  const R = window.RSP;

  let parser = null;
  function markdown() {
    if (!parser && window.BC_MARKDOWN_IT) parser = window.BC_MARKDOWN_IT({html: false, linkify: true, typographer: false});
    return parser;
  }

  /* ---------- 复制 ---------- */
  function CopyButton({text, label, title}) {
    const [copied, setCopied] = useState(false);
    const app = useApp();
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    return <BCAction className={cx('awork__copy', label && 'awork__copy--label')} title={title || '复制'} onClick={async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true); clearTimeout(timer.current); timer.current = setTimeout(() => setCopied(false), 2000);
      } catch { app.toast('复制失败，请重试', 'negative'); }
    }}><Ic n={copied ? 'ok' : 'copy'} className="ic--14" />{label ? <span>{copied ? '已复制' : label}</span> : null}</BCAction>;
  }

  /* ---------- 逐字显示 ---------- */
  const FRAME_MS = 1000 / 60 - 0.5; // 60Hz 上限：高刷屏上隔帧推进
  function useRevealedText(text, streaming) {
    const full = String(text || '');
    const [shown, setShown] = useState(full.length);
    const shownRef = useRef(full.length);
    const textRef = useRef(full);
    textRef.current = full;
    useEffect(() => {
      if (!streaming) { shownRef.current = textRef.current.length; setShown(shownRef.current); return undefined; }
      let raf = 0;
      let last = performance.now();
      const frame = (now) => {
        if (now - last >= FRAME_MS) {
          const s = textRef.current;
          const from = Math.min(shownRef.current, s.length);
          const backlog = s.length - from;
          if (backlog > 0) {
            const next = ST.advanceCut(s, from, ST.revealStep({backlog, elapsedMs: now - last}));
            shownRef.current = next;
            setShown(next);
          }
          last = now;
        }
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf);
    }, [streaming]);
    return streaming ? full.slice(0, Math.min(shown, full.length)) : full;
  }

  /* ---------- token → React ---------- */
  function tree(tokens) {
    const root = {children: []};
    const stack = [root];
    for (const t of tokens || []) {
      if (t.nesting === 1) { const n = {t, children: []}; stack[stack.length - 1].children.push(n); stack.push(n); }
      else if (t.nesting === -1) { if (stack.length > 1) stack.pop(); }
      else stack[stack.length - 1].children.push({t, children: null});
    }
    return root.children;
  }

  const TAGS = {
    bullet_list_open: 'ul', list_item_open: 'li', blockquote_open: 'blockquote', thead_open: 'thead', tbody_open: 'tbody',
    tr_open: 'tr', strong_open: 'strong', em_open: 'em', s_open: 's',
  };
  function align(t) {
    const m = /text-align:\s*(left|right|center)/.exec(t.attrGet('style') || '');
    return m ? {textAlign: m[1]} : undefined;
  }

  function nodes(list) { return list.map(node); }
  function node(n, key) {
    const t = n.t;
    const kids = () => nodes(n.children || []);
    switch (t.type) {
      case 'inline': return <React.Fragment key={key}>{nodes(tree(t.children))}</React.Fragment>;
      case 'paragraph_open': return t.hidden ? <React.Fragment key={key}>{kids()}</React.Fragment> : <p key={key}>{kids()}</p>;
      case 'heading_open': return React.createElement(t.tag, {key, className: 'amd-h'}, kids());
      case 'ordered_list_open': {
        const start = Number(t.attrGet('start'));
        return <ol key={key} start={start > 1 ? start : undefined}>{kids()}</ol>;
      }
      case 'table_open': return <div key={key} className="amd-table"><table>{kids()}</table></div>;
      case 'th_open': return <th key={key} style={align(t)}>{kids()}</th>;
      case 'td_open': return <td key={key} style={align(t)}>{kids()}</td>;
      case 'link_open': {
        const href = t.attrGet('href');
        if (href && /^\/settings(?:\/|$)/.test(href)) return <SettingsLink key={key} href={href}>{kids()}</SettingsLink>;
        if (href && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href)) return <FileLink key={key} href={href}>{kids()}</FileLink>;
        if (href && /^https?:\/\//i.test(href)) return <WebLink key={key} href={href}>{kids()}</WebLink>;
        return <a key={key} href={href} target="_blank" rel="noreferrer noopener">{kids()}</a>;
      }
      case 'hr': return <hr key={key} />;
      case 'fence': case 'code_block': return <CodeBlock key={key} code={t.content} />;
      case 'text': return t.content;
      case 'softbreak': return '\n';
      case 'hardbreak': return <br key={key} />;
      case 'code_inline': {
        const p = TURN.parsePathToken(t.content);
        return p ? <PathLink key={key} raw={t.content} p={p} /> : <code key={key} className="amd-code">{t.content}</code>;
      }
      case 'image': return <window.ThreadMediaPreview key={key} src={t.attrGet('src')} alt={t.content} />;
      default: {
        const tag = TAGS[t.type];
        if (tag) return React.createElement(tag, {key}, kids());
        return n.children ? <React.Fragment key={key}>{kids()}</React.Fragment> : (t.content || null);
      }
    }
  }

  /* 代码块：hover 出复制按钮；复制时去掉尾部换行。长行换行，不横滚。 */
  function CodeBlock({code}) {
    const body = String(code || '').replace(/\n+$/, '');
    return <div className="amd-pre">
      <pre tabIndex={0}><code>{body}</code></pre>
      <span className="amd-pre__copy"><CopyButton text={body} title="复制代码" /></span>
    </div>;
  }

  /* 正文里的文件路径：S2 按钮 + 400ms 的 tooltip（相对路径与行范围）。原型只出一条 toast。 */
  function PathLink({raw, p}) {
    const app = useApp();
    return <R.TooltipTrigger delay={400}>
      <R.ActionButton isQuiet size="XS" UNSAFE_className="amd-path"
        onPress={() => {
          const session = app.sessionById(app.route.id);
          const file = window.BC_FILE_PREVIEW.linkedFile(p.path, app.spaceItems, session && app.dirOfSession(session));
          if (file) app.openWorkspaceFile(file.id);
          else app.toast(`原型演示：正式版会在文件面板打开 ${p.path}`);
        }}>{raw}</R.ActionButton>
      <R.Tooltip>{TURN.pathTip(p)}</R.Tooltip>
    </R.TooltipTrigger>;
  }

  function FileLink({href, children}) {
    const app = useApp();
    return <R.Link onPress={() => {
      const session = app.sessionById(app.route.id);
      const file = window.BC_FILE_PREVIEW.linkedFile(href, app.spaceItems, session && app.dirOfSession(session));
      if (file) app.openWorkspaceFile(file.id);
      else app.toast('原型演示：这个文件没有演示内容，可用系统默认应用打开。');
    }}>{children}</R.Link>;
  }

  function WebLink({href, children}) {
    const app = useApp();
    return <R.Link onPress={() => app.go(window.BC_HOME_WORKSPACE.route(app.route.id, {kind: 'web', id: crypto.randomUUID(), url: href}))}>{children}</R.Link>;
  }

  /* 设置链接（product-design §3.2.2）：应用内的设置路径，点了在当前窗口打开设置的那一页，提示里是位置。
     认不出的路径、或这个表面没有设置页时，只显示文字。 */
  function SettingsLink({href, children}) {
    const app = useApp();
    const hit = window.BC_SURFACE.pages && window.BC_SETTINGS_LINK ? window.BC_SETTINGS_LINK.parse(href) : null;
    if (!hit) return <span className="amd-linktext">{children}</span>;
    return <R.TooltipTrigger delay={400}>
      <R.Link UNSAFE_className="amd-setlink" onPress={() => app.go(hit.route)}>
        <Ic n="settings" className="ic--14" />{children}
      </R.Link>
      <R.Tooltip>{`打开${hit.trail}`}</R.Tooltip>
    </R.TooltipTrigger>;
  }

  /* 一块 Markdown：文字不变就不重渲（React.memo 比 src）。 */
  const Block = memo(function Block({src, gap}) {
    const md = markdown();
    const parsed = useMemo(() => (md ? tree(md.parse(src, {})) : null), [md, src]);
    return <div className={cx('amd-block', gap != null && `agap-${gap}`)}>{parsed ? nodes(parsed) : <p>{src}</p>}</div>;
  });

  function AgentMarkdown({text, streaming}) {
    const shown = useRevealedText(text, streaming);
    const blocks = ST.splitBlocks(shown);
    if (streaming && blocks.length) blocks[blocks.length - 1] = ST.closeStreamingTail(blocks[blocks.length - 1]);
    const gap = TURN.gapBetween('block', 'block');
    return <div className="amd" onDoubleClick={selectTextBlock}>
      {blocks.map((b, i) => <Block key={`block:${i}`} src={b} gap={i ? gap : null} />)}
    </div>;
  }

  Object.assign(window, {AgentMarkdown, AgentCopyButton: CopyButton, useRevealedText});
})();
