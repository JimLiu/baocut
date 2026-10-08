import type { ReactNode } from 'react';
import { Button, Header, Heading, Picker, PickerItem, PickerSection, Text } from '@react-spectrum/s2';
import Checkmark from '@react-spectrum/s2/icons/Checkmark';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import type { ToolModelOption } from '../../model/tools-models.ts';
import { Gate } from './tool-parts.tsx';
import { GATE_COPY } from './tools-copy.ts';

/*
 * 工具页的「模型」一节（设计稿 tool-tts.jsx `ModelLine`、image-gen.jsx `ModelLine` 与 `EngineGate`）：
 * 一个按服务商分组的模型 Picker、连没连上、这只模型能做什么；选中的不能用时下面给门卡。
 */

const line = style({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 8, rowGap: 4, minHeight: 32, minWidth: 0 });
const state = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  flexShrink: 0,
  font: 'ui-xs',
  color: { default: 'gray-600', isOk: 'green-1000' },
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const facts = style({
  flexGrow: 1,
  flexBasis: 0,
  minWidth: 160,
  font: 'ui-sm',
  color: 'gray-700',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
});

interface ProviderGroup<M> {
  providerId: string;
  provider: string;
  items: ToolModelOption<M>[];
}

function groups<M>(options: readonly ToolModelOption<M>[], localGroup: string): ProviderGroup<M>[] {
  const out: ProviderGroup<M>[] = [];
  for (const o of options) {
    const g = out.find((x) => x.providerId === o.providerId);
    if (g) g.items.push(o);
    else out.push({ providerId: o.providerId, provider: o.local ? localGroup : o.provider, items: [o] });
  }
  return out;
}

/**
 * 菜单里一项的两行：云端写模型 ID，下面是不能用的原因或模型的名字；本机写模型的名字，没装好时下面是原因与去哪儿装
 * （设计稿 image-gen.jsx `ModelLine` 的本机一组）。
 */
function itemText<M>(o: ToolModelOption<M>): { label: string; description: string | null } {
  if (o.local) return { label: o.label, description: o.why ? GATE_COPY.localWhere(o.why) : null };
  return { label: o.modelId, description: o.why || o.label !== o.modelId ? (o.why ?? o.label) : null };
}

/** 模型那一行：Picker（按服务商分组；没连上的写「未连接」；本机模型自成一组）、状态、一句能力。 */
export function ModelLine<M>({
  label,
  options,
  selected,
  onSelect,
  factsOf,
  disableUnusable = false,
}: {
  label: string;
  options: readonly ToolModelOption<M>[];
  selected: ToolModelOption<M> | null;
  onSelect: (option: ToolModelOption<M>) => void;
  factsOf: (option: ToolModelOption<M>) => string;
  /** 没连上的不让选（设计稿 image-gen.jsx 的菜单）；语音照引擎卡片的样子，选了再给门卡。本机模型没装好也能选，选了给下载卡。 */
  disableUnusable?: boolean;
}) {
  const disabled = disableUnusable ? options.filter((o) => !o.usable && !o.local && o.key !== selected?.key).map((o) => o.key) : [];
  return (
    <div className={line}>
      <Picker
        aria-label={label}
        size="S"
        menuWidth={320}
        selectedKey={selected?.key ?? null}
        disabledKeys={disabled}
        onSelectionChange={(key) => {
          const next = options.find((o) => o.key === key);
          if (next && next.key !== selected?.key) onSelect(next);
        }}>
        {groups(options, GATE_COPY.localGroup).map((g) => (
          <PickerSection key={g.providerId} id={`provider:${g.providerId}`}>
            <Header>
              <Heading>{g.provider}</Heading>
            </Header>
            {g.items.map((o) => {
              const text = itemText(o);
              return (
                <PickerItem key={o.key} id={o.key} textValue={`${o.provider} · ${text.label}`}>
                  <Text slot="label">{text.label}</Text>
                  {text.description ? <Text slot="description">{text.description}</Text> : null}
                </PickerItem>
              );
            })}
          </PickerSection>
        ))}
      </Picker>
      {selected ? (
        <span className={state({ isOk: selected.usable })}>
          {selected.usable ? <Checkmark aria-hidden /> : null}
          {selected.usable ? (selected.local ? GATE_COPY.installed : GATE_COPY.connected) : selected.why}
        </span>
      ) : null}
      {selected ? (
        <span className={facts} title={factsOf(selected)}>
          {factsOf(selected)}
        </span>
      ) : null}
    </div>
  );
}

/**
 * 选中的模型不能用时的门卡（设计稿 image-gen.jsx `EngineGate` 的云端分支）：没连上的说「先连接 X」、给「去连接」，
 * 有能用的另一只时给「换用可用的 …」。本机模型的门卡（下载、平台不可用）在 local-model-gate.tsx。
 */
export function ModelGate<M>({
  selected,
  options,
  body,
  onConnect,
  onSwitch,
}: {
  selected: ToolModelOption<M> | null;
  options: readonly ToolModelOption<M>[];
  body: string;
  onConnect: () => void;
  onSwitch: (option: ToolModelOption<M>) => void;
}): ReactNode {
  if (!selected || selected.usable || selected.local) return null;
  // 回落只落到云端（设计稿 `EngineGate` 的 `preferred`）：不替用户换成本机模型。
  const usable = options.filter((o) => o.usable && !o.local);
  const alt = usable.find((o) => o.providerId !== selected.providerId) ?? usable[0];
  const switchButton = alt ? (
    <Button variant="secondary" size="S" onPress={() => onSwitch(alt)}>
      {GATE_COPY.switchTo(`${alt.provider} · ${alt.modelId}`)}
    </Button>
  ) : null;
  if (!selected.connected) {
    return (
      <Gate
        title={GATE_COPY.connect(selected.provider)}
        body={body}
        actions={
          <>
            <Button variant="accent" size="S" onPress={onConnect}>
              {GATE_COPY.goConnect}
            </Button>
            {switchButton}
          </>
        }
      />
    );
  }
  return <Gate title={GATE_COPY.unavailable(selected.provider)} body={selected.why ?? ''} actions={switchButton} />;
}
