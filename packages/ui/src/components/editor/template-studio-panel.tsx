import { useState } from 'react';
import { getLocale, type AssetRecord, type Id, type Sequence } from '@baocut/protocol';
import { ActionButton, Button, Picker, PickerItem, Switch, Text, TextField } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import ChevronUp from '@react-spectrum/s2/icons/ChevronUp';
import Layers from '@react-spectrum/s2/icons/Layers';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { STAGE_RATIOS, ORIGINAL_RATIO } from '../../model/stage-bar.ts';
import { infoOf, TEMPLATE_KINDS } from '../../model/template-layers.ts';
import { addLayer, moveLayer, patchStudioLayer, setDraft, type TemplateStudio } from '../../model/template-studio.ts';
import { useEditor } from '../../state/editor-store.ts';
import { useLibrary } from '../../state/library-store.ts';
import { kindLabel } from './elements-templates.tsx';
import { Note, PRow, Sec, SecHead, Seg } from './inspector-controls.tsx';
import { KIND_ICONS, layerSubText } from './inspector-template.tsx';
import { PanelHead, panelBody } from './panel-head.tsx';
import { StudioLayerProps } from './template-studio-layer.tsx';
import { ratioLabel } from './use-template-actions.ts';
import { useTemplateStudio } from './use-template-studio.ts';
import { TEMPLATE_COPY as TC } from './template-copy.ts';

