import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { applyAuthChoice } from "./auth-choice.js";

const noopAsync = async () => {};
const noop = () => {};

describe("openai-private-endpoint auth choice", () => {
  let tempStateDir: string | null = null;

  afterEach(async () => {
    if (tempStateDir) {
      await fs.rm(tempStateDir, { recursive: true, force: true });
      tempStateDir = null;
    }
  });

  it("prompts and configures private endpoint in interactive mode", async () => {
    tempStateDir = await fs.mkdtemp(path.join(os.tmpdir(), "moltbot-openai-private-"));
    process.env.CLAWDBOT_STATE_DIR = tempStateDir;
    process.env.CLAWDBOT_AGENT_DIR = path.join(tempStateDir, "agent");

    const text = vi.fn()
      .mockResolvedValueOnce("custom-provider") // Provider ID
      .mockResolvedValueOnce("https://my-endpoint.com/v1") // Base URL
      .mockResolvedValueOnce("my-api-key") // API Key
      .mockResolvedValueOnce("my-model"); // Model ID

    const prompter: WizardPrompter = {
      intro: vi.fn(noopAsync),
      outro: vi.fn(noopAsync),
      note: vi.fn(noopAsync),
      select: vi.fn(),
      multiselect: vi.fn(),
      text,
      confirm: vi.fn(),
      progress: vi.fn(() => ({ update: noop, stop: noop })),
    };

    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };

    const result = await applyAuthChoice({
      authChoice: "openai-private-endpoint",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
    });

    expect(text).toHaveBeenCalledTimes(4);
    expect(result.config.models?.providers?.["custom-provider"]).toMatchObject({
      baseUrl: "https://my-endpoint.com/v1",
      apiKey: "my-api-key",
      api: "openai-completions",
      models: [
        expect.objectContaining({
          id: "my-model",
        }),
      ],
    });
    expect(result.config.agents?.defaults?.model?.primary).toBe("custom-provider/my-model");
  });

  it("uses provided options in non-interactive mode (via opts)", async () => {
    const prompter: WizardPrompter = {
        intro: vi.fn(noopAsync),
        outro: vi.fn(noopAsync),
        note: vi.fn(noopAsync),
        select: vi.fn(),
        multiselect: vi.fn(),
        text: vi.fn(),
        confirm: vi.fn(),
        progress: vi.fn(() => ({ update: noop, stop: noop })),
      };

      const runtime: RuntimeEnv = {
        log: vi.fn(),
        error: vi.fn(),
        exit: vi.fn(),
      };

    const result = await applyAuthChoice({
      authChoice: "openai-private-endpoint",
      config: {},
      prompter,
      runtime,
      setDefaultModel: true,
      opts: {
        openaiPrivateProviderId: "cli-provider",
        openaiPrivateBaseUrl: "https://cli-endpoint.com",
        openaiPrivateApiKey: "cli-key",
        openaiPrivateModelId: "cli-model",
      },
    });

    expect(prompter.text).not.toHaveBeenCalled();
    expect(result.config.models?.providers?.["cli-provider"]).toMatchObject({
      baseUrl: "https://cli-endpoint.com",
      apiKey: "cli-key",
      api: "openai-completions",
      models: [
        expect.objectContaining({
          id: "cli-model",
        }),
      ],
    });
    expect(result.config.agents?.defaults?.model?.primary).toBe("cli-provider/cli-model");
  });
});
