// #1560 on OpenCode 2 (#1662 L4 Unit C; #1666 ruling 6737930969): a model the user picked out-ranks a command's and its
// agent's recommended model. The re-taken file is packages/core/src/config/plugin/command.ts; the command plugin, the
// Command service and (for the subtask path) Session / Agent / SubagentJob are production, wired as upstream's
// test/config/command.test.ts wires them.
//
// "Picked" is the session's `model`: Code Puppy's adapter switches the session model to the composer's pick before
// every send (L6 contract). A session with no model still takes the command's model (upstream behaviour, kept).
// Red if the re-take is reverted: the direct path calls switchModel over the pick, and a subtask child gets the
// command's model instead of the parent's pick.
import { describe, expect } from "bun:test"
import { DateTime, Effect } from "effect"
import { Document, Info } from "@opencode/schema/config"
import { Session } from "@opencode/core/session"
import { SessionExecution } from "@opencode/core/session/execution"
import { Job } from "@opencode/core/job"
import { SubagentJob } from "@opencode/core/session/subagent-job"
import { Agent } from "@opencode/core/agent"
import { SessionInbox } from "@opencode/schema/session-inbox"
import { SessionMessage } from "@opencode/schema/session-message"
import { Command } from "@opencode/core/command"
import { Config } from "@opencode/core/config"
import { CodePuppyProjectGate } from "@opencode/core/config/codepuppy-project-gate"
import { ConfigCommandPlugin } from "@opencode/core/config/plugin/command"
import { renderPackageInstruction } from "@opencode/plugin/codepuppy-package-runtime"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Bus } from "@opencode/core/bus"
import { AppProcess } from "@opencode/util/process"
import { Location } from "@opencode/core/location"
import { Mcp } from "@opencode/core/mcp/index"
import { ShellSelect } from "@opencode/core/shell/select"
import { Global } from "@opencode/util/global"
import { Layer, Schema } from "effect"
import { emptyConfigLayer, emptyMcpLayer, testLocationLayer } from "./fixture/mcp"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { testEffect } from "./lib/effect"
import { host } from "./plugin/host"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Command.node, Bus.node, FSUtil.node, AppProcess.node, Location.node, ShellSelect.node, Session.node, Job.node, SubagentJob.node, Agent.node]),
    [
      Mcp.node.replace(emptyMcpLayer),
      Config.node.replace(emptyConfigLayer),
      Location.node.replace(testLocationLayer),
      ShellSelect.node.replace(
        Layer.succeed(ShellSelect.Service, ShellSelect.Service.of({ resolve: () => Effect.succeed("sh"), transform: () => Effect.die("unused"), reload: () => Effect.die("unused") })),
      ),
      Global.node.replace(tempGlobalLayer),
      SessionExecution.node.replace(SessionExecution.noopLayer),
      offlineModels,
    ],
  ),
)
const decode = Schema.decodeUnknownSync(Info)

const PICKED = { providerID: "picked", id: "user-choice" }
const COMMAND_MODEL = { providerID: "cmd", model: "command-choice" }
const AGENT_MODEL = { providerID: "agent", id: "agent-choice" }

it.live("native argument suffix stays on the native syntax axis", () => Effect.gen(function* () {
  const result = yield* runCommand({ template: "$ARGUMENTS[0]" }, {})
  expect(result.prompts).toEqual(["go[0]"])
}))

