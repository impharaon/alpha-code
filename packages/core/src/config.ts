export * as Config from "./config.js"

import { makeLocationNode } from "@opencode/util/effect/app-node"
import path from "path"
import { isDeepStrictEqual } from "node:util"
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser"
import { Context, Effect, FiberMap, Layer, Option, PubSub, Ref, Schema, Semaphore, Stream } from "effect"
import { Directory, Document, Info, type Patch, type Entry, Event } from "@opencode/schema/config"
import { Credential } from "./credential.js"
import { Bus } from "./bus.js"
import { Watcher } from "./filesystem/watcher.js"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Location } from "./location.js"
import { AbsolutePath } from "./schema.js"
import { ConfigVariable } from "./config/variable.js"
import { ConfigNormalize } from "./config/normalize.js"
import { ConfigDiscovery } from "./config/discovery.js"
import { ConfigWatch } from "./config/watch.js"
import { ConfigIntegration } from "./config/integration.js"
import { ConfigManaged } from "./config/managed.js"
import { CodePuppyProjectGate } from "./config/codepuppy-project-gate.js" // codepuppy(ADR-049)
import { refreshCodePuppyCredentials, resolveCodePuppyCredentialRefs } from "@opencode/util/codepuppy-credentials" // codepuppy(I-20)
import { ManagedPolicy } from "./managed-policy.js"
import { Connection } from "@opencode/schema/connection"
import { WellKnown } from "./wellknown.js"
import { AppProcess } from "@opencode/util/process"
import { ChildProcess } from "effect/process"
import type { ConfigSource } from "@opencode/plugin/codepuppy-package-runtime" // codepuppy(S-04)
import { createPluginConfigRevisionReader } from "./config/codepuppy-plugin-config-change.js" // codepuppy(S-04)

export function latest<K extends keyof Info>(entries: readonly Entry[], key: K): Info[K] | undefined {
  return entries.findLast((entry): entry is Document => entry.type === "document" && entry.info[key] !== undefined)
    ?.info[key]
}

export interface Interface {
  /** Returns location config documents and discovery sources from lowest to highest priority. */
  readonly entries: () => Effect.Effect<Entry[]>
  /** Compatibility roots consumed by internal compatibility plugins. */
  readonly compatibility?: () => Effect.Effect<{
    readonly claude: readonly AbsolutePath[]
    readonly agents: readonly AbsolutePath[]
  }>
  /**
   * Streams raw filesystem updates under config roots. Config owns root
   * topology and watch reconciliation; domain owners filter this feed for the
   * source files they parse and rebuild their own state.
   */
  readonly changes: () => Stream.Stream<Watcher.Update>
  /** Updates supported global config fields while preserving unrelated JSONC content. */
  readonly update?: (patch: Patch) => Effect.Effect<void, FSUtil.Error>
  /**
   * Replaces, or clears with `undefined`, the document an integration connection contributes. It loads right after
   * managed policies: its settings layer below remote, user, and project config, while its policies outrank theirs.
   * Changing it reloads config like any other source.
   */
  readonly integration?: (
    integrationID: ConfigIntegration.Document["integrationID"],
    document: ConfigIntegration.Document | undefined,
  ) => Effect.Effect<void>
}

export const Options = Schema.Struct({
  project: Schema.optional(Schema.Boolean),
  // false skips the system and global config dirs, ~/.claude, and ~/.agents;
  // wellknown, file, and content entries still load.
  global: Schema.optional(Schema.Boolean),
  system: Schema.optional(Schema.Union([Schema.Boolean, Schema.String])),
  // false skips ~/.claude and project .claude dirs.
  claude: Schema.optional(Schema.Boolean),
  file: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
})
export type Options = typeof Options.Type

export class Service extends Context.Service<Service, Interface>()("@opencode/Config") {}

export interface TestInterface extends Interface {
  /** Replaces the entries returned by subsequent entries() calls. */
  readonly setEntries: (entries: Entry[]) => Effect.Effect<void>
  /** Emits one filesystem update to every changes() subscriber. */
  readonly emitChange: (update: Watcher.Update) => Effect.Effect<void>
}

export class Test extends Context.Service<Test, TestInterface>()("@opencode/Config/Test") {}

