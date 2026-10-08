import {
  localizeText,
  type ImageModelInfo,
  type ModelInfoBase,
  type ModelRef,
  type OnlineCapability,
  type SpeechModelInfo,
  type TextModelInfo,
} from '@baocut/protocol';
import { ActionButton, Badge, Button, Text, Tooltip, TooltipTrigger } from '@react-spectrum/s2';
import AddIcon from '@react-spectrum/s2/icons/Add';
import ChevronDownIcon from '@react-spectrum/s2/icons/ChevronDown';
import ChevronRightIcon from '@react-spectrum/s2/icons/ChevronRight';
import RefreshIcon from '@react-spectrum/s2/icons/Refresh';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { agoLabel } from '../../model/format.ts';
import { CAPABILITY_SHORT, refreshKind, refreshLine, type CloudProviderCard, type RefreshLine } from '../../model/models-cloud.ts';
import { probeSupported, probeVerdict, type ProbeState } from '../../model/models-probe.ts';
import { textModelLine } from '../../model/models-text.ts';
import { CLOUD_COPY } from './models-copy.ts';

const card = style({
  marginBottom: 8,
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: 'gray-200',
  borderRadius: 'lg',
  backgroundColor: 'layer-1',
  minWidth: 0,
});
const head = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, paddingX: 16, paddingY: 12 });
const title = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  flexGrow: 1,
  flexBasis: 0,
  minWidth: 220,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  textAlign: 'start',
  font: 'ui',
  cursor: { default: 'default', isToggle: 'pointer' },
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  borderRadius: 'sm',
});
const chevron = style({ display: 'flex', flexShrink: 0, width: 16, paddingTop: 2, color: 'gray-600', '--iconPrimary': { type: 'fill', value: 'currentColor' } });
const chevronIcon = iconStyle({ size: 'S' });
const name = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });
const nameText = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const nameDesc = style({ font: 'ui-xs', color: { default: 'gray-600', isNegative: 'red-900' }, overflowWrap: 'anywhere' });
const controls = style({ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 });
const models = style({
  marginStart: 40,
  marginEnd: 16,
  borderTopWidth: 1,
  borderXWidth: 0,
  borderBottomWidth: 0,
  borderStyle: 'solid',
  borderColor: 'gray-100',
});
const modelRow = style({
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  minHeight: 36,
  paddingY: 4,
  borderTopWidth: 0,
  borderXWidth: 0,
  borderBottomWidth: { default: 1, ':last-child': 0 },
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
  color: { default: 'gray-600', tone: { positive: 'green-900', negative: 'red-900', neutral: 'gray-600' } },
});

/** 一只模型名字后面那句：预置音色数、尺寸与张数、上下文与推理强度、Codex 这类的说明。 */
function modelLeadText(capability: OnlineCapability, model: ModelInfoBase): string {
  const parts: string[] = [];
  if (model.label && model.label !== model.modelId) parts.push(model.label);
  if (capability === 'synthesizeSpeech') parts.push(CLOUD_COPY.modelVoices((model as SpeechModelInfo).voices?.length ?? 0));
  if (capability === 'generateImage') {
    const image = model as ImageModelInfo;
    parts.push(CLOUD_COPY.modelSizes(image.sizes ?? [], image.maxCount ?? 1));
  }
  if (capability === 'generateText') parts.push(textModelLine(model as TextModelInfo));
  if (model.available === false && model.detail) parts.push(localizeText(model.detail, model.detailRef));
  return parts.join(' · ');
}

/** 说明行里与刷新有关的那一段。 */
function refreshText(line: RefreshLine): string {
  switch (line.state) {
    case 'refreshing':
      return CLOUD_COPY.refreshing[line.kind];
    case 'failed':
      return line.error ? `${CLOUD_COPY.refreshFailedLine[line.kind]} · ${line.error}` : CLOUD_COPY.refreshFailedLine[line.kind];
    case 'builtin':
      return line.kind === 'models' ? CLOUD_COPY.builtinModels : CLOUD_COPY.builtinVoices(line.models, line.voices);
    case 'fresh': {
      const ago = agoLabel(line.at);
      const text = line.kind === 'models' ? CLOUD_COPY.freshModels(line.models, ago) : CLOUD_COPY.freshVoices(line.models, line.voices, ago);
      return line.unusable ? text + CLOUD_COPY.unusable(line.unusable) : text;
    }
  }
}

/** 卡头的那句说明（设计稿 settings-cloud.jsx:200-219 的 headDesc）；刷新失败时整句标红、不写默认。 */
function headText(
  card: CloudProviderCard,
  capability: OnlineCapability,
  defaultModel: string | null,
  isOpen: boolean,
  refreshing: boolean,
): { text: string; negative: boolean } {
  const first = card.models[0];
  if (!card.connected) {
    if (card.custom && !first) return { text: CLOUD_COPY.headCustomOff, negative: false };
    return { text: first ? CLOUD_COPY.headOff(first.modelId, card.models.length) : CLOUD_COPY.headCustomOff, negative: false };
  }
  if (!first) return { text: CLOUD_COPY.headNoModels(CAPABILITY_SHORT[capability]), negative: false };
  const line = refreshLine(card, capability, refreshing);
  if (line?.state === 'refreshing') return { text: refreshText(line), negative: false };
  let text = line ? refreshText(line) : CLOUD_COPY.headCount(card.models.length);
  if (defaultModel && !isOpen && line?.state !== 'failed') text += CLOUD_COPY.headDefault(defaultModel);
  if (!card.available && card.detail) text += ` · ${card.detail}`;
  return { text, negative: line?.state === 'failed' };
}

