#!/usr/bin/env bash
# alpha-code#1662 L1a — set up the upstream build and produce the two Node bundles.
#   1. bun 1.4.4 (upstream packageManager) into ${T}/bun-1.4.4 only — global ~/.bun and rc files untouched
#   2. detached upstream worktree at ${OC2_SHA} in ${T}/oc2; `bun install` with HUSKY=0 (husky would otherwise
#      write core.hooksPath into the .git/config every alpha-code worktree shares)
#   3. copy the probe sources in and build dist-node/embed.mjs, embed-v1mig.mjs and the control embed-v1mig-raw.mjs
#   4. bundle Code Puppy's process-fence-apply.ts unchanged, for the utilityProcess
set -euo pipefail
. "$(dirname "$0")/env.sh"
export BUN_INSTALL="${BUN144_ROOT}" BUN_INSTALL_CACHE_DIR="${BUN144_ROOT}/install/cache" HUSKY=0
if [ ! -x "${BUN144}" ]; then
  mkdir -p "${T}/dl/unz" "${BUN144_ROOT}/bin"
  curl -fsSL -o "${T}/dl/bun.zip" https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/bun-darwin-aarch64.zip
  curl -fsSL -o "${T}/dl/SHASUMS256.txt" https://github.com/oven-sh/bun/releases/download/bun-v1.4.4/SHASUMS256.txt
  want=$(grep ' bun-darwin-aarch64.zip$' "${T}/dl/SHASUMS256.txt" | cut -d' ' -f1)
  [ "$(shasum -a 256 "${T}/dl/bun.zip" | cut -d' ' -f1)" = "${want}" ] || { echo "bun zip checksum mismatch"; exit 1; }
  unzip -q -o "${T}/dl/bun.zip" -d "${T}/dl/unz"
  cp "${T}/dl/unz/bun-darwin-aarch64/bun" "${BUN144}"
fi
"${BUN144}" --version
[ -d "${OC2}" ] || git -C "${WT}" worktree add --detach "${OC2}" "${OC2_SHA}"
hooks_before=$(git -C "${WT}" config --get core.hooksPath || true)
[ -d "${OC2}/node_modules" ] || (cd "${OC2}" && PATH="${BUN144_ROOT}/bin:${PATH}" "${BUN144}" install)
[ "$(git -C "${WT}" config --get core.hooksPath || true)" = "${hooks_before}" ] || { echo "core.hooksPath changed by install"; exit 1; }
cp "${HERE}/embed-entry.ts" "${OC2}/packages/cli/src/ac1662-embed-entry.ts"
mkdir -p "${OC2}/packages/cli/src/ac1662-shims"
cp "${HERE}/shims/bun-sqlite.ts" "${OC2}/packages/cli/src/ac1662-shims/bun-sqlite.ts"
cp "${HERE}/build-embed.ts" "${OC2}/packages/cli/script/ac1662-build-embed.ts"
(cd "${OC2}/packages/cli" && PATH="${BUN144_ROOT}/bin:${PATH}" "${BUN144}" script/ac1662-build-embed.ts)
(cd "${OC2}/packages/cli" && PATH="${BUN144_ROOT}/bin:${PATH}" "${BUN144}" script/ac1662-build-embed.ts --v1-migration)
(cd "${OC2}/packages/cli" && PATH="${BUN144_ROOT}/bin:${PATH}" "${BUN144}" script/ac1662-build-embed.ts --v1-migration-raw)
mkdir -p "${T}/build"
# Code Puppy's fence loader, bundled as-is (the shipped sidecar gets it the same way: bundled into sidecar.js).
(cd "${WT}/packages/ui-mac" && bun build src/main/process-fence-apply.ts --target=node --format=esm --outfile "${T}/build/process-fence-apply.mjs")
ls -la "${OC2}/packages/cli/dist-node/" "${T}/build/"
