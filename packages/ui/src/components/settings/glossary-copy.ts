import { createElement, Fragment, type ReactNode } from 'react';
import { defineMessages } from '@baocut/protocol';
import { zhHans } from './glossary-copy.zh-Hans.ts';
import { zhHant } from './glossary-copy.zh-Hant.ts';
import { ja } from './glossary-copy.ja.ts';
import { ko } from './glossary-copy.ko.ts';
import { es } from './glossary-copy.es.ts';
import { fr } from './glossary-copy.fr.ts';
import { de } from './glossary-copy.de.ts';
import { nl } from './glossary-copy.nl.ts';
import { ptBR } from './glossary-copy.pt-BR.ts';
import { it } from './glossary-copy.it.ts';
import { ru } from './glossary-copy.ru.ts';
import { pl } from './glossary-copy.pl.ts';
import { tr } from './glossary-copy.tr.ts';
import { vi } from './glossary-copy.vi.ts';

/**
 * 设置 › 术语库（glossary-settings.tsx、glossary-detail.tsx、glossary-terms.tsx）的文案。
 * 英文是键与类型的来源，译文在 `glossary-copy.<语言>.ts`。
 * 以 `action` 结尾的条目是交给 `libraryErrorText(action, error)` 的动作短语，套进「没能…：原因」那一句。
 */