it.live("package instruction renders source nodes before bound values and arguments", () => Effect.gen(function* () {
  yield* runCommand({ template: "Initialize native command services" }, {})
  const location = yield* Location.Service
  const render = (parts: Parameters<typeof renderPackageInstruction>[1]["parts"], rawArguments: string) => Effect.promise(() => renderPackageInstruction(location, { parts, rawArguments, arguments: ["target"], syntax: "claude", cwd: location.directory }))
  expect(yield* render(["$0 | $1 | $ARGUMENTS[2] | $target | ", { boundValue: "!`printf BOUND_EXECUTED` $0" }], '"first value" second')).toBe('first value | second | $ARGUMENTS[2] | first value | !`printf BOUND_EXECUTED` $0')
  expect(yield* render(["$ARGUMENTS"], '!`printf ARG_EXECUTED`')).toBe('!`printf ARG_EXECUTED`')
  expect(yield* render(["!`printf '<%s>' $0`"], "'a b' c")).toBe("<a b>")
  expect(yield* render(["!`printf '<%s>' \"$0\"`"], "'a$HOME`printf injected`\"b'")).toBe('<a$HOME`printf injected`"b>')
  expect(yield* render(["!`printf '<%s>' '$0'`"], '"it\'s safe"')).toBe("<it's safe>")
  expect(yield* render(["!`printf '<%s>' ", { boundValue: "root with ' quote" }, "`"], "")).toBe("<root with ' quote>")
  expect(yield* render(["$0,$1,$2,$3"], "'' escaped\\ space 'literal\\slash'")).toBe(",escaped space,literal\\slash,$3")
  expect(yield* render(["No placeholders"], "raw input")).toBe("No placeholders\n\nARGUMENTS: raw input")
}))

it.live("declared argument names select their ordered values", () => Effect.gen(function* () {
  yield* runCommand({ template: "Initialize native command services" }, {})
  const location = yield* Location.Service
  const render = (names: readonly string[]) => Effect.promise(() => renderPackageInstruction(location, { parts: ["$target/$missing/$2"], rawArguments: "first second", arguments: names, syntax: "claude", cwd: location.directory }))
  expect(yield* render(["target", "missing"])).toBe("first/second/$2")
  expect(yield* render(["unused", "target", "missing"])).toBe("second//$2")
}))

// Fenced shell form from anthropics/claude-plugins-official@0fbfda5a91f4,
// commands/ralph-loop.md; replace only the setup command with an observable printf.
it.live("fenced shell source executes before arguments without executing bound fences", () => Effect.gen(function* () {
  expect((yield* runCommand({ template: "```!\nprintf FENCED_SETUP\n```\n$ARGUMENTS" }, {})).prompts).toEqual(["FENCED_SETUP\ngo"])
  const location = yield* Location.Service
  const bound = "```!\nprintf BOUND_SETUP\n```"
  expect(yield* Effect.promise(() => renderPackageInstruction(location, { parts: [{ boundValue: bound }], rawArguments: "", arguments: [], syntax: "claude", cwd: location.directory }))).toBe(bound)
}))

it.live("untrusted project fenced shell stays source and records deferred execution", () => Effect.gen(function* () {
  const location = yield* Location.Service
  const template = "```!\nprintf UNTRUSTED_SETUP\n```"
  const filepath = location.directory + "/opencode.json"
  CodePuppyProjectGate.install({ trusted: () => false })
  const gate = yield* CodePuppyProjectGate.begin({ directory: location.directory, home: location.directory + "/home" })
  const raw = { commands: { review: { template } } }
  gate.document(filepath)!.raw(JSON.stringify(raw), filepath)
  const document = new Document({ type: "document", path: filepath, info: decode(raw) })
  yield* gate.finish([document])
  expect((yield* runCommand({ template }, {}, document)).prompts).toEqual([template + "\n\ngo"])
  expect(CodePuppyProjectGate.view(location.directory)?.withheld).toContainEqual(expect.objectContaining({ kind: "command-run", name: "review", fields: ["shell"] }))
}).pipe(Effect.ensuring(Effect.sync(() => CodePuppyProjectGate.resetForTest()))))

