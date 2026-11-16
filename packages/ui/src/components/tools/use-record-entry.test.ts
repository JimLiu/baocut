import { describe, expect, it } from 'vitest';
import { TOOL_GROUPS, TOOL_IDS, toolById } from '../../model/tool-catalog.ts';
import { GALLERY_COPY } from './tools-copy.ts';
import { RECORD_ENTRY_GROUP } from './use-record-entry.ts';

describe('screen recording entry on the tools page', () => {
  it('sits in an existing group but is not a tool in the catalog', () => {
    expect(TOOL_GROUPS.map((g) => g.key)).toContain(RECORD_ENTRY_GROUP);
    expect(RECORD_ENTRY_GROUP).toBe('video-file');
    expect((TOOL_IDS as readonly string[]).includes('record')).toBe(false);
    expect(toolById('record')).toBeNull();
  });

  it('has its own name and result line', () => {
    expect(GALLERY_COPY.recordName).toBe('屏幕录制');
    expect(GALLERY_COPY.recordResult).toBe('结果：当前项目里的一个新视频');
  });
});
