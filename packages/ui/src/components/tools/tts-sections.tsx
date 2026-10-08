import type { SpeechFormat } from '@baocut/protocol';
import { ActionButton, Picker, PickerItem, SegmentedControl, SegmentedControlItem, Slider, Text, TextField } from '@react-spectrum/s2';
import Refresh from '@react-spectrum/s2/icons/Refresh';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { ToggleButton } from 'react-aria-components';
import { languageOptions, languagesShort } from '../../model/tools-models.ts';
import {
  customVoiceAllowed,
  formatFor,
  pickVibe,
  rollVibe,
  speedValue,
  VIBES,
  voiceKeyFor,
  type MyVoices,
  type SpeechOption,
  type TtsDraft,
} from '../../model/tools-tts.ts';
import { voiceValueLine } from '../../model/voice-picker.ts';
import { VoicePicker } from '../voice-picker.tsx';
import { detail, detailGrow, Indent, Row, Section, SectionLink } from './tool-parts.tsx';
import { TTS_COPY } from './tools-copy.ts';

/* 生成语音页的「声音」与「语言与细节」两节（从 tts-tool.tsx 拆出）。 */

const grow = style({ flexGrow: 1, minWidth: 0 });
const voicePicker = style({ width: 240 });
const customField = style({ flexGrow: 1, minWidth: 160 });
const styleField = style({ flexGrow: 1, minWidth: 200 });
const slider = style({ width: 200 });
const seedField = style({ width: 140 });
const vibes = style({ display: 'grid', gridTemplateColumns: '[repeat(auto-fill, minmax(150px, 1fr))]', gap: 8, marginTop: 4 });
const vibe = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'start',
  gap: 2,
  padding: 8,
  borderRadius: 'default',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', isHovered: 'gray-400', isSelected: 'blue-800' },
  backgroundColor: { default: 'gray-25', isSelected: 'blue-100' },
  color: 'gray-900',
  textAlign: 'start',
  cursor: 'default',
  minWidth: 0,
  transition: 'default',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  outlineOffset: 2,
});
const vibeName = style({ font: 'ui-sm', fontWeight: 'bold' });
const vibeStyle = style({ font: 'ui-xs', color: 'gray-700', lineClamp: 2 });

type Patch = (patch: Partial<TtsDraft>) => void;

/** 声音（设计稿 `CloudVoiceSection` 317-370）：音色（共享选择器：默认 · 我的声音 · 这家的音色 · 手填）、风格与念法卡、语速。 */
export function VoiceSection({ draft, option, voices, patch }: { draft: TtsDraft; option: SpeechOption; voices: MyVoices; patch: Patch }) {
  const info = option.info;
  const voiceKey = voiceKeyFor(draft, info);
  const range = info.speedRange;
  return (
    <Section title={TTS_COPY.voice}>
      <Row label={TTS_COPY.voiceLabel}>
        <VoicePicker label={TTS_COPY.voiceLabel} styles={voicePicker} draft={draft} option={option} voices={voices} onChange={(voice) => patch({ voice })} />
        {voiceKey === 'custom' && customVoiceAllowed(info) ? (
          <TextField
            aria-label={TTS_COPY.customVoice}
            size="S"
            styles={customField}
            placeholder={TTS_COPY.customVoicePlaceholder}
            value={draft.customVoice}
            onChange={(customVoice) => patch({ customVoice })}
          />
        ) : null}
      </Row>
      <Indent>
        <span className={detail}>{voiceValueLine(draft, option, voices)}</span>
      </Indent>

      {info.acceptsInstructions ? (
        <>
          <Row label={TTS_COPY.style}>
            <TextField
              aria-label={TTS_COPY.styleLabel}
              size="S"
              styles={styleField}
              placeholder={TTS_COPY.stylePlaceholder}
              value={draft.instructions}
              onChange={(instructions) => patch({ instructions })}
            />
            <ActionButton isQuiet size="S" onPress={() => patch(rollVibe(draft, info))}>
              <Refresh />
              <Text>{TTS_COPY.roll}</Text>
            </ActionButton>
          </Row>
          <Indent>
            <div className={vibes}>
              {VIBES.map((v) => (
                <ToggleButton
                  key={v.key}
                  className={(rp) => vibe(rp)}
                  isSelected={draft.instructions === v.style}
                  onChange={() => patch(pickVibe(draft, v.key, info))}>
                  <span className={vibeName}>{v.name}</span>
                  <span className={vibeStyle}>{v.style}</span>
                </ToggleButton>
              ))}
            </div>
          </Indent>
        </>
      ) : null}

      {range ? (
        <Row label={TTS_COPY.speed}>
          <Slider
            aria-label={TTS_COPY.speed}
            labelPosition="side"
            size="S"
            styles={slider}
            minValue={range.min}
            maxValue={range.max}
            step={0.05}
            formatOptions={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }}
            value={speedValue(draft, range)}
            onChange={(speed) => patch({ speed })}
          />
          <span className={detailGrow}>{TTS_COPY.speedRange(option.provider, range.min, range.max, info.acceptsInstructions)}</span>
          {draft.speed !== null ? <SectionLink onPress={() => patch({ speed: null })}>{TTS_COPY.resetSpeed}</SectionLink> : null}
        </Row>
      ) : info.acceptsInstructions ? (
        <Indent>
          <span className={detail}>{TTS_COPY.noSpeed(option.provider)}</span>
        </Indent>
      ) : null}
    </Section>
  );
}

/** 语言与细节（设计稿 `OptionsSection` 564-592 与种子一行 640-660）：语言、格式、种子。 */
export function OptionsSection({ draft, option, patch }: { draft: TtsDraft; option: SpeechOption; patch: Patch }) {
  const info = option.info;
  const languages = languageOptions(info.languages);
  const language = languages.some((l) => l.key === draft.language) ? draft.language : '';
  const format = formatFor(draft, info);
  return (
    <Section title={TTS_COPY.options}>
      <Row label={TTS_COPY.language}>
        <Picker
          aria-label={TTS_COPY.language}
          size="S"
          items={languages}
          selectedKey={language}
          onSelectionChange={(key) => key !== null && patch({ language: String(key) })}>
          {(l) => <PickerItem id={l.key}>{l.label}</PickerItem>}
        </Picker>
        <span className={detailGrow}>{TTS_COPY.languageNote(option.provider, languagesShort(info.languages), !language)}</span>
      </Row>
      {info.formats.length > 1 ? (
        <Row label={TTS_COPY.format}>
          <SegmentedControl aria-label={TTS_COPY.format} selectedKey={format} onSelectionChange={(key) => patch({ format: key as SpeechFormat })}>
            {info.formats.map((f) => (
              <SegmentedControlItem key={f} id={f}>
                {f.toUpperCase()}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </Row>
      ) : null}
      <Row label={TTS_COPY.seed}>
        {info.acceptsSeed ? (
          <>
            <TextField
              aria-label={TTS_COPY.seed}
              size="S"
              styles={seedField}
              inputMode="numeric"
              placeholder={TTS_COPY.seedPlaceholder}
              value={draft.seed}
              onChange={(seed) => patch({ seed })}
            />
            <span className={detailGrow}>{TTS_COPY.seedNote}</span>
          </>
        ) : (
          <span className={grow}>
            <span className={detail}>{TTS_COPY.noSeed}</span>
          </span>
        )}
      </Row>
    </Section>
  );
}