const en = {
  list: {
    importFilter: 'Glossary (Markdown)',
    /** 导入的文件进了别的库时那个库的名字。 */
    otherLibrary: { voices: 'My voices', brand: 'Brand kit' } as Record<string, string>,
    userLibrary: 'the user library',
    createAction: 'create the glossary',
    importTitle: 'Import glossary',
    importButton: 'Import',
    imported: (name: string, count: number) => `Imported “${name}” · ${count} ${count === 1 ? 'entry' : 'entries'}`,
    notGlossary: (library: string) => `This file isn't a glossary; saved to ${library}`,
    importAction: 'import',
    lede: "Names, product names and jargon in specialist content are hard for speech models to hear and won't be translated the way your field does it. Record them here once, and every video uses them from then on. Transcription and translation each use their own glossaries.",
    loadingLabel: 'Loading glossaries',
    loading: 'Loading glossaries…',
    transcriptionHint:
      'The correct spelling, and what it is often misheard as. Passed to speech models that accept prompts during transcription, and used to correct each occurrence when polishing the transcript.',
    transcriptionEmpty: 'No transcription glossaries yet.',
    newTranscription: 'New transcription glossary',
    translationHint: 'Source → translation, one glossary per language direction. During translation only the entries this piece uses are passed to the model.',
    translationEmpty: 'No translation glossaries yet.',
    newTranslation: 'New translation glossary',
    importFile: 'Import from file…',
    importUnavailable: "Files can't be picked in this environment; import in the desktop app.",
    foot: "Which glossaries each video uses is chosen in that video's transcription, polish or translation settings. The library is yours; turning glossaries on is up to each video. An export is a Markdown table you can send to others as is, or edit in a text editor and import again.",
    translationTitle: 'Translation glossaries',
    transcriptionTitle: 'Transcription glossaries',
    defaultOnAction: 'use it by default for new videos',
    defaultOffAction: 'stop using it by default for new videos',
    stats: (count: number, ago: string) => `${count} ${count === 1 ? 'entry' : 'entries'} · Updated ${ago}`,
    defaultForNew: 'Default for new videos',
    open: (name: string) => `Open “${name}”`,
    from: 'From',
    to: 'to',
    sourceLanguage: 'Source language',
    targetLanguage: 'Target language',
    sameLanguage: "The source and target languages can't be the same",
    create: 'Create',
    cancel: 'Cancel',
  },
  detail: {
    exportExists: "There's already a file with that name there. BaoCut doesn't overwrite existing files; choose another name and export again.",
    loadFailed: "Couldn't read this glossary",
    loadingLabel: 'Loading',
    loading: 'Loading…',
    addAction: 'add',
    saveTermAction: 'save this entry',
    termGone: 'This entry was just deleted elsewhere, so it wasn\'t saved.',
    deleteTermAction: 'delete this entry',
    termDeleted: 'Deleted this entry',
    exportTitle: 'Export glossary',
    exportButton: 'Export',
    exported: (path: string) => `Exported to ${path}`,
    exportAction: 'export',
    reversed: (name: string, count: number) =>
      `Created “${name}” · ${count} ${count === 1 ? 'entry' : 'entries'}. Delete any that don't fit the other way round.`,
    reverseAction: 'create the reverse glossary',
    deleted: 'Deleted this glossary',
    deleteAction: 'delete this glossary',
    renameAction: 'rename',
    sourceLanguage: 'Source language',
    targetLanguage: 'Target language',
    sameLanguage: "The source and target languages can't be the same",
    sourceAction: 'change the source language',
    targetAction: 'change the target language',
    spokenLanguage: 'Spoken language',
    spokenAction: 'change the spoken language',
    saving: 'Saving',
    stats: (count: number, ago: string) => `${count} ${count === 1 ? 'entry' : 'entries'} · Updated ${ago}`,
    exportTable: 'Export this glossary',
    reverse: (from: string, to: string) => `Create a ${from} → ${to} glossary`,
    deleteTable: 'Delete this glossary',
    exportUnavailable: "A save location can't be chosen in this environment; export in the desktop app.",
    deleteTitle: (name: string) => `Delete “${name}”?`,
    delete: 'Delete',
    cancel: 'Cancel',
    deleteBody:
      "This glossary will be deleted from the library, and future transcriptions and translations won't use it. Transcriptions and translations already done aren't affected.",
    back: 'All glossaries',
    name: 'Glossary name',
  },
  terms: {
    sourcePlaceholder: 'Source, e.g. commit',
    canonicalPlaceholder: 'Correct spelling, e.g. KV cache',
    targetPlaceholder: 'Translation, e.g. confirmación',
    misheardPlaceholder: 'Misheard as (optional), e.g. KB cache, cave cache',
    add: 'Add',
    /** 把几条问题连成一句。 */
    problems: (list: readonly string[]) => list.join('; '),
    bulkOpen: 'Paste a batch…',
    bulkLabel: 'Paste a batch',
    translationSample: 'commit = confirmación\nWyckoff = Wyckoff\nspring = resorte = not “manantial”',
    transcriptionSample: 'KV cache = KB cache, cave cache\nLoRA = Laura\ninference framework',
    /** `eq`、`arrow` 是排成等宽字体的 = 与 →。 */
    bulkHow: (translation: boolean, eq: ReactNode, arrow: ReactNode): ReactNode =>
      createElement(
        Fragment,
        null,
        `One entry per line. Separate ${translation ? 'the source and translation' : 'the correct spelling and its misheard spellings'} with `,
        eq,
        ', ',
        arrow,
        ` or Tab${translation ? '; a third column is an optional note' : '; the correct spelling alone is fine too'}. Paste two columns copied from a spreadsheet, or an exported Markdown table, as is.`,
      ),
    moreSkipped: (count: number) => `${count} more ${count === 1 ? 'line' : 'lines'}`,
    addBatch: (count: number) => (count ? `Add to this glossary · ${count} ${count === 1 ? 'entry' : 'entries'}` : 'Add to this glossary'),
    cancel: 'Cancel',
    search: 'Search entries',
    searchTranslation: 'Search source, translation, notes',
    searchTranscription: 'Search correct and misheard spellings',
    noMatch: (query: string) => `No entries match “${query}”.`,
    emptyTranslation: 'No entries yet. Fill in a source and translation above and press Enter to add it.',
    emptyTranscription: 'No entries yet. Fill in a correct spelling above and press Enter to add it.',
    moreHidden: (count: number) => `${count} more ${count === 1 ? 'entry is' : 'entries are'} not listed; use the search above to narrow it down.`,
    misheardAs: (list: readonly string[]) => `Misheard as ${list.join(' · ')}`,
    editLabel: (main: string) => `Edit “${main}”`,
    edit: 'Edit',
    misheardHint: 'Optional; separate variants with commas',
    misheardTip: 'Only enter spellings that were actually misheard. Made-up variants will break sentences that were correct.',
    note: 'Note',
    notePlaceholder: "One sentence for the model, e.g. in this school it doesn't mean “submit”",
    flexible: 'Flexible',
    flexibleHint: "Glossaries don't have this yet: the translation model uses every entry as is. If it can change with context, say so in the note.",
    more: 'More · Note, flexible',
    save: 'Save',
    deleteEntry: 'Delete this entry',
  },
};

export type GlossaryMessages = typeof en;

export const GLOSSARY_COPY = defineMessages(en, { 'zh-Hans': zhHans, 'zh-Hant': zhHant, ja, ko, es, fr, de, nl, 'pt-BR': ptBR, it, ru, pl, tr, vi });
