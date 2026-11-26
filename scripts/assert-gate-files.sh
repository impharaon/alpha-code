#!/usr/bin/env bash
#
# 逐个跑 scripts/gate-files.tsv 里登记的**闸门文件**,每个都断言「文件还在且真的跑了
# **恰好登记的那么多条**」(`#844`:精确条数,不再是留余量的下界)。
#
# 为什么不能只靠整包地板(本仓已犯过两次的错):
#   整包地板抓灾难性丢失,抓不到单个文件消失 —— 删掉一个 8 条用例的闸门,3085→3077 仍远高于
#   地板 3000,**全绿**;ext 删掉 26 条的 drift lock,132→106 仍高于地板 100,**全绿**。
# 为什么下界也不够(`#844`,第二次同类):
#   下界留 ~20% 余量时,**新加进闸门文件的用例可以被整段删掉而登记簿全绿** —— #828 加的
#   7 条闸删掉后 90→83 仍 ≥ 旧下界 74。实测 87 条登记里 35 条有余量(合计 131 条用例
#   处于可静默删除态),其中两条 guarantee 里明写「不留余量」的也已漂移。
#   等号修的是类:对新增的闸门默认保护,对删除默认拒绝。
# 三层各管各的:地板管灾难,本脚本管单点,精确条数管单点里的单条。
#
# `#1153`:平台条件闸与退出码三档(与 codepuppy-check 第 [2/10]/[9/10]/[10/10] 步同形):
#   0 = 全部适用行已验证;1 = 真失守(文件被删/条数偏离/标注与自报不符/登记簿坏),拦住;
#   2 = 门绿,但存在「本平台不适用」的平台条件行 —— 本次运行不构成那几行的证据,消费方记
#       「未验证」不拦(硬红会训练下一个人把 darwin-only 判据摘出登记簿,即 #1153 的病根)。
# guarantee 列的逐字 `[平台:darwin]`/`[平台:linux]` 标该行只在那个平台适用;不适用平台上
# **仍然真跑**该文件并要求它自报 0 条(bun 1.3.14 实测:整文件 describe.skip ⇒
# `0 pass … Ran N tests across 1 file` 且 exit 0)—— 标注不是免检牌:该跑的文件被误标
# ⇒ 本平台 >0 条当场红;文件被删 ⇒ 匹配 0 个文件当场红。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT/scripts/gate-files.tsv"

usage() {
  cat <<'EOF'
用法:bash scripts/assert-gate-files.sh [--update|--help]

(无参数)  逐条跑登记簿,断言每个闸门文件「在位、绿、恰好跑了登记的条数」。
           条数少了 = 有用例被删/清空/skip;多了 = 新增用例未登记(未登记 = 可被静默
           删除)。两个方向都当场红。

--from-reports <目录>
           不再逐个重跑:从 bin/check 第 [5/14] 步写下的 junit 报告(`<step>.<layer>.xml`,见
           .gate-tests)读每个登记文件的条数,判定与逐个重跑相同 —— 文件不在报告里 = 没跑到 = 红;
           pass 条数与登记精确相等;条件行要求自报 0 条。门用这一档,于是每个测试文件每次门只跑一次。

PR 范围:CODEPUPPY_TEST_FILES 指向共享工具写出的仓库相对路径清单;判选中的登记文件,以及相对 merge-base 改动的登记行;后者未在报告中时按登记条数单独运行。
           未设置时(手动检查、--update、bin/check --full)判全部登记。

--update   从实测**自动写回**登记簿:逐条跑,全部绿之后把每行的登记条数改成实测值
           (all-or-nothing:任何一条测试失败就一条都不写回)。幂等 —— 登记与实测
           一致时零改动。给闸门文件加/删用例后跑这一条即可,让评审读 TSV 的 diff。
           测试文件已不在盘上的行:登记簿里必须已有一条同时含「退役」与 `<工作目录>/<路径>`
           的注释行(写明替代测试或理由),有就在写回时删掉这一行,没有就一次列出全部缺注释
           的行并中止(一行都不写回)。写回后打印新旧登记簿的 diff。检查模式不受影响:文件
           消失照样判红。

例外语法:登记簿第 1 列写 `>=N`(而不是 `N`)= 该行退回下界语义。例外必须具名:
           该行 guarantee 列必须含完整且理由有非空白字符的 `[例外:<理由>]`,否则判红。
           --update 不改写例外行
           的数字(例外行由人维护)。当前登记簿零范围例外(#844 勘破实测,条数逐
           commit 确定);平台条件闸(见下)不算范围例外。

平台条件闸:guarantee 列含逐字 `[平台:darwin]` / `[平台:linux]`(至多一个,不与 `>=N` 叠加)
           = 该行只在那个平台适用(`#1153`)。适用平台照常精确条数;不适用平台仍真跑该文件
           并要求它**自报 0 条** —— 标注不是免检牌:该跑的文件被误标 ⇒ >0 条当场红;文件
           被删 ⇒ 匹配 0 个文件当场红。--update 在不适用平台对这类行只验证、不测量、不写回。

退出码三档:0 = 全部适用行已验证;1 = 真失守,拦住;2 = 门绿但存在「本平台不适用」行
           (本次运行不构成那几行的证据,消费方记「未验证」不拦;--help 与参数错误也用 2,
           仅人手可达 —— 门的调用方不带参数)。

文档:docs/runbooks/ci.md「闸门文件点名」一节。
EOF
}

