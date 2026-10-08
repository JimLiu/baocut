import { defineMessages, type CaptionItem, type DocumentRecord, type Id, type Sequence, type Track } from '@baocut/protocol';
import { trackRows } from './editor.ts';
import { zhHans } from './export-lanes.zh-Hans.ts';
import { zhHant } from './export-lanes.zh-Hant.ts';
import { ja } from './export-lanes.ja.ts';
import { ko } from './export-lanes.ko.ts';
import { es } from './export-lanes.es.ts';
import { fr } from './export-lanes.fr.ts';
import { de } from './export-lanes.de.ts';
import { nl } from './export-lanes.nl.ts';
import { ptBR } from './export-lanes.pt-BR.ts';
import { it } from './export-lanes.it.ts';
import { ru } from './export-lanes.ru.ts';
import { pl } from './export-lanes.pl.ts';
import { tr } from './export-lanes.tr.ts';
import { vi } from './export-lanes.vi.ts';

/** 导出弹层轨道清单的文案（英文是键与类型的来源，译文在 `export-lanes.zh-Hans.ts`）。 */
const en = {
  hidden: 'Hidden on the timeline',
  otherSolo: 'Another track is soloed',
  muted: 'Muted on the timeline',
  otherSoloAudio: 'Another track is soloed',
  subtitles: 'Subtitles',
  names: (names: readonly string[]) => names.join(', '),
  sound: (reason: string) => `Sound: ${reason}`,
  clips: (n: number) => (n === 1 ? '1 clip' : `${n} clips`),
  sounds: (n: number) => (n === 1 ? '1 audio clip' : `${n} audio clips`),
};
export type ExportLanesMessages = typeof en;
const M = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });

/**
 * 导出弹层的「画面里有什么」「声音里有什么」（设计稿 export.jsx 的 `Lane`、export-audio.jsx 的 `soundLanes`）：
 * 时间轴上每条轨道这次会不会进画面、会不会出声。
 *
 * 规则与渲染一致（crates/render-graph `TrackRules`）：隐藏只影响画面，静音只影响声音；独显 / 独听分视觉组与音频组
 * 各自生效——有轨道在独显时，别的视觉轨不进画面。
 *
 * 设计稿在这里可以逐轨拨开关、只对这次导出生效，再「同步到时间轴」；Runtime 的导出没有逐轨覆盖的参数
 * （只有 `burnCaptions` 能决定字幕烧不烧进画面），所以这里只读：开关跟着时间轴，要改回时间轴上改。
 */

export interface ExportLane {
  trackId: Id;
  kind: Track['kind'];
  /** 与时间轴行头同一个叫法：「画面」「音频 2」「字幕 · 英文」。 */
  label: string;
  /** 一句说明：「3 个片段」「2 段声音」「访谈转写」。 */
  sub: string;
  /** 画面：视觉轨与字幕轨这次画不画；音频轨 null。 */
  picture: boolean | null;
  /** 声音：音频轨与带声音的视觉轨这次出不出声；字幕轨、没有声音的视觉轨 null。 */
  sound: boolean | null;
  /** 关着的原因：「时间轴上隐藏」「别的轨在独显」「时间轴上静音」「别的轨在独听」。 */
  reason: string | null;
}

function soloRules(tracks: readonly Track[]) {
  const visualSolo = tracks.some((t) => t.solo.enabled && t.solo.group === 'visual');
  const audioSolo = tracks.some((t) => t.solo.enabled && t.solo.group === 'audio');
  return {
    visible: (t: Track) => t.visible && (!visualSolo || (t.solo.enabled && t.solo.group === 'visual')),
    audible: (t: Track) => !t.muted && (!audioSolo || (t.solo.enabled && t.solo.group === 'audio')),
    hiddenReason: (t: Track) => (!t.visible ? M.hidden : M.otherSolo),
    mutedReason: (t: Track) => (t.muted ? M.muted : M.otherSoloAudio),
  };
}

/** 时间轴上的轨道，顺序与时间轴一致（字幕在上，画面按叠放，音频在下）；一个启用实例都没有的轨道不列。 */
export function exportLanes(sequence: Sequence, documents: Record<Id, DocumentRecord>): ExportLane[] {
  const rules = soloRules(sequence.tracks);
  const lanes: ExportLane[] = [];
  for (const { track, label } of trackRows(sequence)) {
    const items = sequence.items.filter((i) => i.trackId === track.id && i.enabled);
    if (!items.length) continue;
    if (track.kind === 'subtitle') {
      const names = [...new Set(items.filter((i): i is CaptionItem => i.type === 'caption').map((i) => documents[i.documentId]?.name ?? M.subtitles))];
      const on = rules.visible(track);
      lanes.push({ trackId: track.id, kind: track.kind, label, sub: (names.length ? M.names(names) : '') || M.subtitles, picture: on, sound: null, reason: on ? null : rules.hiddenReason(track) });
    } else if (track.kind === 'visual') {
      const picture = rules.visible(track);
      const voiced = items.some((i) => (i.type === 'video' && i.embeddedAudio.enabled) || (i.type === 'composition' && i.audio?.enabled));
      const sound = voiced ? rules.audible(track) : null;
      const reason = !picture ? rules.hiddenReason(track) : sound === false ? M.sound(rules.mutedReason(track)) : null;
      lanes.push({ trackId: track.id, kind: track.kind, label, sub: M.clips(items.length), picture, sound, reason });
    } else {
      const sound = rules.audible(track);
      lanes.push({ trackId: track.id, kind: track.kind, label, sub: M.sounds(items.length), picture: null, sound, reason: sound ? null : rules.mutedReason(track) });
    }
  }
  return lanes;
}

/** 一行这次进不进成片：画面或声音有一样在就算。 */
export function laneOn(lane: ExportLane): boolean {
  return lane.picture === true || lane.sound === true;
}

/** 声音里有什么：出声的轨道（音频轨，与带声音的视觉轨）。 */
export function soundLanes(lanes: readonly ExportLane[]): ExportLane[] {
  return lanes.filter((l) => l.sound !== null);
}
