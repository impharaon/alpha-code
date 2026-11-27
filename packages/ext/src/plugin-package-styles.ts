import type { Plugin } from "@opencode/plugin"
import { unwatchFile, watchFile } from "node:fs"
import { dirname, join } from "node:path"
import { pluginInstructionDefinition } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-conversion.mjs"
import { renderPluginText } from "../../ui-mac/src/shared/host-extension-package-contract/plugin-package"
import { pluginDataDirectory, publicPluginOption } from "../../ui-mac/src/shared/installed-plugin-settings"
import { PACKAGE_OUTPUT_STYLE_ID, renderWrapper } from "./context-injection"
import { readPackageAllowSet } from "./gen-skill-paths"
import { managedPackageEntryAllowedHere } from "./package-scope"
import { allInstalledPluginPackages } from "./plugin-package-skills"

/** Session metadata key holding this session's selected package output style. */
const SELECTED = "codepuppyOutputStyle"
/** The engine's marker on its own fallback coding prompt (DESIGN-local-plugin-install S-10). */
const DEFAULT_CODING = "default-coding"
export const OUTPUT_STYLE_COMMAND = "output-style"

/**
 * Package output styles (BR-24): one existing slash-command entry selects a style per session; the awaited context
 * hook applies it to that session's next request. Only the marked engine fallback and the exact prompt bytes ext
 * itself injected for the request's agent count as default coding instructions.
 */
export async function registerPackageStyles(
  context: Plugin.Context,
  input: { root: string; projectRoot(): string | undefined; ownPrompts(): ReadonlyMap<string, string>; log(line: string): void },
) {
  const active = () =>
    allInstalledPluginPackages(input.root)
      .filter((installed) =>
        managedPackageEntryAllowedHere("bundle", installed.key.slice("bundle--".length), readPackageAllowSet(input.root), input.projectRoot()),
      )
      .flatMap((installed) =>
        installed.description.entries.flatMap((entry) => (entry.kind === "output-style" ? [{ installed, entry }] : [])),
      )
  type Style = ReturnType<typeof active>[number]
  const qualified = (style: Style) => style.installed.description.name + ":" + style.entry.sourceName
  const names = (styles: Style[]) =>
    styles.map((style) =>
      styles.filter((other) => other.entry.sourceName === style.entry.sourceName).length > 1 ? qualified(style) : style.entry.sourceName,
    )
  const pick = (styles: Style[], wanted: string) => {
    const name = wanted.toLowerCase()
    const exact = styles.filter((style) => qualified(style).toLowerCase() === name)
    const named = styles.filter((style) => style.entry.sourceName.toLowerCase() === name)
    return exact.length === 1 ? exact[0] : named.length === 1 ? named[0] : undefined
  }
  const select = async (sessionID: Parameters<Plugin.Context["session"]["get"]>[0]["sessionID"], style: Style | undefined) => {
    const { [SELECTED]: _previous, ...metadata } = (await context.session.get({ sessionID })).metadata ?? {}
    await context.session.update({
      sessionID,
      metadata: style ? { ...metadata, [SELECTED]: { package: style.installed.key, entry: style.entry.id } } : metadata,
    })
  }

  await context.command.transform((editor) => {
    const styles = active()
    if (!styles.length) return
    editor.add({
      name: OUTPUT_STYLE_COMMAND,
      description: renderWrapper(PACKAGE_OUTPUT_STYLE_ID, { label: names(styles).join(", "), body: "" }),
      execute: async (invocation) => {
        const wanted = invocation.prompt.text.trim()
        if (wanted.toLowerCase() === "default") return select(invocation.sessionID, undefined)
        const current = active()
        const style = pick(current, wanted)
        if (!style)
          throw new Error("runtime-failed: unknown output style " + JSON.stringify(wanted) + "; available: " + [...names(current), "default"].join(", "))
        await select(invocation.sessionID, style)
      },
    })
  })

  await context.session.hook("context", async (event) => {
    // A request for a session the store does not hold carries no choice.
    const session = await context.session.get({ sessionID: event.sessionID }).catch(() => undefined)
    const selected = session?.metadata?.[SELECTED]
    // Children inherit metadata; an output style shapes only the conversation it was chosen in.
    if (!session || !selected || session.parentID) return
    const style = chosen(active(), selected)
    if (!style) return select(event.sessionID, undefined)
    if (!style.entry.keepCodingInstructions) {
      const own = input.ownPrompts().get(event.agent)
      const kept = event.system.filter((part) => part.metadata?.codepuppyRole !== DEFAULT_CODING && part.text !== own)
      event.system.splice(0, event.system.length, ...kept)
    }
    const settings = style.installed.settings
    const body = renderPluginText(pluginInstructionDefinition(style.entry.instruction).body, {
      pluginRoot: style.installed.pluginRoot,
      skillDir: dirname(join(style.installed.pluginRoot, style.entry.sourcePath)),
      projectDir: input.projectRoot() ?? context.location.directory,
      ...(settings ? { pluginData: pluginDataDirectory(settings.dataHome, settings.packageId) } : {}),
      resolveOption: (key) => publicPluginOption(style.installed.description, settings, key),
    }).trim()
    if (body) event.system.push({ type: "text", text: body })
  })

  // Closing or removing a package withdraws every session's choice of its styles at once, so turning it back on
  // before the next message does not revive an old choice. Same membership file and cadence as invocation revocation.
  const membership = join(input.root, "skills-enabled.json")
  const withdraw = async () => {
    const styles = active()
    let page = await context.session.list({})
    for (;;) {
      for (const session of page.data) {
        const selected = session.metadata?.[SELECTED]
        if (selected && !chosen(styles, selected)) await select(session.id, undefined)
      }
      if (!page.cursor.next) break
      page = await context.session.list({ cursor: page.cursor.next })
    }
  }
  const changed = () => void withdraw().catch((cause) => input.log("runtime-failed: output style withdrawal: " + String(cause)))
  watchFile(membership, { interval: 100, persistent: false }, changed)
  return { dispose: () => unwatchFile(membership, changed) }
}

/** The active style a session's stored choice names, if any. */
function chosen<Style extends { installed: { key: string }; entry: { id: string } }>(styles: Style[], selected: unknown) {
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) return
  const choice = selected as Record<string, unknown>
  return styles.find((style) => style.installed.key === choice.package && style.entry.id === choice.entry)
}
