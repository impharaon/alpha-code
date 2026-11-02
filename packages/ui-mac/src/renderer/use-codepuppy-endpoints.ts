// Renderer accessor for the resolved backend endpoints. The renderer no longer hardcodes the URLs —
// it reads main's resolution over IPC (window.api.endpoints). A module-level signal fetches once and
// is shared by every caller; the shared default is only the initial value until the IPC resolves
// (links are clicked after mount, so the resolved value is what's used). CODEPUPPY_PATHS (route segments)
// stay imported from shared — those are the stable HTTP contract, not deployment-specific.

import { createSignal } from "solid-js"
import { CODEPUPPY_ENDPOINTS, type CodePuppyEndpoints } from "../shared/codepuppy-config"

const [endpoints, setEndpoints] = createSignal<CodePuppyEndpoints>(CODEPUPPY_ENDPOINTS)
let started = false

export function useCodePuppyEndpoints() {
  if (!started) {
    started = true
    window.api
      .endpoints()
      .then((e) => e && setEndpoints((prev) => ({ ...prev, ...e })))
      .catch(() => {})
  }
  return endpoints
}
