export * as ConfigSkillPlugin from "./skill.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { Entry } from "@opencode/schema/config"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import path from "path"
import { Effect, FiberMap, PubSub, Semaphore, Stream } from "effect"
import { Config } from "../../config.js"
import { Watcher } from "../../filesystem/watcher.js"
import { Location } from "../../location.js"
import { AbsolutePath } from "../../schema.js"
import { Skill } from "../../skill.js"
import { SkillDiscovery } from "../../skill/discovery.js"
import { CodePuppyProjectGate } from "../codepuppy-project-gate.js" // codepuppy(ADR-049)
import { SkillFile } from "./skill-file.js"
import { SkillScan } from "./skill-scan.js"
import { createPluginConfigRevisionReader } from "../codepuppy-plugin-config-change.js" // codepuppy(S-04)

type Source = Skill.DirectorySource | Skill.UrlSource

export const Plugin = define({
  id: "opencode.config.skill",
  effect: Effect.fn(function* (ctx) {
    const config = yield* Config.Service
    const discovery = yield* SkillDiscovery.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const location = yield* Location.Service
    const watcher = yield* Watcher.Service
    const loaded: { entries: Entry[]; skills: Skill.Info[] } = {
      entries: yield* config.entries(),
      skills: [],
    }
    const watches = yield* FiberMap.make<string>()
    const changes = yield* PubSub.sliding<string>(1)
    const lock = Semaphore.makeUnsafe(1)
    const pluginRevisions = createPluginConfigRevisionReader(location) // codepuppy(S-04)
    const scanned = new Map<AbsolutePath, Set<string>>() // codepuppy(S-04): retain rejected deletions only within current native sources.

    const watch = Effect.fn("ConfigSkillPlugin.watch")(function* (directory: string, type: "file" | "directory") {
      const target = path.resolve(directory)
      const updates = yield* watcher.subscribe(
        type === "directory" ? { path: target, type, ignore: SkillScan.ignore } : { path: target, type },
      )
      yield* FiberMap.run(
        watches,
        `${type}:${target}`,
        updates.pipe(Stream.runForEach((update) => PubSub.publish(changes, update.path).pipe(Effect.asVoid))),
        { onlyIfMissing: true, startImmediately: true },
      )
    })

    function firstMissing(target: string): Effect.Effect<string | undefined> {
      const parent = path.dirname(target)
      if (parent === target) return Effect.undefined
      return fs.isDir(parent).pipe(Effect.flatMap((exists) => (exists ? Effect.succeed(target) : firstMissing(parent))))
    }

    const watchDirectory: (directory: string) => Effect.Effect<string[]> = Effect.fn(
      "ConfigSkillPlugin.watchDirectory",
    )(function* (directory: string) {
      const target = path.resolve(directory)
      const resolved = yield* fs.realPath(directory).pipe(Effect.orElseSucceed(() => undefined))
      if (resolved) {
        yield* watch(resolved, "directory")
        if (resolved !== target) yield* watch(target, "file")
        return resolved === target ? [target] : [target, resolved]
      }
      const missing = yield* firstMissing(target)
      if (missing) yield* watch(missing, "file")
      if (
        yield* fs.realPath(directory).pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        )
      ) {
        if (missing) yield* FiberMap.remove(watches, `file:${path.resolve(missing)}`)
        return yield* watchDirectory(directory)
      }
      return [target]
    })

    const sources = (entries = loaded.entries) => { // codepuppy(ADR-049)
      const result: Source[] = []
      const add = (source: Source) => {
        if (result.some((item) => Skill.Source.equals(item, source))) return
        result.push(source)
      }
      const directories = entries.flatMap((entry) => (entry.type === "directory" ? [entry.path] : [])) // codepuppy(ADR-049)
      const items = entries.flatMap((entry) => (entry.type === "document" ? (entry.info.skills ?? []) : [])) // codepuppy(ADR-049)
      for (const directory of directories) {
        add(Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make(path.join(directory, "skill")) }))
        add(Skill.DirectorySource.make({ type: "directory", path: AbsolutePath.make(path.join(directory, "skills")) }))
      }
      for (const item of items) {
        if (URL.canParse(item) && /^(https?:)$/.test(new URL(item).protocol)) {
          add(Skill.UrlSource.make({ type: "url", url: item }))
          continue
        }
        const expanded = item.startsWith("~/") ? path.join(global.home, item.slice(2)) : item
        add(
          Skill.DirectorySource.make({
            type: "directory",
            path: AbsolutePath.make(path.isAbsolute(expanded) ? expanded : path.join(location.directory, expanded)),
          }),
        )
      }
      return result
    }

    const load = Effect.fn("ConfigSkillPlugin.load")(function* (source: Source, gated: boolean) { // codepuppy(ADR-049)
      const directories =
        source.type === "directory"
          ? [source.path]
          : yield* discovery.pull(source.url).pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("failed to load skill source", {
                  source: Skill.Source.key(source),
                  cause,
                }).pipe(Effect.as([] as AbsolutePath[])),
              ),
            )
      const roots = (yield* Effect.forEach(directories, watchDirectory)).flat()
      const skills: Skill.Info[] = []
      for (const directory of directories) {
        const paths = new Set([...(scanned.get(directory) ?? []), ...(yield* SkillScan.scan(directory))]) // codepuppy(S-04)
        const retained = new Set<string>() // codepuppy(S-04)
        for (const filepath of paths) {
          const resolved = yield* fs.realPath(filepath).pipe(Effect.orElseSucceed(() => filepath))
          if (!roots.some((root) => FSUtil.contains(root, resolved))) yield* watch(resolved, "file")
          const content = yield* pluginRevisions.select(filepath, "skills", yield* fs.readFileStringSafe(filepath).pipe(Effect.orElseSucceed(() => undefined))) // codepuppy(S-04)
          if (!content) continue
          retained.add(filepath) // codepuppy(S-04)
          // codepuppy(ADR-049) ── 项目技能只暂缓可执行文件头,正文逐字保留。
          const text = gated ? CodePuppyProjectGate.frontmatter(location.directory, filepath, content, "skill") : content
          if (text === undefined) continue
          const parsed = SkillFile.parse(directory, filepath, text)
          // codepuppy ── end
          if (parsed._tag === "Skipped") {
            yield* Effect.logDebug("skill file skipped", {
              filepath,
              reason: parsed.reason,
              ...(parsed.reason === "frontmatter" ? { issue: parsed.issue } : {}),
            })
            continue
          }
          if (source.type === "directory" && !CodePuppyProjectGate.nativeSkill(location.directory, filepath, parsed.skill.id)) continue // codepuppy(D6): HTTP skill indexes keep today's behaviour
          skills.push(parsed.skill)
        }
        scanned.set(directory, retained) // codepuppy(S-04)
      }
      yield* Effect.logDebug("skill source loaded", {
        source: Skill.Source.key(source),
        type: source.type,
        directories,
        skills: skills.map((skill) => skill.id),
      })
      return skills
    })

    const refresh = Effect.fn("ConfigSkillPlugin.refresh")(
      function* (file?: string) {
        yield* FiberMap.clear(watches)
        const skills = new Map<Skill.ID, Skill.Info>()
        const current = sources()
        const gated = CodePuppyProjectGate.skillSources(location.directory, current, sources(loaded.entries.filter(CodePuppyProjectGate.projectEntry))) // codepuppy(ADR-049)
        for (const source of current) {
          for (const skill of yield* load(source, gated.has(source))) skills.set(skill.id, skill) // codepuppy(ADR-049)
        }
        loaded.skills = Array.from(skills.values())
        if (file) {
          yield* Effect.logInfo("skills rescanned", {
            file,
            sources: current.map(Skill.Source.key),
            skills: loaded.skills.map((skill) => skill.id),
          })
        }
      },
      (effect, ..._args: [file?: string]) => lock.withPermit(CodePuppyProjectGate.observe(location.directory, "skill", effect)), // codepuppy(ADR-049)
    )

    // Editor saves arrive as bursts of watcher events; settle before rescanning once. Subscribe
    // before debouncing so no update slips through while the debounce starts its pull.
    const updates = yield* PubSub.subscribe(changes)
    yield* Stream.fromSubscription(updates).pipe(
      Stream.debounce("100 millis"),
      Stream.runForEach((file) => refresh(file).pipe(Effect.andThen(ctx.skill.reload()))),
      Effect.forkScoped({ startImmediately: true }),
    )
    yield* refresh()
    pluginRevisions.ready() // codepuppy(S-04)
    yield* ctx.skill.transform((editor) => {
      for (const skill of loaded.skills) editor.add(skill)
    })
    yield* ctx.event.subscribe({ types: ["config.updated"] }).pipe(
      Stream.runForEach(() =>
        config.entries().pipe(
          Effect.tap((entries) => Effect.sync(() => (loaded.entries = entries))),
          Effect.andThen(refresh()),
          Effect.andThen(ctx.skill.reload()),
        ),
      ),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
