import { useState } from 'react';
import type { Sequence, TemplateLayer, TemplateLayers } from '@baocut/protocol';
import { Button, Switch, Text, TextField } from '@react-spectrum/s2';
import Delete from '@react-spectrum/s2/icons/Delete';
import Image from '@react-spectrum/s2/icons/Image';
import TextIcon from '@react-spectrum/s2/icons/Text';
import Layers from '@react-spectrum/s2/icons/Layers';
import Bookmark from '@react-spectrum/s2/icons/Bookmark';
import Clock from '@react-spectrum/s2/icons/Clock';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { chapterAt, sequenceChapters, type ChapterSpan } from '../../model/chapters.ts';
import { formatTimecode } from '../../model/editor.ts';
import { infoOf, layerOpacity, logoAlign } from '../../model/template-layers.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useLibrary } from '../../state/library-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { saveTemplateToBrand } from './brand-save.ts';
import { renameChapter } from './chapter-commands.ts';
import { useEditorActions } from './editor-context.tsx';
import { kindLabel, kindSummary, ratioNote, TemplateCard } from './elements-templates.tsx';
import { ColorField, DangerButton, Note, PRow, Sec, SecHead, Seg, ValueRow } from './inspector-controls.tsx';
import { ratioLabel, useTemplateActions } from './use-template-actions.ts';
import { useTemplateCatalog } from './use-template-catalog.ts';
import { TEMPLATE_COPY as TC } from './template-copy.ts';

const buttons = style({ display: 'flex', flexWrap: 'wrap', gap: 8 });
const nameRow = style({ display: 'flex', alignItems: 'end', gap: 8 });
const grow = style({ flexGrow: 1, minWidth: 0 });
const empty = style({ display: 'flex', flexDirection: 'column', gap: 4, paddingY: 24, textAlign: 'center' });
const emptyTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const emptyText = style({ font: 'ui-sm', color: 'gray-600' });
/** 章节一行（原型 .tplchap）：时间码、可改的名字、「当前」小标签。 */
const chapterRow = style({ display: 'flex', alignItems: 'center', gap: 8 });
const timecode = style({
  flexShrink: 0,
  width: 48,
  padding: 0,
  borderWidth: 0,
  backgroundColor: 'transparent',
  font: 'code-xs',
  color: { default: 'gray-700', isHovered: 'blue-900' },
  textAlign: 'start',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  borderRadius: 'sm',
});
const currentTag = style({
  flexShrink: 0,
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: 'blue-100',
  font: 'ui-xs',
  color: 'blue-1000',
});
/** 图层一行（原型 .tplayer）：类的图标、名字与说明、开关；点中的那一行描蓝边，关着的变淡。 */
const layerRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  boxSizing: 'border-box',
  width: 'full',
  paddingX: 8,
  paddingY: '[6px]',
  borderStyle: 'solid',
  borderWidth: 1,
  borderColor: { default: 'transparent', isPicked: 'blue-800' },
  borderRadius: 'default',
  backgroundColor: { default: 'transparent', isHovered: 'gray-75' },
  opacity: { default: 1, isOff: 0.6 },
  textAlign: 'start',
  cursor: 'pointer',
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  '--iconPrimary': { type: 'fill', value: 'gray-700' },
});
const layerText = style({ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 });
const layerName = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900' });
const layerSub = style({ font: 'ui-xs', color: 'gray-600', truncate: true });
const layerIcon = iconStyle({ size: 'S' });
const chips = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });
const push = style({ marginStart: 'auto' });

export const KIND_ICONS: Record<TemplateLayer['kind'], typeof Layers> = {
  chapters: Bookmark,
  progress: Clock,
  logo: Image,
  text: TextIcon,
};

