import { useMemo } from 'react';
import { Picker, PickerItem, Radio, RadioGroup, Text } from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { TARGET_LANGUAGES } from '../../model/new-flow.ts';
import { dubEngineKey, dubParams, toolRequest, type OriginalAudio, type RunMeta } from '../../model/tool-runs.ts';
import {
  defaultTargetLang,
  DUPLICATE_TITLE,
  duplicateNote,
  langLabel,
  pick,
  sourceDocument,
  targetLangs,
  translationOptions,
  type TranslationOption,
} from '../../model/tool-targets.ts';
import { modelReason } from '../../model/tool-frame.ts';
import { cloudModelOptions, findOption, languagesShort, speaks } from '../../model/tools-models.ts';
import { useModels } from '../../state/models-store.ts';
import { useShell } from '../../state/shell-store.ts';
import { ModelRow } from './tool-frame.tsx';
import { GrantCard, ToolFrame } from './tool-run-view.tsx';
import { detail, Section, submitOnModEnter } from './tool-parts.tsx';
import { SpacePicker, useCandidates } from './tool-video-picker.tsx';
import { DUB_COPY, FORM_COPY } from './tools-copy.ts';
import { textModelWhy, useTextModel } from './translate-tool.tsx';
import { blockOf, useToolStatus } from './use-tool-status.ts';
import { useToolStart, useVideoTools, type DubDraft } from './use-video-tools.ts';
import { DuplicateAlert, firstWhy, lede, SubmitBar, TextModelField, usePreset } from './video-tool-parts.tsx';

/*
 * 工具 › 翻译配音（设计稿 tool-dub.jsx `DubToolPage`）：选 Space 里转录过的视频；有译文时直接选用，没有就先翻译（要一只
 * 文本模型）。结果写进这个视频：新的一组配音，原来的配音保留。提交走 `dub` 流程；音色不选（用引擎的默认音色），
 * 音色、时长对比与逐句管理在编辑器的翻译配音里。
 *
 * 与设计稿的出入：配音引擎只列在线服务（同编辑器里的翻译配音，`dub` 流程这一版不接本机引擎）。
 */

const NEW = 'new';
const ORIGINAL: OriginalAudio[] = ['duck', 'mute', 'keep'];
const field = style({ width: 'full' });
const bad = style({ font: 'ui-sm', color: 'negative' });

function translationLabel(o: TranslationOption): string {
  return [o.label, o.sub, o.stale ? DUB_COPY.stale(o.stale) : ''].filter(Boolean).join(' · ');
}

