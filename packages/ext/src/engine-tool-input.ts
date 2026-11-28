import type { Schema } from "effect"
import { definition } from "../../core/src/tool/runtime"

/**
 * A tool input as this extension hands it to the engine: the JSON Schema the engine itself derives from `schema` (core
 * tool/runtime `definition`), so the model is offered the same parameters. The shipped extension is bundled with an Effect of
 * its own (scripts/build.ts, ADR-006) and the engine decodes an Effect schema object with its Effect; across the two instances
 * decoded values come out as Symbols ("Cannot convert a Symbol value to a string"). A JSON Schema is compiled and decoded by
 * the engine's Effect alone.
 */
export function engineToolInput(schema: Schema.Top) {
  return definition({ name: "input", description: "", input: schema, execute: () => { throw new Error("not executed") } }).inputSchema
}
