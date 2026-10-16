import type { AssetRecord, Id, LibraryEntry, LibraryEntrySummary, Sequence, TemplateLayers } from '@baocut/protocol';
import { ActionButton, Button, Menu, MenuItem, MenuSection, MenuTrigger, Text } from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Copy from '@react-spectrum/s2/icons/Copy';
import Delete from '@react-spectrum/s2/icons/Delete';
import Edit from '@react-spectrum/s2/icons/Edit';
import More from '@react-spectrum/s2/icons/More';
import Rename from '@react-spectrum/s2/icons/Rename';
import TemplateIcon from '@react-spectrum/s2/icons/Template';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { isWatermark } from '../../model/template-layers.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { useLibrary } from '../../state/library-store.ts';
import { brandInfo, brandMetaStyle, brandName, brandRow } from './brand-rows.tsx';
import { saveTemplateToBrand } from './brand-save.ts';
import { kindSummary, ratioNote } from './elements-templates.tsx';
import { Note, SecHead } from './inspector-controls.tsx';
import { TemplateThumb } from './template-thumb.tsx';
import { useTemplateActions } from './use-template-actions.ts';
import { useTemplateCatalog } from './use-template-catalog.ts';
import { BRAND_COPY as IB } from './brand-copy.ts';
import { TEMPLATE_COPY as TC } from './template-copy.ts';

const list = style({ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyleType: 'none' });
const hint = style({ margin: 0, marginTop: 8, font: 'ui-xs', color: 'gray-600' });
const nameLine = style({ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 });
const chip = style({
  flexShrink: 0,
  paddingX: 4,
  borderRadius: 'sm',
  backgroundColor: { default: 'gray-100', isOn: 'blue-100' },
  font: 'ui-xs',
  color: { default: 'gray-700', isOn: 'blue-1000' },
  whiteSpace: 'nowrap',
});

type TemplateRowAction = 'apply' | 'edit' | 'duplicate' | 'rename' | 'delete';

