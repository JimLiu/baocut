import { useState } from 'react';
import { Header, Heading, Picker, PickerItem, PickerSection, Text, ToastQueue } from '@react-spectrum/s2';
import { canReenable, LOCAL_PROVIDER } from '../../model/models-local.ts';
import {
  AUTO_KEY,
  capabilityDefaultPicker,
  unifiedDefaultCapability,
  type DefaultCapability,
  type DefaultModelOption,
} from '../../model/models-default.ts';
import type { ModelCategory } from '../../model/settings-nav.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useModels } from '../../state/models-store.ts';
import { CODEX_SWITCH } from '../settings/agent-switch.ts';
import { useAgentSwitch } from './agent-switch-card.tsx';
import { chooseCapabilityDefault } from './model-actions.ts';
import { Card, SettingRow } from './model-parts.tsx';
import { CAP_DEFAULT_COPY, CLOUD_COPY } from './models-copy.ts';

/**
 * 能力页顶上的默认模型（产品设计 §7.6「每种能力一个默认模型」；设计稿 settings-capability.jsx `DefaultPicker`）：
 * 语音识别、语音合成、图像生成在页头下、本地 / 云端页签之上放这一个选择器，本机、局域网节点、云端与 Codex 的模型都在
 * 一个菜单里，按出厂顺序分组；不能用的置灰写原因（本机模型包停用过的仍可选，选中时先重新启用）。第一项清掉默认：
 * 语音识别、图像生成是「自动 · 现在用 X」，语音合成是「未设置」。浏览器里置灰（`models.setDefault` 不在 Web 白名单里）。
 */
export function CapabilityDefault({ category }: { category: ModelCategory }) {
  const capability = unifiedDefaultCapability(category);
  return capability ? <DefaultCard key={capability} capability={capability} /> : null;
}

/** 分组的 id 与选项的 id 在同一个集合里，必须错开。 */
const sectionId = (key: string) => `section:${key}`;

function DefaultCard({ capability }: { capability: DefaultCapability }) {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const connected = useConnection((s) => s.state.status === 'connected');
  const ready = useModels((s) => s.ready);
  const view = useModels((s) => s.capabilities);
  const bundles = useModels((s) => s.bundles);
  const [busy, setBusy] = useState(false);
  // 图像生成：进页探测一次 Codex（与云端页的 Codex 卡同一个钩子），菜单里 Codex 能不能选才是新的。
  useAgentSwitch(CODEX_SWITCH, capability === 'generateImage');

  if (!connected || !ready || !view) return null;
  const copy = CAP_DEFAULT_COPY;
  const picker = capabilityDefaultPicker(view, capability);
  const reenable = (o: DefaultModelOption) =>
    o.providerId === LOCAL_PROVIDER && bundles.some((b) => b.bundleId === o.modelId && canReenable(b));
  const selectable = (o: DefaultModelOption) => o.usable || reenable(o);
  const disabledKeys = picker.groups.flatMap((g) => g.options.filter((o) => !selectable(o) && o.key !== picker.selectedKey).map((o) => o.key));

  const describe = (o: DefaultModelOption): string | undefined => {
    if (o.usable) return o.caution ?? (o.local || o.agent ? undefined : o.label !== o.modelId ? o.label : undefined);
    if (reenable(o)) return o.why ?? undefined;
    if (o.local) return o.why ? copy.localWhy(o.why) : undefined;
    if (!o.connected || o.why === null) return o.why ?? undefined;
    return o.agent ? o.why : copy.cloudWhy(o.why);
  };
  const itemLabel = (o: DefaultModelOption) => (o.local || o.agent ? o.label : o.modelId);
  const clearLabel =
    picker.clear === 'unset' ? copy.unset : picker.autoUses ? copy.autoUses(picker.autoUses) : copy.autoNothing;
  const clearDesc =
    picker.clear === 'unset' ? copy.unsetDesc : capability === 'generateImage' ? copy.autoDesc.generateImage : copy.autoDesc.transcribe;

  const choose = async (key: string) => {
    setBusy(true);
    try {
      await chooseCapabilityDefault(runtime, capability, key, bundles);
      ToastQueue.neutral(CLOUD_COPY.defaultSet, { timeout: 3000 });
    } catch (err) {
      ToastQueue.negative(CLOUD_COPY.defaultFailed((err as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card label={copy.label}>
      <SettingRow label={copy.label} desc={copy.desc[capability]}>
        <Picker
          aria-label={copy.label}
          size="S"
          align="end"
          menuWidth={320}
          selectedKey={picker.selectedKey}
          disabledKeys={disabledKeys}
          isDisabled={web || busy}
          onSelectionChange={(key) => {
            if (key !== null && key !== picker.selectedKey) void choose(String(key));
          }}>
          <PickerSection id={sectionId('clear')} aria-label={clearLabel}>
            <PickerItem id={AUTO_KEY} textValue={clearLabel}>
              <Text slot="label">{clearLabel}</Text>
              <Text slot="description">{clearDesc}</Text>
            </PickerItem>
          </PickerSection>
          {picker.groups.map((g) => (
            <PickerSection key={g.key} id={sectionId(g.key)}>
              <Header>
                <Heading>{g.local ? copy.localGroup : g.title}</Heading>
              </Header>
              {g.options.map((o) => {
                const description = describe(o);
                return (
                  <PickerItem key={o.key} id={o.key} textValue={`${g.local ? copy.localGroup : g.title} · ${itemLabel(o)}`}>
                    <Text slot="label">{itemLabel(o)}</Text>
                    {description ? <Text slot="description">{description}</Text> : null}
                  </PickerItem>
                );
              })}
            </PickerSection>
          ))}
          {picker.missing ? (
            <PickerSection id={sectionId('missing')} aria-label={picker.missing.label}>
              <PickerItem id={picker.missing.key} textValue={picker.missing.label}>
                <Text slot="label">{copy.unavailable(picker.missing.label)}</Text>
              </PickerItem>
            </PickerSection>
          ) : null}
        </Picker>
      </SettingRow>
    </Card>
  );
}
