import { useRef, type ReactNode } from 'react';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { useNarrow } from './use-narrow.ts';
import { UtilitySidebar, type UtilityKind } from './utility-sidebar.tsx';

const layout = style({ display: 'flex', flexGrow: 1, minHeight: 0, minWidth: 0 });
const content = style({ flexGrow: 1, minWidth: 0, overflowY: 'auto' });
const inner = style({ display: 'flex', flexDirection: 'column', maxWidth: '[1040px]', marginX: 'auto' });
const head = style({ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 });
const heading = style({ font: 'heading', margin: 0, flexGrow: 1, minWidth: 0 });

/**
 * 工具、服务与后台任务的页面骨架（产品设计 §2 用户修订）：左边是这一入口的侧栏，右边内容最宽 1040、
 * 内边距 40，内容区窄于 600 时收到 24。
 */
export function UtilityPage({
  kind,
  title,
  actions,
  before,
  children,
}: {
  kind: UtilityKind;
  title?: ReactNode;
  actions?: ReactNode;
  /** 标题上方的一行，比如详情页的返回。 */
  before?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const narrow = useNarrow(ref, 600);
  return (
    <div className={layout}>
      <UtilitySidebar kind={kind} />
      <div ref={ref} className={`${content} bc-scroll`}>
        <div className={inner} style={{ padding: narrow ? 24 : 40 }}>
          {before}
          {title || actions ? (
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