export function DubTool() {
  const go = useShell((s) => s.go);
  const status = useToolStatus();
  const view = useModels((s) => s.capabilities);
  const draft = useVideoTools((s) => s.dub);
  const patchVideoTools = useVideoTools((s) => s.patch);
  const patch = (p: Partial<DubDraft>) => patchVideoTools('dub', p);
  const data = useCandidates('dub');

  usePreset('dub', (entryId) => patch({ entryId, translation: null }));

  const entryId = pick(data.rows, draft.entryId);
  const row = entryId ? (data.rows.find((r) => r.entryId === entryId) ?? null) : null;
  const doc = sourceDocument(row);
  const translations = translationOptions(row);
  const choice =
    draft.translation && (draft.translation === NEW || translations.some((o) => o.id === draft.translation))
      ? draft.translation
      : (translations[translations.length - 1]?.id ?? NEW);
  const chosen = translations.find((o) => o.id === choice) ?? null;
  const targets = targetLangs(
    TARGET_LANGUAGES.map((l) => l.code),
    doc,
  );
  const lang = chosen ? chosen.lang : defaultTargetLang(targets, draft.lang, doc?.language ?? null);

  const engines = useMemo(() => (view ? cloudModelOptions(view, 'synthesizeSpeech') : []), [view]);
  const engine = findOption(engines, view ? dubEngineKey(engines, draft.engine, view.synthesizeSpeech.effective ?? null, lang) : null);
  const engineSpeaks = !engine || !lang || speaks(engine.info.languages, lang);
  const text = useTextModel(draft.textModel);

  const params = entryId
    ? dubParams({
        entryId,
        translation: chosen ? { id: chosen.id, documentId: chosen.documentId } : null,
        targetLanguage: chosen ? null : lang,
        documentId: doc?.documentId ?? null,
        originalAudio: draft.original,
        ...(engine?.usable ? { provider: engine.providerId, model: engine.modelId } : {}),
        ...(!chosen && text.option?.usable ? { textProvider: text.option.providerId, textModel: text.option.modelId } : {}),
      })
    : null;
  const request = params ? toolRequest(status.byId.get('dub'), 'video', params) : null;
  const key = request ? JSON.stringify(request) : '';
  const starter = useToolStart('dub', key);

  const engineWhy = !view
    ? FORM_COPY.loading
    : (modelReason(engines, engine, DUB_COPY.engine) ??
      (engine && !engineSpeaks && lang ? DUB_COPY.notSpeak(`${engine.provider} · ${engine.label}`, langLabel(lang)) : null));
  const why = firstWhy(
    blockOf(status, 'dub', 'video'),
    !entryId && FORM_COPY.needVideo,
    !chosen && !lang && FORM_COPY.needLang,
    engineWhy,
    !chosen && textModelWhy(text),
    !!starter.asking && FORM_COPY.needGrant,
    !request && FORM_COPY.loading,
  );

  const start = () => {
    if (why || !request) return;
    const meta: RunMeta = {
      tool: 'dub',
      input: 'video',
      title: `${DUB_COPY.title} · ${row?.name ?? ''}${lang ? ` → ${langLabel(lang)}` : ''}`,
      videoName: row?.name ?? null,
      sourceLanguage: doc?.language ?? null,
    };
    starter.start(request, meta, key);
  };

  const dup = row ? duplicateNote('dub', row, lang) : null;

  return (
    <ToolFrame
      tool="dub"
      title={DUB_COPY.title}
      bar={<SubmitBar why={why} label={DUB_COPY.submit} busy={starter.busy} onPress={start} />}
      onKeyDown={submitOnModEnter(start)}>
      <p className={lede}>{DUB_COPY.lede}</p>
      <SpacePicker tool="dub" data={data} value={entryId} onChange={(id) => patch({ entryId: id, translation: null })} />
      {row ? (
        <Section>
          {!row.documents.length ? <span className={detail}>{DUB_COPY.pending}</span> : null}
          <RadioGroup label={DUB_COPY.translation} value={choice} onChange={(v) => patch({ translation: v })}>
            {translations.map((o) => (
              <Radio key={o.id} value={o.id}>
                {translationLabel(o)}
              </Radio>
            ))}
            <Radio value={NEW}>{DUB_COPY.newTranslation}</Radio>
          </RadioGroup>
          {!chosen ? (
            <Picker
              label={DUB_COPY.target}
              styles={field}
              items={TARGET_LANGUAGES.filter((l) => targets.includes(l.code))}
              selectedKey={lang}
              onSelectionChange={(k) => k !== null && patch({ lang: String(k) })}>
              {(l) => (
                <PickerItem id={l.code} textValue={`${l.name} · ${l.native}`}>
                  <Text slot="label">{l.name}</Text>
                  <Text slot="description">{l.native}</Text>
                </PickerItem>
              )}
            </Picker>
          ) : null}
        </Section>
      ) : null}
      {row && !chosen ? <TextModelField options={text.options} option={text.option} onChange={(model) => patch({ textModel: model })} /> : null}
      <ModelRow
        title={DUB_COPY.engine}
        noun={DUB_COPY.engine}
        manage={DUB_COPY.manageEngines}
        local={false}
        onSettings={() => go({ tab: 'models', category: 'tts', page: 'cloud' })}
        options={engines}
        selected={engine}
        onSelect={(o) => patch({ engine: o.key })}
        factsOf={(o) => DUB_COPY.engineLine(languagesShort(o.info.languages))}>
        {view && engine?.usable && engineWhy ? <span className={bad}>{engineWhy}</span> : null}
      </ModelRow>
      <Section>
        <RadioGroup label={DUB_COPY.original} orientation="horizontal" value={draft.original} onChange={(v) => patch({ original: v as OriginalAudio })}>
          {ORIGINAL.map((k) => (
            <Radio key={k} value={k}>
              {DUB_COPY.originalOptions[k]}
            </Radio>
          ))}
        </RadioGroup>
      </Section>
      {dup ? <DuplicateAlert title={DUPLICATE_TITLE.dub} body={dup} /> : null}
      {starter.asking ? <GrantCard items={starter.asking} onAgree={starter.agree} busy={starter.busy} hint={DUB_COPY.grantHint} /> : null}
    </ToolFrame>
  );
}
