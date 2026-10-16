import type { ReactNode } from 'react';
import type { TemplateLayerKind, TemplateLayers } from '@baocut/protocol';
import Add from '@react-spectrum/s2/icons/Add';
import Lock from '@react-spectrum/s2/icons/Lock';
import { iconStyle, style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { Button as RACButton } from 'react-aria-components';
import { infoOf, isWatermark, templateKinds, type TemplateEntry, type TemplateGroup } from '../../model/template-layers.ts';
import { TemplateThumb } from './template-thumb.tsx';
import { ratioLabel } from './use-template-actions.ts';
import { TEMPLATE_COPY as TC } from './template-copy.ts';

/** 目录里的一行（原型 .tplrow）：缩略图、名字与小标签、摘要，行尾「套用 / 已套用」；套着的那一行描蓝边。 */
const row = style({
  display: 'flex',
  alignItems: 'center',
  gap: '[10px]',
  boxSizing: 'border-box',
  width: 'full',
  height: 64,
  paddingX: { default: '[10px]', isOn: '[9px]' },
  borderStyle: 'solid',
  borderWidth: { default: 1, isOn: 2 },
  borderColor: { default: 'gray-200', isOn: 'blue-800' },
  borderRadius: 'lg',
  backgroundColor: { default: 'gray-25', isHovered: 'gray-50' },
  textAlign: 'start',
  cursor: { default: 'pointer', isDisabled: 'default', isStatic: 'default' },
  opacity: { default: 1, isDisabled: 0.5 },
  outlineStyle: { default: 'none', isFocusVisible: 'solid' },
  outlineColor: 'focus-ring',
  outlineWidth: 2,
  transition: 'default',
});
const list = style({ display: 'flex', flexDirection: 'column', gap: 8 });
/** 「自己做一个」那一格的加号块（原型 .tplth）。 */
const plusBox = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
  width: 56,
  height: 44,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  '--iconPrimary': { type: 'fill', value: 'gray-600' },
});
const text = style({ display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 });
const nameLine = style({ display: 'flex', alignItems: 'center', gap: '[6px]', minWidth: 0 });
const name = style({ font: 'ui-sm', fontWeight: 'bold', color: 'gray-900', truncate: true, minWidth: 0 });
const summary = style({ font: 'ui-xs', color: 'gray-600', truncate: true });
const tag = style({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  flexShrink: 0,
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: 'gray-100',
  font: 'ui-xs',
  color: 'gray-700',
  whiteSpace: 'nowrap',
  '--iconPrimary': { type: 'fill', value: 'currentColor' },
});
const tagIcon = iconStyle({ size: 'XS' });
const action = style({ flexShrink: 0, font: 'ui-xs', fontWeight: 'bold', color: { default: 'blue-900', isOn: 'gray-600' } });
/** 子页「全部」下一组的组头（原型 .tplgrp）。 */
const groupHead = style({
  display: 'flex',
  alignItems: 'baseline',
  gap: '[6px]',
  paddingTop: { default: 12, isFirst: 0 },
  paddingX: 2,
  font: 'ui-xs',
  fontWeight: 'bold',
  color: 'gray-600',
});
const groupCount = style({ fontWeight: 'normal', color: 'gray-500' });

/** 层的类在界面上叫什么。 */
export function kindLabel(kind: TemplateLayerKind): string {
  switch (kind) {
    case 'chapters':
      return TC.kindChapters;
    case 'progress':
      return TC.kindProgress;
    case 'logo':
      return TC.kindLogo;
    case 'text':
      return TC.kindText;
  }
}

/** 摘要（原型 `TPL.summary`）：有哪几类层，按第一次出现的次序。 */
export const kindSummary = (doc: TemplateLayers): string => templateKinds(doc).map(kindLabel).join(' · ');

/** 摘要末尾的画幅那一节：锁着写「锁定画幅」，只声明写「套用后画幅」，没声明为 null。 */
export function ratioNote(doc: TemplateLayers): string | null {
  const info = infoOf(doc);
  if (!info.ratioTarget) return null;
  return info.ratioLocked ? TC.ratioLocks(ratioLabel(info.ratioTarget)) : TC.ratioOnApply(ratioLabel(info.ratioTarget));
}

