import { mergeViewerSessionState } from '../src/explorer-state/merge';
import { createDefaultViewerSessionState } from '../src/explorer-state/defaults';

describe('viewer session tabs', () => {
  it('opens directly in the World / Terrain workspace', () => {
    expect(createDefaultViewerSessionState().activeView).toBe('terrain');
  });

  it('restores the Sound browser as the active tab', () => {
    expect(mergeViewerSessionState({ activeView: 'sound' }).activeView).toBe('sound');
  });

  it('falls back for unsupported tab values', () => {
    expect(mergeViewerSessionState({ activeView: 'unknown' }).activeView).toBe('terrain');
  });
});
