import { convertCreatedPlugin } from "./created-plugin"
import { posix } from "node:path"
import { renderInstalledSkill } from "../shared/host-extension-package-contract/plugin-conversion.mjs"
import type { Capture, Entry, Text } from "../shared/host-extension-package-contract/plugin-conversion"
import {
  diagnosticNotRunning,
  type InstallOutcomeV1,
  type InstallRequestV1,
  type McpConfigLeafV1,
  type PackageDeclarationV1,
  type PackageSourceV1,
} from "../shared/plugin-install"
import { isHubRequestId } from "./codepuppy-sidecar-messages"
import { newMcpSecretVersionId } from "./codepuppy-mcp-secrets"
import { listConfiguredMcpServerNamesStrict, persistMcp } from "./ext-config"
import {
  installCatalog,
  promotePayloadToCas,
  setPackageStateV1,
  uncuratedSkillFreshGate,
  type PlannerDeps,
} from "./ext-install-planner"
import { canonicalJson, sha256Hex } from "./ext-manifest-v2"
import { commitTransactionLedger } from "./ext-package-ledger-commit"
import { computeInstalledGraphDigest, type PackageGraphV1, type PackageGraphNodeV1 } from "./ext-package-ledger-v3"
import {
  diffPackageGraphsV1,
  planPackageClaimTransferV1,
  planPackageChildRemovalsV1,
  planPackageChildConflictsV1,
} from "./ext-package-lifecycle"
import {
  buildDepartingChildConfigItemsV1,
  buildMcpTxItems,
  buildSkillTxItems,
  type PackageTxBuildV1,
} from "./ext-package-tx-builders"
import { projectScopeIdentity, readPackageLedgerStateV1, type UpsertInput } from "./ext-receipt-v2"
import { runExtensionTransaction } from "./ext-transaction"
import { installDesktopPackageV1, type PackageAdmissionDeps } from "./package-admission"
import { runCatalogInstallWithPackagePreflight } from "./package-installability"
import { capabilitiesForCatalogEntry } from "../shared/ext-capability-authorization"
import { FACTORY_SKILL_IDS } from "./factory-skills"
import { releaseOfficialConnectorResources } from "./official-connector-resources"
import { allPluginSourcesSucceeded, installedPackageIdentity, packageDeclarationRuntimeIdentity, type createPluginSources } from "./plugin-sources"

type Dependencies = Pick<
  PlannerDeps,
  "globalRoot" | "casBaseRoot" | "environment" | "advisoryGate" | "resolvePackage"
> & {
  userDataPath: string
  sources: Pick<ReturnType<typeof createPluginSources>, "convertCandidate" | "catalogComparisons" | "searchedSources">
  catalogInstall(catalogId: string, request: InstallRequestV1): Promise<InstallOutcomeV1>
  activateMcp(packageId: string): Promise<unknown>
  reloadSkills(packageId: string): void
  removeDeparting(children: { kind: string; name: string }[]): void | Promise<void>
}