/** In-memory config for tests: static entries with replaceable state and a test-driven change feed. */
export const testLayer = (
  initial: Entry[] = [],
  compatibility: { readonly claude: readonly AbsolutePath[]; readonly agents: readonly AbsolutePath[] } = {
    claude: [],
    agents: [],
  },
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const entries = yield* Ref.make(initial)
      const integrations = yield* Ref.make(new Map<string, ConfigIntegration.Document>())
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const service = Test.of({
        entries: () =>
          Effect.all([Ref.get(integrations), Ref.get(entries)]).pipe(
            Effect.map(([documents, entries]) => [...documents.values(), ...entries]),
          ),
        compatibility: () => Effect.succeed(compatibility),
        changes: () => Stream.fromPubSub(updates),
        setEntries: (next) => Ref.set(entries, next),
        emitChange: (update) => PubSub.publish(updates, update).pipe(Effect.asVoid),
        integration: (integrationID, document) =>
          Ref.update(integrations, (current) => {
            const next = new Map(current)
            next.delete(integrationID)
            return document ? next.set(integrationID, document) : next
          }),
      })
      return Context.empty().pipe(Context.add(Service, service), Context.add(Test, service))
    }),
  )

export const layer = (options?: Options) =>
  Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* FSUtil.Service
      const location = yield* Location.Service
      const watcher = yield* Watcher.Service
      const bus = yield* Bus.Service
      const credentials = yield* Credential.Service
      const globalService = yield* Global.Service
      const wellknown = yield* WellKnown.Service
      const processes = yield* AppProcess.Service
      const integrations = new Map<string, ConfigIntegration.Document>()
      // Integrations set their documents from outside this layer, so their reloads run with its services.
      const context = yield* Effect.context<FSUtil.Service | Global.Service | Location.Service>()
      const reloadLock = Semaphore.makeUnsafe(1)
      const updateLock = Semaphore.makeUnsafe(1)
      const decodeOptions = { errors: "all", onExcessProperty: "ignore" } as const
      const decodeInfo = Schema.decodeUnknownOption(Info, decodeOptions)
      const parseInfo = Effect.fn("Config.parseInfo")(function* (text: string, source: string) {
        const errors: ParseError[] = []
        const input: unknown = parse(text, errors, { allowTrailingComma: true })
        if (errors.length) {
          yield* Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: "$",
            kind: "invalid",
            action: "rejected malformed JSON or JSONC document",
          })
          return
        }
        const result = ConfigNormalize.normalize(input)
        yield* Effect.forEach(result.diagnostics, (diagnostic) =>
          Effect.logWarning("configuration normalization diagnostic", {
            source,
            path: diagnostic.path[0] === "$" ? "$" : `$.${diagnostic.path.join(".")}`,
            kind: diagnostic.kind,
            action: diagnostic.message,
          }),
        )
        if (result.type === "rejected") return
        const info = Option.getOrUndefined(decodeInfo(result.encoded))
        if (info) return info
        yield* Effect.logWarning("configuration normalization diagnostic", {
          source,
          path: "$",
          kind: "invalid",
          action: "rejected canonical configuration after final validation",
        })
      })

      // codepuppy(I-20) ── DESIGN-stored-credentials-fence §4.4: Code Puppy's two documents (the explicit file and the inline content) take
      // credential values from the in-process table only. Before each load of one of them that has a {file:} reference, pull the table from
      // the main process (one request per load, never merged); then substitute only at the closed list of credential positions. A failed pull
      // substitutes nothing — the references stay for the engine's own read below, never an older table. No other document is touched.
      // The documents are read as JSONC (the explicit slot carries the user's raw codepuppy.jsonc when injection failed): the parser is the
      // jsonc-parser this file already imports. A document that cannot be parsed at all is named in one warning (never its content).
      const codepuppyCredentialText = Effect.fnUntraced(function* (text: string, document: "inline" | "explicit") {
        if (!text.includes("{file:")) return text
        const pulled = yield* Effect.promise(() => refreshCodePuppyCredentials().then(() => true, () => false))
        if (!pulled) return text
        let unparseable = false
        const resolved = resolveCodePuppyCredentialRefs(text, document, (raw) => {
          const errors: ParseError[] = []
          const value = parse(raw, errors, { allowTrailingComma: true })
          unparseable = errors.length > 0
          return unparseable ? undefined : value
        })
        if (unparseable) yield* Effect.logWarning("Code Puppy credential document could not be parsed; no credential was substituted", { document })
        return resolved
      })
      // codepuppy ── end

      const pluginRevisions = createPluginConfigRevisionReader(location) // codepuppy(S-04)
      const loadFile = Effect.fnUntraced(function* (filepath: string, source: ConfigSource, gate?: CodePuppyProjectGate.Filter, codepuppyDocument?: "explicit") { // codepuppy(ADR-049, I-20)
        const text = yield* pluginRevisions.select(filepath, source, yield* fs.readFileStringSafe(filepath)) // codepuppy(S-04)
        if (text === undefined) return
        const prepared = codepuppyDocument ? yield* codepuppyCredentialText(text, codepuppyDocument) : text // codepuppy(I-20)
        const substituted = yield* ConfigVariable.substitute({ type: "path", path: filepath, text: prepared }) // codepuppy(I-20)
        const info = yield* parseInfo(gate ? gate.raw(substituted, filepath) : substituted, filepath) // codepuppy(ADR-049)
        if (!info) return
        return new Document({ type: "document", path: AbsolutePath.make(filepath), info: gate ? gate.decoded(info, filepath) : info }) // codepuppy(ADR-049)
      })

      // codepuppy(I-13 L3): loadWellknownEntry / loadWellknown removed — wellknown documents are not loaded (see load()).

      // `integration.use` decides whether an integration may supply anything. Only managed policies can withhold the
      // documents an integration delivers, so a project file can never strip the Console document carrying org policy.
      // A withheld document keeps its policies, so denying an integration never lifts the restrictions it carries.
      const supplies = Effect.fnUntraced(function* (
        lockdown: ReturnType<typeof ManagedPolicy.statements>,
        integrationID: string,
        connection?: Connection.Info,
      ) {
        const stored =
          connection?.type === "credential" ? yield* credentials.get(Credential.ID.make(connection.id)) : undefined
        const resource = ManagedPolicy.integrationResource(
          integrationID,
          stored ? ManagedPolicy.account(stored.value) : undefined,
        )
        return ManagedPolicy.decision(lockdown, "integration.use", resource) !== "deny"
      })

      const loadPreferences = Effect.fn("Config.loadPreferences")(function* (plist: AbsolutePath) {
        const result = yield* processes
          .run(ChildProcess.make("plutil", ["-convert", "json", "-o", "-", plist], { stdin: "ignore" }), {
            timeout: "10 seconds",
          })
          .pipe(Effect.flatMap(AppProcess.requireSuccess), Effect.option)
        if (Option.isNone(result)) {
          yield* Effect.logWarning("failed to convert managed preferences", { source: plist })
          return []
        }
        const text = yield* ConfigVariable.substitute({
          type: "virtual",
          source: plist,
          dir: path.dirname(plist),
          text: (yield* pluginRevisions.select(plist, "policy_settings", ConfigDiscovery.stripPreferenceMetadata(result.value.stdout.toString())))!, // codepuppy(S-04): managed policy cannot be rejected.
        })
        const info = yield* parseInfo(text, plist)
        return info ? [new Document({ type: "document", path: plist, info })] : []
      })

      const loadDirectory = Effect.fnUntraced(function* (directory: AbsolutePath, source: ConfigSource, gate?: CodePuppyProjectGate.Filter) { // codepuppy(ADR-049)
        return [
          ...(yield* Effect.forEach(ConfigDiscovery.names, (file) => loadFile(path.join(directory, file), source, gate)).pipe( // codepuppy(ADR-049)
            Effect.map((configs) => configs.filter((config): config is Document => config !== undefined)),
          )),
          new Directory({ type: "directory", path: directory }),
        ]
      })

      const load = Effect.fn("Config.load")(function* (sources: ConfigDiscovery.Sources) {
        // codepuppy(ADR-049) ── project config behind the #1709 trust record: one trust read per load; project documents are
        // filtered before normalization, project .opencode plugin directories are denied by a document right after managed policies
        const gate = yield* CodePuppyProjectGate.begin({ directory: location.directory, home: globalService.home })
        // codepuppy ── end
        const direct = yield* Effect.forEach(sources.direct, (filepath) => loadFile(filepath, "project_settings", gate.document(filepath))).pipe( // codepuppy(ADR-049)
          Effect.orDie,
          Effect.map((entries) => entries.filter((entry): entry is Document => entry !== undefined)),
        )

        const explicit = sources.explicit
          ? yield* loadFile(sources.explicit, "local_settings", undefined, "explicit").pipe( // codepuppy(I-20)
              Effect.map((config) => (config ? [config] : [])),
              Effect.orDie,
            )
          : []
        const content =
          options?.content !== undefined
            ? yield* codepuppyCredentialText(options.content, "inline").pipe( // codepuppy(I-20)
                Effect.flatMap((text) => ConfigVariable.substitute({ type: "virtual", source: "OPENCODE_CONFIG_CONTENT", dir: location.directory, text })), // codepuppy(I-20)
                Effect.flatMap((text) => parseInfo(text, "OPENCODE_CONFIG_CONTENT")),
                Effect.map((info) => (info ? [new Document({ type: "document", info })] : [])),
                Effect.orDie,
              )
            : []

        // Managed settings load last so they override everything, and MDM
        // preferences outrank the system directory as in V1. Policies evaluate
        // in reverse load order, so managed policies split off and load first
        // to keep final file-based authority.
        const managed = [
          ...(sources.system?.present ? yield* loadDirectory(sources.system.path, "policy_settings").pipe(Effect.orDie) : []),
          ...(sources.preferences ? yield* loadPreferences(sources.preferences).pipe(Effect.orDie) : []),
        ]
        const managedPolicies = managed
          .flatMap((entry) =>
            entry.type === "document" && entry.info.policies
              ? [
                  new ConfigManaged.Document({
                    type: "document",
                    path: entry.path,
                    info: new Info({ policies: entry.info.policies }),
                  }),
                ]
              : [],
          )
          .toReversed()
        const managedSettings = managed.map((entry) =>
          entry.type === "document"
            ? new ConfigManaged.Document({ ...entry, info: new Info({ ...entry.info, policies: undefined }) })
            : entry,
        )
        // Integration documents load right after managed policies: every remote, user, and project layer overrides
        // their settings, and since policies evaluate earliest-loaded first, only managed policies outrank theirs.
        // Global entries sit below explicit and direct files; project directories rank above them.
        const globalSupplementary = sources.global ? yield* loadDirectory(sources.global, "user_settings").pipe(Effect.orDie) : []
        const projectSupplementary = yield* Effect.forEach(
          sources.project.filter((root) => root.present),
          (root) => loadDirectory(root.path, "project_settings", gate.directory(root.path)), // codepuppy(ADR-049)
        ).pipe(
          Effect.orDie,
          Effect.map((entries) => entries.flat()),
        )
        const lockdown = ManagedPolicy.statements(managedPolicies)
        const integrated = yield* Effect.forEach(integrations.values(), (document) =>
          supplies(lockdown, document.integrationID, document.connection).pipe(
            Effect.map((allowed) =>
              allowed
                ? document
                : new ConfigIntegration.Document({ ...document, info: new Info({ policies: document.info.policies }) }),
            ),
          ),
        )
        // codepuppy(I-13 L3) ── no wellknown documents: their sources, cached manifests and cached documents live in the engine
        // database, which a fenced process can write, and a cached document can start a local MCP server. Code Puppy registers no
        // wellknown source. The WellKnown service, plugin and refresh are untouched. DESIGN-engine-config-fence §4.6, D8.
        // codepuppy ── end
        return yield* gate.finish([ // codepuppy(ADR-049)
          ...managedPolicies,
          ...gate.documents(), // codepuppy(ADR-049)
          ...integrated,
          ...globalSupplementary,
          ...explicit,
          ...direct,
          ...projectSupplementary,
          ...content,
          ...managedSettings,
        ], [...explicit, ...content, ...managedSettings]) // codepuppy(ADR-049; D6: Code Puppy's own and system/MDM entries are not native sources)
      })

      const initial = yield* ConfigDiscovery.discover(options)
      let sources = initial
      let configs = yield* load(initial)
      pluginRevisions.ready() // codepuppy(S-04): initial load is not a file change.
      const updates = yield* PubSub.unbounded<Watcher.Update>()
      const reloads = yield* PubSub.sliding<void>(1)
      // Readiness rescans recover writes made before a watch attached.
      const requestReload = PubSub.publish(reloads, undefined).pipe(Effect.asVoid)
      const watched = yield* FiberMap.make<string>()
      const reconcile = Effect.fn("Config.reconcileWatches")(function* (sources: ConfigDiscovery.Sources) {
        const plan = ConfigWatch.plan(sources)
        for (const key of Array.from(watched, ([key]) => key)) {
          if (!plan.has(key)) yield* FiberMap.remove(watched, key)
        }
        for (const [key, target] of plan) {
          yield* watcher
            .subscribe(target, requestReload)
            .pipe(
              Effect.flatMap(
                Stream.runForEach((update) => PubSub.publish(updates, update).pipe(Effect.andThen(requestReload))),
              ),
              FiberMap.run(watched, key, { onlyIfMissing: true, startImmediately: true }),
            )
        }
      })

      const reload = Effect.fn("Config.reload")(
        function* () {
          const discovered = yield* ConfigDiscovery.discover(options)
          const next = yield* load(discovered)
          yield* reconcile(discovered)
          const compatibilityChanged =
            !isDeepStrictEqual(sources.claude, discovered.claude) ||
            !isDeepStrictEqual(sources.agents, discovered.agents)
          if (isDeepStrictEqual(configs, next) && !compatibilityChanged) return
          sources = discovered
          configs = next
          yield* bus.publish(Event.Updated, {})
        },
        (effect) => reloadLock.withPermit(effect),
      )

      // Subscribe eagerly so synchronous watch readiness isn't dropped.
      const pendingReloads = yield* PubSub.subscribe(reloads)
      yield* Stream.fromSubscription(pendingReloads).pipe(
        Stream.debounce("100 millis"),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(Credential.Event.Switched).pipe(
        Stream.filterEffect((event) =>
          wellknown.entries().pipe(
            Effect.map((entries) => entries.some((entry) => entry.integrationID === event.data.integrationID)),
            Effect.orElseSucceed(() => false),
          ),
        ),
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown config", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* bus.subscribe(WellKnown.Event.Updated).pipe(
        Stream.runForEach(() =>
          reload().pipe(Effect.catchCause((cause) => Effect.logError("failed to reload wellknown sources", { cause }))),
        ),
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* Effect.sleep("10 minutes").pipe(
        Effect.andThen(
          Effect.suspend(() => {
            if (!wellknown.snapshot().length) return Effect.void
            return Effect.gen(function* () {
              const changed = yield* wellknown
                .refresh()
                .pipe(
                  Effect.catch((error) =>
                    Effect.logWarning("failed to refresh wellknown manifests", { error }).pipe(Effect.as(false)),
                  ),
                )
              if (!changed) yield* reload()
            }).pipe(Effect.catchCause((cause) => Effect.logWarning("failed to refresh wellknown config", { cause })))
          }),
        ),
        Effect.forever,
        Effect.forkScoped({ startImmediately: true }),
      )
      yield* reloadLock.withPermit(reconcile(initial))

      const update = Effect.fn("Config.update")(
        function* (patch: Patch) {
          const directory = initial.global ?? AbsolutePath.make(globalService.config)
          const candidates = ConfigDiscovery.names.map((name) => path.join(directory, name))
          const filepath =
            (yield* Effect.filter(candidates, fs.isFile)).at(-1) ?? path.join(directory, "opencode.jsonc")
          const text = (yield* fs.readFileStringSafe(filepath)) ?? "{}\n"
          const updated = yield* Effect.try({
            try: () =>
              applyEdits(
                text,
                modify(text, ["shell"], patch.shell ?? undefined, {
                  formattingOptions: { tabSize: 2, insertSpaces: true },
                }),
              ),
            catch: (cause) => new FSUtil.FileSystemError({ method: "config.update", cause }),
          })
          yield* fs.writeWithDirs(filepath, updated.endsWith("\n") ? updated : `${updated}\n`)
          yield* requestReload
        },
        (effect) => updateLock.withPermit(effect),
      )

      return Service.of({
        entries: Effect.fnUntraced(function* () {
          return configs
        }),
        compatibility: () =>
          Effect.all({
            claude: Effect.filter(sources.claude, fs.isDir),
            agents: Effect.filter(sources.agents, fs.isDir),
          }),
        changes: () => Stream.fromPubSub(updates),
        update,
        integration: Effect.fn("Config.integration")(function* (integrationID, document) {
          if (isDeepStrictEqual(integrations.get(integrationID), document)) return
          integrations.delete(integrationID)
          if (document) integrations.set(integrationID, document)
          yield* reload().pipe(
            Effect.provide(context),
            Effect.catchCause((cause) => Effect.logError("failed to reload config", { cause })),
          )
        }),
      })
    }),
  )

export function configured(options?: Options) {
  return makeLocationNode({
    service: Service,
    layer: layer(options),
    deps: [
      Watcher.node,
      Bus.node,
      FSUtil.node,
      Global.node,
      Location.node,
      Credential.node,
      WellKnown.node,
      AppProcess.node,
    ],
  })
}

export const node = configured()
