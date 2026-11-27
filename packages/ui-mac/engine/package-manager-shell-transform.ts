/** H2's approved Core/Plugin seam. Exact anchors fail the build on upstream drift. */
export function packageManagerShellSource(code: string, file: string): string | undefined {
  const sources = ["core/src/shell", "core/src/plugin/hooks", "core/src/plugin/host", "core/src/tool/plugin/shell", "plugin/src/effect/shell", "plugin/src/promise/shell", "plugin/src/promise/adapter"]
  const source = sources.find((source) => file.endsWith(`/${source}.ts`))
  if (!source) return
  const replace = (from: string, to: string) => {
    if (code.split(from).length !== 2) throw new Error(`Prepared Shell seam moved in ${source}: ${from.slice(0, 60)}`)
    code = code.replace(from, to)
  }
  const types = 'import type { PreparedShellExecution, PreparedShellDelegate } from "@opencode/plugin/codepuppy-package-manager"\n'
  if (source.endsWith("/effect/shell") || source.endsWith("/promise/shell")) {
    code = types + code
    const effect = source.includes("/effect/")
    if (effect) code = 'import type { Effect } from "effect"\n' + code
    replace("export interface ShellDomain {", `export interface ShellDomain {
  readonly delegatePreparedShell: (handler: (input: PreparedShellExecution) => ${effect ? "Effect.Effect<PreparedShellDelegate | undefined>" : "Promise<PreparedShellDelegate | undefined>"}) => ${effect ? "Effect.Effect<void, never, import('effect').Scope.Scope>" : "Promise<void>"}`)
    return code
  }
  if (source === "core/src/plugin/hooks") {
    code = types + code
    replace("readonly shell: ShellHooks", 'readonly shell: ShellHooks & { "codepuppy.prepared": { input: PreparedShellExecution; delegate?: PreparedShellDelegate } }')
    replace("readonly shell: NoFailures<ShellHooks>", 'readonly shell: NoFailures<Domains["shell"]>')
    return code
  }
  if (source === "core/src/plugin/host") {
    replace('shell: {\n      hook: (name, callback) => hooks.register("shell", name, callback),', `shell: {
      delegatePreparedShell: (handler) => hooks.register("shell", "codepuppy.prepared", (event) => handler(event.input).pipe(Effect.map((delegate) => { event.delegate = delegate }))).pipe(Effect.asVoid),
      hook: (name, callback) => hooks.register("shell", name, callback),`)
    return code
  }
  if (source === "plugin/src/promise/adapter") {
    replace('shell: {\n            hook: (name, callback) =>', `shell: {
            delegatePreparedShell: (handler) => run(host.shell.delegatePreparedShell((input) => Effect.promise(() => handler(input)))),
            hook: (name, callback) =>`)
    return code
  }
  if (source === "core/src/tool/plugin/shell") {
    replace("metadata: { sessionID: context.sessionID },", "metadata: { sessionID: context.sessionID, messageID: context.messageID, callID: context.id },")
    return code
  }
  code = types + code
  replace("type Active = {", "type Active = {\n  delegate?: PreparedShellDelegate")
  replace("        commands.delete(id)", '        if (command.delegate && command.info.status === "running") yield* Effect.promise(() => command.delegate!.cancel("cancelled"))\n        commands.delete(id)')
  replace("        const id = Shell.ID.ascending()\n        const args = ShellSelect.args(invocation.shell, invocation.command)", `        const id = Shell.ID.ascending()
        const metadata = input.metadata
        const prepared: { input: PreparedShellExecution; delegate?: PreparedShellDelegate } | undefined = typeof metadata?.sessionID === "string" && typeof metadata.messageID === "string" && typeof metadata.callID === "string"
          ? { input: { shellID: id, sessionID: metadata.sessionID, messageID: metadata.messageID, callID: metadata.callID, command: invocation.command, cwd: invocation.cwd, shell: invocation.shell } } : undefined
        if (prepared) yield* hooks.trigger("shell", "codepuppy.prepared", prepared)
        const delegate = prepared?.delegate
        const args = ShellSelect.args(invocation.shell, delegate?.executionSource ?? invocation.command)`)
  replace('                    stdin: "ignore",', `                    stdin: "ignore",
                    ...(delegate ? { additionalFds: { ["fd" + delegate.privateInput.fd]: { type: "input" as const, stream: Stream.make(delegate.privateInput.data) } } } : {}),`)
  replace("              const command: Active = {", `              if (delegate) yield* Effect.tryPromise({ try: () => delegate.bindProcess({ pid: handle.pid }), catch: (cause) => new AppProcess.AppProcessError({ command: invocation.command, cause }) })
              const command: Active = {
                delegate,`)
  replace('                          if (!(yield* end({ status: "timeout" }))) return', `                          if (!(yield* end({ status: "timeout" }))) return
                          if (delegate) yield* Effect.promise(() => delegate.cancel("timeout"))`)
  replace("                  yield* outputDone.await", "                  yield* outputDone.await\n                  if (delegate) yield* Effect.promise(() => delegate.finish())")
  // The spawn failure path also closes the Shell capture (#1758); the lease finishes on every outcome.
  replace('          ).pipe(Effect.catchTag("AppProcessError", (error) => Effect.gen(function* () {', `          ).pipe(
            Effect.ensuring(delegate ? Effect.promise(() => delegate.finish()) : Effect.void),
            Effect.catchTag("AppProcessError", (error) => Effect.gen(function* () {`)
  return code
}
