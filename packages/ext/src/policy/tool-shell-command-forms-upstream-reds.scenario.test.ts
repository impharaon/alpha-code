import { upstreamReds } from "./session-grant-upstream-reds.cases"

upstreamReds(
  "packages/core/test/tool-shell.test.ts",
  "the pinned command-form cases in tool-shell.test.ts are present and red",
  "command-forms",
)
