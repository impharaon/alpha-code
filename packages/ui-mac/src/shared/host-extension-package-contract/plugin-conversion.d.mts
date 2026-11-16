export type Sha256 = `sha256:${string}`;
export type RelPath = string;
export type Json = null | boolean | number | string | Json[] | {
    [key: string]: Json;
};
export type Source = {
    kind: "folder" | "git" | "listing" | "marketplace" | "mcp-registry" | "npm" | "created";
    locator: string;
    repository?: string;
    commit?: string;
    pluginPath?: string;
    ecosystem?: "claude" | "codex" | "opencode";
    entryName?: string;
    serverName?: string;
    version?: string;
    integrity?: string;
};
export type Provider = "claude-code" | "codex" | "skill" | "mcp-registry" | "opencode";
export type TreeNode = {
    kind: "directory";
    path: RelPath;
    mode: number;
} | {
    kind: "file";
    path: RelPath;
    mode: number;
    bytes: number;
    digest: Sha256;
} | {
    kind: "symlink";
    path: RelPath;
    target: string;
};
export type Capture = {
    source: Source;
    nodes: readonly TreeNode[];
    readFile(path: RelPath): Promise<Uint8Array>;
};
export type Text = readonly (string | {
    binding: "pluginRoot" | "skillDir" | "projectDir";
} | {
    secret: string;
})[];
export type ToolRule = {
    tool: string;
    pattern?: string;
};
export type ModelHint = {
    alias: string;
} | {
    providerID: string;
    modelID: string;
};
export type Invocation = {
    argumentHint?: string;
    model?: ModelHint;
    agent?: string;
    fork: boolean;
    userInvocable: boolean;
    implicitInvocation: boolean;
    allowedTools: ToolRule[];
    deniedTools: ToolRule[];
    availableTools?: ToolRule[];
};
export type SecretNeed = {
    id: string;
    componentId: string;
    label: string;
    targets: {
        file: RelPath;
        pointer: string;
    }[];
};
export type LoginNeed = {
    id: string;
    componentId: string;
    kind: "mcp-oauth";
    required: boolean;
    serviceId: string;
    serverUrl: string;
    oauth?: {
        clientId?: string;
        clientSecret?: Text;
        scopes?: string[];
        resource?: string;
        authorizationServerUrl?: string;
    };
};
export type HookEvent = "SessionStart" | "UserPromptSubmit" | "UserPromptExpansion" | "PreToolUse" | "PostToolUse" | "PostToolUseFailure" | "Stop" | "StopFailure" | "PermissionRequest";
export type Hook = {
    event: HookEvent;
    matcher?: string;
    if?: string;
    command: Text;
    timeoutSeconds: number;
    async: boolean;
    asyncRewake: boolean;
    onFailure: "continue" | "block";
    order: number;
    scope: {
        kind: "package";
    } | {
        kind: "skill" | "agent";
        entryId: string;
    };
};
type EntryBase = {
    id: string;
    sourcePath: RelPath;
    sourceName: string;
};
export type Entry = EntryBase & ({
    kind: "skill";
    directory: RelPath;
    instruction: Text;
    invocation: Invocation;
    display: Record<string, Json>;
    mcpDependencies: string[];
} | {
    kind: "command" | "agent";
    instruction: Text;
    invocation: Invocation;
} | {
    kind: "mcp";
    transport: "stdio";
    command: Text[];
    environment: Record<string, Text>;
    cwd?: Text;
    timeoutMs?: number;
    floatingVersion?: {
        commandIndex: number;
        token: string;
    };
} | {
    kind: "mcp";
    transport: "http" | "sse";
    url: Text;
    headers: Record<string, Text>;
    timeoutMs?: number;
    oauth?: false | LoginNeed;
} | {
    kind: "hook";
    hook: Hook;
});
export type Diagnostic = {
    path: RelPath;
    field?: string;
    code: "invalid-definition" | "missing-entry" | "unresolved-app-id";
    message: string;
};
export type PluginPackage = {
    schema: "codepuppy.plugin-package.v1";
    provider: Provider;
    name: string;
    version?: string;
    description?: string;
    source: Source;
    tree: TreeNode[];
    treeDigest: Sha256;
    entries: Entry[];
    secrets: SecretNeed[];
    diagnostics: Diagnostic[];
};
export type MarketplaceEntry = {
    name: string;
    description: string;
    category?: string;
    source: {
        kind: "path";
        path: RelPath;
    } | {
        kind: "git";
        url: string;
        commit?: string;
        ref?: string;
        path?: RelPath;
    } | {
        kind: "unsupported";
        detail: string;
    };
};
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
export {};