const panel = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const row = style({ display: 'flex', alignItems: 'center', gap: 4 });
const chips = style({ display: 'flex', flexWrap: 'wrap', gap: 4 });
const nameRow = style({ display: 'flex', alignItems: 'end', gap: 8 });
const grow = style({ flexGrow: 1, minWidth: 0 });
const push = style({ marginStart: 'auto' });
const empty = style({ display: 'flex', flexDirection: 'column', gap: 4, paddingY: 16, textAlign: 'center' });
const emptyTitle = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const emptyText = style({ font: 'ui-sm', color: 'gray-600' });
/** 图层一行（原型 .tplayer）：与模板属性页的图层行同一个样子，多了上移、下移。 */
const layerRow = style({
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexGrow: 1,
  minWidth: 0,
  boxSizing: 'border-box',
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

const KEEP = 'keep';
const update = (fn: (s: TemplateStudio) => TemplateStudio) => useEditor.getState().updateStudio(fn);

/** 页标题与「完成」钮按草稿写回到哪里（原型 `TemplateStudioPanel`）。 */
function heading(studio: TemplateStudio): { title: string; done: string } {
  switch (studio.source) {
    case 'video':
      return { title: TC.studioEditLayout, done: TC.done };
    case 'new-video':
      return { title: TC.studioNew, done: TC.applyToVideo };
    case 'brand':
      return { title: TC.studioEditBrand, done: TC.save };
    case 'new-brand':
      return { title: TC.studioNew, done: TC.saveToBrand };
  }
}

/**
 * 版面编辑器的右栏（原型 panel-template-studio.jsx）：改的是版面本身——有哪些层、每层在哪、多大、什么底色；与模板属性页
 * （改这部视频里那一份的内容）是两件事。返回箭头 = 放弃草稿，「完成」才写回。
 */
export function TemplateStudioPanel({ sequence, assets }: { sequence: Sequence; assets: Record<Id, AssetRecord> }) {
  const studio = useEditor((s) => s.templateStudio);
  const actions = useTemplateStudio();
  const [saving, setSaving] = useState(false);
  if (!studio) return null;
  const draft = studio.draft;
  const { title, done } = heading(studio);
  const target = infoOf(draft).ratioTarget;
  const picked = draft.layers.find((layer) => layer.id === studio.layer) ?? null;
  const finish = async () => {
    if (saving) return;
    setSaving(true);
    await actions.done(sequence, assets);
    setSaving(false);
  };
  const ratios = [
    { key: KEEP, label: TC.keepRatio },
    ...STAGE_RATIOS.map((r) => ({ key: r.key, label: r.key })),
    { key: ORIGINAL_RATIO, label: TC.original },
  ];

  return (
    <>
      <PanelHead title={title} back={{ label: TC.discard, onPress: actions.cancel }}>
        <Button variant="accent" size="S" isPending={saving} onPress={() => void finish()}>
          {done}
        </Button>
      </PanelHead>
      <div className={`${panelBody} bc-scroll`}>
        <div className={panel}>
          <SecHead first>{TC.name}</SecHead>
          <Sec>
            <TextField
              aria-label={TC.name}
              size="S"
              styles={grow}
              value={draft.name}
              placeholder={TC.namePlaceholder}
              onChange={(name) => update((s) => setDraft(s, { name }))}
            />
            <PRow label={TC.canvas}>
              <Seg<'16:9' | '9:16'>
                label={TC.canvas}
                value={draft.canvas ?? '16:9'}
                options={[
                  { key: '16:9', label: TC.landscape },
                  { key: '9:16', label: TC.portraitCanvas },
                ]}
                onChange={(canvas) => update((s) => setDraft(s, { canvas }))}
              />
            </PRow>
            <PRow label={TC.ratioWhenApplied}>
              <Picker
                aria-label={TC.ratioWhenApplied}
                size="S"
                styles={grow}
                selectedKey={draft.ratio ?? KEEP}
                onSelectionChange={(key) => update((s) => setDraft(s, { ratio: key === KEEP || key === null ? undefined : String(key) }))}>
                {ratios.map((r) => (
                  <PickerItem key={r.key} id={r.key} textValue={r.label}>
                    {r.label}
                  </PickerItem>
                ))}
              </Picker>
            </PRow>
            <PRow label={TC.lockRatio}>
              <Switch
                size="S"
                styles={push}
                isSelected={!!draft.lockRatio && !!target}
                isDisabled={!target}
                onChange={(lockRatio) => update((s) => setDraft(s, { lockRatio }))}>
                {target ? (draft.lockRatio ? TC.lockAfterOn : TC.lockAfterOff) : TC.pickRatioFirst}
              </Switch>
            </PRow>
          </Sec>
          <Note>{target && draft.lockRatio ? TC.studioLockOnNote(ratioLabel(target)) : TC.studioLockOffNote}</Note>

          <SecHead aside={TC.layersAside(draft.layers.length)}>{TC.layers}</SecHead>
          {draft.layers.length ? (
            <Sec>
              {/* 列表自顶向下是叠放的从上到下：数组靠后的在上。 */}
              {draft.layers
                .map((layer, index) => ({ layer, index }))
                .reverse()
                .map(({ layer, index }) => {
                  const Icon = KIND_ICONS[layer.kind] ?? Layers;
                  const name = kindLabel(layer.kind);
                  const on = layer.on !== false;
                  return (
                    <div key={layer.id} className={row}>
                      <RACButton
                        className={(state) => layerRow({ ...state, isPicked: studio.layer === layer.id, isOff: !on })}
                        onPress={() => update((s) => ({ ...s, layer: layer.id }))}>
                        <Icon styles={layerIcon} />
                        <span className={layerText}>
                          <span className={layerName}>{name}</span>
                          <span className={layerSub}>{layerSubText(layer)}</span>
                        </span>
                      </RACButton>
                      <ActionButton
                        isQuiet
                        size="S"
                        aria-label={TC.moveUp}
                        isDisabled={index === draft.layers.length - 1}
                        onPress={() => update((s) => moveLayer(s, layer.id, 1))}>
                        <ChevronUp />
                      </ActionButton>
                      <ActionButton
                        isQuiet
                        size="S"
                        aria-label={TC.moveDown}
                        isDisabled={index === 0}
                        onPress={() => update((s) => moveLayer(s, layer.id, -1))}>
                        <ChevronDown />
                      </ActionButton>
                      <Switch
                        size="S"
                        aria-label={TC.showLayer(name)}
                        isSelected={on}
                        onChange={(next) => update((s) => patchStudioLayer(s, layer.id, { on: next }))}
                      />
                    </div>
                  );
                })}
            </Sec>
          ) : (
            <div className={empty}>
              <span className={emptyTitle}>{TC.noLayers}</span>
              <span className={emptyText}>{TC.noLayersText}</span>
            </div>
          )}
          <div className={chips}>
            {TEMPLATE_KINDS.map((kind) => (
              <Button
                key={kind}
                variant="secondary"
                size="S"
                aria-label={TC.addLayer(kindLabel(kind))}
                onPress={() => update((s) => addLayer(s, kind, getLocale()))}>
                <Add />
                <Text>{kindLabel(kind)}</Text>
              </Button>
            ))}
          </div>

          {picked ? <StudioLayerProps key={picked.id} layer={picked} /> : <Note>{TC.pickLayerHint}</Note>}

          {studio.source === 'video' || studio.source === 'new-video' ? <SaveLayout name={draft.name} save={actions.saveToBrand} /> : null}
        </div>
      </div>
    </>
  );
}

/** 「把这套版面存到品牌库」：就地起名，缺省用草稿的名字；同名的覆盖。品牌库没到（Web 不开放用户库）时不摆。 */
function SaveLayout({ name: initial, save }: { name: string; save(name: string): Promise<boolean> }) {
  const ready = useLibrary((s) => s.ready);
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (!ready) return null;
  const commit = async () => {
    if (name === null || saving) return;
    setSaving(true);
    const saved = await save(name);
    setSaving(false);
    if (saved) setName(null);
  };
  return (
    <>
      <SecHead>{TC.brandSection}</SecHead>
      {name === null ? (
        <div className={chips}>
          <Button variant="secondary" size="S" onPress={() => setName(initial)}>
            {TC.saveLayoutToBrand}
          </Button>
        </div>
      ) : (
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
              if (event.key === 'Enter') void commit();
              if (event.key === 'Escape') setName(null);
            }}
          />
          <Button variant="accent" size="S" isPending={saving} onPress={() => void commit()}>
            {TC.save}
          </Button>
          <Button variant="secondary" size="S" isDisabled={saving} onPress={() => setName(null)}>
            {TC.cancel}
          </Button>
        </div>
      )}
      <Note>{TC.brandSignpost}</Note>
    </>
  );
}
