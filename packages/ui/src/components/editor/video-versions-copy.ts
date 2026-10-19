import { defineMessages } from '@baocut/protocol';
import { zhHans } from './video-versions-copy.zh-Hans.ts';
import { zhHant } from './video-versions-copy.zh-Hant.ts';
import { ja } from './video-versions-copy.ja.ts';
import { ko } from './video-versions-copy.ko.ts';
import { es } from './video-versions-copy.es.ts';
import { fr } from './video-versions-copy.fr.ts';
import { de } from './video-versions-copy.de.ts';
import { nl } from './video-versions-copy.nl.ts';
import { ptBR } from './video-versions-copy.pt-BR.ts';
import { it } from './video-versions-copy.it.ts';
import { ru } from './video-versions-copy.ru.ts';
import { pl } from './video-versions-copy.pl.ts';
import { tr } from './video-versions-copy.tr.ts';
import { vi } from './video-versions-copy.vi.ts';

/** 视频的版本记录（视频格式规范 §9、版本记录设计 §6）：视频栏的入口与对话框。译文在 `video-versions-copy.zh-Hans.ts`。 */
const en = {
  title: 'History',
  close: 'Close history',
  tipRevision: (revision: string) => `Revision ${revision}`,
  viewChanges: 'Changes',
  tipLatest: (version: number) => `Latest is version ${version}`,
  tipNone: 'No versions yet',
  tipOutside: 'This video isn’t in a project',
  loading: 'Loading version history',
  loadFailed: (message: string) => `Couldn’t load version history: ${message}`,
  stateSynced: 'Snapshot up to date',
  stateSyncedDesc: 'The workspace snapshot in the video folder matches the current content.',
  statePending: 'Writing snapshot',
  statePendingDesc: 'Recent changes go into the snapshot and the version history within seconds.',
  stateConflict: 'Snapshot and BaoCut both changed',
  stateConflictDesc:
    'The snapshot files were changed outside BaoCut, and BaoCut also has changes that aren’t in the snapshot yet. BaoCut won’t overwrite the snapshot until you choose which to keep.',
  stateInvalid: 'Snapshot can’t be read',
  stateInvalidDesc: 'The snapshot files can’t be parsed, so BaoCut didn’t import them. BaoCut checks again after you fix them, or you can overwrite them with BaoCut’s content.',
  stateExternal: 'Importing external changes',
  stateExternalDesc:
    'The snapshot files were changed outside BaoCut (git pull, a sync drive, or a manual edit) and BaoCut has no other changes, so it’s importing them as an “External change” version.',
  stateMissing: 'No snapshot yet',
  stateMissingDesc: 'The workspace snapshot hasn’t been written yet, or video.json is gone.',
  stateRebuild: 'Needs rebuild',
  stateRebuildDesc: 'Only the workspace snapshot is there, without a video library. BaoCut rebuilds the video from it when it opens.',
  footer: (keep: number) =>
    `Versions are kept in the video folder’s .bcut-snapshot/history/ and don’t depend on git. BaoCut keeps the latest ${keep} unnamed versions plus every saved version.`,
  save: 'Save version',
  saveIntro: 'Save the current content as a named version. Saved versions are never cleaned up automatically; only you can delete them.',
  nameLabel: 'Name',
  namePlaceholder: 'For example: Review cut',
  nameRequired: 'Give this version a name',
  noteLabel: 'Note (optional)',
  cancel: 'Cancel',
  saveSubmit: 'Save',
  conflictIntro:
    'These snapshot files were changed outside BaoCut, perhaps by git pull, a sync drive, or a manual edit, and BaoCut also has changes that aren’t in the snapshot yet:',
  conflictOutro: 'Until you choose which to keep, BaoCut won’t overwrite the snapshot. You can keep editing the video, but you can’t save or restore versions.',
  invalidIntro: 'These snapshot files can’t be parsed. They may contain merge conflict markers, be truncated, or have been damaged by hand:',
  invalidOutro:
    'BaoCut didn’t import them. You can keep editing the video, but you can’t save or restore versions. BaoCut checks again after you fix these files, or you can keep BaoCut’s content and overwrite them.',
  externalIntro: 'These snapshot files were changed outside BaoCut, perhaps by git pull, a sync drive, or a manual edit:',
  externalOutro: 'BaoCut has no changes that aren’t in the snapshot yet, so it imports them directly as an “External change” version. You can undo the import afterwards.',
  stripConflict: 'The snapshot was changed outside BaoCut, and BaoCut has new changes too. Choose which to keep.',
  stripInvalid: 'The snapshot files can’t be read. BaoCut didn’t import them.',
  view: 'View',
  keepVideo: 'Keep BaoCut’s content',
  useSnapshot: 'Use the snapshot on disk',
  keepTitle: 'Keep BaoCut’s content?',
  keepConfirm: 'Overwrite the snapshot on disk',
  keepBody: (count: number, files: string, invalid: boolean) =>
    `BaoCut’s content is written to the snapshot right away, overwriting ${count === 1 ? 'the file' : `the ${count} files`} on disk that ${invalid ? 'can’t be read' : 'were changed'}${files ? ` (${files})` : ''}. Those changes on disk don’t go into the version history and can’t be recovered in BaoCut; if they came from git or a sync drive, you can get them back there.`,
  diskTitle: 'Use the snapshot on disk?',
  diskConfirm: 'Use the snapshot on disk',
  diskBody: (files: string) =>
    `The video’s content is replaced with the snapshot on disk${files ? ` (${files})` : ''} and recorded as an “External change” version. Changes in BaoCut that aren’t in the snapshot yet go into the version history first: restore to before the “External change” version to get them back. You can also undo this.`,
  keptTitle: 'Kept BaoCut’s content',
  keptText: (version: number | null) =>
    `The snapshot on disk now matches BaoCut${version ? `, and your recent changes are in version ${version}` : ''}. The changes that were on disk didn’t go into the version history.`,
  usedDiskTitle: (version: number) => `Used the snapshot on disk, recorded as version ${version} “External change”`,
  usedDiskText: (version: number) => `Restore to before version ${version} to get back what was in BaoCut. You can also undo this.`,
  importedTitle: (version: number | null) => (version ? `Imported external changes as version ${version} “External change”` : 'Imported external changes'),
  importedText:
    'The snapshot files were changed outside BaoCut and BaoCut had no other changes, so they were imported directly. Restore to before this version to see the content from before the import, or undo it.',
  importUndoneTitle: 'Import undone',
  importUndoneText:
    'The video is back to its content from before the import and is written back to the snapshot within seconds, which discards this external change. The undo is itself a change and goes into a new version.',
  refusedBroken: 'Can’t restore this version',
  refusedOther: 'Not done',
  refusedText: (message: string) => `${message}. The video hasn’t changed.`,
  savedTitle: (version: number, name: string) => `Saved as version ${version} “${name}”`,
  savedText: 'Saved versions stay; the retention rule never removes them.',
  restoredTitle: (version: number, before: boolean, recorded: number) =>
    before ? `Restored to before version ${version}, recorded as version ${recorded}` : `Restored version ${version}, recorded as version ${recorded}`,
  restoredText: 'This is an ordinary change: you can undo it here, or in the editor after you close this dialog.',
  undo: 'Undo',
  undoneTitle: (version: number, before: boolean) => (before ? `Undone: restore to before version ${version}` : `Undone: restore version ${version}`),
  undoneText: 'The video is back to its previous content. The undo is itself a change and goes into the latest version.',
  noopTitle: 'No changes',
  noopText: (version: number, before: boolean) =>
    before
      ? `The video is already in its state from before version ${version} started. Nothing was committed and no new version was made.`
      : `The video is already in its state from the end of version ${version}. Nothing was committed and no new version was made.`,
  deletedTitle: (name: string) => `Deleted saved version “${name}”`,
  deletedText: 'The video content didn’t change.',
  emptyTitle: 'No versions yet',
  emptyText: (missing: boolean): string =>
    missing
      ? 'The workspace snapshot hasn’t been written yet. Your next change becomes version 1, or you can save a version now.'
      : 'Your next change becomes version 1, or you can save a version now.',
  outsideTitle: 'This video isn’t in a project',
  outsideText: 'Only videos in a project have version history. Move the video into a project first.',
  listLabel: 'Versions',
  versionN: (version: number) => `Version ${version}`,
  openBadge: 'Still open',
  blockedFlag: 'Can’t restore',
  unreadableTitle: 'Can’t read this version file',
  kindSegment: 'Edits',
  kindSave: 'Saved version',
  kindRestore: 'Restore',
  kindExternal: 'External change',
  kindRebuild: 'Rebuild',
  revisions: (from: string, to: string) => (from === to ? `Revision ${to}` : `Revisions ${from}–${to}`),
  openHint: 'The latest version is still open: until there are 5 quiet minutes or it reaches 30 minutes, your next changes go into it.',
  openHintPending: 'The latest version is still open. Recent changes are being written and go into it within seconds.',
  openHintConflict: 'The latest version is still open, but new changes won’t go into the version history until the snapshot conflict is sorted out.',
  openHintExternal: 'The latest version is still open. The snapshot on disk is being imported: this version closes first, and the external changes become a version of their own.',
  externalHint:
    'This version came from outside BaoCut: the snapshot files were changed by git pull, a sync drive, or a manual edit, and BaoCut imported them as this version. Restore to before this version to get back what was in BaoCut before the import.',
  restoreEnd: 'Restore this version',
  restoreBefore: 'Restore to before this version',
  deleteSaved: 'Delete this saved version',
  whyNotFound: 'This version no longer exists',
  whyUnreadable: (version: number) => `The file for version ${version} can’t be read, so it and earlier states can’t be restored`,
  whyBroken: (version: number) => `The version history doesn’t match at version ${version}, so earlier states can’t be restored`,
  noopBoth: (version: number) => `The video is already in the state of version ${version} (its content is the same before and after), so restoring it changes nothing`,
  noopEnd: (version: number) => `The video is already in its state from the end of version ${version}, so restoring it changes nothing`,
  noopBefore: (version: number) => `The video is already in its state from before version ${version} started, so restoring it changes nothing`,
  factActors: 'Changed by',
  factConversations: 'Sessions',
  factFiles: 'What changed',
  factCheckpoint: 'Checkpoint',
  actorYou: 'You',
  actorAgent: 'Agent',
  actorExternal: (name: string) => `External service ${name}`,
  actorSystem: 'BaoCut',
  actionCount: (label: string, count: number) => (count > 1 ? `${label} ×${count}` : label),
  listSeparator: ', ',
  noActions: 'No changes were recorded',
  noActionsRebuild: 'BaoCut rebuilt the video from its snapshot; no content changes',
  omitted: (count: number) => (count === 1 ? '1 more change was only counted' : `${count} more changes were only counted`),
  notHere: '(not on this computer)',
  openConversation: (title: string) => `Open session “${title}”`,
  fileTimeline: 'Timeline',
  fileDocument: 'Document',
  changeAdd: 'Added',
  changeDelete: 'Deleted',
  changeModify: 'Modified',
  noFiles: 'No content changes',
  diffTitle: 'Changes',
  copyDiff: 'Copy diff',
  copied: 'Copied',
  copyFailed: 'Couldn’t copy. Select the text and copy it manually.',
  diffEmpty: 'This version’s diff is empty: the content is the same as at the end of the previous version.',
  diffLabel: (version: number) => `Diff of version ${version}`,
  diffLoading: 'Loading diff',
  diffFailed: (message: string) => `Couldn’t read this version: ${message}`,
  diffMore: (count: number) =>
    count === 1 ? '1 more line isn’t shown. Copy the diff to see all of it.' : `${count} more lines aren’t shown. Copy the diff to see all of them.`,
  unreadableHeading: (file: string) => `Can’t read ${file}`,
  unreadableText: (why: string) => `The version file’s header or diff is damaged; it may be truncated or edited by hand. ${why}. Newer versions aren’t affected.`,
  confirmRestoreTitle: (version: number, before: boolean) => (before ? `Restore to before version ${version}?` : `Restore version ${version}?`),
  confirmRestoreBody: (version: number, before: boolean, when: string) =>
    `The video’s content will be replaced with its state ${before ? `from before version ${version} started` : `from the end of version ${version}`} (${when}). This is a change you can undo, recorded as a new version. Existing versions stay, and checkpoints and protections don’t change.`,
  confirmDeleteTitle: (name: string) => `Delete saved version “${name}”?`,
  confirmDeleteMiddle: (next: number) => `Only this version and its checkpoint are deleted: its changes merge into version ${next}, right after it. The video content doesn’t change.`,
  confirmDeleteTop: 'Only the name, note, and checkpoint are removed: this version becomes an ordinary set of edits, and later changes merge into it. The video content doesn’t change.',
  delete: 'Delete',
};

export type VideoVersionsMessages = typeof en;
export const VIDEO_VERSIONS_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
