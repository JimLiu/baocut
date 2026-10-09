import { useState } from 'react';
import type {
  AssetRecord,
  BrandContent,
  BrandMediaKind,
  DocumentRecord,
  Id,
  LibraryEntry,
  LibraryEntrySummary,
  Sequence,
} from '@baocut/protocol';
import {
  AlertDialog,
  Button,
  DialogContainer,
  Header,
  Heading,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  ProgressCircle,
  Text,
  ToastQueue,
} from '@react-spectrum/s2';
import Add from '@react-spectrum/s2/icons/Add';
import Import from '@react-spectrum/s2/icons/Import';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import {
  BRAND_FILE_FILTERS,
  BRAND_SECTIONS,
  brandCandidates,
  captionStyleCandidates,
  captionStyleTargets,
  clipBrandName,
  isBrandMediaKind,
  nameFromPath,
  type BrandCandidate,
  type BrandSection,
  type CaptionStyleCandidate,
} from '../../model/library-brand.ts';
import { isVersionConflict, libraryErrorText } from '../../model/library-entry.ts';
import { useRuntime } from '../../runtime/context.tsx';
import { importLibraryFile, putLibraryEntry, removeLibraryEntry } from '../../runtime/library-commands.ts';
import { useLibrary } from '../../state/library-store.ts';
import { canEdit, useVideo } from '../../state/video-store.ts';
import { NameDialog } from '../name-dialog.tsx';
import { NewColorDialog } from './brand-color-dialog.tsx';
import { BrandRow, type BrandRowAction } from './brand-rows.tsx';
import { Note, SecHead } from './inspector-controls.tsx';
import { PanelHead, panelBody } from './panel-head.tsx';
import { saveCaptionStyleToBrand } from './brand-save.ts';
import { useBrandApply } from './use-brand-apply.ts';
import { BRAND_COPY as IB } from './brand-copy.ts';

const list = style({ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyleType: 'none' });
const hint = style({ margin: 0, marginTop: 8, font: 'ui-xs', color: 'gray-600' });
const loading = style({ display: 'flex', alignItems: 'center', gap: 8, font: 'ui-sm', color: 'gray-700' });

/** 导入对话框收的文件：各节的媒体，加上库条目（颜色、字幕样式）的 JSON。 */
function importFilters() {
  return [
    {
      name: IB.importFilter,
      extensions: [...new Set([...Object.values(BRAND_FILE_FILTERS).flatMap((filters) => filters.flatMap((f) => f.extensions)), 'json'])],
    },
  ];
}

/** 节名在用的时候按当前语言取。 */
function sectionTitle(kind: string): string | undefined {
  return BRAND_SECTIONS.find((section) => section.kind === kind)?.title;
}

type DialogState =
  | { type: 'rename'; entry: LibraryEntry }
  | { type: 'delete'; summary: LibraryEntrySummary }
  | { type: 'color' }
  | null;

const clip = clipBrandName;
const fileName = (path: string) => path.split(/[\\/]/).pop() || path;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * 编辑器 › 品牌（产品设计 §13.7，设计稿 panel-brand.jsx）：品牌库里的视频、图片、贴纸、品牌色、字体与字幕样式。
 * 品牌库在 Runtime Home 里、跨视频复用；放进视频是拷一份（`library.applyToVideo`），之后库里的修改与删除不影响视频。
 * 列表跟着 `library` 主题；条目的内容按版本读一次。模板（`overlayTemplate`）还没有，不画那一节。
 */
