// alpha-web#283 AC6:产物检测器缺省标识随平台(alpha-platform#568)切到 codepuppy 形态,旧值不留。
import { describe, expect, test } from "bun:test"
import { deriveArtifactDescriptors } from "./cloud-artifact-descriptor"

describe("artifact detector identifier", () => {
  test("a detected MIME without an explicit detector records codepuppy-magic/1", () => {
    const [descriptor] = deriveArtifactDescriptors("job_a", [{ name: "a.png", detectedMime: "image/png" }], { producer: "pipeline" })
    expect(descriptor!.verification.detector).toBe("codepuppy-magic/1")
  })

  test("an explicit detector is kept verbatim and no detected MIME records none", () => {
    const [explicit, none] = deriveArtifactDescriptors(
      "job_a",
      [{ name: "a.png", detectedMime: "image/png", detector: "codepuppy-png-header/1" }, { name: "b.txt" }],
      { producer: "pipeline" },
    )
    expect(explicit!.verification.detector).toBe("codepuppy-png-header/1")
    expect("detector" in none!.verification).toBe(false)
  })
})
