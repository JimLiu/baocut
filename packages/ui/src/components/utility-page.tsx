import { useEffect, useRef, useState, type ReactNode } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useNarrow } from './use-narrow.ts';
import { UtilitySidebar, type UtilityKind } from './utility-sidebar.tsx';

const layout = style({ display: 'flex', flexGrow: 1, minHeight: 0, minWidth: 0 });
const content = style({ flexGrow: 1, minWidth: 0, overflowY: 'auto' });
const inner = style({ display: 'flex', flexDirection: 'column', maxWidth: '[1040px]', marginX: 'auto' });
const head = style({ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 });
const heading = style({ font: 'heading', margin: 0, flexGrow: 1, minWidth: 0 });
// 吸顶的页头（设计稿 shell.jsx `Page` 的 bar、ui.css `.pagenav`）：底色与纸面同色，停在顶上时没有分界，内容卷到它下面才出一条 2px gray-100。
const bar = style({
  position: 'sticky',
  top: 0,
  zIndex: 2,
  backgroundColor: 'gray-25',
  borderBottomWidth: 2,
  borderBottomStyle: 'solid',
  borderColor: { default: 'transparent', isScrolled: 'gray-100' },
  transition: 'default',
});
const barInner = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 12,
  maxWidth: '[1040px]',
  marginX: 'auto',
  paddingTop: 24,
  paddingBottom: 16,
});

/**
 * 工具、服务与后台任务的页面骨架（产品设计 §2 用户修订）：左边是这一入口的侧栏，右边内容最宽 1040、
 * 内边距 40，内容区窄于 600 时收到 24。
 * `sticky`：标题与 `actions`（主按钮）放进吸顶的页头，不随内容滚走（工具页，设计稿 `page--rootbar`）；页头的高度写进
 * `--bc-page-bar`，页里另外吸顶的栏（工作台右边的记录栏）从它下面开始。
 */
export function UtilityPage({
  kind,
  title,
  actions,
  before,
  sticky = false,
  children,
}: {
  kind: UtilityKind;
  title?: ReactNode;
  actions?: ReactNode;
  /** 标题上方的一行，比如详情页的返回。 */
  before?: ReactNode;
  sticky?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const narrow = useNarrow(ref, 600);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const el = ref.current,
      top = barRef.current;
    if (!sticky || !el || !top) return;
    const sync = () => setScrolled(el.scrollTop > 0);
    const observer = new ResizeObserver(() => el.style.setProperty('--bc-page-bar', `${top.offsetHeight}px`));
    observer.observe(top);
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener('scroll', sync);
    };
  }, [sticky]);
  const pad = narrow ? 24 : 40;
  return (
    <div className={layout}>
      <UtilitySidebar kind={kind} />
      <div ref={ref} className={`${content} bc-scroll`}>
        {sticky ? (
          <header ref={barRef} className={bar({ isScrolled: scrolled })}>
            <div className={barInner} style={{ paddingInline: pad }}>
              <h1 className={heading}>{title}</h1>
              {actions}
            </div>
          </header>
        ) : null}
        <div className={inner} style={sticky ? { padding: `8px ${pad}px ${pad}px` } : { padding: pad }}>
          {before}
          {!sticky && (title || actions) ? (
            <header className={head}>
              <h1 className={heading}>{title}</h1>
              {actions}
            </header>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
