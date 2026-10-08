import { useMemo } from 'react';
import { ActionButton, Picker, PickerItem, SegmentedControl, SegmentedControlItem, Text } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { bundleName } from '../../model/models-local.ts';
import { findOption, languageOptions } from '../../model/tools-models.ts';
import { initialTranscribe, switchMode, transcribeOptionLabel, transcribeOptions, type TranscribeMode, type TranscribeOption } from '../../model/tools-transcribe.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { useTools } from '../../state/tools-store.ts';
import { PageStatus } from '../models/model-parts.tsx';
import { AsrMoreOptions, useSpeakerState, type SpeakerState } from './asr-more-options.tsx';
import { detail, Section } from './tool-parts.tsx';
import { GALLERY_COPY, TRANSCRIBE_TOOL_COPY } from './tools-copy.ts';

/*
 * 转录页的语音模型一块（设计稿 tool-transcribe.jsx `AsrFields`）：本机 / 在线、模型、转录语言、现状一行与去模型页的链接；
 * 记着的选择在 tools-store（跨次保留）。「识别说话人」只在写进视频时有（只给文件的转录不收 `diarize`）。
 */

const field = style({ width: 'full' });

// ---- 语音模型 ----

export interface AsrPick {
  view: ReturnType<typeof useModels.getState>['capabilities'];
  mode: TranscribeMode;
  options: TranscribeOption[];
  option: TranscribeOption | null;
  languages: ReturnType<typeof languageOptions>;
  /** 空串是自动检测。 */
  language: string;
  /** 「更多选项 › 识别说话人」。 */
  speakers: SpeakerState;
  /** 模型给人看的名字（本机的取模型包的名字，开关下面那一句用）。 */
  name: string;
}

/** 用哪种方式、哪只模型、什么语言：记着的选择（tools-store，跨次保留）还在就用它，否则落到生效的默认值。 */
export function useAsrPick(): AsrPick {
  const view = useModels((s) => s.capabilities);
  const saved = useTools((s) => s.transcribe);
  const picked = useMemo(() => {
    if (!view) return null;
    return initialTranscribe(view, saved.mode ? { mode: saved.mode, model: saved.model } : null);
  }, [view, saved.mode, saved.model]);
  const mode: TranscribeMode = picked?.mode ?? saved.mode ?? 'local';
  const options = useMemo(() => (view ? transcribeOptions(view, mode) : []), [view, mode]);
  const option = findOption(options, picked?.model ?? null);
  const languages = languageOptions(option?.info.languages ?? 'any', TRANSCRIBE_TOOL_COPY.autoDetect);
  const language = languages.some((l) => l.key === saved.language) ? saved.language : '';
  const speakers = useSpeakerState(option?.info, saved.speakers);
  const bundle = useModels((s) => (mode === 'local' && option ? s.bundles.find((b) => b.bundleId === option.modelId) : undefined));
  const name = bundle ? bundleName(bundle) : (option?.label ?? '');
  return { view, mode, options, option, languages, language, speakers, name };
}

/** 语音模型一块（设计稿 `AsrFields`）：本机 / 在线、模型、转录语言、现状一行与去模型页的链接。 */
export function AsrFields({ pick: p, speakers: showSpeakers = true }: { pick: AsrPick; speakers?: boolean }) {
  const go = useShell((s) => s.go);
  const patch = useTools((s) => s.patchTranscribe);
  const { view, mode, options, option, languages, language, speakers, name } = p;
  if (!view) return <PageStatus>{GALLERY_COPY.loading}</PageStatus>;
  const line = !option
    ? mode === 'cloud'
      ? TRANSCRIBE_TOOL_COPY.noCloud
      : TRANSCRIBE_TOOL_COPY.noLocal
    : mode === 'cloud'
      ? TRANSCRIBE_TOOL_COPY.statusCloud(option.usable, option.provider)
      : TRANSCRIBE_TOOL_COPY.statusLocal(option.usable);
  return (
    <Section
      title={TRANSCRIBE_TOOL_COPY.asrTitle}
      aside={
        <ActionButton isQuiet size="S" onPress={() => go({ tab: 'models', category: 'asr', page: mode })}>
          <Text>{mode === 'cloud' ? TRANSCRIBE_TOOL_COPY.manageCloud : TRANSCRIBE_TOOL_COPY.manageLocal}</Text>
        </ActionButton>
      }>
      <SegmentedControl aria-label={TRANSCRIBE_TOOL_COPY.mode} selectedKey={mode} onSelectionChange={(key) => patch(switchMode(view, key as TranscribeMode))}>
        <SegmentedControlItem id="local">{TRANSCRIBE_TOOL_COPY.local}</SegmentedControlItem>
        <SegmentedControlItem id="cloud">{TRANSCRIBE_TOOL_COPY.cloud}</SegmentedControlItem>
      </SegmentedControl>
      <Picker
        label={TRANSCRIBE_TOOL_COPY.model}
        styles={field}
        items={options}
        selectedKey={option?.key ?? null}
        isDisabled={!options.length}
        placeholder={TRANSCRIBE_TOOL_COPY.noModels}
        onSelectionChange={(key) => key !== null && patch({ mode, model: String(key), language: '' })}>
        {(o) => (
          <PickerItem id={o.key} textValue={transcribeOptionLabel(o, mode)}>
            <Text>{transcribeOptionLabel(o, mode)}</Text>
          </PickerItem>
        )}
      </Picker>
      <Picker
        label={TRANSCRIBE_TOOL_COPY.language}
        styles={field}
        items={languages}
        selectedKey={language}
        onSelectionChange={(key) => key !== null && patch({ mode, model: option?.key ?? null, language: String(key) })}>
        {(l) => <PickerItem id={l.key}>{l.label}</PickerItem>}
      </Picker>
      <span className={detail}>{line}</span>
      {option && showSpeakers ? <AsrMoreOptions state={speakers} name={name} onPick={(on) => patch({ speakers: on })} /> : null}
    </Section>
  );
}