MODE=check
REPORTS=""
case "${1:-}" in
  --help|-h) usage; exit 0 ;;
  --update) MODE=update; shift ;;
  --from-reports)
    [ -n "${2:-}" ] && [ -d "$2" ] || { echo "::error::--from-reports 要一个存在的报告目录:${2:-<缺>}" >&2; exit 2; }
    REPORTS="$2"; shift 2 ;;
  '') ;;
  *) echo "::error::未知参数:$1" >&2; usage >&2; exit 2 ;;
esac
[ "$#" -eq 0 ] || { echo "::error::多余参数:$*" >&2; usage >&2; exit 2; }

out_of_scope=0
registered=0
if [ -n "${CODEPUPPY_TEST_FILES:-}" ] && [ ! -f "$CODEPUPPY_TEST_FILES" ]; then
  echo "::error::selected test list missing:$CODEPUPPY_TEST_FILES" >&2
  exit 1
fi

[ -f "$MANIFEST" ] || { echo "::error::闸门登记簿缺失:$MANIFEST"; exit 1; }

failed=0
checked=0
updates="$(mktemp)"
countfile="$(mktemp)"
seenfile="$(mktemp)"
retired="$(mktemp)"
reported="$(mktemp)"
changed_rows="$(mktemp)"
registry_diff="$(mktemp)"
trap 'rm -f "$updates" "$countfile" "$seenfile" "$retired" "$reported" "$changed_rows" "$registry_diff"' EXIT
# PR 的登记行本身也是输入:仅改条数不能等到夜间才发现。包括已提交、暂存和未暂存的行改动。
if [ -n "${CODEPUPPY_TEST_FILES:-}" ] && [ "$MODE" = check ]; then
  base="$(git -C "$ROOT" merge-base origin/alpha HEAD 2>/dev/null)" || { echo "::error::无法量出登记簿的 merge-base —— 本次测量作废"; exit 1; }
  git -C "$ROOT" diff --no-ext-diff --unified=0 "$base" -- scripts/gate-files.tsv > "$registry_diff" || { echo "::error::无法量出登记簿改动行"; exit 1; }
  awk -F'\t' '/^\+\+\+/{next} /^\+/{sub(/^\+/, ""); if ($0 !~ /^#/ && NF >= 3) print $2 "/" $3}' "$registry_diff" > "$changed_rows"
fi
if [ -n "$REPORTS" ]; then
  python3 "$ROOT/scripts/junit-file-counts.py" "$REPORTS" > "$reported" || { echo "::error::读不了测试报告目录 $REPORTS"; exit 1; }