/** Runs one configured command through the production plugin and Command service; records what it asked the session to do. */
const runCommand = (command: Record<string, unknown>, session: { model?: typeof PICKED }, document?: Document) =>
  Effect.gen(function* () {
    const commands = yield* Command.Service
    const switched: unknown[] = []
    const prompts: string[] = []
    yield* ConfigCommandPlugin.Plugin.effect(
      host({
        command: { list: () => Effect.die("unused"), transform: commands.transform, reload: commands.reload },
        agent: {
          get: () => Effect.succeed({ data: { model: AGENT_MODEL, mode: "primary" } } as never),
          list: () => Effect.die("unused"),
          transform: () => Effect.die("unused"),
          reload: () => Effect.die("unused"),
        } as never,
        session: {
          get: () => Effect.succeed({ agent: "reviewer", ...session } as never),
          switchAgent: () => Effect.void,
          switchModel: (input) => Effect.sync(() => void switched.push(input.model)),
          prompt: (input) =>
            Effect.sync(() => {
              prompts.push(input.text)
              return SessionInbox.User.make({
                id: SessionMessage.ID.make("msg_test"),
                sessionID: input.sessionID,
                time: { created: DateTime.makeUnsafe(0) },
                type: "user",
                payload: { text: input.text },
                delivery: input.delivery ?? "steer",
              })
            }),
        },
      }),
    ).pipe(Effect.provide(Config.testLayer([document ?? new Document({ type: "document", info: decode({ commands: { review: command } }) })])))
    yield* commands.execute({ name: "review", invocation: { sessionID: Session.ID.make("ses_cmd"), prompt: { text: "go" }, delivery: "queue" } })
    return { switched, prompts }
  })

describe("#1560: the model the user picked out-ranks a command's", () => {
  it.live("a picked session: the command's own model does not switch it; the command still runs", () =>
    Effect.gen(function* () {
      const { switched, prompts } = yield* runCommand({ template: "Review", model: `${COMMAND_MODEL.providerID}/${COMMAND_MODEL.model}` }, { model: PICKED })
      expect(switched).toEqual([])
      expect(prompts).toEqual(["Review\n\ngo"])
    }),
  )

  it.live("a picked session: the command agent's model does not switch it either", () =>
    Effect.gen(function* () {
      const { switched, prompts } = yield* runCommand({ template: "Review", agent: "reviewer" }, { model: PICKED })
      expect(switched).toEqual([])
      expect(prompts).toEqual(["Review\n\ngo"])
    }),
  )

  it.live("a session with no model takes the command's model (upstream behaviour kept)", () =>
    Effect.gen(function* () {
      const { switched } = yield* runCommand({ template: "Review", model: `${COMMAND_MODEL.providerID}/${COMMAND_MODEL.model}` }, {})
      expect(switched).toEqual([{ id: COMMAND_MODEL.model, providerID: COMMAND_MODEL.providerID }])
    }),
  )

  const subtask = (parentModel: typeof PICKED | undefined) =>
    Effect.gen(function* () {
      const sessions = yield* Session.Service
      const location = yield* Location.Service
      const parent = yield* sessions.create({
        location: { directory: location.directory },
        agent: Agent.ID.make("build"),
        ...(parentModel ? { model: parentModel } : {}),
      } as never)
      const commands = yield* Command.Service
      yield* ConfigCommandPlugin.Plugin.effect(
        host({
          command: { list: () => Effect.die("unused"), transform: commands.transform, reload: commands.reload },
          // The subtask passes the subagent permission path first (#1129 E6); allowed here.
          permission: { hook: () => Effect.die("unused"), list: () => Effect.die("unused"), get: () => Effect.die("unused"), reply: () => Effect.die("unused"), assert: () => Effect.void } as never,
        }),
      ).pipe(
        Effect.provide(
          Config.testLayer([
            new Document({
              type: "document",
              info: decode({ commands: { review: { template: "Review", subtask: true, model: `${COMMAND_MODEL.providerID}/${COMMAND_MODEL.model}` } } }),
            }),
          ]),
        ),
      )
      yield* commands.execute({ name: "review", invocation: { sessionID: parent.id, prompt: { text: "go" }, delivery: "queue" } })
      const children = (yield* sessions.list()).data.filter((session) => session.parentID === parent.id)
      expect(children).toHaveLength(1)
      return children[0]!.model
    })

  it.live("a subtask command: the child session runs on the parent's picked model", () =>
    Effect.gen(function* () {
      expect(yield* subtask(PICKED)).toMatchObject(PICKED)
    }),
  )

  it.live("a subtask command from a session with no model: the child takes the command's model", () =>
    Effect.gen(function* () {
      expect(yield* subtask(undefined)).toMatchObject({ id: COMMAND_MODEL.model, providerID: COMMAND_MODEL.providerID })
    }),
  )
})
