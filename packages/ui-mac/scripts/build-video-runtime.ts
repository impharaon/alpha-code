import { createHash, randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { parse } from "jsonc-parser"
import lock from "../resources/video-runtime/build.lock.json"
import { fileDigest } from "../resources/video-mcp/cache"
import type { VideoRuntime } from "../resources/video-mcp/runtime"
import { VIDEO_RUNTIME_BUILD_DIR } from "./target-arch"
import { checkVideoRuntime, writeVideoRuntimeInventory } from "./video-runtime-artifacts"

const packageRoot = path.resolve(import.meta.dir, "..")
type SourceRole = keyof typeof lock.sources
export type VideoTarget = VideoRuntime["platform"]

export async function runVideoBuild(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  const child = Bun.spawn(args, { cwd, env, stdout: "inherit", stderr: "inherit" })
  const code = await child.exited
  if (code !== 0) throw new Error(`Video build command failed (${code}): ${args[0]}`)
}

/** Build inputs only. Runtime models/codecs use VIDEO-L1-v2, never this path. */
export async function videoBuildSource(root: string, role: SourceRole) {
  const source = lock.sources[role]
  const file = path.join(root, "sources", source.filename)
  const valid = async () =>
    await stat(file)
      .then(async (entry) => entry.size === source.bytes && (await fileDigest(file)) === source.sha256)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false
        throw error
      })
  if (await valid()) return file
  await mkdir(path.dirname(file), { recursive: true })
  const pending = `${file}.${randomUUID()}.part`
  try {
    const response = await fetch(source.url)
    if (!response.ok || !response.body) throw new Error(`Video source unavailable: ${role} (${response.status})`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(pending, { flags: "wx" }))
    if ((await stat(pending)).size !== source.bytes || (await fileDigest(pending)) !== source.sha256)
      throw new Error(`Video source integrity failed: ${role}`)
    await rename(pending, file)
  } finally {
    await rm(pending, { force: true })
  }
  return file
}

export async function expandVideoBuildSource(root: string, role: SourceRole, directory: string) {
  const archive = await videoBuildSource(root, role)
  const result = path.join(directory, lock.sources[role].root)
  if (
    await stat(result)
      .then((entry) => entry.isDirectory())
      .catch(() => false)
  )
    return result
  await mkdir(directory, { recursive: true })
  await runVideoBuild([Bun.which("tar") ?? "tar", "-xf", archive, "-C", directory], root)
  return result
}

export async function videoBuildTools(root: string, target: VideoTarget) {
  const host = process.platform === "win32" ? "win32" : "darwin"
  const cmake =
    Bun.which("cmake") ??
    path.join(
      await expandVideoBuildSource(root, `cmake-${host}`, path.join(root, "build-tools")),
      "bin",
      `cmake${host === "win32" ? ".exe" : ""}`,
    )
  const cross =
    target === "win32-x64"
      ? await expandVideoBuildSource(root, `llvm-${host}`, path.join(root, "toolchain"))
      : undefined
  const env = {
    ...process.env,
    PATH: [cross && path.join(cross, "bin"), path.dirname(cmake), process.env.PATH]
      .filter(Boolean)
      .join(path.delimiter),
  }
  const flags =
    target === "win32-x64"
      ? [
          "-DCMAKE_SYSTEM_NAME=Windows",
          "-DCMAKE_SYSTEM_PROCESSOR=x86_64",
          `-DCMAKE_C_COMPILER=${path.join(cross!, "bin", "x86_64-w64-mingw32-clang")}`,
          `-DCMAKE_CXX_COMPILER=${path.join(cross!, "bin", "x86_64-w64-mingw32-clang++")}`,
        ]
      : ["-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0"]
  return { cmake, env, flags }
}

