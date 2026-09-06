import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { CodexClientService } from '../app-server/codex-client.service';
import type { ModelListResponse } from '../protocol/generated/v2/ModelListResponse';
import { CHAT_MODES, ChatMode, ChatModePreset, presetFor } from './chat-mode';

export interface ChatModeView extends ChatModePreset {
  /** False when the catalog for this account does not offer it. */
  available: boolean;
}

/**
 * The chat modes offered to users, checked once against the live catalog.
 *
 * The check exists because the app-server accepts an unknown `effort` without
 * complaint, and a model it does not have only fails when someone actually
 * sends a message. Finding out at startup turns a puzzling per-user failure
 * into one line in the log.
 */
@Injectable()
export class ChatModesService implements OnModuleInit {
  private readonly logger = new Logger(ChatModesService.name);
  private unavailable = new Set<string>();

  constructor(private readonly codex: CodexClientService) {}

  async onModuleInit(): Promise<void> {
    await this.verifyAgainstCatalog();
  }

  list(): ChatModeView[] {
    return Object.values(CHAT_MODES).map((preset) => ({
      ...preset,
      available: !this.unavailable.has(preset.mode),
    }));
  }

  presetFor(mode: ChatMode | null | undefined): ChatModePreset {
    return presetFor(mode);
  }

  private async verifyAgainstCatalog(): Promise<void> {
    let models: ModelListResponse;
    try {
      models = await this.codex.requestOrUnavailable<ModelListResponse>('model/list', {});
    } catch (error) {
      // Codex may simply not be signed in yet; the modes still work once it is.
      this.logger.debug(`Could not read the model catalog: ${(error as Error).message}`);
      return;
    }

    const byId = new Map(models.data.map((model) => [model.id, model]));

    for (const preset of Object.values(CHAT_MODES)) {
      const model = byId.get(preset.model);

      if (!model) {
        this.unavailable.add(preset.mode);
        this.logger.warn(
          `Mode "${preset.label}" wants model ${preset.model}, which this account does not have`,
        );
        continue;
      }

      const efforts = model.supportedReasoningEfforts.map((option) => option.reasoningEffort);
      if (!efforts.includes(preset.effort)) {
        this.unavailable.add(preset.mode);
        this.logger.warn(
          `Mode "${preset.label}" wants effort "${preset.effort}" on ${preset.model}, ` +
            `which supports ${efforts.join(', ')}`,
        );
      }
    }

    if (this.unavailable.size === 0) {
      this.logger.log(`Chat modes ready: ${Object.values(CHAT_MODES).map((m) => m.label).join(', ')}`);
    }
  }
}