/** Main owns one instance; the registered write channel supplies the shared recovery gate and ledger barrier. */
export function createSourceInstaller(deps: Dependencies) {
  const requests = new Map<string, { input: string; result: Promise<InstallOutcomeV1> }>()
  return async function installFromSource(request: InstallRequestV1): Promise<InstallOutcomeV1> {
    if (!request || !isHubRequestId(request.requestId) || (request.via !== "chat" && request.via !== "hub"))
      return { ok: false, code: "unknown-id", detail: "Invalid installation request" }
    const encoded = canonicalJson(request)
    const known = requests.get(request.requestId)
    if (known)
      return known.input === encoded
        ? known.result
        : { ok: false, code: "unknown-id", detail: "Installation request ID belongs to a different request" }
    const pending = (async (): Promise<InstallOutcomeV1> => {
      const project = request.effect?.kind === "project" ? projectScopeIdentity(request.effect.directory) : undefined
      if (project && !project.ok)
        return { ok: false, code: "transaction-failed", detail: project.reason }
      const projectMatches = () => {
        if (!project?.ok || request.effect?.kind !== "project") return true
        const current = projectScopeIdentity(request.effect.directory)
        return current.ok && current.scope.projectPathHash === project.scope.projectPathHash
      }
      const catalogRequest = project?.ok ? { ...request, effect: { kind: "project" as const, directory: project.scope.projectPath } } : request
      if (request.source.kind === "catalog") return deps.catalogInstall(request.source.catalogId, catalogRequest)
      if (request.source.kind !== "candidate" && request.source.kind !== "created")
        return { ok: false, code: "unknown-id", detail: "Source is not an issued candidate" }
      if (request.source.kind === "created" && !allPluginSourcesSucceeded(deps.sources.searchedSources(request.source.draft.searchId)))
        return { ok: false, code: "not-searched", detail: "Every applicable source must have a successful recorded query" }
      const converted = request.source.kind === "created"
        ? await convertCreatedPlugin(request.source.draft)
        : await deps.sources.convertCandidate(request.source.candidateId)
      if (!converted.ok) return converted
      if (!projectMatches())
        return { ok: false, code: "transaction-failed", detail: "Project identity changed during source capture" }
      const captured = { capture: converted.capture }
      const before = readPackageLedgerStateV1(deps.globalRoot(), { sideEffectFree: true })
      if (!before.ok)
        return { ok: false, code: "transaction-failed", detail: "Package installation state is unreadable" }
      const identity = converted.runtimeIdentity
      const catalog = identity
        ? (await deps.sources.catalogComparisons(converted.package.name, request.requestId)).find(
            (row) => row.runtimeIdentity === identity,
          )?.catalogId
        : undefined
      if (catalog) {
        const outcome = await deps.catalogInstall(catalog, catalogRequest)
        return outcome.ok ? { ...outcome, resolvedToCatalog: catalog } : outcome
      }
      const source = sourceOf(captured.capture, "publisher" in converted ? converted.publisher : undefined)
      const slug = converted.package.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/^[^a-z0-9]+/, "").slice(0, 119) || "plugin"
      const namespace = source.kind === "created" ? "mine" : source.kind === "marketplace" ? source.ecosystem : source.kind === "npm" ? "opencode" : source.kind === "mcp-registry" ? "mcpreg" : "local"
      const proposed = namespace + ":" + slug
      const fromSource = before.packageGraphs.find(
        (graph) => graph.source && sourceIdentity(graph.source) === sourceIdentity(source) && ((source.kind !== "created" && source.kind !== "local-folder") || graph.packageId === proposed),
      )
      const duplicate =
        identity &&
        before.packageGraphs.find(
          (graph) =>
            graph.declarations &&
            installedPackageIdentity(graph).runtimeIdentity === identity &&
            (graph.packageId !== fromSource?.packageId || graph.envelopeDigest === converted.package.treeDigest),
        )
      if (duplicate && canonicalJson(duplicate.effect ?? null) === canonicalJson(project?.ok ? project.scope : null))
        return outcomeOf(duplicate, true)
      const sameSource = duplicate || fromSource
      const packageId =
        sameSource?.packageId ??
        (before.packageGraphs.some((graph) => graph.packageId === proposed)
          ? proposed + "-" + sha256Hex(sourceIdentity(source)).slice(0, 8)
          : proposed)
      const notRunning = diagnosticNotRunning(converted.package.diagnostics)
      const configured = listConfiguredMcpServerNamesStrict()
      if (!configured.ok)
        return { ok: false, code: "transaction-failed", detail: "Installed connector names could not be read" }
      const names = new Set(
        before.records
          .filter(
            (record) =>
              !sameSource ||
              ![sameSource.root, ...sameSource.children].some(
                (node) => node.kind === record.kind && node.name === record.name,
              ),
          )
          .map((record) => record.kind + ":" + record.name),
      )
      for (const name of configured.names)
        if (
          !sameSource ||
          ![sameSource.root, ...sameSource.children].some((node) => node.kind === "mcp" && node.name === name)
        )
          names.add("mcp:" + name)
      for (const name of FACTORY_SKILL_IDS) names.add("skill:" + name)
      const mapped = converted.package.entries
        .toSorted((left, right) => (left.kind + left.sourcePath).localeCompare(right.kind + right.sourcePath))
        .flatMap((entry) => {
          if (entry.kind !== "mcp" && entry.kind !== "skill") {
            notRunning.push({ kind: entry.kind, sourceName: entry.sourceName, reason: "kind-not-supported-yet" })
            return []
          }
          if (
            needsPluginFiles(
              entry,
              converted.package.tree.map((node) => node.path),
            )
          ) {
            notRunning.push({ kind: entry.kind, sourceName: entry.sourceName, reason: "needs-plugin-files" })
            return []
          }
          const safe =
            entry.sourceName
              .replace(/[^a-zA-Z0-9._-]/g, "-")
              .replace(/^[^a-zA-Z0-9]+/, "")
              .slice(0, 64) || "component"
          const hostName =
            names.has(entry.kind + ":" + safe) ||
            (entry.kind === "skill" && !sameSource && !uncuratedSkillFreshGate(deps.globalRoot(), safe).ok)
              ? safe.slice(0, 55) + "-" + sha256Hex(packageId + entry.kind + entry.sourcePath).slice(0, 8)
              : safe
          names.add(entry.kind + ":" + hostName)
          return [{ entry, hostName }]
        })
      if (!mapped.length)
        return { ok: false, code: "nothing-runnable", detail: "No runnable components in this source", notRunning }
      const builds: PackageTxBuildV1[] = []
      const declarations: PackageDeclarationV1[] = []
      const nodes: PackageGraphNodeV1[] = []
      const version = converted.package.version ?? "content." + converted.package.treeDigest.slice(7, 23)
      for (const item of mapped) {
        const componentId = "user:" + item.hostName.toLowerCase()
        const receipt: UpsertInput = {
          id: componentId,
          kind: item.entry.kind,
          name: item.hostName,
          scope: { kind: "global" },
          environment: deps.environment(),
          origin: source.kind === "created" ? "created" : converted.package.provider === "claude-code" ? "imported-claude" : "imported",
          desiredState: "disabled",
          version,
          installedAt: new Date().toISOString(),
        }
        const common = {
          root: deps.globalRoot(),
          key: item.entry.kind + "--" + item.hostName,
          name: item.hostName,
          receipt,
          capabilities: [],
          manifestDigest: converted.package.treeDigest,
        }
        const declaration: PackageDeclarationV1 = {
          componentId,
          kind: item.entry.kind,
          hostName: item.hostName,
          sourceName: item.entry.sourceName,
          secretNeeds: [],
        }
        if (item.entry.kind === "skill") {
          const prefix = item.entry.directory ? item.entry.directory + "/" : ""
          const files = await Promise.all(
            converted.package.tree
              .filter((node) => node.kind === "file" && node.path.startsWith(prefix))
              .map(async (node) => ({
                path: node.path.slice(prefix.length),
                data: Buffer.from(
                  converted.replacements.get(node.path) ?? (await captured.capture.readFile(node.path)),
                ),
              })),
          )
          const instruction = files.find((file) => file.path === "SKILL.md")!
          instruction.data = Buffer.from(
            renderInstalledSkill(
              item.entry,
              instruction.data,
              new Map([
                ...mapped
                  .filter((item) => item.entry.kind === "mcp")
                  .map((item) => [item.entry.sourceName, item.hostName] as const),
                [item.entry.id, item.hostName],
              ]),
            ),
          )
          const promoted = promotePayloadToCas(
            deps.casBaseRoot(),
            files,
            files.map((file) => ({ path: file.path, bytes: file.data.length, sha256: sha256Hex(file.data) })),
          )
          if (!promoted.ok)
            return { ok: false, code: "transaction-failed", detail: "Skill content could not be staged" }
          const build = buildSkillTxItems({ ...common, assetFiles: promoted.specs, casBaseRoot: deps.casBaseRoot() })
          if (!build.ok) return { ok: false, code: "transaction-failed", detail: build.reason }
          builds.push(build.build)
        }
        if (item.entry.kind === "mcp") {
          const entry = item.entry
          const leaf: McpConfigLeafV1 =
            entry.transport === "stdio"
              ? {
                  type: "local",
                  command: entry.command.map(renderText),
                  environment: Object.fromEntries(
                    Object.entries(entry.environment).map(([key, value]) => [key, renderText(value)]),
                  ),
                  ...(entry.cwd ? { cwd: renderText(entry.cwd) } : {}),
                  ...(entry.timeoutMs === undefined ? {} : { timeout: entry.timeoutMs }),
                }
              : {
                  type: "remote",
                  url: renderText(entry.url),
                  headers: Object.fromEntries(
                    Object.entries(entry.headers).map(([key, value]) => [key, renderText(value)]),
                  ),
                  ...(entry.timeoutMs === undefined ? {} : { timeout: entry.timeoutMs }),
                  ...(entry.oauth === false
                    ? { oauth: false }
                    : entry.oauth?.oauth
                      ? {
                          oauth: {
                            ...(entry.oauth.oauth.clientId ? { clientId: entry.oauth.oauth.clientId } : {}),
                            ...(entry.oauth.oauth.clientSecret
                              ? { clientSecret: renderText(entry.oauth.oauth.clientSecret) }
                              : {}),
                            ...(entry.oauth.oauth.scopes ? { scope: entry.oauth.oauth.scopes.join(" ") } : {}),
                          },
                        }
                      : {}),
                }
          declaration.mcp = leaf
          declaration.secretNeeds = converted.package.secrets
            .filter((need) => need.componentId === entry.id)
            .map((need) => ({ needId: need.id, label: need.label }))
          if (entry.transport !== "stdio" && entry.oauth !== false && !declaration.secretNeeds.length)
            declaration.login = { serverUrl: renderText(entry.url) }
          if (entry.transport !== "stdio" && entry.oauth && entry.oauth.oauth) {
            const omitted = (["resource", "authorizationServerUrl"] as const).filter(
              (field) => entry.oauth && entry.oauth.oauth?.[field] !== undefined,
            )
            if (omitted.length) declaration.oauthNotApplied = omitted
          }
          const build = buildMcpTxItems({
            ...common,
            userDataPath: deps.userDataPath,
            newSecretVersionId: newMcpSecretVersionId,
            leaf,
            secretNeeds: declaration.secretNeeds,
            secretValues: Object.fromEntries(
              [...converted.privateCredentials].map(([id, bytes]) => [id, new TextDecoder().decode(bytes)]),
            ),
          })
          if (!build.ok) return { ok: false, code: "transaction-failed", detail: build.reason }
          builds.push(build.build)
        }
        declarations.push(declaration)
        nodes.push({
          componentId,
          kind: item.entry.kind,
          name: item.hostName,
          required: true,
          manifestDigest: converted.package.treeDigest,
        })
      }
      const graph: PackageGraphV1 = {
        packageId,
        envelopeDigest: converted.package.treeDigest,
        displayName: converted.package.name,
        installedGraphDigest: "",
        root: nodes[0]!,
        children: nodes.slice(1),
        source,
        ...(project?.ok ? { effect: project.scope } : {}),
        notRunning,
        declarations,
      }
      graph.installedGraphDigest = computeInstalledGraphDigest(graph)
      if (planPackageChildConflictsV1({ candidate: graph, graphs: before.packageGraphs }).length)
        return {
          ok: false,
          code: "transaction-failed",
          detail: "Package update conflicts with another installed package",
        }
      const diff = diffPackageGraphsV1(sameSource ?? null, graph, {
        before: sameSource
          ? before.records.find(
              (record) => record.kind === sameSource.root.kind && record.name === sameSource.root.name,
            )?.version
          : null,
        after: version,
      })
      if (!diff.ok) return { ok: false, code: "transaction-failed", detail: diff.reason }
      const departing = planPackageChildRemovalsV1({
        departing: diff.diff.changes.filter((change) => change.before && !change.after),
        ownerBefore: diff.diff.ownerBefore ?? "",
        claims: before.claims,
        recordKeys: new Set(before.records.map((record) => record.kind + ":" + record.name)),
      }).filter((child) => child.decision === "delete")
      const items = [
        ...builds.flatMap((build) => build.items),
        ...buildDepartingChildConfigItemsV1({ root: deps.globalRoot(), children: departing }),
      ]
      items[0]!.packageMutation = {
        operation: sameSource ? "update" : "install",
        graphBeforeDigest: sameSource?.installedGraphDigest ?? null,
        graphAfter: graph,
        claimMutations: planPackageClaimTransferV1(diff.diff),
        childRemovals: departing.map((node) => ({ kind: node.kind, name: node.name })),
      }
      const prepared = builds.flatMap((build) => (build.prepared ? [build.prepared] : []))
      const result = await runExtensionTransaction(
        deps.globalRoot(),
        { items, ...(prepared.length ? { prepared: prepared.map((resource) => resource.descriptor) } : {}) },
        {
          populate: (item, directory) => {
            const build = builds.find((build) => build.items.some((candidate) => candidate.key === item.key))
            build?.populate(item, directory)
          },
          probe: builds[0]!.probe,
          precondition: () => {
            if (!projectMatches()) return { ok: false, reason: "Project identity changed during installation" }
            const current = readPackageLedgerStateV1(deps.globalRoot(), { sideEffectFree: true })
            if (!current.ok || canonicalJson(current.packageGraphs) !== canonicalJson(before.packageGraphs))
              return { ok: false, reason: "Package installation state changed" }
            for (const item of mapped.filter((item) => item.entry.kind === "skill"))
              if (!sameSource) {
                const fresh = uncuratedSkillFreshGate(deps.globalRoot(), item.hostName)
                if (!fresh.ok) return fresh
              }
            for (const build of builds) {
              const checked = build.precondition()
              if (!checked.ok) return checked
            }
            return { ok: true }
          },
          ...(prepared.length
            ? {
                populatePrepared: () => {
                  for (const resource of prepared) resource.populate()
                },
                probePrepared: () => {
                  for (const resource of prepared) {
                    const verdict = resource.probe()
                    if (!verdict.healthy) return verdict
                  }
                  return { healthy: true }
                },
                releasePrepared: (resources) => releaseOfficialConnectorResources(deps.userDataPath, resources),
              }
            : {}),
          commitReceipt: (records) => commitTransactionLedger(deps.globalRoot(), records),
        },
      )
      if (!result.ok)
        return { ok: false, code: "transaction-failed", detail: "Package transaction failed at " + result.stage }
      for (const build of builds.filter((build) => build.receipt.kind === "mcp")) {
        const leaf = build.items[0]!.config!.edits[0]!.value as Record<string, unknown>
        if (leaf.type === "remote") {
          const { enabled, ...definition } = leaf
          const published = persistMcp(build.receipt.name, definition)
          if (!published.ok)
            return { ok: false, code: "transaction-failed", detail: "Installed connector could not be published" }
        }
      }
      if (departing.length) await deps.removeDeparting(departing)
      const enabled = await setPackageStateV1({ packageId, state: "enabled" }, deps)
      if (enabled.ok) await deps.activateMcp(packageId).catch(() => undefined)
      if (mapped.some((item) => item.entry.kind === "skill")) deps.reloadSkills(packageId)
      return outcomeOf(graph)
    })().catch(
      (): InstallOutcomeV1 => ({
        ok: false,
        code: "transaction-failed",
        detail: "Source definition could not be installed",
      }),
    )
    requests.set(request.requestId, { input: encoded, result: pending })
    return pending
  }
}