async function npmVideoPackage(root: string, name: string, version: string) {
  const bunLock = parse(await readFile(path.resolve(packageRoot, "../../bun.lock"), "utf8")) as {
    packages: Record<string, unknown[]>
  }
  const record = bunLock.packages[name]
  if (!record || record[0] !== `${name}@${version}` || typeof record.at(-1) !== "string")
    throw new Error(`Video npm input is not locked: ${name}@${version}`)
  const integrity = record.at(-1) as string
  const metadata = (await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/${version}`).then(
    (response) => {
      if (!response.ok) throw new Error(`Video npm metadata unavailable: ${name}`)
      return response.json()
    },
  )) as { dist: { tarball: string; integrity: string } }
  if (metadata.dist.integrity !== integrity) throw new Error(`Video npm registry/lock mismatch: ${name}`)
  const directory = path.join(root, "npm", name.replaceAll("/", "-"))
  const archive = `${directory}.tgz`
  const verified = async () =>
    await readFile(archive)
      .then((data) => `sha512-${createHash("sha512").update(data).digest("base64")}` === integrity)
      .catch(() => false)
  await mkdir(path.dirname(directory), { recursive: true })
  if (!(await verified())) {
    const response = await fetch(metadata.dist.tarball)
    if (!response.ok || !response.body) throw new Error(`Video npm archive unavailable: ${name}`)
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive))
    if (!(await verified())) throw new Error(`Video npm integrity failed: ${name}`)
  }
  const result = path.join(directory, "package")
  if (
    !(await stat(result)
      .then((entry) => entry.isDirectory())
      .catch(() => false))
  ) {
    await mkdir(directory, { recursive: true })
    await runVideoBuild([Bun.which("tar") ?? "tar", "-xf", archive, "-C", directory], root)
  }
  return result
}

export async function buildVideoRuntime(
  target: VideoTarget,
  sourceRoot?: string,
  directory = path.join(packageRoot, VIDEO_RUNTIME_BUILD_DIR, target === "darwin-arm64" ? "mac-arm64" : "win-x64"),
) {
  const root = sourceRoot ?? (await mkdtemp(path.join(tmpdir(), "codepuppy-video-build-")))
  const buildFingerprint = createHash("sha256")
    .update(await readFile(import.meta.filename))
    .update(await readFile(path.join(packageRoot, "resources/video-runtime/build.lock.json")))
    .update(await readFile(path.join(packageRoot, "resources/video-mcp/helpers/vision.swift")))
    .update(await readFile(path.resolve(packageRoot, "../../bun.lock")))
    .update(target)
    .digest("hex")
  const cached = await checkVideoRuntime(directory, target).catch(() => undefined)
  if (cached?.buildFingerprint === buildFingerprint) return directory
  const tools = await videoBuildTools(root, target)
  const wrapper = await expandVideoBuildSource(root, "whisper-node", path.join(root, "whisper-source"))
  if (!(await stat(path.join(wrapper, "whisper.cpp/CMakeLists.txt")).catch(() => undefined))) {
    const cpp = await expandVideoBuildSource(root, "whisper-cpp", path.join(root, "whisper-cpp"))
    await rm(path.join(wrapper, "whisper.cpp"), { recursive: true, force: true })
    await rename(cpp, path.join(wrapper, "whisper.cpp"))
  }
  const addon = await expandVideoBuildSource(root, "node-addon-api", path.join(root, "node-addon-api"))
  const require = createRequire(import.meta.url)
  const headers = path.join(path.dirname(require.resolve("node-api-headers/package.json")), "include")
  const build = path.join(root, target === "darwin-arm64" ? "build-whisper" : "build-whisper-win32-x64")
  const common = [
    "-DCMAKE_BUILD_TYPE=Release",
    `-DNODE_ARCH=${target === "darwin-arm64" ? "arm64" : "x64"}`,
    "-Dnapi_build_version=6",
    `-DCMAKE_JS_INC=${headers};${addon}`,
    "-DGGML_OPENMP=OFF",
    "-DGGML_NATIVE=OFF",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_EXAMPLES=OFF",
  ]
  const platform =
    target === "darwin-arm64"
      ? [
          "-DGGML_METAL=ON",
          "-DGGML_METAL_EMBED_LIBRARY=ON",
          "-DGGML_METAL_MACOSX_VERSION_MIN=12.0",
          "-DCMAKE_SHARED_LINKER_FLAGS=-undefined dynamic_lookup",
        ]
      : [
          "-DGGML_METAL=OFF",
          "-DGGML_AVX=OFF",
          "-DGGML_AVX2=OFF",
          "-DGGML_FMA=OFF",
          "-DGGML_F16C=OFF",
          "-DCMAKE_SHARED_LINKER_FLAGS=-static",
        ]
  await runVideoBuild(
    [tools.cmake, "-S", wrapper, "-B", build, ...tools.flags, ...common, ...platform],
    root,
    tools.env,
  )
  await runVideoBuild([tools.cmake, "--build", build, "--parallel", "2"], root, tools.env)
  await mkdir(directory, { recursive: true })
  const nativeName = `@fugood/node-whisper-${target}`
  const sherpaName = `sherpa-onnx-${target === "darwin-arm64" ? target : "win-x64"}`
  const npmInputs = [
    ["sherpa-onnx-node", "2.0.3"],
    [sherpaName, "2.0.3"],
    ["@fugood/whisper.node", lock.whisperVersion],
    [nativeName, lock.whisperVersion],
  ]
  for (const [name, version] of npmInputs) {
    const source = await npmVideoPackage(root, name!, version!)
    const destination = path.join(directory, "node_modules", name!)
    await mkdir(destination, { recursive: true })
    for (const entry of await readdir(source, { withFileTypes: true })) {
      if (
        (entry.isFile() &&
          (/\.(js|node|dylib|dll|metallib)$/.test(entry.name) ||
            entry.name === "package.json" ||
            /license|copying/i.test(entry.name))) ||
        (name === "@fugood/whisper.node" && entry.name === "lib")
      )
        await cp(path.join(source, entry.name), path.join(destination, entry.name), {
          recursive: true,
          dereference: true,
        })
    }
  }
  await cp(path.join(build, "index.node"), path.join(directory, "node_modules", nativeName, "index.node"))
  const components: Record<string, string> = {}
  await mkdir(path.join(directory, "helpers"), { recursive: true })
  if (target === "darwin-arm64") {
    components.ocr = "helpers/vision"
    await runVideoBuild(
      [
        "/usr/bin/swiftc",
        "-O",
        "-target",
        "arm64-apple-macosx12.0",
        path.join(packageRoot, "resources/video-mcp/helpers/vision.swift"),
        "-o",
        path.join(directory, components.ocr),
      ],
      root,
    )
  } else {
    const prefix = path.join(root, "ocr-win-prefix")
    for (const [role, options] of [
      [
        "jpeg",
        ["-DENABLE_SHARED=OFF", "-DWITH_TURBOJPEG=OFF", "-DWITH_SIMD=OFF", "-DWITH_TESTS=OFF", "-DWITH_TOOLS=OFF"],
      ],
      [
        "leptonica",
        [
          "-DBUILD_PROG=OFF",
          "-DENABLE_GIF=OFF",
          "-DENABLE_OPENJPEG=OFF",
          "-DENABLE_WEBP=OFF",
          "-DENABLE_TIFF=OFF",
          "-DENABLE_PNG=OFF",
          "-DENABLE_ZLIB=OFF",
        ],
      ],
      [
        "tesseract",
        [
          "-DBUILD_TRAINING_TOOLS=OFF",
          "-DBUILD_TESTS=OFF",
          "-DDISABLE_CURL=ON",
          "-DDISABLE_ARCHIVE=ON",
          "-DOPENMP_BUILD=OFF",
          "-DLEPT_TIFF_RESULT=1",
          "-DDISABLE_TIFF=ON",
          "-DGRAPHICS_DISABLED=ON",
          "-DCMAKE_CXX_FLAGS=-D_USE_MATH_DEFINES",
        ],
      ],
    ] as const) {
      const source = await expandVideoBuildSource(root, role, path.join(root, "component-sources"))
      const output = path.join(root, `win-build-${lock.sources[role].root}`)
      await runVideoBuild(
        [
          tools.cmake,
          "--fresh",
          "-S",
          source,
          "-B",
          output,
          ...tools.flags,
          "-DCMAKE_BUILD_TYPE=Release",
          "-DBUILD_SHARED_LIBS=OFF",
          "-DSW_BUILD=OFF",
          "-DCMAKE_EXE_LINKER_FLAGS=-static",
          `-DCMAKE_INSTALL_PREFIX=${prefix}`,
          `-DCMAKE_PREFIX_PATH=${prefix}`,
          ...options,
        ],
        root,
        tools.env,
      )
      await runVideoBuild([tools.cmake, "--build", output, "--parallel", "2"], root, tools.env)
      await runVideoBuild([tools.cmake, "--install", output], root, tools.env)
    }
    components.ocr = "helpers/tesseract.exe"
    await cp(path.join(prefix, "bin/tesseract.exe"), path.join(directory, components.ocr))
  }
  await mkdir(path.join(directory, "wheels"), { recursive: true })
  for (const [role, component] of [
    ["ytdlp", "yt-dlp"],
    ["ejs", "yt-dlp-ejs"],
  ] as const) {
    components[component] = `wheels/${lock.sources[role].filename}`
    await cp(await videoBuildSource(root, role), path.join(directory, components[component]!))
  }
  await cp(path.join(packageRoot, "resources/video-runtime/licenses"), path.join(directory, "licenses"), {
    recursive: true,
  })
  await cp(path.join(wrapper, "LICENSE"), path.join(directory, "licenses/whisper-node.txt"))
  await cp(path.join(wrapper, "whisper.cpp/LICENSE"), path.join(directory, "licenses/whisper-cpp.txt"))
  await cp(path.join(packageRoot, "resources/video-runtime/licenses.json"), path.join(directory, "licenses.json"))
  await cp(path.join(packageRoot, "resources/video-runtime/build.lock.json"), path.join(directory, "build.lock.json"))
  await writeVideoRuntimeInventory(directory, target, components, buildFingerprint)
  return directory
}

if (import.meta.main) {
  const target = process.argv[2] ?? `${process.platform}-${process.arch}`
  if (target !== "darwin-arm64" && target !== "win32-x64")
    throw new Error("Video build target must be darwin-arm64 or win32-x64")
  const directory = await buildVideoRuntime(target, process.argv[3], process.argv[4])
  console.log(`Video runtime prepared: ${directory}`)
}