/**
 * 一张服务商卡（设计稿 settings-cloud.jsx:299-341）：卡头是名字与一句说明、「已连接」、「管理密钥 / 连接」；
 * 连上且这一档有模型时可展开，列出模型、判词、默认标签与「测试」。自建的在下面多一行「添加模型」，
 * 这一档还没有模型的自建服务商连上后直接展开（说明行写着「在下面添加」）。
 * 文本生成与语音合成档的卡头多一颗「刷新」（模型 / 音色目录）；没连接时置灰，任何一家在刷新时各家的刷新与密钥按钮都等着。
 */
export function ProviderCard({
  card: provider,
  capability,
  defaultRef,
  expanded,
  probes,
  onToggle,
  onKey,
  onAddModel,
  onProbe,
  refreshing,
  refreshBusy,
  onRefresh,
}: {
  card: CloudProviderCard;
  capability: OnlineCapability;
  defaultRef: ModelRef | null;
  expanded: boolean;
  probes: Record<string, ProbeState>;
  onToggle: () => void;
  onKey: () => void;
  onAddModel: () => void;
  onProbe: (model: ModelInfoBase) => void;
  /** 这一家正在刷新。 */
  refreshing: boolean;
  /** 有哪一家正在刷新。 */
  refreshBusy: boolean;
  onRefresh: () => void;
}) {
  const canOpen = provider.connected && provider.models.length > 0;
  const addRow = provider.custom;
  const isOpen = (canOpen && expanded) || (provider.connected && !provider.models.length && addRow);
  const defaultModel = defaultRef?.providerId === provider.providerId ? defaultRef.modelId : null;
  const probeOk = probeSupported(capability);
  const Chevron = isOpen ? ChevronDownIcon : ChevronRightIcon;
  const kind = refreshKind(provider, capability);
  const headLine = headText(provider, capability, defaultModel, isOpen, refreshing);

  const titleBody = (
    <>
      <span className={chevron} aria-hidden>
        {canOpen ? <Chevron styles={chevronIcon} /> : null}
      </span>
      <span className={name}>
        <span className={nameText}>{provider.label}</span>
        <span className={nameDesc({ isNegative: headLine.negative })}>{headLine.text}</span>
      </span>
    </>
  );

  return (
    <section className={card} aria-label={provider.label}>
      <div className={head}>
        {canOpen ? (
          <button
            type="button"
            className={title({ isToggle: true })}
            aria-expanded={isOpen}
            aria-label={isOpen ? CLOUD_COPY.collapse(provider.label) : CLOUD_COPY.expand(provider.label)}
            onClick={onToggle}>
            {titleBody}
          </button>
        ) : (
          <div className={title({ isToggle: false })}>{titleBody}</div>
        )}
        <div className={controls}>
          {provider.custom ? (
            <Badge variant="neutral" size="S" fillStyle="subtle">
              {CLOUD_COPY.customTag}
            </Badge>
          ) : null}
          {provider.connected ? (
            <Badge variant="positive" size="S" fillStyle="subtle">
              {CLOUD_COPY.connected}
            </Badge>
          ) : null}
          {kind ? (
            <TooltipTrigger placement="top" delay={300}>
              <ActionButton
                isQuiet
                size="S"
                aria-label={provider.connected ? CLOUD_COPY.refresh[kind] : CLOUD_COPY.refreshNeedsKey(CLOUD_COPY.refresh[kind])}
                isDisabled={!provider.connected || refreshBusy}
                onPress={onRefresh}>
                <RefreshIcon />
              </ActionButton>
              <Tooltip>{CLOUD_COPY.refresh[kind]}</Tooltip>
            </TooltipTrigger>
          ) : null}
          <Button variant="secondary" size="S" isDisabled={refreshBusy} onPress={onKey}>
            {provider.connected ? CLOUD_COPY.manageKey : CLOUD_COPY.connect}
          </Button>
        </div>
      </div>
      {isOpen ? (
        <div className={models}>
          {provider.models.map((model) => {
            const result = probeVerdict(probes[model.modelId]);
            const lead = modelLeadText(capability, model);
            return (
              <div key={model.modelId} className={modelRow}>
                <span className={modelName}>
                  <span className={modelId}>{model.modelId}</span>
                  {lead ? <span className={modelLead}>{lead}</span> : null}
                </span>
                <span className={verdict({ tone: probeOk ? result.tone : 'neutral' })}>
                  {probeOk ? result.text : CLOUD_COPY.probeUnsupported}
                </span>
                {defaultModel === model.modelId ? (
                  <Badge variant="accent" size="S" fillStyle="subtle">
                    {CLOUD_COPY.defaultChip}
                  </Badge>
                ) : null}
                <ActionButton isQuiet size="S" isDisabled={!probeOk || !provider.available} onPress={() => onProbe(model)}>
                  {CLOUD_COPY.probe[capability]}
                </ActionButton>
              </div>
            );
          })}
          {addRow ? (
            <div className={modelRow}>
              <ActionButton isQuiet size="S" onPress={onAddModel}>
                <AddIcon />
                <Text>{CLOUD_COPY.addModel}</Text>
              </ActionButton>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
