import { create } from 'zustand';
import type { ImageCandidate, ImageComment, ImageRegion } from '../model/image-preview.ts';
import { targetKey } from '../model/media.ts';

export interface ImageDraft { region: ImageRegion | null; text: string; editing: string | null }
interface ImageNotes { comments: ImageComment[]; draft: ImageDraft }
export const EMPTY_IMAGE_NOTES: ImageNotes = { comments: [], draft: { region: null, text: '', editing: null } };
export interface ImageView {zoom:string;view:'focused'|'canvas';selected:string[];prompt:string;frame:number;speed:number;playing:boolean;sheet:boolean}
export const EMPTY_IMAGE_VIEW:ImageView={zoom:'fit',view:'focused',selected:[],prompt:'',frame:0,speed:1,playing:false,sheet:false};
interface ImagePreviewState {
  views:Record<string,ImageView>;
  view(key:string,patch:Partial<ImageView>):void;
  notes: Record<string, ImageNotes>;
  groups: Record<string, ImageCandidate[]>;
  activeGroups: Record<string, string>;
  activate(group: string): void;
  register(group: string, candidate: ImageCandidate): void;
  patch(key: string, draft: Partial<ImageDraft>): void;
  save(key: string): void;
  remove(key: string, id: string): void;
}
/** 图片批注与未完成草稿按资源定位保留，换标签或候选不会丢失；不回写原文件。 */
export const useImagePreview = create<ImagePreviewState>()((set, get) => ({
  views:{}, view(key,patch){set(s=>({views:{...s.views,[key]:{...EMPTY_IMAGE_VIEW,...s.views[key],...patch}}}));},
  notes: {}, groups: {}, activeGroups: {},
  activate(group) {
    set(s => ({ activeGroups: { ...s.activeGroups, ...Object.fromEntries((s.groups[group] ?? []).map(c => [targetKey(c.target), group])) } }));
  },
  register(group, candidate) {
    const previous = get().groups[group] ?? [];
    if (previous.some(c => targetKey(c.target) === targetKey(candidate.target))) return;
    const ordered = [...previous, candidate].sort((a, b) => (a.order?.[0] ?? 0) - (b.order?.[0] ?? 0) || (a.order?.[1] ?? 0) - (b.order?.[1] ?? 0));
    set(s => ({ groups: { ...s.groups, [group]: ordered } }));
  },
  patch(key, draft) { set(s => { const old = s.notes[key] ?? EMPTY_IMAGE_NOTES; return { notes: { ...s.notes, [key]: { ...old, draft: { ...old.draft, ...draft } } } }; }); },
  save(key) {
    const old = get().notes[key] ?? EMPTY_IMAGE_NOTES;
    if (!old.draft.region || !old.draft.text.trim()) return;
    const comment = { id: old.draft.editing ?? crypto.randomUUID(), region: old.draft.region, text: old.draft.text.trim() };
    const comments = old.draft.editing ? old.comments.map(c => c.id === comment.id ? comment : c) : [...old.comments, comment];
    set(s => ({ notes: { ...s.notes, [key]: { comments, draft: EMPTY_IMAGE_NOTES.draft } } }));
  },
  remove(key, id) {
    const old = get().notes[key]; if (!old) return;
    set(s => ({ notes: { ...s.notes, [key]: { comments: old.comments.filter(c => c.id !== id), draft: old.draft.editing === id ? EMPTY_IMAGE_NOTES.draft : old.draft } } }));
  },
}));
