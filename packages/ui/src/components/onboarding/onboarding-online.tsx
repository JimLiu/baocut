import type { KeyboardEvent, MouseEvent } from 'react';
import { Badge, Link, Radio, RadioGroup, SegmentedControl, SegmentedControlItem, ToastQueue } from '@react-spectrum/s2';
import CheckmarkCircle from '@react-spectrum/s2/icons/CheckmarkCircle';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { TextContext } from 'react-aria-components';
import { hostOf, type ApiProvider } from '../../model/api-providers.ts';
import { onlineLine, type OnlineChoice, type StepMode } from '../../model/onboarding.ts';
import { M } from '../../model/onboarding-copy.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { AddAccountForm } from '../models/provider-detail.tsx';
import { ProviderIcon } from '../models/provider-parts.tsx';
import { PROVIDER_STATE_COPY, providerTag } from '../models/providers-copy.ts';
import { card, cardBody, cardCell, cardDesc, cardHead, cardName, cards, grow, hint, installed, note } from './onboarding-styles.ts';

const modeRow = style({ marginTop: 12 });
const provForm = style({ display: 'flex', flexDirection: 'column', cursor: 'default' });
const siteLine = style({ marginTop: 8, marginBottom: 0, font: 'ui-sm', color: 'gray-700', overflowWrap: 'anywhere' });

export type OnlineStep = keyof typeof M.online.hint;

/** 「本机模型 | 在线服务」：只在这一步两面都有时出现。 */
export function ModeSwitch({ mode, onChange }: { mode: StepMode; onChange: (mode: StepMode) => void }) {
  return (
    <div className={modeRow}>
      <SegmentedControl aria-label={M.online.switchLabel} selectedKey={mode} onSelectionChange={(k) => onChange(k === 'online' ? 'online' : 'local')}>
        <SegmentedControlItem id="local">{M.online.local}</SegmentedControlItem>
        <SegmentedControlItem id="online">{M.online.online}</SegmentedControlItem>
      </SegmentedControl>
    </div>
  );
}

/**
 * 首次启动引导的「在线服务」一面（GitHub issue 100；原型 onboarding-online.jsx）：语音识别、语音合成、图像生成三步有。
 * 单选卡片列出有这种能力的 API 提供方，连着的在前（候选与主按钮在 model/onboarding.ts）。选中一家还没连的，卡片里展开
 * 设置 › API 提供方 同一个「添加账号」表单（不要名称）；验证通过才存，存好再启用这家，设置页立刻看得到。
 * `only`：这台电脑跑不了本机的这类模型、没有切换时为真，开头多一句说明。
 */
export function OnlineFace({
  step,
  choices,
  pick,
  only,
  onPick,
}: {
  step: OnlineStep;
  choices: readonly OnlineChoice[];
  pick: string | null;
  only: boolean;
  onPick: (providerId: string) => void;
}) {
  const runtime = useRuntime();
  // 添加账号不改 Provider 的开关；没启用的这里启用（验证没过时什么都没存，不会留下一家空启用的）。
  const connected = async (provider: ApiProvider) => {
    if (provider.config?.enabled) return;
    try {
      await runtime.configureModelProvider({ providerId: provider.providerId, enabled: true });
    } catch (error) {
      ToastQueue.negative(M.online.enableFailed((error as Error).message), { timeout: 5000 });
    }
  };
  return (
    <>
      <p className={hint}>{only ? M.online.onlyOnline(M.online.hint[step]) : M.online.hint[step]}</p>
      <RadioGroup aria-label={M.online.listLabel} value={pick} onChange={onPick}>
        <div className={cards}>
          {choices.map((c) => (
            <ProviderCard
              key={c.provider.providerId}
              choice={c}
              on={pick === c.provider.providerId}
              onPick={onPick}
              onSaved={() => void connected(c.provider)}
            />
          ))}
        </div>
      </RadioGroup>
      <p className={note}>{M.online.note}</p>
    </>
  );
}

/** 一家 API 提供方：右边连着的写「已连接」，下面一句写默认用哪只模型或这把密钥还能用在哪；选中而没连时展开添加账号。 */
function ProviderCard({ choice, on, onPick, onSaved }: { choice: OnlineChoice; on: boolean; onPick: (id: string) => void; onSaved: () => void }) {
  const { provider, ready } = choice;
  const tag = providerTag(provider.kind);
  const site = provider.vendor.website;
  // 点在单选框自己的 label 上交给它；已选中时点卡片（包括里面的表单）不做事。
  const click = (e: MouseEvent<HTMLDivElement>) => {
    if (!on && !(e.target as Element).closest('label')) onPick(provider.providerId);
  };
  // 单选组拿方向键切换选项：表单里的方向键留给输入框（Esc 照常冒上去退出引导）。
  const keepArrows = (e: KeyboardEvent<HTMLDivElement>) => {
    if (/^Arrow/.test(e.key)) e.stopPropagation();
  };
  return (
    <div className={card({ isOn: on })} onClick={click}>
      <span className={cardCell({})}>
        <Radio value={provider.providerId} aria-label={provider.label} />
      </span>
      <span className={cardCell({ isIcon: true })}>
        <ProviderIcon provider={provider} />
      </span>
      <div className={cardBody}>
        <div className={cardHead}>
          <span className={cardName}>{provider.label}</span>
          {tag ? (
            <Badge variant="neutral" size="S" fillStyle="subtle">
              {tag}
            </Badge>
          ) : null}
          <span className={grow} />
          {ready ? (
            <span className={installed}>
              <CheckmarkCircle />
              {PROVIDER_STATE_COPY.ok}
            </span>
          ) : null}
        </div>
        <span className={cardDesc({})}>{onlineLine(choice)}</span>
        {on && !ready ? (
          <div className={provForm} onKeyDown={keepArrows}>
            {/* 单选组给后代带插槽的 TextContext，表单里不带插槽的文字会因此报错，这里清掉。 */}
            <TextContext.Provider value={null}>
              {site ? <SiteLine site={site} /> : null}
              <AddAccountForm compact provider={provider} onSaved={onSaved} />
            </TextContext.Provider>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 「还没有密钥？到 <网站> 创建一把」：网站名按语言放在句中，点了用系统浏览器打开。 */
function SiteLine({ site }: { site: string }) {
  const runtime = useRuntime();
  const host = hostOf(site);
  const text = M.online.noKey(host);
  const at = text.indexOf(host);
  const open = () => {
    const external = runtime.host.openExternal;
    if (external) void external(site).catch((err: Error) => ToastQueue.negative(err.message, { timeout: 5000 }));
    else window.open(site, '_blank', 'noopener,noreferrer');
  };
  if (at < 0) return <p className={siteLine}>{text}</p>;
  return (
    <p className={siteLine}>
      {text.slice(0, at)}
      <Link variant="secondary" onPress={open}>
        {host}
      </Link>
      {text.slice(at + host.length)}
    </p>
  );
}
