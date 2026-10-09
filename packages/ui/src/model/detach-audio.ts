import type { AssetRecord, AudioMix, EditOperation, Sequence, VideoItem } from '@baocut/protocol';

/**
 * 分离音频（BaoCut v2 视频条子的「分离音频」）：一笔事务里新建一条音频轨，把视频片段自带的声音放成一段音频——同一素材、
 * 同一时间映射、同起点同长度，音量、淡入淡出与包络照抄——再关掉视频自带的声音（`setAudioMix.muted`，引擎写成
 * `embeddedAudio.enabled: false`）。撤销一步回去。新的音频片段不带视频的作用（`broll` 等只给画面）与扩展。
 */

/** 同一事务里新建音频轨的 `ref`。 */
export const DETACH_TRACK_REF = 'detached-audio';

/** 这一段有没有声音可分：素材有音轨、自带的声音开着、按恒定速率播放（定格没有声音）。 */
export function canDetachAudio(item: VideoItem, asset: AssetRecord | undefined): boolean {
  return !!asset?.revisions[item.assetRef.revision]?.audio && item.embeddedAudio.enabled && item.timeMap.kind === 'linear';
}

/** 分离这一段的声音的那一笔操作。 */
export function detachAudioOperations(sequence: Sequence, item: VideoItem): EditOperation[] {
  const { fps } = sequence;
  const { enabled: _enabled, envelope, ...fades } = item.embeddedAudio;
  const mix: AudioMix = envelope?.length ? { ...fades, envelope } : fades;
  return [
    { type: 'addTrack', sequenceId: sequence.id, kind: 'audio', ref: DETACH_TRACK_REF },
    {
      type: 'insertItems',
      sequenceId: sequence.id,
      items: [
        {
          type: 'audio',
          trackRef: DETACH_TRACK_REF,
          assetRef: item.assetRef,
          fromFrame: item.span.fromFrame,
          subframeOffset: { ticks: '0', timescale: 1 },
          // 帧数换成精确时间：durationFrames × den / num 秒，不经浮点。
          playDuration: { ticks: String(item.span.durationFrames * fps.den), timescale: fps.num },
          timeMap: item.timeMap,
          mix,
          ...(item.name !== undefined ? { name: item.name } : {}),
        },
      ],
    },
    { type: 'setAudioMix', sequenceId: sequence.id, itemId: item.id, muted: true },
  ];
}
