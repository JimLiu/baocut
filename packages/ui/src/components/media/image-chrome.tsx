import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
  ActionButton,
  MenuTrigger,
  Menu,
  MenuItem,
  Picker,
  PickerItem,
  SegmentedControl,
  SegmentedControlItem,
  Text,
  ToggleButton,
  Tooltip,
  TooltipTrigger,
} from '@react-spectrum/s2';
import ImageIcon from '@react-spectrum/s2/icons/Image';
import ViewGrid from '@react-spectrum/s2/icons/ViewGrid';
import Download from '@react-spectrum/s2/icons/Download';
import More from '@react-spectrum/s2/icons/More';
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
import { mediaHeaderTitle } from './theme.tsx';
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
  const zooms = [...new Set([...IMAGE_ZOOMS, ...(zoom === 'fit' ? [] : [Number(zoom)])])].sort((a, b) => a - b);
  return (
    <header className="bc-image-header">
      <SegmentedControl aria-label={M.view} selectedKey={view} onSelectionChange={(k) => onView(k as 'focused' | 'canvas')}>
        <SegmentedControlItem id="focused">
          <ImageIcon />
          <Text>{M.image}</Text>
        </SegmentedControlItem>
        <SegmentedControlItem id="canvas" isDisabled={gif}>
          <ViewGrid />
          <Text>{M.canvasView}</Text>
        </SegmentedControlItem>
      </SegmentedControl>
      <span className={`bc-image-name ${mediaHeaderTitle}`} title={name}>
        {name}
      </span>
      <Picker
        aria-label={M.zoom}
        isQuiet
        align="end"
        value={zoom}
        onChange={(k) => k != null && onZoom(String(k))}
        renderValue={() => `${Math.round(percent)}%`}
      >
        <PickerItem id="fit">{M.fit}</PickerItem>
        {zooms.map((z) => (
          <PickerItem key={z} id={String(z)}>{`${z}%`}</PickerItem>
        ))}
      </Picker>
      {/* ActionMenu 套不上提示，拆成 MenuTrigger 里包 TooltipTrigger 的按钮。 */}
      <MenuTrigger align="end">
        <Tip label={M.more}>
          <ActionButton isQuiet aria-label={M.more}>
            <More />
          </ActionButton>
        </Tip>
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
      <Tip label={M.download}>
        <ActionButton isQuiet aria-label={M.download} onPress={onDownload}>
          <Download />
        </ActionButton>
      </Tip>
      {onClose && (
        <Tip label={M.close}>
          <ActionButton isQuiet aria-label={M.close} onPress={onClose}>
            <Close />
          </ActionButton>
        </Tip>
      )}
    </header>
  );
}
/** 查看器里只有图标的按钮都配说明提示；表头的朝下弹，底部工具条的朝上弹。 */
export function Tip({
  label,
  placement = 'bottom',
  children,
}: {
  label: string;
  placement?: 'top' | 'bottom';
  children: ReactElement;
}) {
  return (
    <TooltipTrigger placement={placement}>
      {children}
      <Tooltip>{label}</Tooltip>
    </TooltipTrigger>
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
        <Tip label={M.select} placement="top">
          <ActionButton size="S" isQuiet aria-label={M.select} onPress={onSelect}>
            <Images />
          </ActionButton>
        </Tip>
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
      const box = e.getBoundingClientRect(),
        rect = item.getBoundingClientRect();
      const top = rect.top - box.top + e.scrollTop,
        left = rect.left - box.left + e.scrollLeft;
      if (top < e.scrollTop || top + item.offsetHeight > e.scrollTop + e.clientHeight)
        e.scrollTop = top - (e.clientHeight - item.offsetHeight) / 2;
      if (left < e.scrollLeft || left + item.offsetWidth > e.scrollLeft + e.clientWidth)
        e.scrollLeft = left - (e.clientWidth - item.offsetWidth) / 2;
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
/** 全屏查看器底部的缩略图条：平时隐藏，指针移到底边、键盘焦点进入或刚换图时显示；没有悬停的设备一直显示。 */
export function ImageDock({
  files,
  selected,
  onSelect,
}: {
  files: ImageCandidate[];
  selected: string;
  onSelect: (c: ImageCandidate) => void;
}) {
  const [peek, setPeek] = useState(true);
  useEffect(() => {
    setPeek(true);
    const timer = setTimeout(() => setPeek(false), 1500);
    return () => clearTimeout(timer);
  }, [selected]);
  return (
    <div className={`bc-image-dock ${peek ? 'is-peek' : ''}`}>
      <ImageRail files={files} selected={selected} onSelect={onSelect} />
    </div>
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