/** 复制一份的名字：「X 副本」，重名时后面加序号。 */
function copyName(name: string, taken: readonly LibraryEntrySummary[]): string {
  const names = new Set(taken.map((summary) => summary.name));
  const base = TC.copyName(name);
  if (!names.has(base)) return base;
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`;
}

/**
 * 品牌页的「模板」一节（原型 panel-brand.jsx，排在最上：模板会烧进导出画面）：存在这里的是版面定义，跨视频复用；
 * 套用是拷一份进视频，之后改库里的不动已经套用的视频。水印也是模板（`tag: 'watermark'`）。
 */
export function BrandTemplates({
  sequence,
  assets,
  editable,
  onNew,
  onEdit,
  onRename,
  onDelete,
}: {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  editable: boolean;
  /** 「新建模板」：从空白进版面编辑器，存进品牌库。 */
  onNew?(): void;
  /** 「编辑版面」：在版面编辑器里改库里的这一条。 */
  onEdit?(doc: TemplateLayers, entry: LibraryEntry): void;
  onRename(entry: LibraryEntry): void;
  onDelete(summary: LibraryEntrySummary): void;
}) {
  const runtime = useRuntime();
  const brand = useLibrary((s) => s.brand);
  const summaries = brand.filter((summary) => summary.kind === 'overlayTemplate');
  const catalog = useTemplateCatalog();
  const templates = useTemplateActions();
  const loaded = new Map(catalog.brandEntries.map((template) => [template.summary.id, template]));
  const appliedFrom = sequence.template?.from;

  const onAction = (action: TemplateRowAction, summary: LibraryEntrySummary) => {
    if (action === 'delete') return onDelete(summary);
    const template = loaded.get(summary.id);
    if (!template) return;
    if (action === 'apply') return void templates.apply(sequence, assets, template.doc, { again: appliedFrom === template.doc.id });
    if (action === 'edit') return onEdit?.(template.doc, template.entry);
    if (action === 'rename') return onRename(template.entry);
    void saveTemplateToBrand(runtime, template.doc, copyName(template.doc.name, summaries), brand, 'duplicated');
  };

  return (
    <section aria-label={TC.section}>
      <SecHead
        first
        aside={[TC.brandNote, summaries.length ? IB.entryCount(summaries.length) : null].filter(Boolean).join(' · ')}
        action={
          onNew ? (
            <Button variant="secondary" size="S" isDisabled={!editable} onPress={onNew}>
              <Add />
              <Text>{TC.newTemplate}</Text>
            </Button>
          ) : null
        }
      >
        {TC.section}
      </SecHead>
      {summaries.length ? (
        <ul className={list} aria-label={TC.section}>
          {summaries.map((summary) => {
            const template = loaded.get(summary.id) ?? null;
            const applied = !!template && appliedFrom === template.doc.id;
            return (
              <BrandTemplateRow
                key={summary.id}
                summary={summary}
                doc={template?.doc ?? null}
                applied={applied}
                editable={editable}
                canEdit={!!onEdit}
                onAction={(action) => onAction(action, summary)}
              />
            );
          })}
        </ul>
      ) : (
        <Note>{TC.brandEmpty}</Note>
      )}
      <p className={hint}>{TC.brandSignpostTemplates}</p>
    </section>
  );
}

function BrandTemplateRow({
  summary,
  doc,
  applied,
  editable,
  canEdit,
  onAction,
}: {
  summary: LibraryEntrySummary;
  doc: TemplateLayers | null;
  applied: boolean;
  editable: boolean;
  canEdit: boolean;
  onAction(action: TemplateRowAction): void;
}) {
  const meta = doc ? [kindSummary(doc), ratioNote(doc)].filter(Boolean).join(' · ') : IB.loading;
  const applyLabel = applied ? TC.reapply : TC.applyToCurrent;
  const disabled = [...(doc ? [] : ['apply', 'edit', 'duplicate', 'rename']), ...(editable ? [] : ['apply'])];
  return (
    <li className={brandRow}>
      {doc ? <TemplateThumb doc={doc} height={32} /> : null}
      <span className={brandInfo}>
        <span className={nameLine}>
          <span className={brandName} title={summary.name}>
            {summary.name}
          </span>
          {doc && isWatermark(doc) ? (
            <span className={chip({ isOn: false })}>{doc.imported === 'watermark' ? TC.chipImported : TC.chipWatermark}</span>
          ) : null}
          {applied ? <span className={chip({ isOn: true })}>{TC.applied}</span> : null}
        </span>
        <span className={brandMetaStyle}>{meta}</span>
      </span>
      <MenuTrigger>
        <ActionButton isQuiet size="S" aria-label={IB.actionsFor(summary.name)}>
          <More />
        </ActionButton>
        <Menu aria-label={IB.actionsFor(summary.name)} disabledKeys={disabled} onAction={(key) => onAction(key as TemplateRowAction)}>
          <MenuSection>
            <MenuItem id="apply" textValue={applyLabel}>
              <TemplateIcon />
              <Text slot="label">{applyLabel}</Text>
              {editable ? null : <Text slot="description">{IB.videoNotReady}</Text>}
            </MenuItem>
            {canEdit ? (
              <MenuItem id="edit" textValue={TC.editLayout}>
                <Edit />
                <Text slot="label">{TC.editLayout}</Text>
              </MenuItem>
            ) : null}
            <MenuItem id="duplicate" textValue={TC.duplicate}>
              <Copy />
              <Text slot="label">{TC.duplicate}</Text>
            </MenuItem>
            <MenuItem id="rename" textValue={IB.rename}>
              <Rename />
              <Text slot="label">{IB.renameEllipsis}</Text>
            </MenuItem>
          </MenuSection>
          <MenuSection>
            <MenuItem id="delete" textValue={TC.removeFromBrand}>
              <Delete />
              <Text slot="label">{TC.removeFromBrand}</Text>
            </MenuItem>
          </MenuSection>
        </Menu>
      </MenuTrigger>
    </li>
  );
}
