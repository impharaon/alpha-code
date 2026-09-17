import { Location } from "@opencode-ai/core/location"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { AlphaToolInventory } from "@opencode-ai/core/permission/alpha-tool-inventory"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { Effect, Option } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import {
  ConflictError,
  PermissionNotFoundError,
  ServiceUnavailableError,
  SessionNotFoundError,
} from "@opencode-ai/protocol/errors"
import { response } from "../location"

function missingRequest(id: PermissionV2.ID) {
  return new PermissionNotFoundError({ requestID: id, message: `Permission request not found: ${id}` })
}

function conflictingRequest(id: PermissionV2.ID) {
  return new ConflictError({ resource: id, message: `Permission request conflicts with the immutable request: ${id}` })
}

export const PermissionHandler = HttpApiBuilder.group(Api, "server.permission", (handlers) =>
  Effect.gen(function* () {
    return handlers
      .handle(
        "permission.request.list",
        Effect.fn(function* () {
          return yield* response((yield* PermissionV2.Service).list())
        }),
      )
      .handle(
        "session.permission.create",
        Effect.fn(function* (ctx) {
          const permission = yield* PermissionV2.Service
          return {
            data: yield* permission
              .ask({
                id: ctx.payload.id,
                sessionID: ctx.params.sessionID,
                action: ctx.payload.action,
                resources: ctx.payload.resources,
                save: ctx.payload.save,
                metadata: ctx.payload.metadata,
                source: ctx.payload.source,
                agent: ctx.payload.agent,
              })
              .pipe(
                Effect.catchTag("PermissionV2.ConflictError", (error) => conflictingRequest(error.requestID)),
                Effect.catchTag(
                  "Session.NotFoundError",
                  (error) =>
                    new SessionNotFoundError({
                      sessionID: error.sessionID,
                      message: `Session not found: ${error.sessionID}`,
                    }),
                ),
              ),
          }
        }),
      )
      .handle(
        "session.permission.list",
        Effect.fn(function* (ctx) {
          const permission = yield* PermissionV2.Service
          return { data: yield* permission.forSession(ctx.params.sessionID) }
        }),
      )
      .handle(
        "session.permission.get",
        Effect.fn(function* (ctx) {
          const request = yield* (yield* PermissionV2.Service).get(ctx.params.requestID)
          if (!request || request.sessionID !== ctx.params.sessionID) return yield* missingRequest(ctx.params.requestID)
          return { data: request }
        }),
      )
      .handle(
        "session.permission.reply",
        Effect.fn(function* (ctx) {
          const permission = yield* PermissionV2.Service
          return {
            data: yield* permission
              .reply({ requestID: ctx.params.requestID, sessionID: ctx.params.sessionID, command: ctx.payload })
              .pipe(
                Effect.catchTag("PermissionV2.NotFoundError", () => missingRequest(ctx.params.requestID)),
                Effect.catchTag("PermissionV2.ConflictError", () => conflictingRequest(ctx.params.requestID)),
              ),
          }
        }),
      )
      .handle(
        "permission.saved.list",
        Effect.fn(function* (ctx) {
          const location = yield* Location.Service
          return {
            data: yield* (yield* PermissionSaved.Service).list({
              projectID: ctx.query.projectID ?? location.project.id,
            }),
          }
        }),
      )
      .handle(
        "permission.saved.remove",
        Effect.fn(function* (ctx) {
          yield* (yield* PermissionSaved.Service).remove(ctx.params.id)
          return HttpApiSchema.NoContent.make()
        }),
      )
      // REQ-131 / #1130(路线 B 探针)。标签在 core,实现在 opencode(见 core 侧文件抬头)。
      // 用 serviceOption 而不是把它写进 handler 的 R:R 一变,上游 `packages/server/src/routes.ts`
      // 与 `packages/cli/.../serve.ts` 的 `toWebHandler`/`serve` 约束当场红 —— 那两处不在收编名单里。
      // 没接线的宿主(standalone server)拿到的是 503,不是空清单。
      .handle(
        "permission.tool-inventory.list",
        Effect.fn(function* () {
          const location = yield* Location.Service
          const inventory = yield* Effect.serviceOption(AlphaToolInventory.Service)
          if (Option.isNone(inventory)) {
            return yield* new ServiceUnavailableError({
              message: "tool policy inventory is not wired into this server",
              service: AlphaToolInventory.Service.key,
            })
          }
          return { data: yield* inventory.value.list({ directory: location.directory }) }
        }),
      )
  }),
)
