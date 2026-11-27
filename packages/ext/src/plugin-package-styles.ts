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

/** Session metadata key holding this session's selected package output style; `null` is the default style. */
const SELECTED = "codepuppyOutputStyle"
/** ext's persisted plugin-storage key for the style later new conversations start with (INT-extensions I-26). */
const REMEMBERED = "output-style"
/** The engine's marker on its own fallback coding prompt (DESIGN-local-plugin-install S-10). */
const DEFAULT_CODING = "default-coding"
export const OUTPUT_STYLE_COMMAND = "output-style"

/**
 * Package output styles (BR-24): one existing slash-command entry selects a style for the session and remembers it
 * for later new conversations (INT-extensions I-26); the awaited context hook applies a session's style to its next
 * request. Only the marked engine fallback and the exact prompt bytes ext itself injected for the request's agent
 * count as default coding instructions.
 */
export async function registerPackageStyles(
  context: Plugin.Context,
  input: { root: string; projectRoot(): string | undefined; ownPrompts(): ReadonlyMap<string, string>; log(line: string): void },
) {
  const styles = (enabled: (installed: ReturnType<typeof allInstalledPluginPackages>[number]) => boolean) =>
    allInstalledPluginPackages(input.root)
      .filter(enabled)
      .flatMap((installed) =>
        installed.description.entries.flatMap((entry) => (entry.kind === "output-style" ? [{ installed, entry }] : [])),
      )
  const active = () =>
    styles((installed) =>
      managedPackageEntryAllowedHere("bundle", installed.key.slice("bundle--".length), readPackageAllowSet(input.root), input.projectRoot()),
    )
  // The remembered choice outlives a package that is off here but on in another project; only off everywhere ends it.
  const enabledAnywhere = () => {
    const allowSet = readPackageAllowSet(input.root)
    return styles(
      (installed) =>
        !!allowSet &&
        (allowSet.keys.includes(installed.key) ||
          allowSet.scoped.some((entry) => entry.kind === "bundle" && installed.key === "bundle--" + entry.name)),
    )
  }
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
    await context.session.update({ sessionID, metadata: { ...metadata, [SELECTED]: style ? choice(style) : null } })
  }
  const choice = (style: Style) => ({ package: style.installed.key, entry: style.entry.id })

  await context.command.transform((editor) => {
    const styles = active()
    if (!styles.length) return
    editor.add({
      name: OUTPUT_STYLE_COMMAND,
      description: renderWrapper(PACKAGE_OUTPUT_STYLE_ID, { label: names(styles).join(", "), body: "" }),
      execute: async (invocation) => {
        const wanted = invocation.prompt.text.trim()
        if (wanted.toLowerCase() === "default") {
          await select(invocation.sessionID, undefined)
          return context.storage.remove(REMEMBERED)
        }
        const current = active()
        const style = pick(current, wanted)
        if (!style)
          throw new Error("runtime-failed: unknown output style " + JSON.stringify(wanted) + "; available: " + [...names(current), "default"].join(", "))
        await select(invocation.sessionID, style)
        await context.storage.set(REMEMBERED, choice(style))
      },
    })
  })

  // A new conversation starts with the remembered choice while its package is enabled here; conversations already
  // under way keep theirs. Every top-level session records its choice at its first prompt, `null` for the default.
  await context.session.hook("prompt", async (event) => {
    const session = await context.session.get({ sessionID: event.sessionID }).catch(() => undefined)
    if (!session || session.parentID || session.metadata?.[SELECTED] !== undefined) return
    await select(event.sessionID, chosen(active(), await context.storage.get(REMEMBERED)))
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

  // Closing or removing a package withdraws every session's choice of its styles at once, and the remembered choice
  // once it is enabled nowhere, so turning it back on does not revive an old choice; an update keeps both.
  // Same membership file and cadence as invocation revocation.
  const membership = join(input.root, "skills-enabled.json")
  const withdraw = async () => {
    const remembered = await context.storage.get(REMEMBERED)
    if (remembered !== undefined && !chosen(enabledAnywhere(), remembered)) await context.storage.remove(REMEMBERED)
    const current = active()
    let page = await context.session.list({})
    for (;;) {
      for (const session of page.data) {
        const selected = session.metadata?.[SELECTED]
        if (selected && !chosen(current, selected)) await select(session.id, undefined)
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
