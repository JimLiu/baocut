import type { ReactNode } from 'react';
import type { Id } from '@baocut/protocol';
import { Content, Heading, InlineAlert, Link, ToastQueue } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { ExportProblem } from '../../model/export-rejection.ts';
import { shortenPath } from '../../model/format.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useExportPlaces } from '../../state/export-store.ts';
import { EXPORT_COPY } from './export-copy.ts';

/**
 * 导出弹层共用的小件（设计稿 ui.css 的 `.cpsec` `.xnote` `.xquick` `.xlanes` `.xlane` `.xsum` `.xacts`），
 * 只用 S2 token。
 */

const sec = style({ margin: 0, marginTop: { default: 16, isFirst: 0 }, marginBottom: 8, font: 'ui-xs', fontWeight: 'bold', color: 'gray-600' });

/** 一节的小标题（`.cpsec`）。 */
export function Sec({ children, first }: { children: ReactNode; first?: boolean }) {
  return <h3 className={sec({ isFirst: !!first })}>{children}</h3>;
}

const note = style({ marginTop: 8, font: 'ui-xs', color: { default: 'gray-600', isWarn: 'orange-1000' }, minWidth: 0, overflowWrap: 'anywhere' });
const noteRow = style({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 8, font: 'ui-xs', color: 'gray-600', minWidth: 0 });
const noteLinks = style({ display: 'flex', gap: 8, flexShrink: 0 });

/** 小字说明（`.xnote`）。 */
export function Note({ children, warn }: { children: ReactNode; warn?: boolean }) {
  return <div className={note({ isWarn: !!warn })}>{children}</div>;
}

/** 左边一句、右边几个链接（`.xnote--row`）。 */
export function NoteRow({ children, links }: { children: ReactNode; links: ReactNode }) {
  return (
    <div className={noteRow}>
      <span>{children}</span>
      <span className={noteLinks}>{links}</span>
    </div>
  );
}

/** 小字里的动作（`.xlink`）。 */
export function TextLink({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Link isStandalone isQuiet onPress={onPress}>
      {children}
    </Link>
  );
}

const quick = style({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 16, rowGap: 8, minWidth: 0 });
const quickField = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const quickLabel = style({ flexShrink: 0, font: 'ui-sm', color: 'gray-700' });

/** 一排快捷设置（`.xquick`）。 */
export function Quick({ children }: { children: ReactNode }) {
  return <div className={quick}>{children}</div>;
}

/** 快捷设置的一项：左边名字，右边控件（`.xquick__f`）。 */
export function QuickField({ label, children, id }: { label: string; children: ReactNode; id?: string }) {
  return (
    <div className={quickField}>
      <span className={quickLabel} id={id}>
        {label}
      </span>
      {children}
    </div>
  );
}

const lanes = style({ display: 'flex', flexDirection: 'column', borderRadius: 'lg', borderWidth: 1, borderStyle: 'solid', borderColor: 'gray-200', overflow: 'hidden' });
const lane = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 40,
  boxSizing: 'border-box',
  paddingY: 4,
  paddingStart: 8,
  paddingEnd: 8,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderTopWidth: 0,
  borderStartWidth: 0,
  borderEndWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const laneIcon = style({ display: 'flex', flexShrink: 0, color: { default: 'gray-600', isOff: 'gray-400' } });
