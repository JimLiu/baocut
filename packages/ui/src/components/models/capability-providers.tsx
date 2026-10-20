import { useState } from 'react';
import type { ModelCapabilitiesView, ModelInfoBase, OnlineCapability } from '@baocut/protocol';
import { ActionButton, Badge, Button, SearchField, Text } from '@react-spectrum/s2';
import AddIcon from '@react-spectrum/s2/icons/Add';
import ChevronDownIcon from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRightIcon from '@react-spectrum/s2/icons/ChevronRight';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { capabilityGroups, type CapabilityGroup } from '../../model/api-providers.ts';
import { probeSupported, probeVerdict } from '../../model/models-probe.ts';
import { providerCanClone } from '../../model/voice-capture.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { CODEX_IMAGE_PROVIDER } from '../settings/codex-image.ts';
import { useConfigureProvider } from './api-providers-page.tsx';
import { CodexImageCard, useCodexImage } from './codex-image-card.tsx';
import { ModelVoicesLine } from './model-voices-line.tsx';
import { CLOUD_COPY } from './models-copy.ts';
import { ProbeDialog } from './probe-dialog.tsx';
import { accountSummary, modelLeadText, ProviderIcon, stateLabel, useProbeRuns, type ProbeTarget } from './provider-parts.tsx';
import { CAP_PROVIDERS_COPY, PROVIDER_DETAIL_COPY, PROVIDERS_COPY, providerTag } from './providers-copy.ts';

/*
 * 能力页第 ④ 节「API 提供方」（产品设计 §7.6；设计稿 settings-capability.jsx `ProviderModels`）：目录里有这种能力的全部
 * 提供方（含没添加的与自建端点），一家一组、带图标；顶上始终有搜索框。组可折叠：能用的默认展开、其余收起，有查询词时命中的
 * 展开；手动翻过的组在换查询词时回到默认。能用的组每行可以测试、标出默认；没连上的组头给「配置」（与添加 sheet 选卡同一路径），
 * 展开后只读列模型。末尾一行去 API 提供方页添加 OpenAI 兼容端点（`from=custom`）。图像生成在最后多一张 Codex 画图。
 */

const section = style({ marginTop: 32 });
const head = style({ display: 'flex', alignItems: 'start', gap: 12, marginBottom: 12 });
const headText = style({ flexGrow: 1, minWidth: 0 });
const headTitle = style({ margin: 0, font: 'title-sm', color: 'gray-900' });
const headDesc = style({ marginTop: 4, marginBottom: 0, font: 'ui-sm', color: 'gray-600' });
const headAction = style({ flexShrink: 0, whiteSpace: 'nowrap' });
const search = style({ marginBottom: 12, width: 'full', maxWidth: 360 });
const card = style({
  marginBottom: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
  minWidth: 0,
  overflow: 'hidden',
});
const grp = style({ borderTopWidth: 0, borderXWidth: 0, borderBottomWidth: 1, borderStyle: 'solid', borderColor: 'gray-100' });
const grpRow = style({ display: 'flex', alignItems: 'center', gap: 8, paddingEnd: 12 });
const toggle = style({
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  flexGrow: 1,
  minWidth: 0,
  paddingStart: 16,
  paddingEnd: 4,
  paddingY: 12,
  borderWidth: 0,
  backgroundColor: { default: 'transparent', ':hover': 'gray-75' },
  textAlign: 'start',
  font: 'ui',
  color: 'gray-900',
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
});
const grpName = style({ fontWeight: 'bold', flexShrink: 0 });
const tag = style({ paddingX: 4, borderRadius: 'sm', backgroundColor: 'gray-100', font: 'ui-xs', color: 'gray-700', flexShrink: 0 });
const meta = style({
  flexGrow: 1,
  minWidth: 0,
  font: { default: 'ui-xs', isMono: 'code-xs' },
  color: { default: 'gray-600', isWarn: 'orange-900' },
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});
const chevron = style({ display: 'flex', flexShrink: 0, color: 'gray-600', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const chevronIcon = iconStyle({ size: 'S' });
const models = style({ marginStart: 48, marginEnd: 16, paddingBottom: 8 });
const modelRow = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  minHeight: 36,
  paddingY: 4,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const modelName = style({ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 8, flexGrow: 1, flexBasis: 0, minWidth: 180 });
const modelId = style({ font: 'code-xs', fontWeight: 'bold', color: 'gray-900', overflowWrap: 'anywhere', userSelect: 'text' });
const modelLead = style({ font: 'ui-xs', color: 'gray-600' });
const verdict = style({
  maxWidth: 260,
  font: 'ui-xs',
  textAlign: 'end',
  overflowWrap: 'anywhere',
  color: { default: 'gray-600', tone: { positive: 'green-900', negative: 'negative', neutral: 'gray-600' } },
});
const none = style({ margin: 0, paddingY: 8, font: 'ui-xs', color: 'gray-600' });
const custom = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: 'full',
  paddingX: 16,
  paddingY: 12,
  borderWidth: 0,
  backgroundColor: { default: 'transparent', ':hover': 'gray-75' },
  textAlign: 'start',
  font: 'ui-sm',
  color: 'gray-700',
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: -2,
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const customStrong = style({ fontWeight: 'bold', color: 'gray-900' });
const empty = style({ display: 'flex', flexDirection: 'column', alignItems: 'start', gap: 8, paddingX: 16, paddingY: 12 });
const emptyText = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });

