import { JsonSchema, Schema, SchemaRepresentation } from "effect"
import { definition } from "../../core/src/tool/runtime"

/**
 * A tool input as this extension hands it to the engine. The shipped extension is bundled with an Effect of its own
 * (scripts/build.ts, ADR-006) and the engine decodes an Effect schema object with its Effect; across the two instances
 * decoded values come out as Symbols ("Cannot convert a Symbol value to a string"). So the engine gets a Standard JSON Schema:
 *   · its JSON Schema is the one the engine itself derives from `schema` (core tool/runtime `definition`), so the model is
 *     offered the same parameters;
 *   · its validator is that same JSON Schema compiled and run by this bundle's Effect alone. Patterns are applied: the
 *     document comes from our own schemas (the engine's compiler drops a schema with a pattern and then validates nothing).
 */
export function engineToolInput(schema: Schema.Top) {
  const json = definition({ name: "input", description: "", input: schema, execute: () => { throw new Error("not executed") } }).inputSchema
  const codec = Schema.make<Schema.Codec<unknown>>(
    SchemaRepresentation.fromJsonSchemaDocument(JsonSchema.fromSchemaDraft2020_12(json), { patterns: "apply" }).ast,
  )
  return {
    "~standard": {
      ...Schema.toStandardSchemaV1(codec)["~standard"],
      vendor: "codepuppy",
      jsonSchema: { input: () => json, output: () => json },
    },
  }
}
