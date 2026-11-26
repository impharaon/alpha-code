export type { Sha256, RelPath, Json, Source, Provider, TreeNode, Capture, Text, ToolRule, ModelHint, Invocation, SecretNeed, LoginNeed, HookEvent, Hook, Entry, Diagnostic, PluginPackage, MarketplaceEntry } from "./plugin-package";
import type { RelPath, Json, Source, Capture, Entry, Diagnostic, PluginPackage, MarketplaceEntry } from "./plugin-package";
export declare class CaptureError extends Error {
    readonly code: "invalid-path" | "duplicate-path" | "invalid-node" | "read-failed" | "digest-mismatch";
    readonly path: string;
    constructor(code: "invalid-path" | "duplicate-path" | "invalid-node" | "read-failed" | "digest-mismatch", path: string);
}
export declare function readMarketplace(bytes: Uint8Array, ecosystem: "claude" | "codex"): {
    name: string;
    entries: MarketplaceEntry[];
    diagnostics: Diagnostic[];
};
/** Validate the captured bytes before interpreting any definition; only sanitized bytes leave the converter. */
export declare function convertPluginTree(input: Capture): Promise<{
    package: PluginPackage;
    replacements: ReadonlyMap<RelPath, Uint8Array>;
    privateCredentials: ReadonlyMap<string, Uint8Array>;
}>;
/** A registry definition has no plugin tree or executable installation step. */
export declare function convertMcpServerDefinition(server: Json, source: Source): {
    package: PluginPackage;
    privateCredentials: ReadonlyMap<string, Uint8Array>;
};
/** Materialize only the installed copy; discovery and frontmatter field meanings remain converter-owned. */
export declare function renderInstalledSkill(entry: Extract<Entry, {
    kind: "skill";
}>, bytes: Uint8Array, hosts: ReadonlyMap<string, string>): Uint8Array;
