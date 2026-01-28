import { loginOpenAICodex } from "@mariozechner/pi-ai";
import { resolveEnvApiKey } from "../agents/model-auth.js";
import { applyPrimaryModel } from "./model-picker.js";
import { upsertSharedEnvVar } from "../infra/env-file.js";
import { isRemoteEnvironment } from "./oauth-env.js";
import {
  formatApiKeyPreview,
  normalizeApiKeyInput,
  validateApiKeyInput,
} from "./auth-choice.api-key.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import { createVpsAwareOAuthHandlers } from "./oauth-flow.js";
import { applyAuthProfileConfig, writeOAuthCredentials } from "./onboard-auth.js";
import { openUrl } from "./onboard-helpers.js";
import {
  applyOpenAICodexModelDefault,
  OPENAI_CODEX_DEFAULT_MODEL,
} from "./openai-codex-model-default.js";

export async function applyAuthChoiceOpenAI(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  let authChoice = params.authChoice;
  if (authChoice === "apiKey" && params.opts?.tokenProvider === "openai") {
    authChoice = "openai-api-key";
  }

  if (authChoice === "openai-api-key") {
    const envKey = resolveEnvApiKey("openai");
    if (envKey) {
      const useExisting = await params.prompter.confirm({
        message: `Use existing OPENAI_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        const result = upsertSharedEnvVar({
          key: "OPENAI_API_KEY",
          value: envKey.apiKey,
        });
        if (!process.env.OPENAI_API_KEY) {
          process.env.OPENAI_API_KEY = envKey.apiKey;
        }
        await params.prompter.note(
          `Copied OPENAI_API_KEY to ${result.path} for launchd compatibility.`,
          "OpenAI API key",
        );
        return { config: params.config };
      }
    }

    let key: string | undefined;
    if (params.opts?.token && params.opts?.tokenProvider === "openai") {
      key = params.opts.token;
    } else {
      key = await params.prompter.text({
        message: "Enter OpenAI API key",
        validate: validateApiKeyInput,
      });
    }

    const trimmed = normalizeApiKeyInput(String(key));
    const result = upsertSharedEnvVar({
      key: "OPENAI_API_KEY",
      value: trimmed,
    });
    process.env.OPENAI_API_KEY = trimmed;
    await params.prompter.note(
      `Saved OPENAI_API_KEY to ${result.path} for launchd compatibility.`,
      "OpenAI API key",
    );
    return { config: params.config };
  }

  if (params.authChoice === "openai-private-endpoint") {
    const providerIdInput =
      params.opts?.openaiPrivateProviderId ||
      (await params.prompter.text({
        message: "Provider ID",
        initialValue: "openai-private",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      }));
    const providerId = String(providerIdInput).trim();

    const baseUrlInput =
      params.opts?.openaiPrivateBaseUrl ||
      (await params.prompter.text({
        message: "Base URL",
        placeholder: "https://api.openai.com/v1",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      }));
    const baseUrl = String(baseUrlInput).trim();

    const apiKeyInput =
      params.opts?.openaiPrivateApiKey ||
      (await params.prompter.text({
        message: "API Key / Bearer Token",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      }));
    const apiKey = String(apiKeyInput).trim();

    const modelIdInput =
      params.opts?.openaiPrivateModelId ||
      (await params.prompter.text({
        message: "Model ID",
        placeholder: "gpt-4o",
        validate: (v) => (v?.trim() ? undefined : "Required"),
      }));
    const modelId = String(modelIdInput).trim();

    const providers = { ...params.config.models?.providers };
    providers[providerId] = {
      baseUrl,
      apiKey,
      auth: "api-key",
      api: "openai-completions",
      models: [
        {
          id: modelId,
          name: modelId,
          reasoning: false,
          input: ["text", "image"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 4096,
          compat: {},
        },
      ],
    };

    let nextConfig = {
      ...params.config,
      models: {
        ...params.config.models,
        providers,
      },
    };

    const modelRef = `${providerId}/${modelId}`;
    if (params.setDefaultModel) {
      nextConfig = applyPrimaryModel(nextConfig, modelRef);
    }

    await params.prompter.note(
      `Configured private endpoint ${baseUrl} with model ${modelRef}`,
      "OpenAI Private Endpoint",
    );

    return { config: nextConfig, agentModelOverride: params.setDefaultModel ? undefined : modelRef };
  }

  if (params.authChoice === "openai-codex") {
    let nextConfig = params.config;
    let agentModelOverride: string | undefined;
    const noteAgentModel = async (model: string) => {
      if (!params.agentId) return;
      await params.prompter.note(
        `Default model set to ${model} for agent "${params.agentId}".`,
        "Model configured",
      );
    };

    const isRemote = isRemoteEnvironment();
    await params.prompter.note(
      isRemote
        ? [
            "You are running in a remote/VPS environment.",
            "A URL will be shown for you to open in your LOCAL browser.",
            "After signing in, paste the redirect URL back here.",
          ].join("\n")
        : [
            "Browser will open for OpenAI authentication.",
            "If the callback doesn't auto-complete, paste the redirect URL.",
            "OpenAI OAuth uses localhost:1455 for the callback.",
          ].join("\n"),
      "OpenAI Codex OAuth",
    );
    const spin = params.prompter.progress("Starting OAuth flow…");
    try {
      const { onAuth, onPrompt } = createVpsAwareOAuthHandlers({
        isRemote,
        prompter: params.prompter,
        runtime: params.runtime,
        spin,
        openUrl,
        localBrowserMessage: "Complete sign-in in browser…",
      });

      const creds = await loginOpenAICodex({
        onAuth,
        onPrompt,
        onProgress: (msg) => spin.update(msg),
      });
      spin.stop("OpenAI OAuth complete");
      if (creds) {
        await writeOAuthCredentials("openai-codex", creds, params.agentDir);
        nextConfig = applyAuthProfileConfig(nextConfig, {
          profileId: "openai-codex:default",
          provider: "openai-codex",
          mode: "oauth",
        });
        if (params.setDefaultModel) {
          const applied = applyOpenAICodexModelDefault(nextConfig);
          nextConfig = applied.next;
          if (applied.changed) {
            await params.prompter.note(
              `Default model set to ${OPENAI_CODEX_DEFAULT_MODEL}`,
              "Model configured",
            );
          }
        } else {
          agentModelOverride = OPENAI_CODEX_DEFAULT_MODEL;
          await noteAgentModel(OPENAI_CODEX_DEFAULT_MODEL);
        }
      }
    } catch (err) {
      spin.stop("OpenAI OAuth failed");
      params.runtime.error(String(err));
      await params.prompter.note(
        "Trouble with OAuth? See https://docs.molt.bot/start/faq",
        "OAuth help",
      );
    }
    return { config: nextConfig, agentModelOverride };
  }

  return null;
}
