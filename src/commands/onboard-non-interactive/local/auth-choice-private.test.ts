import { describe, expect, it, vi } from "vitest";
import type { RuntimeEnv } from "../../../../runtime.js";
import { applyNonInteractiveAuthChoice } from "./auth-choice.js";

describe("applyNonInteractiveAuthChoice - openai-private-endpoint", () => {
  it("applies private endpoint config when options are provided", async () => {
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };

    const nextConfig = {
        models: {
            providers: {}
        }
    };
    const opts = {
      authChoice: "openai-private-endpoint" as const,
      openaiPrivateProviderId: "ni-provider",
      openaiPrivateBaseUrl: "https://ni-endpoint.com",
      openaiPrivateApiKey: "ni-key",
      openaiPrivateModelId: "ni-model",
    };

    const result = await applyNonInteractiveAuthChoice({
      nextConfig: nextConfig as any,
      authChoice: "openai-private-endpoint",
      opts: opts as any,
      runtime,
      baseConfig: {} as any,
    });

    expect(result?.models?.providers?.["ni-provider"]).toMatchObject({
      baseUrl: "https://ni-endpoint.com",
      apiKey: "ni-key",
      api: "openai-completions",
    });
    expect(result?.agents?.defaults?.model?.primary).toBe("ni-provider/ni-model");
  });

  it("exits if required options are missing", async () => {
    const runtime: RuntimeEnv = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    };

    const opts = {
      authChoice: "openai-private-endpoint" as const,
      // missing other options
    };

    await applyNonInteractiveAuthChoice({
      nextConfig: {} as any,
      authChoice: "openai-private-endpoint",
      opts: opts as any,
      runtime,
      baseConfig: {} as any,
    });

    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("Missing required options"));
    expect(runtime.exit).toHaveBeenCalledWith(1);
  });
});
