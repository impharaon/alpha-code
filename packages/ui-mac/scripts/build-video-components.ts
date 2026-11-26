import { cp, mkdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import lock from "../resources/video-runtime/build.lock.json"
import { fileDigest } from "../resources/video-mcp/cache"
import {
  expandVideoBuildSource,
  runVideoBuild,
  videoBuildTools,
  videoBuildSource,
  type VideoTarget,
} from "./build-video-runtime"

/** Produces codec/source assets for the existing public release. No upload. */
export async function buildVideoComponents(target: VideoTarget, root: string, output: string) {
  const tools = await videoBuildTools(root, target)
  const sources = path.join(root, target === "darwin-arm64" ? "component-sources" : "codec-win-sources")
  const openh264 = await expandVideoBuildSource(root, "openh264", sources)
  const ffmpeg = await expandVideoBuildSource(root, "ffmpeg", sources)
  const prefix = path.join(root, target === "darwin-arm64" ? "codec-prefix" : "codec-win-prefix")
  const stage = path.join(root, target === "darwin-arm64" ? "codec-stage" : "codec-win-stage")
  const pkgconfDirectory = path.join(root, "pkgconf-tool")
  const pkgconf = Bun.which("pkg-config") ?? Bun.which("pkgconf") ?? path.join(pkgconfDirectory, "bin/pkgconf")
  if (!(await stat(pkgconf).catch(() => undefined))) {
    const source = await expandVideoBuildSource(root, "pkgconf", path.join(root, "component-sources"))
    await runVideoBuild(["./configure", `--prefix=${pkgconfDirectory}`], source)
    await runVideoBuild(["make", "-j2"], source)
    await runVideoBuild(["make", "install"], source)
  }
  const env = {
    ...tools.env,
    PATH: [path.dirname(pkgconf), tools.env.PATH].join(path.delimiter),
    PKG_CONFIG_LIBDIR: path.join(prefix, "lib/pkgconfig"),
  }
  const buildFlags =
    target === "darwin-arm64"
      ? ["OS=darwin", "ARCH=arm64", "CFLAGS=-mmacosx-version-min=12.0", "CXXFLAGS=-mmacosx-version-min=12.0"]
      : [
          "OS=mingw_nt",
          "ARCH=x86_64",
          "USE_ASM=No",
          "CC=x86_64-w64-mingw32-clang",
          "CXX=x86_64-w64-mingw32-clang++",
          "AR=llvm-ar",
        ]
  await runVideoBuild(
    ["make", "-j2", ...buildFlags, `PREFIX=${prefix}`, "libopenh264.a", "install-static"],
    openh264,
    env,
  )
  const prefixName = target === "darwin-arm64" ? "codec-prefix" : "codec-win-prefix"
  const flags = [
    "--prefix=/ffmpeg",
    "--disable-gpl",
    "--disable-nonfree",
    "--disable-autodetect",
    "--enable-libopenh264",
    "--enable-static",
    "--disable-shared",
    "--disable-doc",
    "--disable-debug",
    "--disable-ffplay",
    "--disable-network",
    `--pkg-config=${path.basename(pkgconf)}`,
    "--pkg-config-flags=--static",
  ]
  const targetFlags =
    target === "darwin-arm64"
      ? [
          `--extra-cflags=-I../../${prefixName}/include -mmacosx-version-min=12.0`,
          `--extra-ldflags=-L../../${prefixName}/lib -mmacosx-version-min=12.0`,
        ]
      : [
          "--target-os=mingw32",
          "--arch=x86_64",
          "--cross-prefix=x86_64-w64-mingw32-",
          "--cc=x86_64-w64-mingw32-clang",
          "--cxx=x86_64-w64-mingw32-clang++",
          "--enable-cross-compile",
          "--disable-x86asm",
          `--extra-cflags=-I../../${prefixName}/include`,
          `--extra-ldflags=-L../../${prefixName}/lib -static`,
        ]
  await runVideoBuild(["./configure", ...flags, ...targetFlags], ffmpeg, env)
  await runVideoBuild(["make", "-j2"], ffmpeg, env)
  await runVideoBuild(["make", "install", `DESTDIR=${stage}`], ffmpeg, env)
  const delivery = path.join(root, `codec-delivery-${target}`)
  const rootDirectory = path.join(delivery, "ffmpeg")
  await mkdir(path.join(rootDirectory, "bin"), { recursive: true })
  for (const program of ["ffmpeg", "ffprobe"]) {
    const name = program + (target === "win32-x64" ? ".exe" : "")
    await cp(path.join(stage, "ffmpeg/bin", name), path.join(rootDirectory, "bin", name))
  }
  await mkdir(path.join(rootDirectory, "licenses"), { recursive: true })
  await cp(path.join(ffmpeg, "COPYING.LGPLv2.1"), path.join(rootDirectory, "licenses/LGPL-2.1.txt"))
  await cp(path.join(openh264, "LICENSE"), path.join(rootDirectory, "licenses/OpenH264.txt"))
  await writeFile(
    path.join(rootDirectory, "SOURCE.json"),
    JSON.stringify(
      {
        sources: { ffmpeg: lock.sources.ffmpeg, openh264: lock.sources.openh264 },
        configure: [...flags, ...targetFlags],
        openh264Build: [
          "make",
          "-j2",
          ...buildFlags,
          "PREFIX=<source-root>/codec-prefix",
          "libopenh264.a",
          "install-static",
        ],
        sourceAsset: `video-ffmpeg-9.1-openh264-2.7.0-${target}-source.tar.gz`,
      },
      null,
      2,
    ),
  )
  // The source material is a separate, equally accessible release asset. It is
  // not another 70 MB fetched merely to answer a user's first local question.
  const sourceStage = path.join(root, `codec-source-release-${target}`)
  await mkdir(sourceStage, { recursive: true })
  for (const role of ["ffmpeg", "openh264"] as const)
    await cp(await videoBuildSource(root, role), path.join(sourceStage, lock.sources[role].filename))
  await cp(path.join(rootDirectory, "SOURCE.json"), path.join(sourceStage, "SOURCE.json"))
  await cp(
    path.join(import.meta.dir, "../resources/video-runtime/build.lock.json"),
    path.join(sourceStage, "build.lock.json"),
  )
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'"
  const replay = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    "# Requires make, tar and pkgconf (or pkg-config); Windows cross build also needs the locked llvm-mingw toolchain on PATH.",
    'cd "$(dirname "$0")"',
    `mkdir -p ${target === "darwin-arm64" ? "component-sources" : "codec-win-sources"}`,
    `tar -xf ${quote(lock.sources.ffmpeg.filename)} -C ${target === "darwin-arm64" ? "component-sources" : "codec-win-sources"}`,
    `tar -xf ${quote(lock.sources.openh264.filename)} -C ${target === "darwin-arm64" ? "component-sources" : "codec-win-sources"}`,
    'source_root="$PWD"',
    `cd ${target === "darwin-arm64" ? "component-sources" : "codec-win-sources"}/${lock.sources.openh264.root}`,
    `make -j2 ${buildFlags.map(quote).join(" ")} PREFIX="$source_root/${prefixName}" libopenh264.a install-static`,
    `cd ../${lock.sources.ffmpeg.root}`,
    `export PKG_CONFIG_LIBDIR="$source_root/${prefixName}/lib/pkgconfig"`,
    `./configure ${[...flags.filter((flag) => !flag.startsWith("--pkg-config=")), "--pkg-config=pkgconf", ...targetFlags].map(quote).join(" ")}`,
    "make -j2",
    'make install DESTDIR="$source_root/stage"',
    "",
  ].join("\n")
  await writeFile(path.join(sourceStage, "BUILD.sh"), replay, { mode: 0o755 })
  await mkdir(output, { recursive: true })
  const archive = path.join(output, `video-ffmpeg-9.1-openh264-2.7.0-${target}.tar.gz`)
  await runVideoBuild([Bun.which("tar") ?? "tar", "-czf", archive, "-C", delivery, "ffmpeg"], root, {
    ...process.env,
    COPYFILE_DISABLE: "1",
  })
  const sourceArchive = archive.replace(".tar.gz", "-source.tar.gz")
  await runVideoBuild([Bun.which("tar") ?? "tar", "-czf", sourceArchive, "-C", sourceStage, "."], root, {
    ...process.env,
    COPYFILE_DISABLE: "1",
  })
  const pin = {
    id: `ffmpeg/${target}/9.1-openh264-2.7.0`,
    family: "ffmpeg",
    target,
    version: "9.1-openh264-2.7.0",
    originUrl: `https://github.com/impharaon/alpha-code/releases/download/v0.2.8/${path.basename(archive)}`,
    bytes: (await stat(archive)).size,
    sha256: await fileDigest(archive),
    provenanceUrl: `https://github.com/impharaon/alpha-code/releases/download/v0.2.8/${path.basename(sourceArchive)}`,
  }
  await writeFile(`${archive}.pin.json`, `${JSON.stringify(pin, null, 2)}\n`)
  return { archive, sourceArchive, pin }
}

if (import.meta.main) {
  const target = process.argv[2]
  if ((target !== "darwin-arm64" && target !== "win32-x64") || !process.argv[3] || !process.argv[4])
    throw new Error(
      "Usage: build-video-components.ts <darwin-arm64|win32-x64> <temporary-source-root> <temporary-release-output>",
    )
  console.log(JSON.stringify(await buildVideoComponents(target, process.argv[3], process.argv[4])))
}
