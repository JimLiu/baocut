import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFrameArtifact } from "../boot/environment";
import {
  commentSummonHost,
  dataSourcesOffered,
  feedbackOffered,
  homeOffered,
  projectDuplicateOffered,
  versionHistoryOffered,
} from './docs-host';

vi.mock("../boot/environment", () => ({ isFrameArtifact: vi.fn(() => false) }));

const inFrame = vi.mocked(isFrameArtifact);

afterEach(() => {
  inFrame.mockReset();
  inFrame.mockReturnValue(false);
  vi.unstubAllGlobals();
});

describe('version history gate', () => {
  it('opens on standalone pages: the BaoCut docs service serves the history endpoints', () => {
    expect(versionHistoryOffered()).toBe(true);
    vi.stubGlobal('docsHost', {
      comments: { canSendToClaude: async () => 'available', sendToClaude: async () => ({ threadId: 't' }) },
      chat: { focus() {} },
    });
    expect(commentSummonHost()).toBe(true);
    expect(versionHistoryOffered()).toBe(true);
  });

  it('stays off when the host marks the page read-only', () => {
    vi.stubGlobal('docsHost', {
      comments: { canSendToClaude: async () => 'available', sendToClaude: async () => ({ threadId: 't' }) },
      readOnly: true,
    });
    expect(versionHistoryOffered()).toBe(false);
  });

  it('keeps the original behaviour inside the Frame', () => {
    inFrame.mockReturnValue(true);
    expect(versionHistoryOffered()).toBe(true);
  });
});

describe('project menu platform gates', () => {
  it('hide Data sources and Duplicate on standalone pages, even with the BaoCut host installed', () => {
    vi.stubGlobal('docsHost', {
      comments: { canSendToClaude: async () => 'available', sendToClaude: async () => ({ threadId: 't' }) },
      chat: { focus() {} },
    });
    expect(dataSourcesOffered()).toBe(false);
    expect(projectDuplicateOffered()).toBe(false);
  });

  it('keep the original behaviour inside the Frame', () => {
    inFrame.mockReturnValue(true);
    expect(dataSourcesOffered()).toBe(true);
    expect(projectDuplicateOffered()).toBe(true);
  });

  it('hide Send feedback on standalone pages, even with the BaoCut host installed', () => {
    vi.stubGlobal('docsHost', {
      comments: { canSendToClaude: async () => 'available', sendToClaude: async () => ({ threadId: 't' }) },
      chat: { focus() {} },
    });
    expect(feedbackOffered()).toBe(false);
  });

  it('keep Send feedback inside the Frame', () => {
    inFrame.mockReturnValue(true);
    expect(feedbackOffered()).toBe(true);
  });
});

describe('home button gate', () => {
  it('stays off on standalone pages, even with the BaoCut host installed', () => {
    expect(homeOffered()).toBe(false);
    vi.stubGlobal('docsHost', {
      comments: { canSendToClaude: async () => 'available', sendToClaude: async () => ({ threadId: 't' }) },
      chat: { focus() {} },
    });
    expect(homeOffered()).toBe(false);
  });

  it('keeps the original behaviour inside the Frame', () => {
    inFrame.mockReturnValue(true);
    expect(homeOffered()).toBe(true);
  });
});
