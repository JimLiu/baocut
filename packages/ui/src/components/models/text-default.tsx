import { useState } from 'react';
import { Header, Heading, Picker, PickerItem, PickerSection, Text, ToastQueue } from '@react-spectrum/s2';
import { cloudDefaultPicker, type DefaultOption } from '../../model/models-cloud.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useConnection } from '../../state/connection-store.ts';
import { useModels } from '../../state/models-store.ts';
import { chooseCloudDefault } from './model-actions.ts';
import { Card, SettingRow } from './model-parts.tsx';
import { CLOUD_COPY } from './models-copy.ts';
import { TextParamRows } from './text-params.tsx';

/**
 * 文本生成页顶上的默认模型与参数（推理强度、并发请求数；设计稿 settings-capability.jsx ① ②）。其余能力的默认模型由
 * capability-default.tsx 统一给。文本生成只有 API 提供方的模型，菜单只列能用的（已添加、有账号的）。浏览器里置灰：
 * `models.setDefault`、`models.setCapabilityParameters` 不在 Web 白名单里。
 */

const EMPTY_KEY = 'empty';
/** 分组的 id 与选项的 id 在同一个集合里，必须错开（分组 `none` 撞上「不设默认」那一项的 `none` 会让整页崩掉）。 */
const sectionId = (key: string) => `section:${key}`;

/** 菜单的一项。直接返回 PickerItem（包一层组件的话 S2 的集合认不出它）。 */
function pickerOption(item: DefaultOption) {
  return (
    <PickerItem key={item.key} id={item.key} textValue={item.label}>
      <Text slot="label">{item.label}</Text>
      {item.description ? <Text slot="description">{item.description}</Text> : null}
    </PickerItem>
  );
}

export function TextDefault() {
  const runtime = useRuntime();
  const web = runtime.host.platform === 'web';
  const view = useModels((s) => s.capabilities);
  const connected = useConnection((s) => s.state.status === 'connected');
  const [busy, setBusy] = useState(false);
  if (!view) return null;

  const capability = 'generateText';
  const picker = cloudDefaultPicker(view, capability, null, {
    none: CLOUD_COPY.none[capability],
    noneDesc: CLOUD_COPY.noneDesc[capability],
    codex: CLOUD_COPY.codexItem,
    codexDesc: CLOUD_COPY.codexItemDesc,
    unavailable: CLOUD_COPY.unavailable,
    localDesc: CLOUD_COPY.localDefaultDesc,
  });

  const choose = async (key: string) => {
    setBusy(true);
    try {
      await chooseCloudDefault(runtime, capability, key);
      ToastQueue.neutral(CLOUD_COPY.defaultSet, { timeout: 3000 });
    } catch (err) {
      ToastQueue.negative(CLOUD_COPY.defaultFailed((err as Error).message), { timeout: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card label={CLOUD_COPY.defaultLabel[capability]}>
      <SettingRow label={CLOUD_COPY.defaultLabel[capability]} desc={CLOUD_COPY.defaultDesc[capability]}>
        <Picker
          aria-label={CLOUD_COPY.defaultLabel[capability]}
          size="S"
          align="end"
          menuWidth={300}
          selectedKey={picker.selectedKey}
          disabledKeys={[EMPTY_KEY]}
          isDisabled={web || busy || !connected}
          onSelectionChange={(key) => {
            if (key !== null && key !== picker.selectedKey && key !== EMPTY_KEY) void choose(String(key));
          }}>
          {picker.sections.map((section) =>
            section.title ? (
              <PickerSection key={section.key} id={sectionId(section.key)}>
                <Header>
                  <Heading>{section.title}</Heading>
                </Header>
                {section.items.map(pickerOption)}
              </PickerSection>
            ) : (
              <PickerSection key={section.key} id={sectionId(section.key)} aria-label={section.items[0]?.label}>
                {section.items.map(pickerOption)}
              </PickerSection>
            ),
          )}
          {picker.empty ? (
            <PickerSection id={sectionId('empty')} aria-label={CLOUD_COPY.pickerEmpty.other}>
              {pickerOption({ key: EMPTY_KEY, label: CLOUD_COPY.pickerEmpty.other })}
            </PickerSection>
          ) : null}
        </Picker>
      </SettingRow>
      <TextParamRows view={view} connected={connected} />
    </Card>
  );
}
