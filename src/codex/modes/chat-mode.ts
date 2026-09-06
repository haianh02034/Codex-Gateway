/**
 * How hard the model should think.
 *
 * Both modes run the same model and differ only in reasoning effort, which is
 * what Codex actually exposes: `model/list` reports a set of supported efforts
 * per model, and `turn/start` takes one. Presenting two named modes rather than
 * six effort levels is a deliberate simplification — the levels in between are
 * hard to choose meaningfully without knowing the task.
 */
export enum ChatMode {
  Instant = 'instant',
  Think = 'think',
}

export interface ChatModePreset {
  mode: ChatMode;
  label: string;
  description: string;
  model: string;
  /** A value from the model's `supportedReasoningEfforts`. */
  effort: string;
}

/**
 * The app-server does **not** validate `effort` — a nonsense value is accepted
 * silently and the turn simply behaves differently. Confirmed by sending one.
 * So these presets are the validation: nothing outside this table reaches
 * `turn/start`.
 */
export const CHAT_MODES: Record<ChatMode, ChatModePreset> = {
  [ChatMode.Instant]: {
    mode: ChatMode.Instant,
    label: 'Instant',
    description: 'Trả lời nhanh, suy luận nhẹ. Dùng cho hỏi đáp thường ngày.',
    model: 'gpt-5.6-luna',
    effort: 'low',
  },
  [ChatMode.Think]: {
    mode: ChatMode.Think,
    label: 'Think',
    description: 'Suy luận sâu hơn, chậm hơn. Dùng cho câu hỏi khó.',
    model: 'gpt-5.6-luna',
    effort: 'high',
  },
};

export const DEFAULT_CHAT_MODE = ChatMode.Instant;

export function presetFor(mode: ChatMode | null | undefined): ChatModePreset {
  return CHAT_MODES[mode ?? DEFAULT_CHAT_MODE] ?? CHAT_MODES[DEFAULT_CHAT_MODE];
}
