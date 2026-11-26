import { expect, test } from "bun:test"
import { parseEnv } from "node:util"
import { credentialValues, documentValues, envAssignments } from "./secret-values"
import { ProtectedFiles } from "../../schema/src/codepuppy-protected-files"

// Fixture source/version/hash: fixtures/secret-files/provenance.json. All CLI writers used isolated paths.
const fixture = (name: string) => Bun.file(new URL(`./fixtures/secret-files/${name}`, import.meta.url))
const file = (
  profile: ProtectedFiles.CredentialProfile,
  format: ProtectedFiles.ProtectedFormat,
): ProtectedFiles.ProtectedFile => ({ rule: "fixture", path: "/fixture/sample", profile, format, view: "notice" })
const strings = (values: readonly Uint8Array[]) => values.map((value) => Buffer.from(value).toString())

test("published profiles collect credential values", async () => {
  const samples = [
    ["aws-credentials.ini", "aws", "ini", "fixture-secret-key"],
    ["npm.ini", "npm", "assignments", "fixture-npm-token"],
    ["kube.yaml", "kube", "assignments", "fixture-kube-token"],
    ["git-credentials.txt", "git-credentials", "credential-url", "fixture-git-password"],
  ] as const
  for (const [name, profile, format, expected] of samples) {
    const values = strings(credentialValues(file(profile, format), await fixture(name).bytes()))
    expect(values.includes(expected), name).toBe(true)
    expect(values).not.toContain("json")
    expect(values).not.toContain("us-east-1")
  }
  expect(credentialValues(file("aws", "ini"), await fixture("aws-config.ini").bytes())).toEqual([])
  for (const [name, profile, key] of [
    ["gcp.json", "gcp-adc", "refresh_token"],
    ["azure-entry.json", "azure", "secret"],
  ] as const) {
    const document = await fixture(name).json()
    expect(
      strings(credentialValues(file(profile, "json"), await fixture(name).bytes())).includes(document[key]),
      name,
    ).toBe(true)
    expect(strings(documentValues(profile, document))).not.toContain(document.client_id)
  }
  const docker = await fixture("docker.json").json()
  const auth = Object.values(docker.auths)[0] as { auth: string }
  expect(
    strings(credentialValues(file("docker", "json"), await fixture("docker.json").bytes())).includes(auth.auth),
  ).toBe(true)
  const key = await fixture("private-key.txt").bytes()
  expect(credentialValues(file("private-key", "opaque"), key).some((value) => Buffer.from(value).equals(key))).toBe(
    true,
  )
  expect(credentialValues(file("encrypted-store", "opaque"), key).length).toBe(1)
  expect(credentialValues(file("netrc", "netrc"), await fixture("netrc.txt").bytes()).length).toBeGreaterThan(0)
  expect(credentialValues(file("pypi", "ini"), await fixture("pypi.ini").bytes()).length).toBeGreaterThan(0)
  expect(
    credentialValues(file("credential-document", "assignments"), await fixture("credentials.toml").bytes()).length,
  ).toBeGreaterThan(0)
  const gcp = await fixture("gcp.json").json()
  expect(strings(documentValues("credential-document", gcp)).includes(gcp.client_secret)).toBe(true)
})

test("env records preserve every assignment occurrence", async () => {
  const text = await fixture("node-env.txt").text()
  const records = envAssignments(text)
  expect(Object.fromEntries(records.map((row) => [row.name, row.value]))).toEqual(parseEnv(text))
  const original = records[0]
  const first = text.slice(original.start, original.end)
  const second = first.slice(0, original.valueStart - original.start) + '"another-fixture-value"'
  const repeated = envAssignments(`${first}\n${second}\n`)
  expect(repeated.map((row) => row.occurrence)).toEqual([1, 2])
  expect(repeated[0].value === repeated[1].value).toBe(false)
  expect(repeated.map((row) => `${first}\n${second}\n`.slice(row.valueStart, row.valueEnd))).toEqual([
    text.slice(original.valueStart, original.valueEnd),
    '"another-fixture-value"',
  ])
})

test("structured parse failures never become opaque values", async () => {
  const text = await fixture("gcp.json").text()
  expect(() => credentialValues(file("gcp-adc", "json"), Buffer.from(text.slice(0, -3)))).toThrow()
})

test("AWS EKS exec args and YAML aliases retain credential classification", async () => {
  // Official aws eks update-kubeconfig golden output; provenance.json pins its original bytes.
  expect(credentialValues(file("kube", "assignments"), await fixture("kube-eks.yaml").bytes())).toEqual([])
  // YAML 1.2 anchors/aliases/flow sequence and YAML merge-key examples, with fixture-only values.
  const document = `defaults: &default
  token: fixture-aliased-token
ordinary: &region us-east-1
users:
- name: fixture
  user:
    <<: *default
    exec:
      args: [--region, *region, eks]
    extras:
    - --region
    - *region
` 
  const values = strings(credentialValues(file("kube", "assignments"), Buffer.from(document)))
  expect(values).toContain("fixture-aliased-token")
  expect(values).not.toContain("us-east-1")
  expect(values).not.toContain("--region")
})
