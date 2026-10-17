import { useEffect, useState } from 'react';
import Markdown from 'react-markdown';
import type { MediaHandle, SkillFileEntry } from '@baocut/protocol';
import { ProgressCircle, SegmentedControl, SegmentedControlItem, TextArea } from '@react-spectrum/s2';
import AudioWave from '@react-spectrum/s2/icons/AudioWave';
import FileIcon from '@react-spectrum/s2/icons/File';
import Folder from '@react-spectrum/s2/icons/Folder';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import InfoCircle from '@react-spectrum/s2/icons/InfoCircle';
import Play from '@react-spectrum/s2/icons/Play';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { isSkillAssetPath, isSkillScriptPath, skillFileKind } from '@baocut/protocol';
import { fileSizeLabel, skillErrorMessage } from '../../model/agent-skills.ts';
import { assetKindOf, fileTree, previewOf, splitFrontMatter, type SkillAsset } from '../../model/skills-page.ts';
import { remarkPlugins } from '../thread/remark-plugins.ts';
import { DETAIL_COPY, FILES_COPY } from './skills-copy.ts';
import '../thread/markdown.css';

/** 文件从哪里读：skill（某个版本）或项目品牌。`key` 变了就重读。 */
export interface FileSource {
  key: string;
  readText(path: string): Promise<string>;
  openHandle(path: string): Promise<MediaHandle>;
}

type Load<T> = { key: string; state: 'loading' } | { key: string; state: 'ready'; value: T } | { key: string; state: 'failed'; message: string };