export function BrandPanel({
  sequence,
  assets,
  documents,
}: {
  sequence: Sequence;
  assets: Record<Id, AssetRecord>;
  documents: Record<Id, DocumentRecord>;
}) {
  const runtime = useRuntime();
  const ready = useLibrary((s) => s.ready);
  const brand = useLibrary((s) => s.brand);
  const editable = useVideo((s) => canEdit(s.video));
  const applyEntry = useBrandApply();
  const [dialog, setDialog] = useState<DialogState>(null);
  /** 正在往哪一节里添加（按钮转圈）。 */
  const [adding, setAdding] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const pickFiles = runtime.host.pickFiles;
  const hasCaptions = captionStyleTargets(sequence).length > 0;
  const styles = captionStyleCandidates(sequence, documents);

  const placeBlocked = (kind: string): string | null => {
    if (!editable) return IB.videoNotReady;
    if (kind === 'captionStyle' && !hasCaptions) return IB.noStylableCaptions;
    return null;
  };

  const importFiles = async () => {
    if (!pickFiles) return;
    const paths = await pickFiles({ title: IB.importTitle, buttonLabel: IB.import, filters: importFilters(), multiple: true });
    if (!paths.length) return;
    setImporting(true);
    try {
      for (const path of paths) {
        try {
          const entry = await importLibraryFile(runtime, path);
          // 进哪一节由 Runtime 按内容判：回执说真落点。
          if (entry.library === 'brand') {
            const content = entry.content as BrandContent;
            ToastQueue.positive(IB.imported(sectionTitle(content.kind) ?? IB.brand, content.name), { timeout: 4000 });
          } else {
            ToastQueue.neutral(entry.library === 'glossaries' ? IB.notBrandGlossary(fileName(path)) : IB.notBrandVoice(fileName(path)), {
              timeout: 6000,
            });
          }
        } catch (error) {
          ToastQueue.negative(IB.importFailed(fileName(path), messageOf(error)), { timeout: 6000 });
        }
      }
    } finally {
      setImporting(false);
    }
  };

  /** 本机文件存进某一节：每个文件一条，失败的逐个说原因。 */
  const addFiles = async (section: BrandSection & { kind: BrandMediaKind }) => {
    if (!pickFiles) return;
    const paths = await pickFiles({
      title: IB.addSection(section.title),
      buttonLabel: IB.add,
      filters: BRAND_FILE_FILTERS[section.kind],
      multiple: true,
    });
    if (!paths.length) return;
    setAdding(section.kind);
    let added = 0;
    try {
      for (const path of paths) {
        try {
          await putLibraryEntry(runtime, { library: 'brand', content: { name: nameFromPath(path), kind: section.kind }, source: { path } });
          added++;
        } catch (error) {
          ToastQueue.negative(IB.addFailed(fileName(path), messageOf(error)), { timeout: 6000 });
        }
      }
    } finally {
      setAdding(null);
    }
    if (added) ToastQueue.positive(IB.addedCount(section.title, added), { timeout: 4000 });
  };

  /** 这个视频里的一个素材存进某一节：生成的用产物，链接的用原文件。 */
  const addAsset = async (section: BrandSection & { kind: BrandMediaKind }, candidate: BrandCandidate) => {
    if (!candidate.source) return;
    setAdding(section.kind);
    try {
      const name = clip(candidate.asset.name) || IB.untitled;
      await putLibraryEntry(runtime, { library: 'brand', content: { name, kind: section.kind }, source: candidate.source });
      ToastQueue.positive(IB.addedOne(section.title, name), { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(libraryErrorText(IB.actionSaveToBrand, error), { timeout: 6000 });
    } finally {
      setAdding(null);
    }
  };

  /** 把视频里正在用的一份字幕样式存进来（读那份 `caption-style` 文档的当前版本）。 */
  const saveStyle = async (candidate: CaptionStyleCandidate) => {
    const record = documents[candidate.documentId];
    if (!record) return;
    setAdding('captionStyle');
    try {
      await saveCaptionStyleToBrand(runtime, record);
    } finally {
      setAdding(null);
    }
  };

  const addColor = async (name: string, value: string): Promise<boolean> => {
    try {
      await putLibraryEntry(runtime, { library: 'brand', content: { name: clip(name), kind: 'color', value } });
      ToastQueue.positive(IB.addedColor(clip(name)), { timeout: 4000 });
      return true;
    } catch (error) {
      ToastQueue.negative(libraryErrorText(IB.actionAddColor, error), { timeout: 6000 });
      return false;
    }
  };

  /** 改名：带文件的条目只给名字与种类（文件沿用当前版本的），颜色与字幕样式带上原内容。 */
  const rename = async (entry: LibraryEntry, name: string) => {
    const content = entry.content as BrandContent;
    const next = clip(name);
    if (!next || next === content.name) {
      setDialog(null);
      return;
    }
    try {
      await putLibraryEntry(runtime, {
        library: 'brand',
        id: entry.id,
        expectedVersion: entry.version,
        content: isBrandMediaKind(content.kind) ? { name: next, kind: content.kind } : { ...(content as Exclude<BrandContent, { file: unknown }>), name: next },
      });
      setDialog(null);
    } catch (error) {
      ToastQueue.negative(libraryErrorText(IB.actionRename, error), { timeout: 6000 });
      if (isVersionConflict(error)) setDialog(null);
    }
  };

  const remove = async (summary: LibraryEntrySummary) => {
    setDialog(null);
    try {
      await removeLibraryEntry(runtime, 'brand', summary.id);
      ToastQueue.positive(IB.removed(summary.name), { timeout: 4000 });
    } catch (error) {
      ToastQueue.negative(libraryErrorText(IB.actionDelete, error), { timeout: 6000 });
    }
  };

  const onAction = (action: BrandRowAction, summary: LibraryEntrySummary, entry: LibraryEntry | null) => {
    if (action === 'delete') return setDialog({ type: 'delete', summary });
    if (!entry) return;
    if (action === 'rename') return setDialog({ type: 'rename', entry });
    if (action === 'place') return void applyEntry(entry);
    const content = entry.content as BrandContent;
    if (action === 'copy' && content.kind === 'color') {
      navigator.clipboard.writeText(content.value).then(
        () => ToastQueue.positive(IB.copied(content.value), { timeout: 3000 }),
        (error: Error) => ToastQueue.negative(IB.copyFailed(error.message), { timeout: 5000 }),
      );
    }
  };

  return (
    <>
      <PanelHead title={IB.brand}>
        <Button variant="secondary" size="S" isDisabled={!pickFiles || !ready} isPending={importing} onPress={() => void importFiles()}>
          <Import />
          <Text>{IB.import}</Text>
        </Button>
      </PanelHead>
      <div className={`${panelBody} bc-scroll`}>
        {!pickFiles ? <Note>{IB.noFilePicker}</Note> : null}
        {!ready ? (
          <div className={loading}>
            <ProgressCircle aria-label={IB.loadingLibrary} size="S" isIndeterminate />
            {IB.loadingLibraryEllipsis}
          </div>
        ) : (
          BRAND_SECTIONS.map((section, index) => {
            const entries = brand.filter((entry) => entry.kind === section.kind);
            const kind = section.kind;
            let action = null;
            if (isBrandMediaKind(kind)) {
              const media = { ...section, kind };
              action = (
                <AddMenu
                  section={media}
                  candidates={brandCandidates(assets, kind)}
                  canPickFiles={!!pickFiles}
                  isPending={adding === kind}
                  onFiles={() => void addFiles(media)}
                  onAsset={(candidate) => void addAsset(media, candidate)}
                />
              );
            } else if (kind === 'color') {
              action = (
                <Button variant="secondary" size="S" onPress={() => setDialog({ type: 'color' })}>
                  <Add />
                  <Text>{IB.new}</Text>
                </Button>
              );
            } else {
              action = (
                <SaveStyle
                  candidates={styles}
                  isPending={adding === 'captionStyle'}
                  onSave={(candidate) => void saveStyle(candidate)}
                />
              );
            }
            return (
              <section key={kind} aria-label={section.title}>
                <SecHead first={index === 0} aside={entries.length ? IB.entryCount(entries.length) : null} action={action}>
                  {section.title}
                </SecHead>
                {entries.length ? (
                  <ul className={list} aria-label={section.title}>
                    {entries.map((summary) => (
                      <BrandRow key={summary.id} summary={summary} placeBlocked={placeBlocked(kind)} onAction={onAction} />
                    ))}
                  </ul>
                ) : (
                  <Note>{section.empty}</Note>
                )}
                {kind === 'captionStyle' && !styles.length ? (
                  <p className={hint}>
                    {hasCaptions ? IB.styleStillDefault : IB.noCaptionsToSave}
                  </p>
                ) : null}
                <p className={hint}>{section.hint}</p>
              </section>
            );
          })
        )}
      </div>

      {dialog?.type === 'rename' ? (
        <NameDialog
          title={IB.rename}
          label={IB.name}
          initial={(dialog.entry.content as BrandContent).name}
          submitLabel={IB.save}
          onClose={() => setDialog(null)}
          onSubmit={(name) => rename(dialog.entry, name)}
        />
      ) : null}
      {dialog?.type === 'color' ? <NewColorDialog onSubmit={addColor} onClose={() => setDialog(null)} /> : null}
      <DialogContainer onDismiss={() => setDialog(null)}>
        {dialog?.type === 'delete' ? (
          <AlertDialog
            variant="destructive"
            title={IB.deleteTitle(dialog.summary.name)}
            primaryActionLabel={IB.delete}
            cancelLabel={IB.cancel}
            onPrimaryAction={() => void remove(dialog.summary)}>
            {IB.deleteBody}
          </AlertDialog>
        ) : null}
      </DialogContainer>
    </>
  );
}

/** 媒体节的「添加」：本机文件，或这个视频里的素材（取不到原文件的灰着，写明原因）。 */
function AddMenu({
  section,
  candidates,
  canPickFiles,
  isPending,
  onFiles,
  onAsset,
}: {
  section: BrandSection;
  candidates: BrandCandidate[];
  canPickFiles: boolean;
  isPending: boolean;
  onFiles(): void;
  onAsset(candidate: BrandCandidate): void;
}) {
  const disabled = [
    ...(canPickFiles ? [] : ['files']),
    ...(candidates.length ? [] : ['none']),
    ...candidates.filter((candidate) => !candidate.source).map((candidate) => `asset:${candidate.asset.id}`),
  ];
  return (
    <MenuTrigger>
      <Button variant="secondary" size="S" isPending={isPending}>
        <Add />
        <Text>{IB.add}</Text>
      </Button>
      <Menu
        aria-label={IB.addSection(section.title)}
        disabledKeys={disabled}
        onAction={(key) => {
          if (key === 'files') return onFiles();
          const candidate = candidates.find((c) => `asset:${c.asset.id}` === key);
          if (candidate) onAsset(candidate);
        }}>
        <MenuSection>
          <MenuItem id="files" textValue={IB.localFiles}>
            <Import />
            <Text slot="label">{IB.localFilesEllipsis}</Text>
            {canPickFiles ? null : <Text slot="description">{IB.noFilePickerShort}</Text>}
          </MenuItem>
        </MenuSection>
        <MenuSection>
          <Header>
            <Heading>{IB.videoAssets}</Heading>
          </Header>
          {candidates.length ? (
            candidates.map((candidate) => (
              <MenuItem key={candidate.asset.id} id={`asset:${candidate.asset.id}`} textValue={candidate.asset.name}>
                <Text slot="label">{candidate.asset.name}</Text>
                {candidate.reason ? <Text slot="description">{candidate.reason}</Text> : null}
              </MenuItem>
            ))
          ) : (
            <MenuItem id="none" textValue={IB.none}>
              <Text slot="label">{IB.noAssetsOfKind}</Text>
            </MenuItem>
          )}
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}

/** 字幕样式节的「存当前样式」：视频里只用一份样式时直接存，几份时选一份；没有时灰着（原因写在节里）。 */
function SaveStyle({
  candidates,
  isPending,
  onSave,
}: {
  candidates: CaptionStyleCandidate[];
  isPending: boolean;
  onSave(candidate: CaptionStyleCandidate): void;
}) {
  const button = (onPress?: () => void) => (
    <Button variant="secondary" size="S" isDisabled={!candidates.length} isPending={isPending} onPress={onPress}>
      <Add />
      <Text>{IB.saveCurrentStyle}</Text>
    </Button>
  );
  if (candidates.length <= 1) return button(() => candidates[0] && onSave(candidates[0]));
  return (
    <MenuTrigger>
      {button()}
      <Menu
        aria-label={IB.whichStyle}
        onAction={(key) => {
          const candidate = candidates.find((c) => c.documentId === key);
          if (candidate) onSave(candidate);
        }}>
        {candidates.map((candidate) => (
          <MenuItem key={candidate.documentId} id={candidate.documentId} textValue={candidate.name}>
            <Text slot="label">{candidate.name}</Text>
            <Text slot="description">{IB.styleUses(candidate.uses)}</Text>
          </MenuItem>
        ))}
      </Menu>
    </MenuTrigger>
  );
}