fi

# --from-reports:<workdir> <path> <期望 =N|N|=0> → 报告里该文件的 pass 条数与期望相符则 0;不符 / 没跑到 / 跑了两次 ⇒ 1。
report_check() {
  local w="$1" p="$2" spec="$3" rows pass fail
  rows="$(awk -F'\t' -v w="$w" -v p="$p" '$1 == w && $2 == p' "$reported")"
  if [ -z "$rows" ]; then
    echo "::error::$w/$p 不在本次测试报告里 —— 文件被删 / 改名 / 没被 [5/14] 跑到"; return 1
  fi
  if [ "$(printf '%s\n' "$rows" | wc -l | tr -d ' ')" -ne 1 ]; then
    echo "::error::$w/$p 在报告里出现了不止一次 —— 同一文件被两组跑了"; return 1
  fi
  pass="$(printf '%s' "$rows" | cut -f3)"; fail="$(printf '%s' "$rows" | cut -f4)"
  echo "── 报告:pass $pass · fail $fail · 期望 $spec"
  [ "$fail" -eq 0 ] || { echo "::error::$w/$p 有 $fail 条失败"; return 1; }
  case "$spec" in
    =*) [ "$pass" -eq "${spec#=}" ] || { echo "::error::$w/$p 实际 $pass 条 ≠ 登记 ${spec#=} 条。刻意增删用例后跑 bash scripts/assert-gate-files.sh --update 写回。"; return 1; } ;;
    *) [ "$pass" -ge "$spec" ] || { echo "::error::$w/$p 实际 $pass 条 < 下界 $spec 条"; return 1; } ;;
  esac
}

# I-09:--update 遇到已删的测试文件不再在第一条就中止 —— 先把它们一次找全。理由不由工具代写:
# 每一行都要求人已经在登记簿里写了退役注释(「退役」+ `<工作目录>/<路径>`,同一行),有注释的行
# 写回时删掉,缺注释的一次列全后中止。检查模式不走这里:文件消失仍由下面的逐条点名判红(保证 G1)。
if [ "$MODE" = update ]; then
  missing_notes=""
  while IFS=$'\t' read -r floor workdir path _rest || [ -n "${floor:-}" ]; do
    case "${floor:-}" in ''|\#*) continue ;; esac
    [ -n "${workdir:-}" ] && [ -n "${path:-}" ] || continue
    [ -e "$ROOT/$workdir/$path" ] && continue
    if grep -E '^[[:space:]]*#' "$MANIFEST" | grep -F '退役' | grep -Fq -- "$workdir/$path"; then
      printf '%s\t%s\n' "$workdir" "$path" >> "$retired"
    else
      missing_notes="${missing_notes}  · $workdir/$path"$'\n'
    fi
  done < "$MANIFEST"
  if [ -n "$missing_notes" ]; then
    echo "::error::--update 中止:下列登记行的测试文件已不在盘上,登记簿里也没有它们的退役注释 —— 一行都不写回:"
    printf '%s' "$missing_notes"
    echo "  先在登记簿里为每一行写一条注释再重跑,例如:"
    echo "  # $(date +%Y-%m-%d) 退役(<票号>):<工作目录>/<路径>(<原条数>)。替代:<测试文件>「<用例名>」。无对应用例:<理由>"
    exit 1
  fi
fi

# `#1153`:平台条件闸的运行平台。词表 = process.platform 取值(登记标注用同一词表,
# 于是「登记的平台」与「测试文件自己 gate 的 process.platform」说的是同一种话)。
case "$(uname -s)" in
  Darwin) RUNTIME_PLATFORM=darwin ;;
  Linux)  RUNTIME_PLATFORM=linux ;;
  *)      RUNTIME_PLATFORM="$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
esac
na_count=0
na_names=""

