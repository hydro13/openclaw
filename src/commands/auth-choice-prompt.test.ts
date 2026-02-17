import { afterEach, describe, expect, it, vi } from "vitest";
import type { AuthProfileStore } from "../agents/auth-profiles.js";
import type { WizardPrompter, WizardSelectParams } from "../wizard/prompts.js";
import { buildAuthChoiceGroups } from "./auth-choice-options.js";
import { promptAuthChoiceGrouped, resolveExistingAuthLinesForGroup } from "./auth-choice-prompt.js";
import { createWizardPrompter } from "./test-wizard-helpers.js";

const ORIGINAL_OPENAI_API_KEY = process.env.OPENAI_API_KEY;

function createStore(): AuthProfileStore {
  return {
    version: 1,
    profiles: {
      "openai-codex:default": {
        type: "oauth",
        provider: "openai-codex",
        access: "access-token",
        refresh: "refresh-token",
      },
    },
  };
}

function requireOpenAiGroup(store: AuthProfileStore) {
  const group = buildAuthChoiceGroups({
    store,
    includeSkip: false,
  }).groups.find((entry) => entry.value === "openai");

  if (!group) {
    throw new Error("openai auth choice group missing");
  }

  return group;
}

afterEach(() => {
  if (ORIGINAL_OPENAI_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_OPENAI_API_KEY;
  }
  vi.restoreAllMocks();
});

describe("auth choice keep existing", () => {
  it("lists existing APIKey and OAuth entries for OpenAI", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const store = createStore();

    const lines = resolveExistingAuthLinesForGroup({
      group: requireOpenAiGroup(store),
      store,
    });

    expect(lines).toContain("APIKey: OPENAI_API_KEY (openai)");
    expect(lines).toContain("OAuth: openai-codex:default (openai-codex)");
  });

  it("offers Keep existing in the method selector and returns skip", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const store = createStore();

    const select: WizardPrompter["select"] = vi.fn(async (params: WizardSelectParams) => {
      if (params.message === "Model/auth provider") {
        return "openai";
      }
      if (params.message === "OpenAI auth method") {
        const keepExisting = params.options.find((option) => option.value === "skip");
        expect(keepExisting?.label).toBe("Keep existing");
        expect(keepExisting?.hint).toContain("APIKey:");
        expect(keepExisting?.hint).toContain("OAuth:");
        expect(keepExisting?.hint).toContain("\n");
        return "skip";
      }
      return params.options[0]?.value ?? "skip";
    });

    const prompter = createWizardPrompter(
      { select: select as unknown as WizardPrompter["select"] },
      { defaultSelect: "" },
    );

    await expect(
      promptAuthChoiceGrouped({
        prompter,
        store,
        includeSkip: true,
      }),
    ).resolves.toBe("skip");
  });

  it("does not show Keep existing when provider has no existing auth", async () => {
    delete process.env.OPENAI_API_KEY;
    const store: AuthProfileStore = { version: 1, profiles: {} };

    const select: WizardPrompter["select"] = vi.fn(async (params: WizardSelectParams) => {
      if (params.message === "Model/auth provider") {
        return "openai";
      }
      if (params.message === "OpenAI auth method") {
        expect(params.options.some((option) => option.value === "skip")).toBe(false);
        return "openai-api-key";
      }
      return params.options[0]?.value ?? "openai-api-key";
    });

    const prompter = createWizardPrompter(
      { select: select as unknown as WizardPrompter["select"] },
      { defaultSelect: "" },
    );

    await expect(
      promptAuthChoiceGrouped({
        prompter,
        store,
        includeSkip: true,
      }),
    ).resolves.toBe("openai-api-key");
  });
});
