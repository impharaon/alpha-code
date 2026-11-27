export type { Sha256, RelPath, Json, JsonTemplate, LanguageServer, Source, Provider, TreeNode, LinkedNode, Capture, Text, ToolRule, ModelHint, ArgumentSyntax, SkillDisplay, McpToolDependency, Invocation, SecretNeed, LoginNeed, HookEvent, Hook, Entry, Diagnostic, PluginDefaults, PluginPackage, CopiedPluginPackage, CommandPluginSource, MarketplaceEntry } from "./plugin-package";
import type { RelPath, Json, Source, Capture, Text, ToolRule, Entry, Diagnostic, PluginPackage, MarketplaceEntry } from "./plugin-package";
export declare class CaptureError extends Error {
    readonly code: "invalid-path" | "duplicate-path" | "invalid-node" | "read-failed" | "digest-mismatch";
    readonly path: string;
    constructor(code: "invalid-path" | "duplicate-path" | "invalid-node" | "read-failed" | "digest-mismatch", path: string);
}
/** Read Markdown metadata while retaining the original Text nodes for invocation-time binding. */
export declare function pluginInstructionDefinition(instruction: Text): {
    body: Text;
    description?: string;
};
export declare function readMarketplace(bytes: Uint8Array, ecosystem: "claude" | "codex"): {
    name: string;
    entries: MarketplaceEntry[];
    diagnostics: Diagnostic[];
};
type ConvertedPlugin = {
    package: PluginPackage;
    replacements: ReadonlyMap<RelPath, Uint8Array>;
    privateCredentials: ReadonlyMap<string, Uint8Array>;
};
/** Validate the captured bytes before interpreting any definition; only sanitized bytes leave the converter. */
export declare function convertPluginTree(input: Capture): Promise<ConvertedPlugin>;
/** A registry definition has no plugin tree or executable installation step. */
export declare function convertMcpServerDefinition(server: Json, source: Source): {
    package: PluginPackage;
    privateCredentials: ReadonlyMap<string, Uint8Array>;
};
export declare function pluginToolRules(value: unknown, invalid: () => void): ToolRule[];
/** Materialize only the installed copy; discovery and frontmatter field meanings remain converter-owned. */
export declare function renderInstalledSkill(entry: Extract<Entry, {
    kind: "skill";
}>, bytes: Uint8Array, hosts: ReadonlyMap<string, string>): Uint8Array;
