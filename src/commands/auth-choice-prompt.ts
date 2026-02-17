import type { AuthProfileStore } from "../agents/auth-profiles.js";
import { listProfilesForProvider } from "../agents/auth-profiles.js";
import { resolveEnvApiKey } from "../agents/model-auth.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import type { AuthChoiceGroup, AuthChoiceOption } from "./auth-choice-options.js";
import { buildAuthChoiceGroups } from "./auth-choice-options.js";
import { resolvePreferredProviderForAuthChoice } from "./auth-choice.preferred-provider.js";
import type { AuthChoice } from "./onboard-types.js";

const BACK_VALUE = "__back";

function toKindLabel(type: "api_key" | "oauth" | "token" | undefined): "APIKey" | "OAuth" {
  if (type === "oauth" || type === "token") {
    return "OAuth";
  }
  return "APIKey";
}

function stripEnvSourcePrefix(source: string): string {
  return source.replace(/^shell env: /, "").replace(/^env: /, "");
}

function resolveProviderKeysForGroup(group: AuthChoiceGroup): string[] {
  const keys = group.options
    .map((option) => resolvePreferredProviderForAuthChoice(option.value))
    .filter((provider): provider is string => Boolean(provider));
  return [...new Set(keys)];
}

export function resolveExistingAuthLinesForGroup(params: {
  group: AuthChoiceGroup;
  store: AuthProfileStore;
}): string[] {
  const providerKeys = resolveProviderKeysForGroup(params.group);
  const showProvider = providerKeys.length > 1;
  const lines = new Set<string>();

  for (const providerKey of providerKeys) {
    const profileIds = listProfilesForProvider(params.store, providerKey);
    for (const profileId of profileIds) {
      const kind = toKindLabel(params.store.profiles[profileId]?.type);
      const providerSuffix = showProvider ? ` (${providerKey})` : "";
      lines.add(`${kind}: ${profileId}${providerSuffix}`);
    }

    const envKey = resolveEnvApiKey(providerKey);
    if (envKey) {
      const kind = envKey.source.includes("OAUTH_TOKEN") ? "OAuth" : "APIKey";
      const source = stripEnvSourcePrefix(envKey.source);
      const providerSuffix = showProvider ? ` (${providerKey})` : "";
      lines.add(`${kind}: ${source}${providerSuffix}`);
    }
  }

  return [...lines];
}

export function buildKeepExistingOption(params: {
  group: AuthChoiceGroup;
  store: AuthProfileStore;
}): AuthChoiceOption | undefined {
  const lines = resolveExistingAuthLinesForGroup(params);
  if (lines.length === 0) {
    return undefined;
  }
  return {
    value: "skip",
    label: "Keep existing",
    hint: lines.join("\n"),
  };
}

export async function promptAuthChoiceGrouped(params: {
  prompter: WizardPrompter;
  store: AuthProfileStore;
  includeSkip: boolean;
}): Promise<AuthChoice> {
  const { groups, skipOption } = buildAuthChoiceGroups(params);
  const availableGroups = groups.filter((group) => group.options.length > 0);

  while (true) {
    const providerOptions = [
      ...availableGroups.map((group) => ({
        value: group.value,
        label: group.label,
        hint: group.hint,
      })),
      ...(skipOption ? [skipOption] : []),
    ];

    const providerSelection = (await params.prompter.select({
      message: "Model/auth provider",
      options: providerOptions,
    })) as string;

    if (providerSelection === "skip") {
      return "skip";
    }

    const group = availableGroups.find((candidate) => candidate.value === providerSelection);

    if (!group || group.options.length === 0) {
      await params.prompter.note(
        "No auth methods available for that provider.",
        "Model/auth choice",
      );
      continue;
    }

    if (group.options.length === 1) {
      return group.options[0].value;
    }

    const keepExistingOption = params.includeSkip
      ? buildKeepExistingOption({ group, store: params.store })
      : undefined;
    const methodOptions: Array<{ value: string; label: string; hint?: string }> = [
      ...group.options,
      ...(keepExistingOption ? [keepExistingOption] : []),
      { value: BACK_VALUE, label: "Back" },
    ];

    const methodSelection = await params.prompter.select({
      message: `${group.label} auth method`,
      options: methodOptions,
    });

    if (methodSelection === BACK_VALUE) {
      continue;
    }

    return methodSelection as AuthChoice;
  }
}
