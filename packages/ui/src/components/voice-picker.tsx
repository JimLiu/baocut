import type { ComponentProps } from 'react';
import { Header, Heading, Picker, PickerItem, PickerSection, Text } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Microphone from '@react-spectrum/s2/icons/Microphone';
import type { LibraryEntrySummary } from '@baocut/protocol';
import { libraryIdOf, type MyVoices, type SpeechOption, type TtsDraft, type VoiceKey } from '../model/tools-tts.ts';
import { CLONE_NEW, pickerSelection, voicePickerGroups, type CloneFix, type VoicePickerItem } from '../model/voice-picker.ts';
import { useCloneActivity } from './voice-clone-fix.tsx';
import { useShell } from '../state/shell-store.ts';
import { S } from './shell-copy.ts';

/**
 * 共享音色选择器（设计稿 voice-picker.jsx `VoicePicker`）：工具页「生成语音」与编辑器「音频 › 生成语音 / 克隆声音」共用。
 * 分组与置灰原因在 model/voice-picker.ts；这里只画。「克隆新音色…」去 模型 › 语音合成 › 我的声音（克隆在那里建，
 * 这一版没有回程认领：建好回来再选）。我的声音里还没在这家建好、但补得上的照样能选：先选上，再交给 `onFix` 去补那一步
 * （voice-clone-fix.tsx，在传的只选上）。手填音色 ID 的输入框与控件下面那一句（`VoiceFixLine`）由调用方按自己的版式放。
 */
export function VoicePicker({
  label,
  draft,
  option,
  voices,
  onChange,
  onFix,
  styles,
}: {
  label: string;
  draft: Pick<TtsDraft, 'voice'>;
  option: SpeechOption;
  /** 我的声音；还没读到时 null。 */
  voices: MyVoices;
  onChange: (voice: VoiceKey) => void;
  /** 选上的那只还没在这家建好、补得上：去补那一步。 */
  onFix?: (voice: LibraryEntrySummary, fix: CloneFix) => void;
  styles?: ComponentProps<typeof Picker>['styles'];
}) {
  const go = useShell((s) => s.go);
  const activity = useCloneActivity();
  const groups = voicePickerGroups(option, voices, activity);
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
        if (key === CLONE_NEW) {
          go({ tab: 'models', category: 'tts', page: 'voices' });
          return;
        }
        const voiceKey = String(key) as VoiceKey;
        onChange(voiceKey);
        const fix = groups.flatMap((g) => g.items).find((i) => i.key === voiceKey)?.fix;
        const id = libraryIdOf(voiceKey);
        const voice = id !== null ? voices?.find((v) => v.id === id) : undefined;
        if (fix && fix !== 'wait' && voice) onFix?.(voice, fix);
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
