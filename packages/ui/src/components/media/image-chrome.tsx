import { useEffect, useRef, useState } from 'react';
import { ActionButton, MenuTrigger, Menu, MenuItem, Text, ToggleButton } from '@react-spectrum/s2';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import ChevronDown from '@react-spectrum/s2/icons/ChevronDown';
import Download from '@react-spectrum/s2/icons/Download';
import Close from '@react-spectrum/s2/icons/Close';
import Edit from '@react-spectrum/s2/icons/Edit';
import Comment from '@react-spectrum/s2/icons/Comment';
import Crop from '@react-spectrum/s2/icons/Crop';
import Images from '@react-spectrum/s2/icons/Images';
import { IMAGE as M } from '../image-preview-copy.ts';
import { PANEL } from '../panel-copy.ts';
import { IMAGE_ZOOMS, IMAGE_RATIOS, type ImageCandidate } from '../../model/image-preview.ts';
import { targetKey } from '../../model/media.ts';
import { useRuntime } from '../../runtime/context.tsx';
export function ImageChrome({
  name,
  gif,
  view,
  zoom,
  percent,
  onView,
  onZoom,
  onClose,
  onOpenTab,
  onDownload,
  onCopy,
  onPanorama,
  onDefaultOpen,
}: {
  name: string;
  gif?: boolean;
  view: string;
  zoom: string;
  percent: number;
  onView: (v: 'focused' | 'canvas') => void;
  onZoom: (v: string) => void;
  onClose?: () => void;
  onOpenTab?: () => void;
  onDefaultOpen?: () => void;
  onDownload: () => void;
  onCopy: () => void;
  onPanorama: () => void;
}) {
  return (
    <header className="bc-image-header">
      <MenuTrigger>
        <ActionButton aria-label={M.image}>
          <Text>
            <span className="bc-image-button-label">
              <ImageIcon />
              {view === 'canvas' ? M.canvasView : M.image}
              <ChevronDown />
            </span>
          </Text>
        </ActionButton>
        <Menu selectionMode="single" selectedKeys={[view]} onAction={(k) => onView(k as 'focused' | 'canvas')}>
          <MenuItem id="focused">{M.image}</MenuItem>
          <MenuItem id="canvas" isDisabled={gif}>
            {M.canvasView}
          </MenuItem>
        </Menu>
      </MenuTrigger>
      <span className="bc-image-name" title={name}>
        {name}
      </span>
      <MenuTrigger align="end">
        <ActionButton aria-label={M.fit}>
          <Text>
            <span className="bc-image-button-label">
              {Math.round(percent)}%<ChevronDown />
            </span>
          </Text>
        </ActionButton>
        <Menu selectionMode="single" selectedKeys={[zoom]} onAction={(k) => onZoom(String(k))}>
          <MenuItem id="fit">{M.fit}</MenuItem>
          {[...new Set([...IMAGE_ZOOMS, ...(zoom === 'fit' ? [] : [Number(zoom)])])]
            .sort((a, b) => a - b)
            .map((z) => (
              <MenuItem key={z} id={String(z)}>
                {z}%
              </MenuItem>
            ))}
        </Menu>
      </MenuTrigger>
      <MenuTrigger align="end">
        <ActionButton aria-label={M.more}>
          <Text>
            <span className="bc-image-button-label">
              {M.more}
              <ChevronDown />
            </span>
          </Text>
        </ActionButton>
        <Menu
          onAction={(k) => {
            if (k === 'tab') onOpenTab?.();
            if (k === 'copy') onCopy();
            if (k === 'panorama') onPanorama();
            if (k === 'default') onDefaultOpen?.();
          }}
        >
          {onDefaultOpen && <MenuItem id="default">{PANEL.openDefault}</MenuItem>}
          {onOpenTab && <MenuItem id="tab">{M.openTab}</MenuItem>}
          <MenuItem id="copy">{M.copy}</MenuItem>
          <MenuItem id="panorama">{M.panorama}</MenuItem>
        </Menu>
      </MenuTrigger>
      <ActionButton aria-label={M.download} onPress={onDownload}>
        <Download />
      </ActionButton>
      {onClose && (
        <ActionButton aria-label={M.cancel} onPress={onClose}>
          <Close />
        </ActionButton>
      )}
    </header>
  );
}
export function ImageTools({
  gif,
  commenting,
  disabled,
  onComment,
  onMarkup,
  onErase,
  onBackground,
  onRatio,
  onSelect,
}: {
  gif?: boolean;
  commenting: boolean;
  disabled: boolean;
  onComment: () => void;
  onMarkup: () => void;
  onErase: () => void;
  onBackground: () => void;
  onRatio: (r: string) => void;
  onSelect: () => void;
}) {
  return (
    <div className="bc-image-tools" role="toolbar" aria-label={M.markup}>
      {!gif && (
        <ActionButton size="S" isQuiet onPress={onMarkup}>
          <Edit />
          <Text>{M.markup}</Text>
        </ActionButton>
      )}
      <ToggleButton size="S" isQuiet isSelected={commenting} onPress={onComment}>
        <Comment />
        <Text>{M.annotations}</Text>
      </ToggleButton>
      {!gif && (
        <ActionButton size="S" isQuiet isDisabled={disabled} onPress={onBackground}>
          <ImageIcon />
          <Text>{M.removeBg}</Text>
        </ActionButton>
      )}
      {!gif && (
        <ActionButton size="S" isQuiet onPress={onErase}>
          <Edit />
          <Text>{M.erase}</Text>
        </ActionButton>
      )}
      <MenuTrigger direction="top">
        <ActionButton size="S" isQuiet isDisabled={disabled}>
          <Crop />
          <Text>{M.ratio}</Text>
        </ActionButton>
        <Menu onAction={(k) => onRatio(String(k))}>
          {IMAGE_RATIOS.map((r) => (
            <MenuItem key={r} id={r}>
              {r}
            </MenuItem>
          ))}
        </Menu>
      </MenuTrigger>
      {!gif && (
        <ActionButton size="S" isQuiet aria-label={M.select} onPress={onSelect}>
          <Images />
        </ActionButton>
      )}
    </div>
  );
}
export function ImageRail({
  files,
  selected,
  onSelect,
}: {
  files: ImageCandidate[];
  selected: string;
  onSelect: (c: ImageCandidate) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const e = ref.current,
      item = e?.querySelector<HTMLElement>('[aria-current="true"]');
    if (e && item) {
      const top = item.getBoundingClientRect().top - e.getBoundingClientRect().top + e.scrollTop;
      if (top < e.scrollTop || top + item.offsetHeight > e.scrollTop + e.clientHeight)
        e.scrollTop = top - (e.clientHeight - item.offsetHeight) / 2;
    }
  }, [selected]);
  return (
    <span ref={ref} className="bc-image-rail" role="group" aria-label={M.gallery}>
      {files.map((file, index) => (
        <ImageThumbnail
          key={targetKey(file.target)}
          file={file}
          selected={targetKey(file.target) === selected}
          onSelect={() => onSelect(file)}
          onKey={(key) => {
            const next =
              key === 'Home'
                ? 0
                : key === 'End'
                  ? files.length - 1
                  : key === 'ArrowUp' || key === 'ArrowLeft'
                    ? Math.max(0, index - 1)
                    : key === 'ArrowDown' || key === 'ArrowRight'
                      ? Math.min(files.length - 1, index + 1)
                      : null;
            if (next === null) return false;
            onSelect(files[next]!);
            ref.current?.querySelectorAll('button')[next]?.focus();
            return true;
          }}
        />
      ))}
    </span>
  );
}
export function ImageThumbnail({
  file,
  selected,
  onSelect,
  onKey,
}: {
  file: ImageCandidate;
  selected: boolean;
  onSelect: () => void;
  onKey?: (key: string) => boolean;
}) {
  const runtime = useRuntime(),
    [url, setUrl] = useState(file.handle?.url);
  const key = targetKey(file.target);
  useEffect(() => {
    if (file.handle) return;
    let cancelled = false;
    void runtime
      .resolveMedia(file.target)
      .then((h) => {
        if (!cancelled) setUrl(h.url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [runtime, key, file.handle]);
  return (
    <ActionButton
      UNSAFE_className="bc-image-thumb"
      aria-label={file.name}
      aria-current={selected ? 'true' : undefined}
      onPress={onSelect}
      onKeyDown={(e) => {
        if (onKey?.(e.key)) e.preventDefault();
      }}
    >
      {url ? <img src={url} alt="" /> : file.name}
    </ActionButton>
  );
}