const laneText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const laneName = style({ font: 'ui-sm', fontWeight: 'medium', color: { default: 'gray-900', isOff: 'gray-600' }, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
const laneSub = style({ font: 'ui-xs', color: { default: 'gray-600', isOff: 'gray-500' }, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
const laneEnd = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, font: 'code-xs', color: 'gray-600' });

/** 一张开关清单（`.xlanes`）。 */
export function Lanes({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className={lanes} role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** 清单的一行（`.xlane`）：图标、名字与说明、右边的控件；关着的整行变淡。 */
export function Lane({ icon, name, sub, off, end, start }: { icon?: ReactNode; name: ReactNode; sub?: ReactNode; off?: boolean; end?: ReactNode; start?: ReactNode }) {
  return (
    <div className={lane}>
      {start}
      {icon ? <span className={laneIcon({ isOff: !!off })}>{icon}</span> : null}
      <div className={laneText}>
        <span className={laneName({ isOff: !!off })}>{name}</span>
        {sub ? <span className={laneSub({ isOff: !!off })}>{sub}</span> : null}
      </div>
      {end ? <span className={laneEnd}>{end}</span> : null}
    </div>
  );
}

const summary = style({ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 12, paddingX: 12, paddingY: 8, borderRadius: 'lg', backgroundColor: 'gray-75' });
const sumRow = style({ display: 'flex', alignItems: 'baseline', gap: 8, font: 'ui-sm', minWidth: 0 });
const sumLabel = style({ flexShrink: 0, width: 40, color: 'gray-600' });
const sumValue = style({ flexGrow: 1, minWidth: 0, fontWeight: 'medium', color: 'gray-900', overflowWrap: 'anywhere' });
const sumMono = style({ flexGrow: 1, minWidth: 0, font: 'code-sm', color: 'gray-900', overflowWrap: 'anywhere' });

/** 摘要（`.xsum`）。 */
export function Summary({ children }: { children: ReactNode }) {
  return <div className={summary}>{children}</div>;
}

export function SumRow({ label, children, mono, end }: { label: string; children: ReactNode; mono?: boolean; end?: ReactNode }) {
  return (
    <div className={sumRow}>
      <span className={sumLabel}>{label}</span>
      <span className={mono ? sumMono : sumValue}>{children}</span>
      {end}
    </div>
  );
}

/** 文件名几行：多于 4 个时只列前 4 个（设计稿 export-audio.jsx）。 */
export function FileRows({ names }: { names: readonly string[] }) {
  return (
    <>
      {names.slice(0, 4).map((n) => (
        <SumRow key={n} label={EXPORT_COPY.file} mono>
          {n}
        </SumRow>
      ))}
      {names.length > 4 ? <SumRow label={EXPORT_COPY.more}>{EXPORT_COPY.moreFiles(names.length - 4)}</SumRow> : null}
    </>
  );
}

/** 位置：默认由 Runtime 决定（项目下的 exports/）；可以挑一个目录，挑过的按视频记着（`useExportPlaces`）。 */
export function PlaceRow({ videoId }: { videoId: Id }) {
  const dir = useExportPlaces((s) => s.dirs[videoId] ?? null);
  const setDir = useExportPlaces((s) => s.setDir);
  const pickDir = usePickDir();
  return (
    <SumRow
      label={EXPORT_COPY.place}
      mono={!!dir}
      end={
        <span className={noteLinks}>
          <TextLink
            onPress={async () => {
              const next = await pickDir();
              if (next) setDir(videoId, next);
            }}>
            {EXPORT_COPY.pickPlace}
          </TextLink>
          {dir ? <TextLink onPress={() => setDir(videoId, null)}>{EXPORT_COPY.resetPlace}</TextLink> : null}
        </span>
      }>
      {dir ? shortenPath(dir) : EXPORT_COPY.defaultPlace}
    </SumRow>
  );
}

/** 挑一个目录（宿主的目录对话框）；取消时 null。 */
export function usePickDir(): () => Promise<string | null> {
  const runtime = useRuntime();
  return () =>
    runtime.host.pickDirectory().catch((e: Error) => {
      ToastQueue.negative(EXPORT_COPY.pickFailed(e.message), { timeout: 5000 });
      return null;
    });
}

const acts = style({ display: 'flex', justifyContent: 'end', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 16 });
const actsBetween = style({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 16 });

/** 底部按钮（`.xacts`）。 */
export function Actions({ children, between }: { children: ReactNode; between?: boolean }) {
  return <div className={between ? actsBetween : acts}>{children}</div>;
}

const problemWrap = style({ marginTop: 12 });
const problemList = style({ margin: 0, marginTop: 4, paddingStart: 16, font: 'ui-sm', overflowWrap: 'anywhere' });
const problemHint = style({ marginTop: 4, font: 'ui-sm' });
const problemActs = style({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 });

/** 被拒或失败：标题、Runtime 原话、逐项清单、补救说明，以及界面能直接做的那一步。 */
export function ProblemAlert({ problem, actions }: { problem: ExportProblem; actions?: ReactNode }) {
  return (
    <div className={problemWrap}>
      <InlineAlert variant="negative">
        <Heading>{problem.title}</Heading>
        <Content>
          {problem.message ? <div>{problem.message}</div> : null}
          {problem.items.length ? (
            <ul className={problemList}>
              {problem.items.slice(0, 8).map((item, i) => (
                <li key={`${i}:${item}`}>{item}</li>
              ))}
              {problem.items.length > 8 ? <li>{EXPORT_COPY.moreItems(problem.items.length - 8)}</li> : null}
            </ul>
          ) : null}
          {problem.hint ? <div className={problemHint}>{problem.hint}</div> : null}
          {actions ? <div className={problemActs}>{actions}</div> : null}
        </Content>
      </InlineAlert>
    </div>
  );
}