function renderText(text: Text): string {
  return text
    .map((part) =>
      typeof part === "string"
        ? part
        : "secret" in part
          ? "{secret:" + part.secret + "}"
          : part.binding === "projectDir"
            ? "."
            : "",
    )
    .join("")
}
function sourceOf(capture: Capture, publisher?: import("./plugin-sources").CandidateV1["publisher"]): PackageSourceV1 {
  const source = capture.source
  if (source.kind === "created") return { kind: "created" }
  if (source.kind === "folder" || source.kind === "git") return { kind: "local-folder" }
  if (source.kind === "mcp-registry")
    return { kind: "mcp-registry", serverName: source.serverName!, version: source.version!, publisher: publisher! }
  if (source.kind === "npm")
    return {
      kind: "npm",
      ecosystem: "opencode",
      name: source.locator,
      version: source.version!,
      integrity: source.integrity!,
    }
  return {
    kind: "marketplace",
    ecosystem: source.ecosystem === "codex" ? "codex" : "claude",
    repository: source.repository!,
    commit: source.commit!,
    path: source.pluginPath ?? "",
    entryName: source.entryName ?? source.pluginPath?.split("/").at(-1) ?? "plugin",
  }
}

function sourceIdentity(source: PackageSourceV1): string {
  return canonicalJson(
    source.kind === "marketplace"
      ? { ...source, commit: undefined }
      : source.kind === "npm"
        ? { kind: source.kind, name: source.name }
        : source.kind === "mcp-registry"
          ? { kind: source.kind, serverName: source.serverName }
          : source,
  )
}
function outcomeOf(graph: PackageGraphV1, alreadyInstalled?: true): InstallOutcomeV1 {
  return {
    ok: true,
    packageId: graph.packageId,
    displayName: graph.displayName ?? graph.root.name,
    source: graph.source ?? { kind: "catalog" },
    installed: (graph.declarations ?? []).map((entry) => ({
      kind: entry.kind,
      hostName: entry.hostName,
      sourceName: entry.sourceName,
    })),
    notRunning: graph.notRunning ?? [],
    ...(alreadyInstalled ? { alreadyInstalled } : {}),
  }
}
function needsPluginFiles(entry: Extract<Entry, { kind: "mcp" | "skill" }>, paths: string[]): boolean {
  const binding = (text: Text) =>
    text.some((part) => typeof part !== "string" && "binding" in part && part.binding !== "projectDir")
  if (entry.kind === "mcp")
    return entry.transport === "stdio"
      ? entry.command.some(binding) ||
          Object.values(entry.environment).some(binding) ||
          (!!entry.cwd && binding(entry.cwd)) ||
          entry.command.some(
            (text) => typeof text[0] === "string" && text[0].startsWith("./") && paths.includes(text[0].slice(2)),
          )
      : binding(entry.url) || Object.values(entry.headers).some(binding)
  return (
    binding(entry.instruction) ||
    entry.instruction.some(
      (part) =>
        typeof part === "string" &&
        [...part.matchAll(/\]\(([^)]+)\)/g)].some((match) => {
          const target = posix.normalize(posix.join(entry.directory, match[1]!))
          return paths.includes(target) && !target.startsWith(entry.directory + "/")
        }),
    )
  )
}