/** 按 `key` 取一次；`key` 为 null 时不取。 */
export function useLoad<T>(key: string | null, load: () => Promise<T>): Load<T> | null {
  const [value, setValue] = useState<Load<T> | null>(null);
  useEffect(() => {
    if (key === null) return undefined;
    let cancelled = false;
    setValue({ key, state: 'loading' });
    load().then(
      (v) => !cancelled && setValue({ key, state: 'ready', value: v }),
      (error) => !cancelled && setValue({ key, state: 'failed', message: skillErrorMessage(error, 'read') }),
    );
    return () => {
      cancelled = true;
    };
    // load 只经 key 生效。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null) return null;
  return value && value.key === key ? value : { key, state: 'loading' };
}

const note = style({
  display: 'flex',
  alignItems: 'start',
  gap: 8,
  margin: 0,
  paddingY: 8,
  paddingX: 12,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  font: 'ui-sm',
  color: 'gray-800',
});
const noteIcon = style({ display: 'flex', flexShrink: 0, color: 'gray-700', paddingTop: 2 });

export function Note({ children }: { children: string }) {
  return (
    <p className={note} role="note">
      <span className={noteIcon}>
        <InfoCircle />
      </span>
      <span>{children}</span>
    </p>
  );
}

const pre = style({
  margin: 0,
  padding: 12,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  font: 'code-sm',
  color: 'gray-800',
  whiteSpace: 'pre-wrap',
  overflowWrap: 'anywhere',
  userSelect: 'text',
});

export function Code({ children, label }: { children: string; label?: string }) {
  return (
    <pre className={pre} aria-label={label}>
      {children}
    </pre>
  );
}

/* ---------- 素材栏 ---------- */

const assetGrid = style({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 12 });
const assetCard = style({
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  padding: 8,
  minWidth: 0,
  boxSizing: 'border-box',
  borderRadius: 'lg',
  borderWidth: 1,
  borderStyle: 'solid',
  borderColor: { default: 'gray-200', ':hover': 'gray-300' },
  backgroundColor: 'gray-25',
  textAlign: 'start',
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineColor: 'focus-ring',
});
const thumb = style({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: 80,
  borderRadius: 'default',
  backgroundColor: 'gray-100',
  color: 'gray-600',
  overflow: 'hidden',
});
const thumbImg = style({ maxWidth: 'full', maxHeight: 'full', objectFit: 'contain' });
const assetName = style({ font: 'ui-sm', fontWeight: 'medium', color: 'gray-900', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const assetMeta = style({ font: 'ui-xs', color: 'gray-600' });
const fontMark = style({ font: 'title', color: 'gray-700' });

function AssetThumb({ asset, source }: { asset: SkillAsset; source: FileSource }) {
  const picture = asset.kind === 'svg' || asset.kind === 'image';
  const handle = useLoad(picture ? `${source.key}:${asset.path}` : null, () => source.openHandle(asset.path));
  if (picture) {
    return handle?.state === 'ready' ? <img className={thumbImg} src={handle.value.url} alt="" /> : <ImageIcon />;
  }
  if (asset.kind === 'audio') return <AudioWave />;
  if (asset.kind === 'video') return <Play />;
  return <span className={fontMark}>Aa</span>;
}

/** 素材缩略图：图片与 svg 画出来，音频、视频、字体给类型与大小；点一个打开文件页签选中它。 */
export function AssetGallery({ assets, source, onOpen }: { assets: readonly SkillAsset[]; source: FileSource; onOpen(path: string): void }) {
  return (
    <div className={assetGrid}>
      {assets.map((a) => (
        <button key={a.path} type="button" className={assetCard} aria-label={DETAIL_COPY.viewAsset(a.path)} onClick={() => onOpen(a.path)}>
          <span className={thumb}>
            <AssetThumb asset={a} source={source} />
          </span>
          <span className={assetName} title={a.path}>
            {a.name}
          </span>
          <span className={assetMeta}>{fileSizeLabel(a.size)}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- 文件页签 ---------- */

const browser = style({
  display: 'grid',
  gridTemplateColumns: { default: ['minmax(180px, 240px)', 'minmax(0, 1fr)'], '@container (max-width: 640px)': ['minmax(0, 1fr)'] },
  gap: 16,
  minHeight: 360,
});
const tree = style({ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 });
const treeDir = style({ display: 'flex', alignItems: 'center', gap: '[6px]', minHeight: 28, font: 'ui-sm', color: 'gray-600' });
const treeFile = style({
  display: 'flex',
  alignItems: 'center',
  gap: '[6px]',
  minHeight: 28,
  paddingEnd: 8,
  boxSizing: 'border-box',
  borderStyle: 'none',
  borderRadius: 'default',
  backgroundColor: { default: 'transparent', ':hover': 'gray-100', isOn: 'gray-200' },
  font: 'ui-sm',
  color: 'gray-800',
  textAlign: 'start',
  cursor: 'pointer',
  outlineStyle: { default: 'none', ':focus-visible': 'solid' },
  outlineWidth: 2,
  outlineOffset: -2,
  outlineColor: 'focus-ring',
});
const treeName = style({ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', font: 'code-sm' });
const treeTag = style({ flexShrink: 0, font: 'ui-xs', color: 'gray-600' });
const view = style({ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 });
const viewHead = style({ display: 'flex', alignItems: 'center', gap: 8, minHeight: 32 });
const viewPath = style({ flexGrow: 1, minWidth: 0, font: 'code-sm', color: 'gray-700', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' });
const markdown = style({ padding: 16, borderRadius: 'lg', backgroundColor: 'gray-50', overflowWrap: 'anywhere', userSelect: 'text' });
const picture = style({
  display: 'flex',
  justifyContent: 'center',
  padding: 16,
  borderRadius: 'lg',
  backgroundColor: 'gray-100',
});
const pictureImg = style({ maxWidth: 'full', maxHeight: 480, objectFit: 'contain' });
const binary = style({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  paddingY: 40,
  borderRadius: 'lg',
  backgroundColor: 'gray-50',
  font: 'ui-sm',
  color: 'gray-700',
});
const binaryName = style({ font: 'ui', fontWeight: 'bold', color: 'gray-900' });
const quiet = style({ margin: 0, font: 'ui-sm', color: 'gray-600' });
const editor = style({ width: 'full' });

/** 文件树，选中的那个高亮；素材与脚本标出来。 */
function FileTree({
  files,
  first,
  selected,
  onSelect,
}: {
  files: readonly SkillFileEntry[];
  first: string;
  selected: string | null;
  onSelect(path: string): void;
}) {
  return (
    <nav className={tree} aria-label={FILES_COPY.tree}>
      {fileTree(files, first).map((node) =>
        node.kind === 'dir' ? (
          <div key={`d:${node.path}`} className={treeDir} style={{ paddingInlineStart: node.depth * 16 + 8 }}>
            <Folder />
            <span>{node.name}</span>
          </div>
        ) : (
          <button
            key={node.path}
            type="button"
            className={treeFile({ isOn: node.path === selected })}
            style={{ paddingInlineStart: node.depth * 16 + 8 }}
            aria-current={node.path === selected ? 'true' : undefined}
            onClick={() => onSelect(node.path)}>
            <span className={treeName}>{node.name}</span>
            {isSkillAssetPath(node.path) ? <span className={treeTag}>{FILES_COPY.asset}</span> : null}
            {isSkillScriptPath(node.path) ? <span className={treeTag}>{FILES_COPY.script}</span> : null}
          </button>
        ),
      )}
    </nav>
  );
}

export interface FileEditing {
  /** 编辑中的文本（改过的）；没改过的由视图读原文。 */
  texts: Readonly<Record<string, string>>;
  /** 从本机加进来、还没存的文件：不预览。 */
  added: Readonly<Record<string, unknown>>;
  onText(path: string, text: string, original: string): void;
}

/**
 * 「文件」页签的主体（原型 page-skill-detail.jsx `FilesTab` 的树与 `FileView`）：左边文件树，右边按类型预览——Markdown 与 svg
 * 可切预览 / 源码，图片画出来，音频、视频可播放，脚本标明不会运行，其余二进制只给信息。`editing` 时文本文件换成编辑框。
 */
export function FileBrowser({
  files,
  first,
  selected,
  onSelect,
  source,
  editing,
}: {
  files: readonly SkillFileEntry[];
  first: string;
  selected: string | null;
  onSelect(path: string): void;
  source: FileSource;
  editing?: FileEditing | null;
}) {
  const file = files.find((f) => f.path === selected) ?? files.find((f) => f.path === first) ?? files[0] ?? null;
  return (
    <div className={browser}>
      <FileTree files={files} first={first} selected={file?.path ?? null} onSelect={onSelect} />
      <div className={view} aria-label={file?.path}>
        {file ? <FileView key={`${source.key}:${file.path}`} file={file} source={source} editing={editing ?? null} /> : <p className={quiet}>{FILES_COPY.pick}</p>}
      </div>
    </div>
  );
}

function FileView({ file, source, editing }: { file: SkillFileEntry; source: FileSource; editing: FileEditing | null }) {
  const kind = previewOf(file.path);
  const added = !!editing?.added[file.path];
  const textual = file.text && !added;
  const [mode, setMode] = useState<'preview' | 'source'>('preview');
  const text = useLoad(textual ? `${source.key}:${file.path}` : null, () => source.readText(file.path));
  const media = useLoad(!added && (kind === 'svg' || kind === 'image' || kind === 'audio' || kind === 'video') ? `${source.key}:${file.path}:h` : null, () =>
    source.openHandle(file.path),
  );
  const size = fileSizeLabel(file.size);
  const canPreview = textual && (kind === 'markdown' || kind === 'svg');

  const head = (
    <div className={viewHead}>
      <span className={viewPath} title={file.path}>{`${file.path} · ${size}`}</span>
      {canPreview && !editing ? (
        <SegmentedControl aria-label={FILES_COPY.previewMode} selectedKey={mode} onSelectionChange={(key) => setMode(key as 'preview' | 'source')}>
          <SegmentedControlItem id="preview">{FILES_COPY.preview}</SegmentedControlItem>
          <SegmentedControlItem id="source">{FILES_COPY.source}</SegmentedControlItem>
        </SegmentedControl>
      ) : null}
    </div>
  );

  if (textual) {
    if (!text || text.state === 'loading') return <>{head}<ProgressCircle isIndeterminate size="S" aria-label={FILES_COPY.loading} /></>;
    if (text.state === 'failed') return <>{head}<p className={quiet}>{FILES_COPY.loadFailed(text.message)}</p></>;
    const original = text.value;
    if (editing) {
      return (
        <>
          {head}
          <TextArea
            aria-label={FILES_COPY.editLabel(file.path)}
            value={editing.texts[file.path] ?? original}
            onChange={(value) => editing.onText(file.path, value, original)}
            styles={editor}
          />
        </>
      );
    }
    if (mode === 'preview' && kind === 'markdown') {
      const { front, body } = splitFrontMatter(original);
      return (
        <>
          {head}
          {front !== null ? <Code label={FILES_COPY.frontMatter}>{`---\n${front}\n---`}</Code> : null}
          <div className={`${markdown} bc-md`}>
            <Markdown remarkPlugins={remarkPlugins}>{body}</Markdown>
          </div>
        </>
      );
    }
    if (mode === 'preview' && kind === 'svg' && media?.state === 'ready') {
      return (
        <>
          {head}
          <div className={picture}>
            <img className={pictureImg} src={media.value.url} alt={file.path} />
          </div>
        </>
      );
    }
    return (
      <>
        {head}
        {isSkillScriptPath(file.path) ? <Note>{FILES_COPY.scriptNote}</Note> : null}
        <Code>{original}</Code>
      </>
    );
  }

  if (media?.state === 'ready') {
    const url = media.value.url;
    if (kind === 'image' || kind === 'svg')
      return (
        <>
          {head}
          <div className={picture}>
            <img className={pictureImg} src={url} alt={file.path} />
          </div>
        </>
      );
    if (kind === 'audio')
      return (
        <>
          {head}
          <audio controls src={url} aria-label={file.path} />
        </>
      );
    if (kind === 'video')
      return (
        <>
          {head}
          <video controls src={url} aria-label={file.path} style={{ maxWidth: '100%', maxHeight: 480 }} />
        </>
      );
  }
  if (media?.state === 'loading') return <>{head}<ProgressCircle isIndeterminate size="S" aria-label={FILES_COPY.loading} /></>;
  const assetKind = assetKindOf(skillFileKind(file.path));
  const Icon = assetKind === 'image' ? ImageIcon : assetKind === 'audio' ? AudioWave : assetKind === 'video' ? Play : FileIcon;
  return (
    <>
      {head}
      <div className={binary}>
        <Icon />
        <span className={binaryName}>{file.path.split('/').pop()}</span>
        <span>{FILES_COPY.binary(FILES_COPY.kind[assetKind ?? 'other'] ?? FILES_COPY.kind.other!, size)}</span>
      </div>
    </>
  );
}
