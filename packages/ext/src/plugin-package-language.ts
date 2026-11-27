import { Effect, ManagedRuntime, Redacted, Stream } from "effect"
import { ChildProcess } from "effect/process"
import { readFileSync, realpathSync, statSync, unwatchFile, watchFile } from "node:fs"
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { AppProcess } from "../../util/src/process"
import { LayerNode } from "../../util/src/effect/layer-node"
import { codepuppyCredential } from "../../util/src/codepuppy-credentials"
import { pluginProcessConfig } from "../../ui-mac/src/shared/plugin-mcp-config"
import { renderPluginText, type Entry, type Json, type JsonTemplate, type PluginPackage, type Text } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-package"
import { INSTALLED_PLUGIN_SETTINGS_FILE } from "../../ui-mac/src/shared/installed-plugin-settings"
import type { LanguageServerStateV1, PackageLanguageStatusMessage } from "../../ui-mac/src/main/codepuppy-sidecar-messages"
import { allInstalledPluginPackages } from "./plugin-package-skills"
import { readPackageAllowSet } from "./gen-skill-paths"
import { managedPackageEntryAllowedHere } from "./package-scope"

/** The installed content a status belongs to: a copy's tree digest, a link's binding (main keys the graph by the same value). */
const installedIdentity = (description: PluginPackage) => description.materialization === "copy" ? description.treeDigest : description.link.bindingId

type LanguageEntry = Extract<Entry, { kind: "lsp" }>
type Installed = ReturnType<typeof allInstalledPluginPackages>[number]
export type LanguageServerStatus = Omit<PackageLanguageStatusMessage, "type">
/** S-02 document identity; documentVersion is the version this runtime sent for fileUri. */
export type LanguageDocumentRef = { packageId: string; entryId: string; projectRoot: string; fileUri: string; documentVersion: number }
export type LanguageDiagnostic = { line: number; character: number; severity: "error" | "warning" | "information" | "hint"; message: string; source?: string; code?: string }
export type LanguageFileResult = { status: LanguageServerStatus; file: string; diagnostics?: LanguageDiagnostic[] }

/** LSP protocol default from the source definition shape (design §4.11); other limits come only from the source. */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000
const SEVERITY = ["error", "warning", "information", "hint"] as const

type Published = { version: number; explicit: boolean; diagnostics: LanguageDiagnostic[] }
type Running = {
  send(message: Record<string, unknown>): void
  request(method: string, params: unknown, timeoutMs: number): Promise<unknown>
  initialized: Promise<boolean>
  documents: Map<string, { version: number; text: string }>
  /** Last version sent per URI; it keeps rising across close and reopen, so late answers stay older. */
  versions: Map<string, number>
  published: Map<string, Published>
  waiters: Set<{ uri: string; version: number; resolve(value: Published | undefined): void }>
  exited: Promise<void>
  alive: boolean
  pid?: number
  /** Graceful stop sends shutdown/exit first; the process scope then terminates anything left. */
  stop(graceful?: boolean): Promise<void>
}
type Server = {
  key: string
  generation: string
  installed: Installed
  entry: LanguageEntry
  packageId: string
  status: LanguageServerStatus
  restarts: number
  running?: Running
  starting?: Promise<Running | undefined>
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)

/** Fill each bound string leaf; a template that is exactly one option keeps the option's JSON type. */
function renderTemplate(template: JsonTemplate, render: (text: Text) => string, option: (key: string) => string | number | boolean | undefined): Json {
  const visit = (value: Json, pointer: string): Json => {
    const binding = template.bindings[pointer]
    if (binding) {
      const only = binding.length === 1 ? binding[0] : undefined
      if (only && typeof only !== "string" && "option" in only) { const typed = option(only.option); if (typed !== undefined) return typed }
      return render(binding)
    }
    if (Array.isArray(value)) return value.map((child, index) => visit(child, pointer + "/" + index))
    if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child as Json, pointer + "/" + key.replaceAll("~", "~0").replaceAll("/", "~1"))]))
    return value
  }
  return visit(template.value, "")
}