/** 图层行的说明（原型 `layerSub`）。 */
export function layerSubText(layer: TemplateLayer): string {
  switch (layer.kind) {
    case 'chapters':
      return layer.fill === 'dim' ? TC.layerChaptersDim : TC.layerChaptersBar;
    case 'progress':
      return TC.layerProgress;
    case 'logo': {
      const opacity = layerOpacity(layer);
      return [
        layer.src === undefined || layer.src === 'text' ? TC.layerLogoText(layer.text ?? '') : TC.layerLogoImage,
        layer.tile ? TC.layerTiled : null,
        opacity < 1 ? `${Math.round(opacity * 100)}%` : null,
      ]
        .filter(Boolean)
        .join(' · ');
    }
    case 'text':
      return TC.layerQuoted(layer.text);
  }
}

const isTextLogo = (layer: Extract<TemplateLayer, { kind: 'logo' }>) => layer.src === undefined || layer.src === 'text';
const brandLogoId = (layer: Extract<TemplateLayer, { kind: 'logo' }>) =>
  layer.src && typeof layer.src === 'object' && 'brandLogo' in layer.src ? layer.src.brandLogo : null;

/** 失焦或回车才提交的文字框（每敲一个字一笔事务太碎）；Esc 回弹。 */
function DraftField({
  label,
  value,
  isDisabled,
  onCommit,
}: {
  label: string;
  value: string;
  isDisabled?: boolean;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (draft !== value) onCommit(draft);
  };
  return (
    <TextField
      aria-label={label}
      size="S"
      styles={grow}
      value={draft ?? value}
      isDisabled={isDisabled}
      onChange={setDraft}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
    />
  );
}

/** 章节一行：名字可改（失焦或回车提交，Esc 回弹，清空不改），点时间码跳过去。 */
function ChapterRow({
  chapter,
  current,
  sequence,
  editable,
}: {
  chapter: ChapterSpan;
  current: boolean;
  sequence: Sequence;
  editable: boolean;
}) {
  const actions = useEditorActions();
  const time = formatTimecode(chapter.start, sequence.fps);
  return (
    <div className={chapterRow}>
      <RACButton
        className={(state) => `${timecode(state)} bc-tabular`}
        aria-label={TC.jumpToChapter(time)}
        onPress={() => actions.seek(chapter.start)}
      >
        {time}
      </RACButton>
      <DraftField
        label={TC.chapterTitleLabel(chapter.index + 1)}
        value={chapter.title}
        isDisabled={!editable}
        onCommit={(title) => {
          if (title.trim() && title.trim() !== chapter.title) void renameChapter(actions, sequence, chapter, title);
        }}
      />
      {current ? <span className={currentTag}>{TC.current}</span> : null}
    </div>
  );
}

/**
 * 「存到品牌库」/「更新品牌库」（原型 panel-template-edit 的 naming）：点开后就地起名，缺省用模板名；同名的覆盖。
 * 存好后这份实例的 `from` 指向那一条，版面卡片随之写「已存进品牌库」。
 */
function SaveToBrand({ sequence, tpl, inBrand, editable }: { sequence: Sequence; tpl: TemplateLayers; inBrand: boolean; editable: boolean }) {
  const runtime = useRuntime();
  const templates = useTemplateActions();
  const ready = useLibrary((s) => s.ready);
  const brand = useLibrary((s) => s.brand);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const save = async () => {
    if (name === null || saving) return;
    setSaving(true);
    const saved = await saveTemplateToBrand(runtime, tpl, name, brand);
    setSaving(false);
    if (!saved) return;
    setName(null);
    // 存的那一刻视频可能又改过：在最新的那份上改出处。
    const fresh = useVideo.getState().video?.state?.video.sequences[sequence.id] ?? sequence;
    const current = fresh.template;
    if (editable && current && (current.from !== saved.id || current.name !== saved.name)) {
      void templates.patch(fresh, { from: saved.id, name: saved.name });
    }
  };
  // 品牌库没到（Web 服务不开放用户库）时不摆这个钮。
  if (!ready) return null;
  if (name === null) {
    return (
      <Button variant="secondary" size="S" onPress={() => setName(tpl.name)}>
        {inBrand ? TC.updateBrand : TC.saveToBrand}
      </Button>
    );
  }
  return (
    <div className={nameRow}>
      <TextField
        label={TC.nameLabel}
        placeholder={TC.namePlaceholder}
        size="S"
        styles={grow}
        autoFocus
        value={name}
        onChange={setName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void save();
          if (event.key === 'Escape') setName(null);
        }}
      />
      <Button variant="accent" size="S" isPending={saving} onPress={() => void save()}>
        {TC.save}
      </Button>
      <Button variant="secondary" size="S" isDisabled={saving} onPress={() => setName(null)}>
        {TC.cancel}
      </Button>
    </div>
  );
}

