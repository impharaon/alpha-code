# alpha-code#1662 L1a — shared paths for every step. Source it from bash: `. env.sh`.
# Everything the experiments create lives under $T (a /private/tmp directory). Nothing here touches
# the owner's ~/.local/share/opencode, the global ~/.bun, or any shell rc file.

T=${AC1662_ROOT:-/private/tmp/ac1662-l1}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WT=$(cd "${HERE}/../../.." && pwd)                       # the alpha-code worktree this file lives in
REAL_HOME=${REAL_HOME:-$HOME}                           # captured before any isolation is applied
OC2_SHA=33f94fce96                                      # baseline §2.1 merge target (= v2.2.6 code)
OC2=${T}/oc2                                            # detached upstream worktree, built with bun 1.4.4
BUN144_ROOT=${T}/bun-1.4.4
BUN144=${BUN144_ROOT}/bin/bun
ELECTRON=${WT}/packages/ui-mac/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron

# iso_env <name>: print `export` lines that point HOME and every XDG root at ${T}/iso-<name>.
# Usage: eval "$(iso_env armA)". The roots are created so the engine's mkdir never escapes upward.
iso_env() {
  local root="${T}/iso-$1"
  mkdir -p "${root}/home" "${root}/xdg/data" "${root}/xdg/config" "${root}/xdg/state" "${root}/xdg/cache" "${root}/tmp" "${root}/ws"
  cat <<EOF
export ISO_ROOT='${root}'
export HOME='${root}/home'
export XDG_DATA_HOME='${root}/xdg/data'
export XDG_CONFIG_HOME='${root}/xdg/config'
export XDG_STATE_HOME='${root}/xdg/state'
export XDG_CACHE_HOME='${root}/xdg/cache'
export TMPDIR='${root}/tmp/'
EOF
}
