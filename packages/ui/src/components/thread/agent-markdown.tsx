import { createContext, memo, useContext, useEffect, useMemo, useId, useRef, useState, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform, type Components } from 'react-markdown';
import { ActionButton, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import { Link } from '@react-spectrum/s2/Link';
import Settings from '@react-spectrum/s2/icons/Settings';
import { advanceCut, closeStreamingTail, revealStep, splitBlocks } from '../../model/agent-stream.ts';
import { gapBetween, parsePathToken, pathTip, type PathToken } from '../../model/agent-turn.ts';
import { useShell } from '../../state/shell-store.ts';
import { markdownFilePath } from '../../model/markdown-file-link.ts';
import { settingsLink } from '../../model/settings-link.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { CopyButton } from './copy-button.tsx';
import { T } from './thread-copy.ts';
import { remarkPlugins } from './remark-plugins.ts';
import './agent-thread.css';
import { openMarkdownPath, ThreadMediaPreview } from './thread-media-preview.tsx';

/**
 * Agent 回复正文（产品设计 §3.2.2）：逐字匀速显示，按 Markdown 块渲染。
 *
 * - 全文留在 store，`useRevealedText` 只放出一截：每帧按积压成比例前进（`revealStep`），切点落在字素簇边界；
 *   流式结束立刻显示全文，挂载时已经写完的消息整段显示。
 * - 回复按块拆开（`splitBlocks`），每块一个 memo 组件：流式时只有最后一块的文字在变，前面的块不重新解析；
 *   最后一块先经 `closeStreamingTail` 补齐没写完的标记再渲染。
 */

/** 60Hz 上限：高刷屏上隔帧推进。 */
const FRAME_MS = 1000 / 60 - 0.5;

export function useRevealedText(text: string, streaming: boolean): string {
  const [shown, setShown] = useState(text.length);
  const shownRef = useRef(text.length);
  const textRef = useRef(text);
  textRef.current = text;

  useEffect(() => {
    if (!streaming) {
      shownRef.current = textRef.current.length;
      setShown(shownRef.current);
      return;
    }
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      if (now - last >= FRAME_MS) {
        const full = textRef.current;
        const from = Math.min(shownRef.current, full.length);
        const backlog = full.length - from;
        if (backlog > 0) {
          const next = advanceCut(full, from, revealStep({ backlog, elapsedMs: now - last }));
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

  return streaming ? text.slice(0, Math.min(shown, text.length)) : text;
}

/** 正文里的路径相对哪个会话的工作目录打开。 */
const PathScope = createContext<{ conversationId: string; cwd: string | null; mediaGroup: string }>({ conversationId: '', cwd: null, mediaGroup: '' });

/** hast 节点里的文字。 */
function textOf(node: unknown): string {
  const n = node as { type?: string; value?: string; children?: unknown[] } | undefined;
  if (!n) return '';
  if (n.type === 'text') return n.value ?? '';
  return (n.children ?? []).map(textOf).join('');
}

/** 代码块：hover 出复制按钮；复制时去掉尾部换行。长行换行，不横滚。 */
function CodeBlock({ code }: { code: string }) {
  const body = code.replace(/\n+$/, '');
  return (
    <div className="bc-amd-pre">
      <pre tabIndex={0}>
        <code>{body}</code>
      </pre>
      <span className="bc-amd-pre__copy">
        <CopyButton text={body} label={T.copyCode} />
      </span>
    </div>
  );
}

/** 正文里的文件路径：点了在功能区打开文件查看器；tooltip 是相对路径与行范围。 */
function PathLink({ raw, token }: { raw: string; token: PathToken }) {
  const scope = useContext(PathScope);
  const { cwd } = scope;
  const runtime = useRuntime();
  const path = token.path.startsWith('./') ? token.path.slice(2) : token.path;
  return (
    <TooltipTrigger delay={400}>
      <ActionButton
        isQuiet
        size="XS"
        UNSAFE_className="bc-amd-path"
        onPress={() => openMarkdownPath(path, scope, runtime)}>
        {raw}
      </ActionButton>
      <Tooltip>{pathTip(token, cwd)}</Tooltip>
    </TooltipTrigger>
  );
}

/** 显式产物链接和行内路径一样进入右侧查看器，不能让浏览器导航到本机路径。 */
function MarkdownLink({ href, children, title }: { href?: string; children?: ReactNode; title?: string }) {
  const scope = useContext(PathScope);
  const runtime = useRuntime();
  // 设置路径优先于外部网页与文件；浏览器和未知设置路径只显示文字（§3.2.2）。
  if (href && /^\/settings(?:\/|$)/.test(href)) {
    const hit = runtime.host.platform !== 'web' ? settingsLink(href) : null;
    if (!hit) return <span>{children}</span>;
    return <TooltipTrigger delay={400}>
      <Link href={href} UNSAFE_className="bc-amd-settings">
        <Settings />{children}
      </Link>
      <Tooltip>{hit.trail}</Tooltip>
    </TooltipTrigger>;
  }
  const path = href ? markdownFilePath(href) : null;
  if (!href) return <span>{children}</span>;
  if (!path) return <a href={href} title={title} target="_blank" rel="noreferrer noopener" onClick={event => {
    if (!runtime.host.web || !/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    useShell.getState().openPane({ kind: 'web', id: crypto.randomUUID(), url: href });
  }}>{children}</a>;
  const open = (event: React.MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (event.type === 'auxclick' && event.button !== 1) return;
    openMarkdownPath(path, scope, runtime);
  };
  return <a href={href} title={title ?? path} onClick={open} onAuxClick={open}>{children}</a>;
}

const MediaBlock = createContext(0);
function MarkdownMedia({ src, alt, offset = 0 }: { src?: string; alt?: string; offset?: number }) {
  const block = useContext(MediaBlock);
  const scope = useContext(PathScope);
  return src && scope ? <ThreadMediaPreview src={src} alt={alt ?? ''} scope={scope} block={block} offset={offset} /> : null;
}

const components: Components = {
  img: ({ src, alt, node }) => <MarkdownMedia src={src} alt={alt} offset={node?.position?.start.offset} />,
  a: ({ href, children, title }) => <MarkdownLink href={href} title={title}>{children}</MarkdownLink>,
  pre: ({ node }) => <CodeBlock code={textOf(node)} />,
  code: ({ children }) => {
    const raw = String(children ?? '');
    const token = parsePathToken(raw);
    return token ? <PathLink raw={raw} token={token} /> : <code className="bc-amd-code">{children}</code>;
  },
  table: ({ children }) => (
    <div className="bc-amd-table">
      <table>{children}</table>
    </div>
  ),
};

/** 一块 Markdown：文字不变就不重渲。 */
const MarkdownBlock = memo(function MarkdownBlock({ src, gap }: { src: string; gap: number }) {
  return (
    <div className="bc-amd-block" style={gap ? { marginTop: gap } : undefined}>
      <Markdown remarkPlugins={remarkPlugins} components={components}
        urlTransform={(url, key) => (key === 'href' || key === 'src') && markdownFilePath(url) ? url : defaultUrlTransform(url)}>
        {src}
      </Markdown>
    </div>
  );
});

export function AgentMarkdown({
  text,
  streaming,
  conversationId,
  cwd = null,
}: {
  text: string;
  streaming: boolean;
  conversationId: string;
  cwd?: string | null;
}): ReactNode {
  const shown = useRevealedText(text, streaming);
  const blocks = splitBlocks(shown);
  if (streaming && blocks.length) blocks[blocks.length - 1] = closeStreamingTail(blocks[blocks.length - 1]!);
  const mediaGroup = useId();
  const scope = useMemo(() => ({ conversationId, cwd, mediaGroup }), [conversationId, cwd, mediaGroup]);
  const gap = gapBetween('block', 'block');
  return (
    <PathScope.Provider value={scope}>
      <div className="bc-amd">
        {blocks.map((src, i) => (
          <MediaBlock.Provider key={i} value={i}><MarkdownBlock src={src} gap={i ? gap : 0} /></MediaBlock.Provider>
        ))}
      </div>
    </PathScope.Provider>
  );
}