/** Parse Content-Length framed JSON-RPC bytes; malformed frames are a protocol error of this server only. */
function frameReader(onMessage: (message: Record<string, unknown>) => void, onError: (reason: string) => void) {
  let buffer = new Uint8Array(0)
  return (chunk: Uint8Array) => {
    const next = new Uint8Array(buffer.length + chunk.length)
    next.set(buffer)
    next.set(chunk, buffer.length)
    buffer = next
    for (;;) {
      const text = new TextDecoder("latin1").decode(buffer.subarray(0, Math.min(buffer.length, 1024)))
      const end = text.indexOf("\r\n\r\n")
      if (end < 0) return
      const length = Number(/(?:^|\r\n)content-length:\s*(\d+)/i.exec(text.slice(0, end))?.[1])
      if (!Number.isSafeInteger(length)) { buffer = new Uint8Array(0); return onError("invalid message header") }
      if (buffer.length < end + 4 + length) return
      const body = buffer.subarray(end + 4, end + 4 + length)
      buffer = buffer.slice(end + 4 + length)
      try {
        const message: unknown = JSON.parse(new TextDecoder().decode(body))
        if (record(message)) onMessage(message)
        else onError("invalid message")
      } catch { onError("invalid message") }
    }
  }
}

function diagnosticsOf(value: unknown): LanguageDiagnostic[] {
  return (Array.isArray(value) ? value : []).flatMap((item): LanguageDiagnostic[] => {
    if (!record(item) || !record(item.range) || !record(item.range.start) || typeof item.message !== "string") return []
    const start = item.range.start
    if (!Number.isSafeInteger(start.line) || !Number.isSafeInteger(start.character)) return []
    // LSP positions are 0-based; the edge shown to the assistant is 1-based.
    return [{ line: Number(start.line) + 1, character: Number(start.character) + 1, severity: SEVERITY[Number(item.severity) - 1] ?? "error", message: item.message,
      ...(typeof item.source === "string" ? { source: item.source } : {}), ...(typeof item.code === "string" || typeof item.code === "number" ? { code: String(item.code) } : {}) }]
  })
}

/**
 * One Location-level runtime (design §4.11 / S-02): servers keyed by packageId, entryId and project root.
 * `projectRoot` is the verified real project root (undefined outside a project) that receipts are scoped by;
 * the workspace, process cwd and every document URI use it, or the Location directory when there is none.
 */
