import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import DeviceLaptop from '@react-spectrum/s2/icons/DeviceLaptop';
import Lock from '@react-spectrum/s2/icons/Lock';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { AgentAdvanced } from './agent-advanced.tsx';
import { AGENT_COPY, AGENT_FACTS } from './agent-copy.ts';
import { AgentProviders } from './agent-providers.tsx';

const FACT_ICON = { cli: DeviceLaptop, plan: CheckmarkCircle, ask: Lock } as const;

// 这一节自己画标题（设计稿 h1.t-heading-sm：20px、800），下面紧跟一句说明（.agset-lede：上 8、14px）。
const heading = style({ margin: 0, fontSize: '[20px]', fontWeight: 'extra-bold', lineHeight: '[26px]', color: 'gray-900' });
const lede = style({ marginTop: 8, marginBottom: 0, font: 'body-sm', color: 'gray-700' });
/** 三条事实是灰底小卡片，一行三张，窄了一张一行（设计稿 settings-agent.css `.agset-facts`）；提供方内容离它 24。 */
const facts = style({
  display: 'grid',
  gridTemplateColumns: { default: ['minmax(0, 1fr)'], lg: ['minmax(0, 1fr)', 'minmax(0, 1fr)', 'minmax(0, 1fr)'] },
  gap: 8,
  marginTop: 16,
  marginBottom: 24,
  paddingStart: 0,
  listStyleType: 'none',
});
const fact = style({ display: 'flex', alignItems: 'start', gap: 8, padding: 12, borderRadius: 'default', backgroundColor: 'gray-75' });
const factIcon = style({
  display: 'flex',
  flexShrink: 0,
  paddingTop: 2,
  color: 'gray-700',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const factIconSize = iconStyle({ size: 'S' });
const factTitle = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const factBody = style({ marginTop: 4, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });
const tail = style({ paddingBottom: 32 });

/**
 * 设置 › Agent 提供方（设计稿 page-settings-agent.jsx 的 AgentSection）：一句话说清 Agent 是什么、三条事实，
 * 然后是提供方内容，页底接「高级与排障」。不再分页签；Skills 与 Agent 权限各在自己的页（设置 › Skills、设置 › 隐私与权限）。
 */
export function AgentSettings() {
  return (
    <>
      <h1 className={heading}>{AGENT_COPY.pageTitle}</h1>
      <p className={lede}>{AGENT_COPY.lede}</p>
      <ul className={facts} aria-label={AGENT_COPY.factsLabel}>
        {AGENT_FACTS.map((item) => {
          const Icon = FACT_ICON[item.key];
          return (
            <li key={item.key} className={fact}>
              <span className={factIcon} aria-hidden>
                <Icon styles={factIconSize} />
              </span>
              <div>
                <div className={factTitle}>{item.title}</div>
                <p className={factBody}>{item.body}</p>
              </div>
            </li>
          );
        })}
      </ul>
      <AgentProviders />
      <div className={tail}>
        <AgentAdvanced />
      </div>
    </>
  );
}