while IFS=$'\t' read -r floor workdir path delegates guarantee || [ -n "${floor:-}" ]; do
  case "${floor:-}" in ''|\#*) continue ;; esac
  [ -n "${workdir:-}" ] && [ -n "${path:-}" ] || { echo "::error::登记簿格式错误:$floor $workdir $path"; failed=1; continue; }
  if [ "$MODE" = update ] && grep -Fqx -- "${workdir}"$'\t'"${path}" "$retired"; then
    echo "── retire $workdir/$path(测试文件已删,退役注释在册)—— 写回时删掉这一行"
    continue
  fi
  # delegates_to 默认拒:没有委派也必须显式写 `-`,留空即红。
  [ -n "${delegates:-}" ] || { echo "::error::$workdir/$path 的 delegates_to 列为空 —— 没有委派请显式写 '-'"; failed=1; continue; }

  # `(workdir,path)` 是登记簿主键。重复行会让 --update 的 awk 同时改写两行,甚至把人工维护的
  # `>=N` 例外静默改成精确数字;所有模式都先拒绝重复,写回保持 all-or-nothing。
  registry_key="${workdir}"$'\t'"${path}"
  if grep -Fqx -- "$registry_key" "$seenfile"; then
    echo "::error::登记簿重复路径:$workdir/$path —— (workdir,path) 必须唯一;否则 --update 会同时改写多行"
    failed=1
    continue
  fi
  printf '%s\n' "$registry_key" >> "$seenfile"

  # `#844`:`N` = 精确(默认);`>=N` = 具名例外(下界语义,理由必须写进 guarantee)。
  kind=exact
  spec="$floor"
  if [ "${floor#>=}" != "$floor" ]; then
    kind=range
    spec="${floor#>=}"
    if ! [[ "${guarantee:-}" =~ \[例外:([^][]*)\] ]] || ! [[ "${BASH_REMATCH[1]}" =~ [^[:space:]] ]]; then
      echo "::error::$workdir/$path 登记为范围例外($floor)但 guarantee 缺少完整且理由有非空白字符的 [例外:理由] —— 例外必须具名,不许静默退回下界"
      failed=1
      continue
    fi
  fi
  case "$spec" in
    ''|*[!0-9]*) echo "::error::$workdir/$path 的条数列非法:$floor"; failed=1; continue ;;
  esac
  if [ "$spec" -eq 0 ]; then
    echo "::error::$workdir/$path 的登记条数必须大于 0:$floor —— 空文件/零断言不能成为闸门"
    failed=1
    continue
  fi

  # `#1153`:平台条件标注。必须逐字合法且一行至多一个 —— 写歪不静默退化成普通行(默认拒:
  # 一个被打错的标注若被当普通行跑,在不适用平台上就是恒红;若被当不适用跳过,就是静默放行)。
  platform=""
  case "${guarantee:-}" in
    *"[平台"*)
      malformed=1
      if [[ "${guarantee:-}" =~ \[平台:(darwin|linux)\] ]]; then
        platform="${BASH_REMATCH[1]}"
        rest="${guarantee/\[平台:${platform}\]/}"
        case "$rest" in
          *"[平台"*) ;;
          *) malformed=0 ;;
        esac
      fi
      if [ "$malformed" -ne 0 ]; then
        echo "::error::$workdir/$path 的 [平台:…] 标注不合法 —— 只认逐字 [平台:darwin] / [平台:linux],且一行至多一个"
        failed=1
        continue
      fi
      if [ "$kind" = range ]; then
        echo "::error::$workdir/$path 同时登记了 [平台:$platform] 与范围例外($floor)—— 平台条件行只支持精确条数,不叠加下界语义"
        failed=1
        continue
      fi
      ;;
  esac

  # Local signing is release evidence, explicitly opted in; ordinary gates still verify the host self-skips.
  manual=""
  case "${guarantee:-}" in
    *"[环境"*)
      if [[ "$guarantee" == *"[环境:CODEPUPPY_TEST_SIGNED_FENCE=1]"* ]] && [ "$workdir/$path" = "packages/ui-mac/src/main/process-fence-extension-packaged.test.ts" ] && [ "$kind" = exact ]; then
        manual="CODEPUPPY_TEST_SIGNED_FENCE=1"
      else
        echo "::error::$workdir/$path 的环境条件非法:只允许签名围栏宿主显式 CODEPUPPY_TEST_SIGNED_FENCE=1"
        failed=1
        continue
      fi
      ;;
  esac

  registered=$((registered + 1))
  row_reports="$REPORTS"
  if [ -n "${CODEPUPPY_TEST_FILES:-}" ] && ! grep -Fqx "$workdir/$path" "$CODEPUPPY_TEST_FILES"; then
    if grep -Fqx "$workdir/$path" "$changed_rows"; then
      echo "── 登记行已改动:$workdir/$path(未被 affected-tests 选中,按登记条数单独运行)"
      row_reports=""
    else
      echo "── 本次范围外:$workdir/$path(未被 affected-tests 选中)"
      out_of_scope=$((out_of_scope + 1))
      continue
    fi
  fi

  checked=$((checked + 1))

  # 平台或显式发布条件未满足。标注不是免检牌 —— 真跑该文件,要求它**自报 0 条**
  # (在位、恰好匹配 1 个文件、bun exit 0、0 pass;bun-test-floor.sh 的 =0 精确模式四者全断)。
  # 两个方向都抓:该跑的文件被误标 ⇒ 本平台 >0 条 ⇒ 红;文件被删 ⇒ 匹配 0 个文件 ⇒ 红。
  if { [ -n "$platform" ] && [ "$platform" != "$RUNTIME_PLATFORM" ]; } || { [ -n "$manual" ] && [ "${CODEPUPPY_TEST_SIGNED_FENCE:-}" != "1" ]; }; then
    echo "── [$checked] $workdir/$path (登记 $floor,[平台:$platform],本平台 $RUNTIME_PLATFORM,显式条件 ${manual:-无})"
    if { [ -n "$row_reports" ] && report_check "$workdir" "$path" "=0"; } || { [ -z "$row_reports" ] && bash "$ROOT/scripts/bun-test-floor.sh" "=0" "$workdir" "$path"; }; then
      echo "   ⊘ 本次未验证:文件在位且自报 0 条,与 [平台:$platform] / ${manual:-无额外条件} 相符 —— 该行的保证本次未被验证"
      na_count=$((na_count + 1))
      na_names="${na_names:+$na_names, }$workdir/$path"
    else
      echo "::error::$workdir/$path 的条件 [平台:$platform] / ${manual:-无额外条件} 与实测不符:本次不应执行却自报 >0 条,或文件已删/损坏(见上方输出)。不得删条件避红。"
      if [ "$MODE" = update ]; then
        echo "::error::--update 中止:条件标注与实测不符 —— all-or-nothing,一条都不写回"
        exit 1
      fi
      failed=1
    fi
    continue
  fi

  if [ "$MODE" = update ]; then
    # 例外行照旧判下界(--update 不放松任何既有判定);精确行只要求绿,量到多少写多少。
    run_spec="0"
    [ "$kind" = range ] && run_spec="$spec"
    echo "── [$checked] measure $workdir/$path (登记 $floor)"
    : > "$countfile"
    if ! CODEPUPPY_TEST_COUNT_FILE="$countfile" bash "$ROOT/scripts/bun-test-floor.sh" "$run_spec" "$workdir" "$path"; then
      echo "::error::--update 中止:$workdir/$path 测试失败 —— all-or-nothing,一条都不写回"
      exit 1
    fi
    measured="$(cat "$countfile")"
    case "$measured" in
      ''|*[!0-9]*) echo "::error::--update 中止:$workdir/$path 没量到条数(CODEPUPPY_TEST_COUNT_FILE 空)"; exit 1 ;;
    esac
    if [ "$measured" -eq 0 ]; then
      echo "::error::--update 中止:$workdir/$path 实测 0 条 —— 文件被清空/路径写歪不允许被写回成 0"
      exit 1
    fi
    if [ "$kind" = exact ] && [ "$measured" != "$spec" ]; then
      printf '%s\t%s\t%s\n' "$workdir" "$path" "$measured" >> "$updates"
      echo "   ↳ 将写回:$spec → $measured"
    fi
    continue
  fi

  call_spec="=$spec"
  [ "$kind" = range ] && call_spec="$spec"
  echo "── [$checked] $workdir/$path (登记 $floor, 委派 ${delegates}) — ${guarantee:-}"
  if [ -n "$row_reports" ]; then
    report_check "$workdir" "$path" "$call_spec" || { echo "::error::闸门文件失守:$workdir/$path — ${guarantee:-}"; failed=1; }
    continue
  fi
  if ! bash "$ROOT/scripts/bun-test-floor.sh" "$call_spec" "$workdir" "$path"; then
    echo "::error::闸门文件失守:$workdir/$path — ${guarantee:-}"
    failed=1
  fi