const domId = (capability: OnlineCapability, providerId: string) => `capm-${capability}-${providerId.replace(/[^a-z0-9-]/gi, '-')}`;

/** 能力页的「API 提供方」一节。 */
export function CapabilityProviders({ view, capability }: { view: ModelCapabilitiesView; capability: OnlineCapability }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const connected = useConnection((s) => s.state.status === 'connected');
  const go = useShell((s) => s.go);
  const configure = useConfigureProvider();
  const codex = useCodexImage(capability === 'generateImage');
  const probes = useProbeRuns();
  const [probe, setProbe] = useState<ProbeTarget | null>(null);
  const [query, setQuery] = useState('');
  // 手动翻过的组；换查询词时清空，回到默认的开合。
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const copy = CAP_PROVIDERS_COPY;

  const groups = capabilityGroups(view, capability, Date.now(), query);
  const defaultRef = view[capability].default;
  const isOpen = (g: CapabilityGroup) => toggled[g.provider.providerId] ?? (query.trim() ? true : g.ready);
  const probeOk = probeSupported(capability);
  const clonable = (providerId: string) =>
    capability === 'synthesizeSpeech' && view.synthesizeSpeech.providers.some((p) => p.providerId === providerId && providerCanClone(p));

  const metaText = (g: CapabilityGroup): { text: string; mono: boolean; warn: boolean } => {
    const n = PROVIDERS_COPY.models(g.models.length);
    if (g.ready) {
      if (g.state.kind === 'warn') return { text: `${copy.primaryWarn(stateLabel(g.state))} · ${n}`, mono: false, warn: true };
      const summary = accountSummary(g.provider);
      return { text: [summary.text, n].filter(Boolean).join(' · '), mono: summary.mono, warn: false };
    }
    return { text: `${stateLabel(g.state)} · ${n}`, mono: false, warn: false };
  };

  const modelLine = (g: CapabilityGroup, model: ModelInfoBase) => {
    const lead = modelLeadText(capability, model);
    if (!g.ready) {
      return (
        <div key={model.modelId} className={modelRow}>
          <span className={modelName}>
            <span className={modelId}>{model.modelId}</span>
            {lead ? <span className={modelLead}>{lead}</span> : null}
          </span>
        </div>
      );
    }
    const result = probeVerdict(probes.state(capability, g.provider.providerId, model.modelId));
    const isDefault = defaultRef?.providerId === g.provider.providerId && defaultRef.modelId === model.modelId;
    return (
      <div key={model.modelId} className={modelRow}>
        <span className={modelName}>
          <span className={modelId}>{model.modelId}</span>
          {lead ? <span className={modelLead}>{lead}</span> : null}
        </span>
        <span className={verdict({ tone: probeOk ? result.tone : 'neutral' })}>{probeOk ? result.text : CLOUD_COPY.probeUnsupported}</span>
        {isDefault ? (
          <Badge variant="accent" size="S" fillStyle="subtle">
            {CLOUD_COPY.defaultChip}
          </Badge>
        ) : null}
        <ActionButton
          isQuiet
          size="S"
          isDisabled={!probeOk || model.available === false}
          onPress={() => setProbe({ capability, providerId: g.provider.providerId, providerLabel: g.provider.label, model })}>
          {PROVIDER_DETAIL_COPY.probe}
        </ActionButton>
      </div>
    );
  };

  const probeState = probe ? probes.state(probe.capability, probe.providerId, probe.model.modelId) : undefined;

  return (
    <section className={section} aria-label={copy.title}>
      <div className={head}>
        <div className={headText}>
          <h2 className={headTitle}>{copy.title}</h2>
          <p className={headDesc}>{copy.desc}</p>
        </div>
        <div className={headAction}>
          <ActionButton isQuiet size="S" onPress={() => go({ tab: 'settings', section: 'providers' })}>
            <Text>{copy.manage}</Text>
            <ChevronRightIcon />
          </ActionButton>
        </div>
      </div>
      <div className={search}>
        <SearchField
          aria-label={copy.search}
          placeholder={copy.search}
          value={query}
          onChange={(next) => {
            setQuery(next);
            setToggled({});
          }}
        />
      </div>
      {groups.length ? (
        <div className={card}>
          {groups.map((g) => {
            const open = isOpen(g);
            const body = domId(capability, g.provider.providerId);
            const m = metaText(g);
            const tagText = providerTag(g.provider.kind);
            const Chevron = open ? ChevronDownIcon : ChevronRightIcon;
            return (
              <div key={g.provider.providerId} className={grp}>
                <div className={grpRow}>
                  <button
                    type="button"
                    className={toggle}
                    aria-expanded={open}
                    aria-controls={open ? body : undefined}
                    aria-label={open ? copy.collapse(g.provider.label) : copy.expand(g.provider.label)}
                    onClick={() => setToggled((old) => ({ ...old, [g.provider.providerId]: !open }))}>
                    <ProviderIcon provider={g.provider} />
                    <span className={grpName}>{g.provider.label}</span>
                    {tagText ? <span className={tag}>{tagText}</span> : null}
                    <span className={meta({ isMono: m.mono, isWarn: m.warn })}>{m.text}</span>
                    <span className={chevron} aria-hidden>
                      <Chevron styles={chevronIcon} />
                    </span>
                  </button>
                  {g.ready ? null : (
                    <Button
                      variant="secondary"
                      size="S"
                      aria-label={copy.configureLabel(g.provider.label)}
                      isDisabled={web || !connected}
                      onPress={() => void configure(g.provider)}>
                      {copy.configure}
                    </Button>
                  )}
                </div>
                {open ? (
                  <div className={models} id={body}>
                    {g.models.length ? g.models.map((model) => modelLine(g, model)) : <p className={none}>{copy.noModels}</p>}
                    {clonable(g.provider.providerId) ? <ModelVoicesLine target={{ kind: 'cloud', id: g.provider.providerId }} name={g.provider.label} /> : null}
                  </div>
                ) : null}
              </div>
            );
          })}
          <button type="button" className={custom} onClick={() => go({ tab: 'settings', section: 'providers', from: 'custom' })}>
            <AddIcon />
            <span>
              {copy.customLead} <span className={customStrong}>{copy.customAction}</span>
            </span>
          </button>
        </div>
      ) : (
        <div className={card}>
          <div className={empty}>
            <p className={emptyText}>{copy.noMatch(query.trim())}</p>
            <Button variant="secondary" size="S" isDisabled={web || !connected} onPress={() => go({ tab: 'settings', section: 'providers', from: 'add' })}>
              <AddIcon />
              <Text>{PROVIDERS_COPY.add}</Text>
            </Button>
          </div>
        </div>
      )}
      {capability === 'generateImage' ? <CodexImageCard codex={codex} isDefault={defaultRef?.providerId === CODEX_IMAGE_PROVIDER} /> : null}
      {probe ? (
        <ProbeDialog
          capability={probe.capability}
          providerLabel={probe.providerLabel}
          model={probe.model}
          state={probeState ?? { status: 'ready' }}
          onStart={(voice) => void probes.start(probe, voice)}
          onClose={() => setProbe(null)}
        />
      ) : null}
    </section>
  );
}