/** 页标题：套着模板时带上它的名字。 */
export function templatePageTitle(sequence: Sequence): string {
  return sequence.template ? TC.pageTitle(sequence.template.name) : TC.pageTitleEmpty;
}

/**
 * 模板属性页（原型 panel-template-edit.jsx；视频格式规范 §3.17）：调的是序列里那一份实例——章节名、台标写什么 / 用哪张图、
 * 进度画成色条还是明暗、哪些层开着、字幕要不要避让，都是这部视频自己的事。层的位置与大小是版面，不在这里改。
 */
export function TemplatePage({ sequence }: { sequence: Sequence }) {
  const editable = useVideo((s) => canEdit(s.video));
  const playhead = useEditor((s) => s.playhead);
  const picked = useEditor((s) => s.templateLayer);
  const brandImages = useLibrary((s) => s.brand).filter((entry) => entry.kind === 'image');
  const templates = useTemplateActions();
  const catalog = useTemplateCatalog();
  const tpl = sequence.template;
  if (!tpl) {
    return (
      <div className={empty}>
        <span className={emptyTitle}>{TC.emptyTitle}</span>
        <span className={emptyText}>{TC.emptyText}</span>
        <div className={buttons} style={{ justifyContent: 'center', marginTop: 8 }}>
          <Button variant="secondary" size="S" onPress={() => useEditor.getState().openTemplates()}>
            {TC.swap}
          </Button>
        </div>
      </div>
    );
  }
  const info = infoOf(tpl);
  const chapters = sequenceChapters(sequence);
  const current = chapterAt(chapters, playhead);
  const avoid = tpl.subsAvoid !== false;
  const lift = infoOf({ ...tpl, subsAvoid: true }).subsBottom;
  const patchLayer = (layer: TemplateLayer, patch: Partial<TemplateLayer>) => void templates.patchLayer(sequence, layer.id, patch);
  const of = <K extends TemplateLayer['kind']>(kind: K) =>
    tpl.layers.filter((l): l is Extract<TemplateLayer, { kind: K }> => l.kind === kind);
  const chapterLayers = of('chapters');
  const progressLayers = of('progress');
  const logoLayers = of('logo');
  const textLayers = of('text');
  const from = tpl.from ? catalog.find(tpl.from) : null;
  const detail = [from ? TC.fromNamed(from.doc.name) : null, from?.brand ? TC.savedInBrand : TC.onlyHere, ratioNote(tpl)]
    .filter(Boolean)
    .join(' · ');

  return (
    <>
      <SecHead first aside={kindSummary(tpl)}>
        {TC.layout}
      </SecHead>
      <TemplateCard doc={tpl} detail={detail} />
      <div className={buttons}>
        <Button variant="secondary" size="S" onPress={() => useEditor.getState().openTemplates()}>
          {TC.swap}
        </Button>
      </div>
      <SaveToBrand sequence={sequence} tpl={tpl} inBrand={!!from?.brand} editable={editable} />
      <Note>{TC.layoutSignpost}</Note>

      {info.ratioTarget ? (
        <>
          <SecHead aside={info.ratioLocked ? TC.locked : TC.unlocked}>{TC.ratio}</SecHead>
          <Sec>
            <PRow label={ratioLabel(info.ratioTarget)}>
              <Switch size="S" isSelected={info.ratioLocked} isDisabled={!editable} onChange={(on) => void templates.setLock(sequence, on)}>
                {info.ratioLocked ? TC.lockSwitchOn : TC.lockSwitchOff}
              </Switch>
            </PRow>
          </Sec>
          <Note>{info.ratioLocked ? TC.lockOnNote(ratioLabel(info.ratioTarget)) : TC.lockOffNote(ratioLabel(info.ratioTarget))}</Note>
        </>
      ) : null}

      <SecHead aside={TC.chapterCount(chapters.length)}>{TC.chapters}</SecHead>
      {chapters.length ? (
        <Sec>
          {chapters.map((chapter, index) => (
            <ChapterRow key={chapter.id} chapter={chapter} current={index === current} sequence={sequence} editable={editable} />
          ))}
        </Sec>
      ) : null}
      <Note>{chapters.length ? TC.chaptersSignpost : TC.noChapters}</Note>

      {chapterLayers.length ? (
        <>
          <SecHead>{TC.kindChapters}</SecHead>
          <Sec>
            {chapterLayers.map((layer) => (
              <Sec key={layer.id}>
                <PRow label={TC.fill}>
                  <Seg<'bar' | 'dim'>
                    label={TC.fill}
                    value={layer.fill ?? 'bar'}
                    options={[
                      { key: 'bar', label: TC.fillBar },
                      { key: 'dim', label: TC.fillDim },
                    ]}
                    isDisabled={!editable}
                    onChange={(fill) => patchLayer(layer, { fill })}
                  />
                </PRow>
                <PRow label={layer.fill === 'dim' ? TC.playedBase : TC.barColor}>
                  <ColorField
                    label={layer.fill === 'dim' ? TC.playedBase : TC.barColor}
                    value={layer.accent}
                    fallback="#FFFFFF"
                    isDisabled={!editable}
                    onCommit={(accent) => patchLayer(layer, { accent })}
                  />
                </PRow>
                <PRow label={TC.divider}>
                  <Switch
                    size="S"
                    aria-label={TC.divider}
                    styles={push}
                    isSelected={layer.divider !== false}
                    isDisabled={!editable}
                    onChange={(divider) => patchLayer(layer, { divider })}
                  />
                </PRow>
              </Sec>
            ))}
          </Sec>
          <Note>{TC.chapterBarSignpost}</Note>
        </>
      ) : null}

      {progressLayers.length ? (
        <>
          <SecHead>{TC.kindProgress}</SecHead>
          <Sec>
            {progressLayers.map((layer) => (
              <PRow key={layer.id} label={TC.color}>
                <ColorField
                  label={TC.kindProgress}
                  value={layer.accent}
                  fallback="#FFFFFF"
                  isDisabled={!editable}
                  onCommit={(accent) => patchLayer(layer, { accent })}
                />
              </PRow>
            ))}
          </Sec>
        </>
      ) : null}

      {logoLayers.length ? (
        <>
          <SecHead>{TC.kindLogo}</SecHead>
          <Sec>
            {logoLayers.map((layer) => (
              <Sec key={layer.id}>
                <PRow label={TC.source}>
                  <Seg<'text' | 'image'>
                    label={TC.source}
                    value={isTextLogo(layer) ? 'text' : 'image'}
                    options={[
                      { key: 'text', label: TC.sourceText },
                      { key: 'image', label: TC.sourceImage },
                    ]}
                    isDisabled={!editable}
                    onChange={(next) => {
                      if (next === 'text') patchLayer(layer, { src: 'text' });
                      else if (brandImages[0]) void templates.setLogoImage(sequence, layer.id, brandImages[0]);
                    }}
                  />
                </PRow>
                <PRow label={TC.tile}>
                  <Switch
                    size="S"
                    aria-label={TC.tile}
                    styles={push}
                    isSelected={!!layer.tile}
                    isDisabled={!editable}
                    onChange={(tile) => patchLayer(layer, { tile })}
                  />
                </PRow>
                <ValueRow
                  label={TC.opacity}
                  value={Math.round(layerOpacity(layer) * 100)}
                  min={5}
                  max={100}
                  step={5}
                  unit="%"
                  isDisabled={!editable}
                  onCommit={(value) => patchLayer(layer, { opacity: Math.min(1, Math.max(0.05, value / 100)) })}
                />
                {!layer.tile ? (
                  <PRow label={TC.align}>
                    <Seg<'left' | 'center' | 'right'>
                      label={TC.align}
                      value={logoAlign(layer)}
                      options={[
                        { key: 'left', label: TC.alignLeft },
                        { key: 'center', label: TC.alignCenter },
                        { key: 'right', label: TC.alignRight },
                      ]}
                      isDisabled={!editable}
                      onChange={(align) => patchLayer(layer, { align })}
                    />
                  </PRow>
                ) : null}
                {isTextLogo(layer) ? (
                  <PRow label={TC.text}>
                    <DraftField
                      label={TC.text}
                      value={layer.text ?? ''}
                      isDisabled={!editable}
                      onCommit={(text) => patchLayer(layer, { text })}
                    />
                  </PRow>
                ) : brandImages.length ? (
                  <div className={chips} role="group" aria-label={TC.pickBrandImage}>
                    {brandImages.map((entry) => (
                      <Button
                        key={entry.id}
                        size="S"
                        variant={brandLogoId(layer) === entry.id ? 'accent' : 'secondary'}
                        isDisabled={!editable}
                        onPress={() => void templates.setLogoImage(sequence, layer.id, entry)}
                      >
                        <Image />
                        <Text>{entry.name}</Text>
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Note>{TC.noBrandImages}</Note>
                )}
              </Sec>
            ))}
          </Sec>
        </>
      ) : null}

      {textLayers.length ? (
        <>
          <SecHead>{TC.kindText}</SecHead>
          <Sec>
            {textLayers.map((layer) => (
              <PRow key={layer.id} label={layer.mono ? TC.timer : TC.content}>
                <DraftField
                  label={layer.mono ? TC.timer : TC.content}
                  value={layer.text}
                  isDisabled={!editable}
                  onCommit={(text) => patchLayer(layer, { text })}
                />
              </PRow>
            ))}
          </Sec>
          <Note>{TC.varsSignpost}</Note>
        </>
      ) : null}

      <SecHead aside={TC.layersOn(tpl.layers.filter((l) => l.on !== false).length, tpl.layers.length)}>{TC.layers}</SecHead>
      <Sec>
        {tpl.layers.map((layer) => {
          const Icon = KIND_ICONS[layer.kind] ?? Layers;
          const on = layer.on !== false;
          return (
            <div key={layer.id} className={chapterRow}>
              <RACButton
                className={(state) => layerRow({ ...state, isPicked: picked === layer.id, isOff: !on })}
                onPress={() => useEditor.getState().focusTemplate(true, picked === layer.id ? null : layer.id)}
              >
                <Icon styles={layerIcon} />
                <span className={layerText}>
                  <span className={layerName}>{kindLabel(layer.kind)}</span>
                  <span className={layerSub}>{layerSubText(layer)}</span>
                </span>
              </RACButton>
              <Switch
                size="S"
                aria-label={TC.showLayer(kindLabel(layer.kind))}
                isSelected={on}
                isDisabled={!editable}
                onChange={(next) => patchLayer(layer, { on: next })}
              />
            </div>
          );
        })}
      </Sec>

      <SecHead>{TC.subtitles}</SecHead>
      <Sec>
        <PRow label={TC.avoid}>
          <Switch
            size="S"
            aria-label={TC.avoid}
            styles={push}
            isSelected={avoid}
            isDisabled={!editable}
            onChange={(subsAvoid) => void templates.patch(sequence, subsAvoidPatch(subsAvoid))}
          />
        </PRow>
      </Sec>
      <Note>
        {lift ? (avoid ? TC.avoidOn(lift) : TC.avoidOff) : TC.avoidNone} {TC.avoidTail}
      </Note>

      <DangerButton isDisabled={!editable} onPress={() => void templates.remove(sequence)}>
        <Delete />
        <Text>{TC.remove}</Text>
      </DangerButton>
    </>
  );
}

/** 字幕避让：缺省就是开，开的时候不写字段。 */
function subsAvoidPatch(on: boolean): Partial<TemplateLayers> {
  return on ? { subsAvoid: undefined } : { subsAvoid: false };
}
