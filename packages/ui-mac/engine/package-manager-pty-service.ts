export * as Pty from "./package-manager-pty-service"
export { Service, ID, Info, CreateInput, UpdateInput, Event, NotFoundError, ExitedError } from "../../core/src/pty"
export type { Interface, AttachInput, Attachment } from "../../core/src/pty"

import { Context, Effect, Layer } from "effect"
import { Pty } from "../../core/src/pty"
import { refreshPackageManagerEnvironment } from "../src/shared/package-manager-environment"

// Refresh before the upstream service composes its environment and enters the synchronous native binding.
export const node = Pty.node.mapLayer((layer) => Layer.flatMap(layer, (context) => {
  const original = Context.get(context, Pty.Service)
  return Layer.succeed(Pty.Service, { ...original, create: (input) => Effect.promise(refreshPackageManagerEnvironment).pipe(Effect.flatMap(() => original.create(input))) })
}))
