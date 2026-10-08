import type { ComponentProps } from 'react';
import { Header, Heading, Picker, PickerItem, PickerSection, Text } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import type { MyVoices, SpeechOption, TtsDraft, VoiceKey } from '../model/tools-tts.ts';
import { CLONE_NEW, pickerSelection, voicePickerGroups, type VoicePickerItem } from '../model/voice-picker.ts';
import { useShell } from '../state/shell-store.ts';
import { S } from './shell-copy.ts';

/**
 * 共享音色选择器（设计稿 voice-picker.jsx `VoicePicker`）：工具页「生成语音」与编辑器「音频 › 生成语音 / 克隆声音」共用。
 * 分组与置灰原因在 model/voice-picker.ts；这里只画。「克隆新音色…」去 模型 › 语音合成 › 我的声音（克隆在那里建，
 * 这一版没有回程认领：建好回来再选）。手填音色 ID 的输入框与控件下面那一句由调用方按自己的版式放。
 */
export function VoicePicker({
  label,
  draft,
  option,
  voices,
  onChange,
  styles,
}: {
  label: string;
  draft: Pick<TtsDraft, 'voice'>;
  option: SpeechOption;
  /** 我的声音；还没读到时 null。 */
  voices: MyVoices;
  onChange: (voice: VoiceKey) => void;
  styles?: ComponentProps<typeof Picker>['styles'];
}) {
  const go = useShell((s) => s.go);
  const groups = voicePickerGroups(option, voices);
  const disabled = groups.flatMap((g) => g.items.filter((i) => i.disabled).map((i) => i.key));
  return (
    <Picker
      aria-label={label}
      size="S"
      styles={styles}
      menuWidth={320}
      placeholder={S.voicePicker.placeholder}
      selectedKey={pickerSelection(draft, option, voices)}
      disabledKeys={disabled}
      onSelectionChange={(key) => {
        if (key === null) return;
        if (key === CLONE_NEW) go({ tab: 'models', category: 'tts', page: 'voices' });
        else onChange(String(key) as VoiceKey);
      }}>
      {groups.map((g) =>
        g.title ? (
          <PickerSection key={g.id} id={`group:${g.id}`}>
            <Header>
              <Heading>{g.title}</Heading>
            </Header>
            {g.items.map((item) => voiceItem(item, g.id === 'mine'))}
          </PickerSection>
        ) : (
          g.items.map((item) => voiceItem(item, false))
        ),
      )}
    </Picker>
  );
}

function voiceItem(item: VoicePickerItem, mine: boolean) {
  return (
    <PickerItem key={item.key} id={item.key} textValue={item.label}>
      {item.key === CLONE_NEW ? <Add /> : mine && item.key.startsWith('library:') ? <Microphone /> : null}
      <Text slot="label">{item.label}</Text>
      {item.description ? <Text slot="description">{item.description}</Text> : null}
    </PickerItem>
  );
}
