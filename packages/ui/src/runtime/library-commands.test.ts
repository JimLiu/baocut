import type { LibraryEntry, LibraryEntryRef, LibraryEntrySummary } from '@baocut/protocol';
import { describe, expect, it } from 'vitest';
import { getLibraryEntry } from './library-commands.ts';
import type { RuntimeSession } from './session.ts';

describe('getLibraryEntry', () => {
  it('递条目摘要时只送引用的三项（`library.get` 的参数是严格的）', async () => {
    const sent: LibraryEntryRef[] = [];
    const session = {
      getLibraryEntry: async (ref: LibraryEntryRef) => (sent.push(ref), { ...ref, version: 1 }) as unknown as LibraryEntry,
    } as unknown as RuntimeSession;
    const summary: LibraryEntrySummary = {
      library: 'brand',
      id: 'brd_ref_only',
      version: 1,
      contentHash: 'sha256:0',
      name: 'Mine',
      kind: 'overlayTemplate',
      updatedAt: '2026-10-16T00:00:00.000Z',
    } as LibraryEntrySummary;
    await getLibraryEntry(session, summary);
    await getLibraryEntry(session, { ...summary, version: undefined, id: 'brd_latest' });
    expect(sent).toEqual([
      { library: 'brand', id: 'brd_ref_only', version: 1 },
      { library: 'brand', id: 'brd_latest' },
    ]);
  });
});
