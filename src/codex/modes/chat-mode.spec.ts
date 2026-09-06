import { CHAT_MODES, ChatMode, DEFAULT_CHAT_MODE, presetFor } from './chat-mode';

describe('chat modes', () => {
  it('offers exactly the two modes the product defines', () => {
    expect(Object.keys(CHAT_MODES).sort()).toEqual(['instant', 'think']);
  });

  it('separates the modes by reasoning effort, not by model', () => {
    // Both run the same model; the difference Codex actually exposes is the
    // effort it is asked for.
    expect(CHAT_MODES.instant.model).toBe(CHAT_MODES.think.model);
    expect(CHAT_MODES.instant.effort).not.toBe(CHAT_MODES.think.effort);
  });

  it('maps a known mode to its preset', () => {
    expect(presetFor(ChatMode.Think)).toMatchObject({ mode: 'think', effort: 'high' });
  });

  it('falls back to the default for a missing mode', () => {
    // Conversations created before modes existed have no value stored.
    expect(presetFor(null).mode).toBe(DEFAULT_CHAT_MODE);
    expect(presetFor(undefined).mode).toBe(DEFAULT_CHAT_MODE);
  });

  it('falls back rather than passing an unknown effort through', () => {
    // The app-server accepts any string as an effort without validating it, so
    // a bad value would change behaviour silently. This table is the check.
    expect(presetFor('nonsense' as ChatMode).mode).toBe(DEFAULT_CHAT_MODE);
  });
});