/** The entry's catalog arm: global storage and one graph admission, including native catalog items. */
export async function installCatalogFromSource(
  catalogId: string,
  request: InstallRequestV1,
  deps: { planner: PlannerDeps; admission: PackageAdmissionDeps } & Pick<Dependencies, "activateMcp" | "reloadSkills" | "removeDeparting">,
): Promise<InstallOutcomeV1> {
  const planner = deps.planner
  const legacy = await planner.resolveEntry(catalogId)
  const previous = readPackageLedgerStateV1(planner.globalRoot(), { sideEffectFree: true })
  if (!previous.ok) return { ok: false, code: "transaction-failed", detail: "Package installation state is unreadable" }
  const before = previous.packageGraphs.find((graph) => graph.packageId === catalogId)
  const entries = legacy?.entry.type === "bundle"
    ? await Promise.all((legacy.entry.bundleItems ?? []).map((item) => planner.resolveEntry(item.catalogEntryId)))
    : [legacy]
  const confirmed = Object.fromEntries(entries.flatMap((item) => item ? [[`${item.entry.type}--${item.entry.name}`, capabilitiesForCatalogEntry(item.entry)]] : []))
  const effect = request.effect.kind === "project" ? projectScopeIdentity(request.effect.directory) : undefined
  if (effect && !effect.ok) return { ok: false, code: "transaction-failed", detail: effect.reason }
  const result = await runCatalogInstallWithPackagePreflight({ catalogId, scope: { scope: "global" }, ...(!legacy ? { attemptId: request.requestId } : { authorization: { confirmed } }) }, {
    loadVerifiedCatalog: deps.admission.loadVerifiedCatalog,
    installLegacy: (intent) => installCatalog(intent, planner, { ...(effect?.ok ? { effect: effect.scope } : {}) }),
    installPackage: () => installDesktopPackageV1(catalogId, { ...deps.admission, advisoryGate: planner.advisoryGate, resolvePackage: planner.resolvePackage, ...(effect?.ok ? { effect: effect.scope } : {}) }),
  })
  if (!result.ok) return { ok: false, code: "transaction-failed", detail: "Catalog entry could not be installed" }
  const state = readPackageLedgerStateV1(planner.globalRoot(), { sideEffectFree: true })
  if (!state.ok) return { ok: false, code: "transaction-failed", detail: "Installed catalog entry could not be read" }
  const graph = state.packageGraphs.find((graph) => graph.packageId === catalogId)
  if (!graph) return { ok: false, code: "nothing-runnable", detail: "No catalog content could be installed", notRunning: [] }
  if (legacy) await setPackageStateV1({ packageId: catalogId, state: "enabled" }, planner)
  if (before) await deps.removeDeparting([before.root, ...before.children].filter((node) => !state.records.some((record) => record.kind === node.kind && record.name === node.name)))
  await deps.activateMcp(catalogId)
  const nodes = [graph.root, ...graph.children]
  if (nodes.some((node) => node.kind !== "mcp" && node.kind !== "cloud")) deps.reloadSkills(catalogId)
  return { ok: true, packageId: catalogId, displayName: graph.displayName ?? legacy?.entry.displayName ?? catalogId, source: { kind: "catalog" }, installed: nodes.flatMap((node) => node.kind === "skill" || node.kind === "mcp" ? [{ kind: node.kind, hostName: node.name, sourceName: node.name }] : []), notRunning: graph.notRunning ?? [] }
}
