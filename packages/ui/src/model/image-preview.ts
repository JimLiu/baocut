import type { MediaTarget, MediaHandle, SpaceEntry } from '@baocut/protocol';
import { targetKey } from './media.ts';

export interface ImageCandidate { target: MediaTarget; name: string; handle?: MediaHandle; temporary?: boolean; conversationId?:string; generated?:boolean; order?: readonly [number, number] }
export interface ImagePoint { x: number; y: number }
export interface ImageRegion extends ImagePoint { width: number; height: number }
export interface ImageComment { id: string; region: ImageRegion; text: string }
export const IMAGE_ZOOMS = [10, 25, 50, 75, 100, 125, 150, 200, 300, 400];
export const IMAGE_RATIOS = ['1:1', '3:4', '9:16', '4:3', '16:9'];
export function imagePoint(client: ImagePoint, bounds: { left: number; top: number; width: number; height: number }): ImagePoint | null {
  if (bounds.width <= 0 || bounds.height <= 0) return null;
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  return { x: clamp((client.x - bounds.left) / bounds.width), y: clamp((client.y - bounds.top) / bounds.height) };
}
export function imageRegion(a: ImagePoint, b: ImagePoint): ImageRegion {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}
export function imageFit(natural: { width: number; height: number }, viewport: { width: number; height: number }): number {
  return Math.max(0.05, Math.min(1, Math.max(0, viewport.width - 48) / natural.width, Math.max(0, viewport.height - 48) / natural.height));
}
export function imageZoomStep(percent: number, delta: number): number {
  return delta > 0 ? IMAGE_ZOOMS.find(n => n > percent) ?? 400 : [...IMAGE_ZOOMS].reverse().find(n => n < percent) ?? 10;
}
/** 只把同一生成任务的候选放在一起；普通图片保持独立，不按目录猜分组。 */
export function generatedImageGallery(current: ImageCandidate, entries: readonly SpaceEntry[]): ImageCandidate[] {
  const entry = 'entryId' in current.target ? entries.find(e => e.id === (current.target as { entryId: string }).entryId) : undefined;
  if (!entry?.origin?.jobId) return [current];
  const group = entries.filter(e => e.kind === 'image' && !e.user.trashedAt && e.origin?.jobId === entry.origin?.jobId &&
    e.origin?.conversationId === entry.origin?.conversationId && e.source.projectId === entry.source.projectId)
    .map(e => ({ target: { entryId: e.id }, name: e.name, conversationId:e.origin?.conversationId??undefined, generated:true }));
  return group.some(e => targetKey(e.target) === targetKey(current.target)) ? group : [current];
}
export const appendImageRequest = (draft: string, request: string): string => draft ? `${draft}\n\n${request}` : request;

/** 每次播放只保留一个预览播放器；隐藏标签和卸载另由宿主管理。 */
export function pauseOtherPreviews(current: HTMLMediaElement | null): void {
  document.querySelectorAll<HTMLMediaElement>('[data-bc-media-preview]').forEach(media => { if (media !== current) media.pause(); });
}

export function canvasImageCandidates(current:ImageCandidate[],groups:Record<string,ImageCandidate[]>,conversationId?:string|null):ImageCandidate[]{
  if(!conversationId||!current.some(c=>c.generated))return current;
  const combined=[...current,...Object.values(groups).flat().filter(c=>c.generated&&c.conversationId===conversationId)];
  return [...new Map(combined.map(c=>[targetKey(c.target),c])).values()];
}