/** 名字后面的小标签：品牌库的水印、品牌库 / 由水印导入、锁着的画幅。 */
function Tags({ entry }: { entry: TemplateEntry }) {
  const { doc, brand } = entry;
  const info = infoOf(doc);
  return (
    <>
      {brand && isWatermark(doc) ? <span className={tag}>{TC.chipWatermark}</span> : null}
      {brand ? <span className={tag}>{doc.imported === 'watermark' ? TC.chipImported : TC.chipBrand}</span> : null}
      {info.ratioLocked && info.ratioTarget ? (
        <span className={tag}>
          <Lock styles={tagIcon} />
          {ratioLabel(info.ratioTarget)}
        </span>
      ) : null}
    </>
  );
}

function rowSummary(doc: TemplateLayers): string {
  return [kindSummary(doc), doc.canvas === '9:16' ? TC.portrait : null, ratioNote(doc)].filter(Boolean).join(' · ');
}

/** 目录里的一行：点一下 = 套用（拷一份进视频）。 */
export function TemplateRow({
  entry,
  on,
  editable,
  onApply,
}: {
  entry: TemplateEntry;
  on: boolean;
  editable: boolean;
  onApply(doc: TemplateLayers): void;
}) {
  const { doc } = entry;
  return (
    <RACButton
      className={(state) => row({ ...state, isOn: on })}
      aria-label={TC.applyNamed(doc.name)}
      aria-pressed={on}
      isDisabled={!editable}
      onPress={() => onApply(doc)}
    >
      <TemplateThumb doc={doc} />
      <span className={text}>
        <span className={nameLine}>
          <span className={name}>{doc.name}</span>
          <Tags entry={entry} />
        </span>
        <span className={summary}>{rowSummary(doc)}</span>
      </span>
      <span className={action({ isOn: on })}>{on ? TC.applied : TC.apply}</span>
    </RACButton>
  );
}

/** 不可点的一行（属性页「版面」那一格）：同一个样子，右边换成调用方给的说明。 */
export function TemplateCard({ doc, detail }: { doc: TemplateLayers; detail: ReactNode }) {
  return (
    <div className={row({ isStatic: true, isOn: false, isHovered: false })}>
      <TemplateThumb doc={doc} />
      <span className={text}>
        <span className={name}>{doc.name}</span>
        <span className={summary}>{detail}</span>
      </span>
    </div>
  );
}

/** 「自己做一个」：从空白进版面编辑器，排在目录最后。 */
export function MakeOwnRow({ editable, onPress }: { editable: boolean; onPress(): void }) {
  return (
    <RACButton className={(state) => row({ ...state, isOn: false })} isDisabled={!editable} onPress={onPress}>
      <span className={plusBox}>
        <Add />
      </span>
      <span className={text}>
        <span className={name}>{TC.makeOwn}</span>
        <span className={summary}>{TC.makeOwnNote}</span>
      </span>
    </RACButton>
  );
}

/** 模板名字能不能被搜到：名字、说明与组名都算。 */
export function templateMatches(entry: TemplateEntry, group: TemplateGroup, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [entry.doc.name, entry.doc.desc ?? '', group.label, TC.section].some((s) => s.toLowerCase().includes(q));
}

/**
 * 模板目录（原型 panel-elements.jsx 的 `fr` 一段）：目录页只摆前 `peek` 款；子页「全部」按组分节，选了某一组只列那一组、
 * 不再重复组头。`onMakeOwn` 给了，最后一行是「自己做一个」。
 */
export function TemplateList({
  groups,
  group,
  peek,
  current,
  editable,
  onApply,
  onMakeOwn,
}: {
  groups: readonly TemplateGroup[];
  /** 子页里停在哪一组；目录页为 null。 */
  group: string | null;
  peek: number | null;
  current: TemplateLayers | undefined;
  editable: boolean;
  onApply(doc: TemplateLayers): void;
  onMakeOwn?: () => void;
}) {
  const rowOf = (entry: TemplateEntry) => (
    <TemplateRow key={entry.doc.id} entry={entry} on={current?.from === entry.doc.id} editable={editable} onApply={onApply} />
  );
  return (
    <div className={list}>
      {peek !== null
        ? groups
            .flatMap((g) => g.items)
            .slice(0, peek)
            .map(rowOf)
        : group === null || group === 'all'
          ? groups.map((g, index) => (
              <div key={g.key} className={list}>
                <div className={groupHead({ isFirst: index === 0 })} role="heading" aria-level={4}>
                  {g.label}
                  <span className={`${groupCount} bc-tabular`}>{g.items.length}</span>
                </div>
                {g.items.map(rowOf)}
              </div>
            ))
          : (groups.find((g) => g.key === group)?.items ?? []).map(rowOf)}
      {onMakeOwn ? <MakeOwnRow editable={editable} onPress={onMakeOwn} /> : null}
    </div>
  );
}