export function createPackageLanguageServices(input: { root: string; directory: string; projectRoot(): string | undefined; report(status: LanguageServerStatus): void; log(line: string): void }) {
  const runtime = ManagedRuntime.make(LayerNode.compile(AppProcess.node))
  const servers = new Map<string, Server>()
  const documentUpdates = new Map<string, Promise<number>>()
  const observed = new Set<string>()
  let disposed = false
  const workspaceRoot = () => input.projectRoot() ?? input.directory
  /** One URI per real file, whether a tool names it through an alias, relatively or as a preview real path. */
  const canonicalFile = (path: string) => {
    const file = isAbsolute(path) ? path : resolve(workspaceRoot(), path)
    try { return realpathSync(file) } catch { try { return join(realpathSync(dirname(file)), basename(file)) } catch { return file } }
  }

  const sourceOf = (installed: Installed) => {
    if (!installed.settings) throw Error("start-error: package settings unavailable")
    return {
      description: installed.description, settings: installed.settings, pluginRoot: installed.pluginRoot, projectDir: workspaceRoot(),
      resolveEnvironment: (name: string) => process.env[name],
      resolveOptionSecret: (reference: string) => codepuppyCredential(reference.slice(6, -1)),
      resolveSecret: (id: string) => { const reference = installed.settings?.secretRefs[id]; return reference ? codepuppyCredential(reference.slice(6, -1)) : undefined },
    }
  }
  /** The declared program and argv as the spawning process resolves them; nothing is started here. */
  const command = (server: Server) => {
    const config = pluginProcessConfig(sourceOf(server.installed))
    const definition = server.entry.server
    const env: Record<string, string> = { ...config.environment(), ...Object.fromEntries(Object.entries(definition.env).map(([key, value]) => [key, config.render(value)])) }
    const program = config.render(definition.command)
    const path = env.PATH ?? process.env.PATH ?? ""
    return { config, env, program, args: definition.args.map(config.render), resolved: Bun.which(program, { PATH: path, cwd: workspaceRoot() }) }
  }
  const declaredCommand = (server: Server) => renderPluginText(server.entry.server.command, { pluginRoot: "${CLAUDE_PLUGIN_ROOT}", projectDir: "${CLAUDE_PROJECT_DIR}" })
  const setStatus = (server: Server, state: LanguageServerStateV1, detail?: string) => {
    if (server.status.state === state && server.status.detail === detail) return
    server.status = { packageId: server.packageId, entryId: server.entry.id, sourceName: server.entry.sourceName, treeDigest: installedIdentity(server.installed.description), state, ...(detail === undefined ? {} : { detail }) }
    if (servers.get(server.key) === server && !disposed) input.report(server.status)
  }
  const checkProgram = (server: Server) => {
    try {
      if (command(server).resolved) {
        if (server.status.state === "dependency-missing") setStatus(server, "enabled")
        return true
      }
      setStatus(server, "dependency-missing", declaredCommand(server))
    } catch (error) {
      setStatus(server, "start-error", error instanceof Error ? error.message.slice(0, 200) : "start failed")
    }
    return false
  }

  const active = () => {
    const allow = readPackageAllowSet(input.root)
    return allInstalledPluginPackages(input.root).filter(installed => {
      for (const file of ["current.json", INSTALLED_PLUGIN_SETTINGS_FILE]) {
        const pointer = join(input.root, "ext-store", installed.key, file)
        if (!observed.has(pointer)) { observed.add(pointer); watchFile(pointer, { interval: 100, persistent: false }, reconcile) }
      }
      return installed.settings && managedPackageEntryAllowedHere("bundle", installed.key.slice("bundle--".length), allow, input.projectRoot())
    })
  }
  /** Package on/off, update, settings and removal: stop what is no longer the effective definition, register what is. */
  function reconcile() {
    if (disposed) return
    const current = new Map<string, { installed: Installed; entry: LanguageEntry; generation: string }>()
    for (const installed of active()) for (const entry of installed.description.entries)
      if (entry.kind === "lsp") current.set(JSON.stringify([installed.settings!.packageId, entry.id, workspaceRoot()]), { installed, entry, generation: JSON.stringify([installed.pluginRoot, installed.settings, entry]) })
    for (const [key, server] of servers) {
      if (current.get(key)?.generation === server.generation) continue
      servers.delete(key)
      void stopServer(server)
    }
    for (const [key, item] of current) {
      if (servers.has(key)) continue
      const packageId = item.installed.settings!.packageId
      const server: Server = { key, generation: item.generation, installed: item.installed, entry: item.entry, packageId, restarts: 0,
        status: { packageId, entryId: item.entry.id, sourceName: item.entry.sourceName, treeDigest: installedIdentity(item.installed.description), state: "enabled" } }
      servers.set(key, server)
      if (checkProgram(server)) input.report(server.status)
    }
  }
  const membership = join(input.root, "skills-enabled.json")
  watchFile(membership, { interval: 100, persistent: false }, reconcile)

  async function stopServer(server: Server) {
    const running = server.running ?? await server.starting
    server.running = undefined
    await running?.stop()
  }

  const start = (server: Server): Promise<Running | undefined> => {
    if (server.running?.alive) return Promise.resolve(server.running)
    if (server.starting) return server.starting
    const definition = server.entry.server
    if (server.running && (!definition.restartOnCrash || definition.maxRestarts !== undefined && server.restarts >= definition.maxRestarts)) return Promise.resolve(undefined)
    if (server.running) server.restarts++
    const starting = (async () => {
      let prepared: ReturnType<typeof command>
      try { prepared = command(server) }
      catch (error) { setStatus(server, "start-error", error instanceof Error ? error.message.slice(0, 200) : "start failed"); return }
      if (!prepared.resolved) { setStatus(server, "dependency-missing", declaredCommand(server)); return }
      const running = spawn(server, prepared)
      server.running = running
      const ok = await running.initialized
      if (!ok) return
      return running
    })().finally(() => { if (server.starting === starting) server.starting = undefined })
    server.starting = starting
    return starting
  }

  const spawn = (server: Server, prepared: ReturnType<typeof command>): Running => {
    const definition = server.entry.server
    const requestTimeout = definition.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS
    const redact = (text: string) => [...prepared.config.secretValues].reduce((value, secret) => value.replaceAll(secret, "[redacted]"), text)
    const encoder = new TextEncoder()
    let writer: ReadableStreamDefaultController<Uint8Array> | undefined
    const stdin = new ReadableStream<Uint8Array>({ start: controller => { writer = controller } })
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
    let sequence = 0
    let stopping = false
    const abort = new AbortController()
    const settle = (published: Published, uri: string) => {
      for (const waiter of running.waiters) if (waiter.uri === uri && published.version >= waiter.version) { running.waiters.delete(waiter); waiter.resolve(published) }
    }
    const fail = (reason: string) => {
      if (stopping) return
      setStatus(server, "protocol-error", reason)
      input.log("runtime-failed: package language server " + server.entry.sourceName + ": " + reason)
    }
    const send = (message: Record<string, unknown>) => {
      if (!running.alive || !writer) return
      const body = encoder.encode(JSON.stringify({ jsonrpc: "2.0", ...message }))
      try { writer.enqueue(encoder.encode("Content-Length: " + body.length + "\r\n\r\n")); writer.enqueue(body) } catch { /* stdin already closed */ }
    }
    const workspace = definition.workspaceFolder ? prepared.config.render(definition.workspaceFolder) : workspaceRoot()
    const folders = [{ uri: pathToFileURL(workspace).href, name: workspace.split("/").at(-1) || workspace }]
    const settings = definition.settings ? renderTemplate(definition.settings, prepared.config.render, prepared.config.bindings.resolveOption) : undefined
    const section = (name: unknown): Json => {
      if (typeof name !== "string" || !name) return settings ?? null
      let value: Json | undefined = settings
      for (const part of name.split(".")) value = record(value) ? (value as Record<string, Json>)[part] : undefined
      return value ?? null
    }
    const answer = (message: Record<string, unknown>) => {
      const params = record(message.params) ? message.params : {}
      if (message.method === "workspace/configuration") return Array.isArray(params.items) ? params.items.map(item => section(record(item) ? item.section : undefined)) : []
      if (message.method === "workspace/workspaceFolders") return folders
      if (["client/registerCapability", "client/unregisterCapability", "window/workDoneProgress/create", "window/showMessageRequest", "window/showDocument"].includes(String(message.method))) return null
      return undefined
    }
    const onMessage = (message: Record<string, unknown>) => {
      if (typeof message.method === "string" && message.id !== undefined) {
        const result = answer(message)
        send(result === undefined ? { id: message.id, error: { code: -32601, message: "Method not found" } } : { id: message.id, result })
        return
      }
      if (message.method === "textDocument/publishDiagnostics" && record(message.params) && typeof message.params.uri === "string") {
        const uri = message.params.uri
        const known = running.published.get(uri)
        const sent = running.documents.get(uri)?.version ?? 0
        const version = Number.isSafeInteger(message.params.version) ? Number(message.params.version) : undefined
        // A late version, or an unversioned notification observed while a newer explicit version is known, never replaces it.
        if (version !== undefined ? known?.explicit && known.version > version : known?.explicit && known.version >= sent) return
        const published = { version: version ?? sent, explicit: version !== undefined, diagnostics: diagnosticsOf(message.params.diagnostics) }
        running.published.set(uri, published)
        setStatus(server, "diagnostics-ready")
        settle(published, uri)
        return
      }
      if (typeof message.id === "number" && pending.has(message.id)) {
        const call = pending.get(message.id)!
        pending.delete(message.id)
        clearTimeout(call.timer)
        if (record(message.error)) call.reject(Error(typeof message.error.message === "string" ? message.error.message : "request failed"))
        else call.resolve(message.result)
      }
    }
    let stderr = ""
    const read = frameReader(onMessage, fail)
    const running: Running = {
      send, alive: true, documents: new Map(), versions: new Map(), published: new Map(), waiters: new Set(),
      request: (method, params, timeoutMs) => new Promise((resolve, reject) => {
        const id = ++sequence
        const timer = setTimeout(() => { pending.delete(id); reject(Error(method + " timed out")) }, timeoutMs)
        pending.set(id, { resolve, reject, timer })
        send({ id, method, params })
      }),
      initialized: Promise.resolve(false),
      exited: Promise.resolve(),
      stop: async (graceful = true) => {
        if (!running.alive) return
        stopping = true
        for (const waiter of running.waiters) waiter.resolve(undefined)
        running.waiters.clear()
        if (graceful) {
          // Only a source shutdownTimeout grants a window for shutdown/exit; without one nothing waits before termination.
          const deadline = definition.shutdownTimeout === undefined ? undefined : performance.now() + definition.shutdownTimeout
          const shutdown = running.request("shutdown", null, definition.shutdownTimeout ?? requestTimeout).catch(() => {})
          if (deadline !== undefined) await shutdown
          send({ method: "exit" })
          try { writer?.close() } catch { /* already closed */ }
          if (deadline !== undefined) await Promise.race([running.exited, Bun.sleep(Math.max(0, deadline - performance.now()))])
        }
        try { writer?.close() } catch { /* already closed */ }
        abort.abort()
        await running.exited
      },
    }
    running.exited = runtime.runPromiseExit(Effect.scoped(Effect.gen(function* () {
      const processes = yield* AppProcess.Service
      const argv = prepared.args.map(value => [...prepared.config.secretValues].some(secret => value.includes(secret)) ? Redacted.make(value) : value)
      const handle = yield* processes.spawn(ChildProcess.make(prepared.program, argv, {
        cwd: workspaceRoot(), extendEnv: true, env: prepared.env,
        stdin: Stream.fromReadableStream({ evaluate: () => stdin, onError: error => { throw error } }),
      }))
      running.pid = Number(handle.pid)
      yield* Effect.forkScoped(handle.stderr.pipe(Stream.runForEach(chunk => Effect.sync(() => { stderr = (stderr + new TextDecoder().decode(chunk)).slice(-500) }))))
      yield* Effect.forkScoped(handle.stdout.pipe(Stream.runForEach(chunk => Effect.sync(() => read(chunk)))))
      return yield* handle.exitCode
    })), { signal: abort.signal }).then(exit => {
      running.alive = false
      for (const call of pending.values()) { clearTimeout(call.timer); call.reject(Error("language server exited")) }
      pending.clear()
      for (const waiter of running.waiters) waiter.resolve(undefined)
      running.waiters.clear()
      if (stopping) return
      const code = exit._tag === "Success" ? "exit " + String(exit.value) : String((exit.cause as unknown as { toString(): string }).toString())
      const missing = /NotFound|ENOENT/.test(code)
      setStatus(server, missing ? "dependency-missing" : "start-error", missing ? declaredCommand(server) : redact(code.slice(0, 200)))
      input.log("runtime-failed: package language server " + server.entry.sourceName + " stopped: " + redact((code + " " + stderr).slice(0, 400)))
    })
    const initializationOptions = definition.initializationOptions ? renderTemplate(definition.initializationOptions, prepared.config.render, prepared.config.bindings.resolveOption) : undefined
    running.initialized = running.request("initialize", {
      processId: process.pid, clientInfo: { name: "Code Puppy" }, rootUri: folders[0]!.uri, rootPath: workspace, workspaceFolders: folders,
      ...(initializationOptions === undefined ? {} : { initializationOptions }),
      capabilities: {
        textDocument: { synchronization: { dynamicRegistration: false, didSave: false }, publishDiagnostics: { versionSupport: true, relatedInformation: false } },
        workspace: { configuration: true, workspaceFolders: true, didChangeConfiguration: { dynamicRegistration: false } },
      },
    }, definition.startupTimeout ?? requestTimeout).then(() => {
      send({ method: "initialized", params: {} })
      if (settings !== undefined) send({ method: "workspace/didChangeConfiguration", params: { settings } })
      if (server.status.state !== "diagnostics-ready") setStatus(server, "enabled")
      return true
    }, error => {
      // A declared socket transport still runs over stdio (design §4.11); say so when such a server never initializes.
      fail("initialize failed: " + redact(error instanceof Error ? error.message : String(error)).slice(0, 200) + (definition.transport === "socket" ? "; declared transport socket runs over stdio" : ""))
      void running.stop(false)
      return false
    })
    return running
  }

  const locate = (ref: Pick<LanguageDocumentRef, "packageId" | "entryId" | "projectRoot">) => servers.get(JSON.stringify([ref.packageId, ref.entryId, ref.projectRoot]))
  const languageId = (server: Server, uri: string) => server.entry.server.extensionToLanguage[extname(fileURLToPath(uri))]
  /** S-02 open/change/close; each sends the document text at the given version to a started server. */
  async function open(ref: LanguageDocumentRef, text: string) {
    const server = locate(ref)
    const running = server && await start(server)
    if (!server || !running) return
    running.documents.set(ref.fileUri, { version: ref.documentVersion, text })
    running.versions.set(ref.fileUri, Math.max(ref.documentVersion, running.versions.get(ref.fileUri) ?? 0))
    running.send({ method: "textDocument/didOpen", params: { textDocument: { uri: ref.fileUri, languageId: languageId(server, ref.fileUri), version: ref.documentVersion, text } } })
  }
  async function change(ref: LanguageDocumentRef, text: string) {
    const server = locate(ref)
    const running = server?.running?.alive ? server.running : undefined
    if (!running?.documents.has(ref.fileUri)) return open(ref, text)
    running.documents.set(ref.fileUri, { version: ref.documentVersion, text })
    running.versions.set(ref.fileUri, Math.max(ref.documentVersion, running.versions.get(ref.fileUri) ?? 0))
    running.send({ method: "textDocument/didChange", params: { textDocument: { uri: ref.fileUri, version: ref.documentVersion }, contentChanges: [{ text }] } })
  }
  function close(ref: Omit<LanguageDocumentRef, "documentVersion">) {
    const running = locate(ref)?.running
    if (!running?.documents.delete(ref.fileUri)) return
    running.published.delete(ref.fileUri)
    running.send({ method: "textDocument/didClose", params: { textDocument: { uri: ref.fileUri } } })
  }
  /** Diagnostics for this or a newer version, bounded by the source/protocol request timeout. */
  function diagnostics(ref: LanguageDocumentRef): Promise<LanguageDiagnostic[] | undefined> {
    const server = locate(ref)
    const running = server?.running
    if (!server || !running?.alive) return Promise.resolve(undefined)
    const known = running.published.get(ref.fileUri)
    if (known && known.version >= ref.documentVersion) return Promise.resolve(known.diagnostics)
    return new Promise(resolve => {
      const waiter = { uri: ref.fileUri, version: ref.documentVersion, resolve: (value: Published | undefined) => { clearTimeout(timer); resolve(value?.diagnostics) } }
      const timer = setTimeout(() => { running.waiters.delete(waiter); resolve(undefined) }, server.entry.server.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT_MS)
      running.waiters.add(waiter)
    })
  }

  /** Sync a real file with every enabled server matching its extension; non-matching files start nothing. */
  async function sync(path: string): Promise<LanguageFileResult[]> {
    if (disposed) return []
    const file = canonicalFile(path)
    reconcile()
    const matching = [...servers.values()].filter(server => Object.hasOwn(server.entry.server.extensionToLanguage, extname(file)))
    if (!matching.length) return []
    const uri = pathToFileURL(file).href
    const text = (() => { try { return statSync(file).isFile() ? readFileSync(file, "utf8") : undefined } catch { return } })()
    return Promise.all(matching.map(async (server): Promise<LanguageFileResult> => {
      const ref = { packageId: server.packageId, entryId: server.entry.id, projectRoot: workspaceRoot(), fileUri: uri }
      const display = relative(workspaceRoot(), file) || file
      if (text === undefined) { close(ref); return { status: server.status, file: display } }
      if (server.status.state === "dependency-missing" && !checkProgram(server)) return { status: server.status, file: display }
      const running = await start(server)
      if (!running) return { status: server.status, file: display }
      // One document update at a time per server and file, so concurrent calls never reuse a version.
      const previous = documentUpdates.get(server.key + uri) ?? Promise.resolve(0)
      const update = previous.then(async () => {
        const current = running.documents.get(uri)
        const documentVersion = current?.text === text ? current.version : (running.versions.get(uri) ?? 0) + 1
        if (!current) await open({ ...ref, documentVersion }, text)
        else if (current.text !== text) await change({ ...ref, documentVersion }, text)
        return documentVersion
      })
      documentUpdates.set(server.key + uri, update)
      const documentVersion = await update
      if (documentUpdates.get(server.key + uri) === update) documentUpdates.delete(server.key + uri)
      if (!server.entry.server.diagnostics) return { status: server.status, file: display }
      const found = await diagnostics({ ...ref, documentVersion })
      return { status: server.status, file: display, ...(found ? { diagnostics: found } : {}) }
    }))
  }

  /** A watched file changed on disk: resend documents a server already has open; nothing new starts. */
  async function refresh(path: string) {
    const file = canonicalFile(path)
    const uri = pathToFileURL(file).href
    const text = (() => { try { return statSync(file).isFile() ? readFileSync(file, "utf8") : undefined } catch { return } })()
    for (const server of servers.values()) {
      const running = server.running
      const current = running?.alive ? running.documents.get(uri) : undefined
      if (!current) continue
      const ref = { packageId: server.packageId, entryId: server.entry.id, projectRoot: workspaceRoot(), fileUri: uri }
      if (text === undefined) close(ref)
      else if (text !== current.text) await change({ ...ref, documentVersion: (running!.versions.get(uri) ?? current.version) + 1 }, text)
    }
  }

  reconcile()
  return {
    open, change, close, diagnostics, sync, refresh,
    /** Stop every server of this Location and drop cached diagnostics and queued callbacks. */
    async dispose() {
      if (disposed) return
      disposed = true
      unwatchFile(membership, reconcile)
      for (const pointer of observed) unwatchFile(pointer, reconcile)
      const stopping = [...servers.values()]
      servers.clear()
      await Promise.all(stopping.map(stopServer))
      await runtime.dispose()
    },
  }
}

/** Assistant-facing text for one file result; positions are 1-based. */
export function languageResultText(result: LanguageFileResult): { label: string; body: string } {
  const state = result.status.state + (result.status.detail ? ": " + result.status.detail : "")
  const lines = (result.diagnostics ?? []).map(item => result.file + ":" + item.line + ":" + item.character + " " + item.severity + " " + item.message + (item.code ? " [" + item.code + "]" : "") + (item.source ? " (" + item.source + ")" : ""))
  return { label: result.status.sourceName + " (" + state + ") for " + result.file, body: result.diagnostics ? lines.length ? lines.join("\n") : "No diagnostics." : "No diagnostics were reported." }
}