done < "$MANIFEST"

# 空登记簿 / 解析全挂 = 本脚本自己变成空闸门。显式判红。
if [ "$out_of_scope" -gt 0 ]; then
  echo "── $out_of_scope 个登记文件在本次选择范围之外(见上),本次不判"
fi
if [ "$registered" -lt 25 ]; then
  echo "::error::只登记了 $registered 个闸门文件(至少应有 25 个)——登记簿被清空或解析失败"
  exit 1
fi

if [ "$MODE" = update ]; then
  # `#844` R3(Codex 三审):行级校验红(格式坏行/委派列空/例外无理由/条数列非法)以前只置
  # failed=1 就 continue,而本分支在写回/报成功前从不看它 —— 非法行被静默跳过、其余行照写照
  # 报 exit 0,破 all-or-nothing。校验红 = 登记簿本身坏了,一条都不许写回。
  if [ "$failed" -ne 0 ]; then
    echo "::error::--update 中止:登记簿存在非法行(见上方 ::error::)—— 先修登记簿,all-or-nothing,一条都不写回"
    exit 1
  fi
  if [ ! -s "$updates" ] && [ ! -s "$retired" ]; then
    if [ "$na_count" -gt 0 ]; then
      echo "✓ 登记簿与实测一致($((checked - na_count)) 条;另 $na_count 条平台条件闸本平台不适用 —— 已验证自报 0 条,未测量、未改动),零改动"
    else
      echo "✓ 登记簿与实测一致($checked 条),零改动"
    fi
    exit 0
  fi
  awk -F'\t' -v OFS='\t' '
    FILENAME == ARGV[1] { gone[$1 FS $2] = 1; next }
    FILENAME == ARGV[2] { m[$1 FS $2] = $3; next }
    /^[[:space:]]*#/ || NF < 3 { print; next }
    { key = $2 FS $3; if (key in gone) next; if (key in m) $1 = m[key]; print }
  ' "$retired" "$updates" "$MANIFEST" > "$MANIFEST.tmp"
  diff -u --label "gate-files.tsv(写回前)" --label "gate-files.tsv(写回后)" "$MANIFEST" "$MANIFEST.tmp" || true
  mv "$MANIFEST.tmp" "$MANIFEST"
  echo "✓ 已按实测写回 $(wc -l < "$updates" | tr -d ' ') 行、删掉 $(wc -l < "$retired" | tr -d ' ') 行已退役的登记;上面是 diff,重跑 bash scripts/assert-gate-files.sh 复核"
  exit 0
fi

[ "$failed" -eq 0 ] || exit 1
if [ "$na_count" -gt 0 ]; then
  # 第三档:门绿,但平台/显式发布条件行的保证本次未验证 —— 总结不许说「全部」,退出码 2
  # 供消费方(codepuppy-check [6/10] / codepuppy-ci 的 assert gate files 步)记「未验证」不拦。
  echo "⚠️  $((checked - na_count)) 个闸门文件在位且真的跑过(条数与登记精确一致);另 $na_count 个条件闸的保证本次未验证 —— 已验证其自报 0 条与条件标注相符:$na_names"
  exit 2
fi
echo "✓ $checked 个闸门文件全部在位且真的跑过(条数与登记精确一致)"
