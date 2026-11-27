import { createHash, randomUUID } from "node:crypto"
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Location } from "../../../schema/src/location"
import type { PinnedFiles } from "../../../util/src/codepuppy-pinned-files"
import {
  publishDocumentPythonEnvironment,
  type DocumentPythonProjection,
  type DocumentRuntimeState,
} from "../../../util/src/codepuppy-document"
import { prepareDocumentProfile } from "../shared/document-runtime-fonts"

/** Only main writes these files. Runtime calls publish before notifying its state subscribers. */
export function createDocumentPythonProjections(input: {
  root: string
  generation: number
  pin: PinnedFiles["files"][number]
  assets: string
  resources: string
  platform: "darwin" | "win32"
}) {
  const root = join(input.root, "python-host")
  const entries = new Map<string, { path: string; value: DocumentPythonProjection; cleanup: () => void }>()
  const key = (location: Location.Ref) => JSON.stringify([location.directory, location.workspaceID ?? null])
  const write = (path: string, value: DocumentPythonProjection) => {
    const temporary = path + "." + randomUUID() + ".tmp"
    writeFileSync(temporary, JSON.stringify(value), { flag: "wx" })
    renameSync(temporary, path)
  }
  // A new runtime invalidates old generations before accepting new Python consumers.
  if (existsSync(root))
    for (const generation of readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
      for (const registration of readdirSync(join(root, generation.name), { withFileTypes: true }).filter((entry) =>
        entry.isDirectory(),
      )) {
        const path = join(root, generation.name, registration.name, "host.json")
        if (!existsSync(path) || !lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) continue
        let old: DocumentPythonProjection
        try {
          old = JSON.parse(readFileSync(path, "utf8")) as DocumentPythonProjection
        } catch {
          continue
        } // A malformed prior snapshot already fails closed in Python.
        if (
          old.schemaVersion !== 1 ||
          !Number.isSafeInteger(old.sequence) ||
          !Number.isSafeInteger(old.sidecarGeneration) ||
          !old.registrationId ||
          !old.location
        )
          continue
        write(path, {
          schemaVersion: 1,
          sequence: old.sequence + 1,
          sidecarGeneration: old.sidecarGeneration,
          registrationId: old.registrationId,
          location: old.location,
          status: "invalidated",
          reason: "sidecar-stopped",
        })
      }
    }
  return {
    environment(location: Location.Ref, registrationId: string, runtime: DocumentRuntimeState) {
      const existing = entries.get(key(location))
      if (existing && existing.value.registrationId === registrationId)
        return { CODEPUPPY_DOCUMENT_HOST: existing.path }
      if (!registrationId || /[\\/]/.test(registrationId) || registrationId === "." || registrationId === "..")
        throw Error("invalid document registration identity")
      const directory = join(root, String(input.generation), registrationId)
      mkdirSync(directory, { recursive: true })
      const configuration = join(directory, "configuration")
      prepareDocumentProfile({
        assets: input.assets,
        jobRoot: configuration,
        platform: input.platform,
        home: homedir(),
      })
      const seed = join(configuration, "profile")
      const basic = join(seed, "user", "basic")
      mkdirSync(join(basic, "Standard"), { recursive: true })
      // App-authored Basic catalogue; document-provided macros remain disabled by the shared profile.
      writeFileSync(
        join(basic, "script.xlc"),
        '<?xml version="1.0"?><library:libraries xmlns:library="http://openoffice.org/2000/library" xmlns:xlink="http://www.w3.org/1999/xlink"><library:library library:name="Standard" library:link="false"/></library:libraries>',
      )
      writeFileSync(
        join(basic, "Standard", "script.xlb"),
        '<?xml version="1.0"?><library:library xmlns:library="http://openoffice.org/2000/library" library:name="Standard" library:readonly="false" library:passwordprotected="false"><library:element library:name="Module1"/></library:library>',
      )
      copyFileSync(join(input.resources, "document-runtime/recalculate.xba"), join(basic, "Standard/Module1.xba"))
      const fontconfigTemplate = input.platform === "darwin" ? join(configuration, "fonts.conf") : null
      if (fontconfigTemplate)
        writeFileSync(
          fontconfigTemplate,
          readFileSync(fontconfigTemplate, "utf8").replace(
            /<cachedir>[^<]*<\/cachedir>/,
            "<cachedir>{{JOB_FONT_CACHE}}</cachedir>",
          ),
        )
      const files = readdirSync(configuration, { recursive: true })
        .map(String)
        .filter((file) => statSync(join(configuration, file)).isFile())
        .sort()
      const configurationSha256 = createHash("sha256")
        .update(
          JSON.stringify(
            files.map((file) => [
              file,
              createHash("sha256")
                .update(readFileSync(join(configuration, file)))
                .digest("hex"),
            ]),
          ),
        )
        .digest("hex")
      const jobs = join(directory, "jobs")
      mkdirSync(jobs, { recursive: true })
      const value: DocumentPythonProjection = {
        schemaVersion: 1,
        sequence: 0,
        sidecarGeneration: input.generation,
        registrationId,
        location: { directory: location.directory, ...(location.workspaceID !== undefined ? { workspaceID: location.workspaceID } : {}) },
        status: "active",
        pinId: input.pin.id,
        pinSha256: input.pin.sha256,
        runtime,
        jobs: { root: jobs, profileSeed: seed, fontconfigTemplate, configurationSha256, timeoutMs: 180000 },
      }
      const path = join(directory, "host.json")
      write(path, value)
      const environment = { CODEPUPPY_DOCUMENT_HOST: path }
      entries.set(key(location), { path, value, cleanup: publishDocumentPythonEnvironment(location, environment) })
      return environment
    },
    publish(runtime: DocumentRuntimeState) {
      for (const entry of entries.values()) {
        if (entry.value.status !== "active") continue
        entry.value = { ...entry.value, sequence: entry.value.sequence + 1, runtime }
        write(entry.path, entry.value)
      }
    },
    invalidate(location: Location.Ref, registrationId: string, reason: "location-disposed" | "sidecar-stopped") {
      const entry = entries.get(key(location))
      if (!entry || entry.value.registrationId !== registrationId) return
      const value: DocumentPythonProjection = {
        schemaVersion: 1,
        sequence: entry.value.sequence + 1,
        sidecarGeneration: entry.value.sidecarGeneration,
        registrationId,
        location,
        status: "invalidated",
        reason,
      }
      write(entry.path, value)
      entry.cleanup()
      entries.delete(key(location))
    },
    dispose() {
      for (const entry of [...entries.values()])
        this.invalidate(entry.value.location, entry.value.registrationId, "sidecar-stopped")
    },
  }
}
