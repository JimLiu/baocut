import { useEffect, useState } from 'react';
import { USAGE_PERIODS, type UsagePeriod, type UsageReport, type UsageRow, type UsageUnits } from '@baocut/protocol';
import { ActionButton, SegmentedControl, SegmentedControlItem, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import CloseIcon from '@react-spectrum/s2/icons/Close';
import { Focusable } from 'react-aria-components';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { findApiProvider, PROVIDER_CAPABILITIES } from '../../model/api-providers.ts';
import { formatDuration } from '../../model/format.ts';
import { CAPABILITY_SHORT } from '../../model/models-cloud.ts';
import { formatCount, formatMoney, sharePercent, shareWidth, tokenTotal } from '../../model/usage-format.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { EmptyCard, PageStatus } from './model-parts.tsx';
import { MODELS_PAGE_COPY } from './models-copy.ts';
import { USAGE_COPY } from './providers-copy.ts';

/*
 * 设置 › 模型 › 用量（产品设计 §7.6；设计稿 settings-usage.jsx）：时段、花费（按标价估算 / 提供方报告 / 未知分开，币种分开
 * 不换算）、统计格、按天的柱状图（按能力分色堆叠）、按 API 提供方 / 能力 / 模型 / 账号拆分。只统计 API 提供方与智能体的
 * 调用，本机模型不计费、不进用量（`models.usage`，架构设计 §6.10）。路由带 `providerId` 时只看这一家。
 * 设计稿顶上的「余额」（P1，演示数据）不做。`models.usage` 在 Web 白名单里，浏览器里照样能看。
 */

type Split = 'byProvider' | 'byCapability' | 'byModel' | 'byAccount';
const SPLITS: readonly Split[] = ['byProvider', 'byCapability', 'byModel', 'byAccount'];

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

const pageWrap = style({ display: 'flex', flexDirection: 'column', minWidth: 0 });
const head = style({
  display: 'flex',
  flexDirection: { default: 'row', '@container (max-width: 560px)': 'column' },
  alignItems: 'start',
  gap: 16,
  marginBottom: 16,
});
const headText = style({ flexGrow: 1, minWidth: 0 });
const title = style({ marginTop: 0, marginBottom: 8, fontSize: '[22px]', fontWeight: 'bold', lineHeight: '[28px]', color: 'gray-900' });
const lede = style({ margin: 0, font: 'ui', color: 'gray-600' });
const pills = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: { default: 'end', '@container (max-width: 560px)': 'start' },
  gap: 8,
  flexShrink: 0,
});
const pill = style({
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 24,
  paddingX: 12,
  borderRadius: 'full',
  backgroundColor: 'gray-100',
  font: 'ui-xs',
  fontWeight: 'medium',
  color: 'gray-900',
  fontVariantNumeric: 'tabular-nums',
  borderWidth: 0,
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const toolbar = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 });
const tiles = style({
  display: 'grid',
  gridTemplateColumns: { default: 'repeat(5, minmax(0, 1fr))', '@container (max-width: 560px)': 'repeat(2, minmax(0, 1fr))' },
  gap: 8,
  marginBottom: 24,
});
const tile = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
  paddingX: 16,
  paddingY: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
});
const tileValue = style({ fontSize: '[18px]', fontWeight: 'bold', color: 'gray-900', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' });
const small = style({ margin: 0, font: 'ui-xs', color: 'gray-600', overflowWrap: 'anywhere' });
const group = style({ marginBottom: 24 });
const groupHead = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 12 });
const groupTitle = style({ flexGrow: 1, margin: 0, font: 'title-sm', color: 'gray-900' });
const card = style({
  paddingX: 16,
  paddingY: 12,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
  minWidth: 0,
});
const chart = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const bars = style({ display: 'flex', alignItems: 'end', gap: { default: 4, isDense: 2 }, height: 160 });
const bar = style({ flexGrow: 1, flexBasis: 0, minWidth: 0, height: 'full', display: 'flex', alignItems: 'end' });
const stack = style({ width: 'full', minHeight: 2, display: 'flex', flexDirection: 'column-reverse', borderRadius: 'sm', overflow: 'hidden' });
const SEG_COLORS = {
  generateText: 'blue-800',
  transcribe: 'seafoam-700',
  synthesizeSpeech: 'purple-700',
  generateImage: 'orange-600',
  other: 'gray-500',
} as const;
type SegKey = keyof typeof SEG_COLORS;
const seg = style({
  display: 'block',
  flexBasis: 0,
  minHeight: 1,
  backgroundColor: { cap: SEG_COLORS },
});
const swatch = style({
  display: 'inline-block',
  flexShrink: 0,
  size: 8,
  borderRadius: 'sm',
  backgroundColor: { cap: SEG_COLORS },
});
const axis = style({ display: 'flex', justifyContent: 'space-between', font: 'ui-xs', color: 'gray-600' });
const legend = style({ display: 'flex', flexWrap: 'wrap', columnGap: 16, rowGap: 4, font: 'ui-xs', color: 'gray-600' });
const legendItem = style({ display: 'inline-flex', alignItems: 'center', gap: 4 });
const table = style({ display: 'flex', flexDirection: 'column' });
const row = style({
  display: 'grid',
  gridTemplateColumns: {
    default: 'minmax(0, 2fr) 96px minmax(0, 1fr) minmax(0, 1.6fr) minmax(0, 1.6fr)',
    '@container (max-width: 560px)': 'minmax(0, 1fr) auto',
  },
  alignItems: 'center',
  columnGap: 12,
  rowGap: 4,
  minHeight: { default: 40, isHead: 28 },
  paddingY: 4,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
  borderStyle: 'solid',
  borderColor: 'gray-100',
  font: { default: 'ui-sm', isHead: 'ui-xs' },
  color: { default: 'gray-700', isHead: 'gray-600' },
});
const wideOnly = style({ display: { default: 'block', '@container (max-width: 560px)': 'none' } });
const costCell = style({
  gridColumn: { default: 'auto', '@container (max-width: 560px)': '1 / -1' },
  color: { default: 'gray-700', isUnknown: 'orange-900' },
  overflowWrap: 'anywhere',
});
const nameCell = style({ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 });
const nameText = style({ font: 'ui-sm', fontWeight: 'medium', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const nameLink = style({
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'ui-sm',
  fontWeight: 'medium',
  color: { default: 'accent', ':hover': 'accent-1000' },
  textAlign: 'start',
  cursor: 'pointer',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  borderRadius: 'sm',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
});
const share = style({ display: 'block', height: 6, borderRadius: 'full', backgroundColor: 'gray-100', overflow: 'hidden' });
const shareFill = style({ display: 'block', height: 'full', backgroundColor: 'blue-800' });
const note = style({ marginTop: 8, marginBottom: 0, font: 'ui-xs', color: 'gray-600' });
const errorText = style({ margin: 0, paddingY: 24, font: 'ui-sm', color: 'negative' });

const segKey = (capability: string): SegKey => (capability in SEG_COLORS ? (capability as SegKey) : 'other');
const capabilityName = (capability: string, fallback: string) => (CAPABILITY_SHORT as Record<string, string>)[capability] ?? fallback;

/** 一行的用量：token、音频、字符、图片里有的那几项。 */
function unitsText(units: UsageUnits): string {
  const copy = USAGE_COPY;
  const parts: string[] = [];
  if (tokenTotal(units)) parts.push(copy.tokens(formatCount(units.inputTokens), formatCount(units.outputTokens)));
  if (units.audioSeconds) parts.push(formatDuration(units.audioSeconds * 1000));
  if (units.chars) parts.push(copy.chars(formatCount(units.chars)));
  if (units.images) parts.push(copy.images(units.images));
  return parts.join(' · ') || '—';
}

/** 一行的花费：按 `costKind` 写报告 / 估算 / 两者都有 / 未知。 */
function costText(r: UsageRow): string {
  const copy = USAGE_COPY.cost;
  const money = formatMoney(r.cost);
  if (r.costKind === 'unknown' || !money) return copy.unknown;
  if (r.costKind === 'reported') return copy.reported(money);
  if (r.costKind === 'mixed') return copy.mixed(money);
  return copy.estimated(money);
}

/** 设置 › 模型 › 用量；`providerId` 有值时只看这一家。 */
export function UsagePage({ providerId }: { providerId?: string }) {
  const runtime = useRuntime();
  const connected = useConnection((s) => s.state.status === 'connected');
  const view = useModels((s) => s.capabilities);
  const replace = useShell((s) => s.replace);
  const [period, setPeriod] = useState<UsagePeriod>('30d');
  const [split, setSplit] = useState<Split>('byProvider');
  const [report, setReport] = useState<UsageReport | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const copy = USAGE_COPY;

  useEffect(() => {
    if (!connected) return;
    let live = true;
    setFailure(null);
    runtime.modelUsage({ period, ...(providerId ? { providerId } : {}) }).then(
      (next) => {
        if (live) setReport(next);
      },
      (err) => {
        if (live) setFailure(message(err));
      },
    );
    return () => {
      live = false;
    };
  }, [runtime, connected, period, providerId]);

  // 只看一家时的名字：已经移除的照样能看（用量记录保留），名字从用量行里找，最后用 ID。
  const filterName = providerId
    ? ((view ? findApiProvider(view, providerId)?.label : undefined) ?? report?.byProvider.find((r) => r.key === providerId)?.label ?? providerId)
    : null;
  const totals = report?.totals;
  const estimated = totals ? formatMoney(totals.cost.estimated) : '';
  const reported = totals ? formatMoney(totals.cost.reported) : '';

  let body;
  if (!connected) body = <PageStatus>{MODELS_PAGE_COPY.offline}</PageStatus>;
  else if (failure) body = <p className={errorText} role="alert">{copy.loadFailed(failure)}</p>;
  else if (!report || !totals) body = <PageStatus>{copy.loading}</PageStatus>;
  else if (!totals.calls) body = <EmptyCard title={copy.emptyTitle} body={filterName ? copy.emptyOne(filterName) : copy.emptyAll} />;
  else {
    const rows = report[split];
    const top = Math.max(1, ...rows.map((r) => r.calls));
    body = (
      <>
        <div className={tiles}>
          <Tile label={copy.tile.calls} value={copy.calls(totals.calls)} sub={totals.failed ? copy.failed(totals.failed) : copy.noFailures} />
          <Tile
            label={copy.tile.tokens}
            value={formatCount(tokenTotal(totals.units))}
            sub={copy.tokens(formatCount(totals.units.inputTokens), formatCount(totals.units.outputTokens))}
          />
          <Tile label={copy.tile.audio} value={formatDuration((totals.units.audioSeconds ?? 0) * 1000)} sub={CAPABILITY_SHORT.transcribe} />
          <Tile label={copy.tile.chars} value={formatCount(totals.units.chars)} sub={CAPABILITY_SHORT.synthesizeSpeech} />
          <Tile label={copy.tile.images} value={copy.images(totals.units.images ?? 0)} sub={CAPABILITY_SHORT.generateImage} />
        </div>
        <section className={group} aria-label={copy.byDay}>
          <div className={groupHead}>
            <h2 className={groupTitle}>{copy.byDay}</h2>
          </div>
          <div className={card}>
            <Bars days={report.byDay} total={totals.calls} />
          </div>
        </section>
        <section className={group} aria-label={copy.split}>
          <div className={groupHead}>
            <h2 className={groupTitle}>{copy.split}</h2>
            <SegmentedControl aria-label={copy.split} selectedKey={split} onSelectionChange={(k) => setSplit(k as Split)}>
              {SPLITS.map((k) => (
                <SegmentedControlItem key={k} id={k}>
                  {copy.splits[k]}
                </SegmentedControlItem>
              ))}
            </SegmentedControl>
          </div>
          <div className={card} role="table" aria-label={copy.splits[split]}>
            <div className={table}>
              <div className={row({ isHead: true })} role="row">
                <span role="columnheader">{copy.columns.name}</span>
                <span role="columnheader">{copy.columns.calls}</span>
                <span role="columnheader" className={wideOnly}>
                  {copy.columns.share}
                </span>
                <span role="columnheader" className={wideOnly}>
                  {copy.columns.units}
                </span>
                <span role="columnheader" className={costCell({ isUnknown: false })}>
                  {copy.columns.cost}
                </span>
              </div>
              {rows.map((r) => (
                <div className={row({ isHead: false })} role="row" key={r.key}>
                  <span role="cell" className={nameCell}>
                    {split === 'byCapability' ? <span className={swatch({ cap: segKey(r.key) })} aria-hidden /> : null}
                    {split === 'byProvider' && !r.key.startsWith('agent:') && r.key !== providerId ? (
                      <button type="button" className={nameLink} onClick={() => replace({ tab: 'settings', section: 'usage', providerId: r.key })}>
                        {r.label}
                      </button>
                    ) : (
                      <span className={nameText}>{split === 'byCapability' ? capabilityName(r.key, r.label) : r.label}</span>
                    )}
                    {split === 'byModel' && r.providerId ? <span className={small}>{report.byProvider.find((p) => p.key === r.providerId)?.label ?? r.providerId}</span> : null}
                  </span>
                  <span role="cell">{copy.rowCalls(r.calls, r.failed)}</span>
                  <span role="cell" className={wideOnly} aria-label={`${sharePercent(r.calls, totals.calls)}%`}>
                    <span className={share}>
                      <span className={shareFill} style={{ width: `${shareWidth(r.calls, top)}%` }} />
                    </span>
                  </span>
                  <span role="cell" className={wideOnly}>
                    {unitsText(r.units)}
                  </span>
                  <span role="cell" className={costCell({ isUnknown: r.costKind === 'unknown' })}>
                    {costText(r)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <p className={note}>{copy.note}</p>
        </section>
      </>
    );
  }

  return (
    <div className={pageWrap}>
      <header className={head}>
        <span className={headText}>
          <h1 className={title}>{copy.title}</h1>
          <p className={lede}>{copy.intro}</p>
        </span>
        {totals && (estimated || reported) ? (
          <span className={pills}>
            {estimated ? (
              <TooltipTrigger placement="bottom" delay={300}>
                <Focusable>
                  <span className={pill} tabIndex={0} role="note">
                    {copy.estimated(estimated) + (totals.cost.unknownCalls ? copy.estimatedUnknown(totals.cost.unknownCalls) : '')}
                  </span>
                </Focusable>
                <Tooltip>{copy.estimatedTip(totals.cost.unknownCalls)}</Tooltip>
              </TooltipTrigger>
            ) : null}
            {reported ? <span className={pill}>{copy.reported(reported)}</span> : null}
          </span>
        ) : null}
      </header>
      <div className={toolbar}>
        <SegmentedControl aria-label={copy.period} selectedKey={period} onSelectionChange={(k) => setPeriod(k as UsagePeriod)}>
          {USAGE_PERIODS.map((p) => (
            <SegmentedControlItem key={p} id={p}>
              {copy.periods[p]}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        {filterName ? (
          <ActionButton size="S" aria-label={copy.showAll} onPress={() => replace({ tab: 'settings', section: 'usage' })}>
            <Text>{copy.only(filterName)}</Text>
            <CloseIcon />
          </ActionButton>
        ) : null}
      </div>
      {body}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className={tile}>
      <span className={small}>{label}</span>
      <span className={tileValue}>{value}</span>
      {sub ? <span className={small}>{sub}</span> : null}
    </div>
  );
}

function Bars({ days, total }: { days: UsageReport['byDay']; total: number }) {
  const copy = USAGE_COPY;
  const max = Math.max(1, ...days.map((d) => d.calls));
  const first = days[0];
  const last = days.length > 1 ? days[days.length - 1] : undefined;
  return (
    <div className={chart} role="img" aria-label={copy.chart(total)}>
      <div className={bars({ isDense: days.length > 14 })}>
        {days.map((d) => (
          <div className={bar} key={d.day} title={copy.dayTip(d.day, d.calls)}>
            <div className={stack} style={{ height: `${(d.calls / max) * 100}%` }}>
              {(Object.keys(d.byCapability) as string[])
                .sort((a, b) => order(a) - order(b))
                .filter((c) => (d.byCapability as Record<string, number | undefined>)[c])
                .map((c) => (
                  <span key={c} className={seg({ cap: segKey(c) })} style={{ flexGrow: (d.byCapability as Record<string, number>)[c] }} />
                ))}
            </div>
          </div>
        ))}
      </div>
      <div className={axis}>
        <span>{first ? first.day.slice(5) : ''}</span>
        <span>{last ? last.day.slice(5) : ''}</span>
      </div>
      <div className={legend}>
        {PROVIDER_CAPABILITIES.map((c) => (
          <span key={c} className={legendItem}>
            <span className={swatch({ cap: c })} aria-hidden />
            {CAPABILITY_SHORT[c]}
          </span>
        ))}
      </div>
    </div>
  );
}

const order = (capability: string) => {
  const at = (PROVIDER_CAPABILITIES as readonly string[]).indexOf(capability);
  return at < 0 ? 99 : at;
};
