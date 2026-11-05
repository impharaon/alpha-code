---
title: Mac release runbook (signing, notarization, auto-update)
kind: runbook
status: active
owners:
  - Code Puppy maintainers
last_reviewed: 2026-11-04
review_after: 2026-11-16
---

# 发版 runbook — Code Puppy Mac(签名 · 公证 · 自动更新)

> 权威发版文档。把 Code Puppy(opencode 引擎 + 自有前端/后端)打成**你自己**的、签名+公证、可分发给 Apple 芯片 Mac 的 app,并经 GitHub Release 走自动更新。
> 首个签名+公证发布:**v0.1.0**(2026-07-03,`jinjunnn/alpha-code`),下述流程即由它验证。
> 卸载与数据残留:见 [uninstall.md](uninstall.md)(C16;app 内入口 = 数据 ▸ 清除数据…)。

## 0. 前置(已就绪,一次性)

**签名/公证凭证**(**不在仓库**,`~/.codepuppy-signing/` 0600 —— 见该目录 README):
- `Developer ID Application` 证书(team **RQX6X6A635** = Beijing yuanyuji,与 tideapp 同 team),已装登录钥匙串,`codesign` 已授「始终允许」→ 打包不再弹钥匙串框。全链 verify 通过。备份 `devid-backup.p12`(口令见 README)+ **已另存 iCloud**。
- `AuthKey_Y69LXQA5B4.p8`(App Store Connect API key,`开发者` 角色,公证用,**只能下一次**)。
- `signing.env` 导出 `CODEPUPPY_SIGN=1` + `APPLE_API_KEY`/`APPLE_API_KEY_ID`/`APPLE_API_ISSUER` + `APPLE_TEAM_ID`。

**签名目录与变量名的一次性改名(#1570 之后的第一次发版前做一次)**:目录原名 `~/.alpha-code-signing/`,
`signing.env` 里原来是 `ALPHA_SIGN` / `ALPHA_SIGN_IDENTITY` / `ALPHA_MAC_SIGN_IDENTITY`。旧变量名不会被读到,
本地打包会**静默**产出未签名的包,所以 `electron-builder.config.ts` 见到任何一个旧名就直接拒绝打包。
`signing.env` 的值里也有旧目录路径(如 `.p8` 的路径),目录改名时必须一起替换,否则公证仍会找旧路径。
下面只改名字与路径,不读、不打印任何值:

```sh
set -e
[ -d ~/.alpha-code-signing ] && [ ! -e ~/.codepuppy-signing ] && mv ~/.alpha-code-signing ~/.codepuppy-signing
sed -i '' -E 's/(^|[^A-Za-z0-9_])ALPHA_(SIGN|SIGN_IDENTITY|MAC_SIGN_IDENTITY)=/\1CODEPUPPY_\2=/' ~/.codepuppy-signing/signing.env
sed -i '' 's/\.alpha-code-signing/.codepuppy-signing/g' ~/.codepuppy-signing/signing.env
grep -cE '(^|[^A-Za-z0-9_])ALPHA_|\.alpha-code-signing' ~/.codepuppy-signing/signing.env || true   # 只数行数,应为 0
```

**打包配置**(`packages/ui-mac/electron-builder.config.ts` + `scripts/*`,零改上游):
- prod/beta productName `Code Puppy`、appId `com.tide.codepuppy`(dev/beta 加后缀)、Electron 应用名 `Code Puppy` / `Code Puppy Beta` / `Code Puppy Dev`(决定钥匙串条目名)、登录 URL scheme `codepuppy`、artifact `codepuppy-*`。
- 更新源 = 自有 public repo `jinjunnn/alpha-code`(prod=`latest` 渠道,beta=`beta`),**不是** `anomalyco/opencode`。
- `CODEPUPPY_SIGN=1` → Developer ID 签名 + 公证;否则 ad-hoc(仅本机双击)。
- `notarize` 是 boolean(electron-builder 26.x);team/凭证走 env。
- prebuild 会 `patch-server-version.ts` 把内嵌 server 的 `InstallationVersion` 从 `local` 改成真实版本(A4:否则 `@opencode-ai/plugin@local` 装不上,带 `.opencode` 插件的项目首个请求卡住)。

## 1. 发一个版本(权威步骤)

从 0.1.26 起只出 Apple 芯片(arm64)Mac 包(#1496)。在 arm64 打包机上照下列步骤执行;
mac 打包配置只接受 arm64 目标,误设其它架构会在配置解析时直接报错。

### ⓪ 取得最新主线的检出

版本号、catalog 与 extension seed 等发版改动先经发版 PR 合并到 `alpha`,再从最新主线创建干净检出并在其中打包:

```bash
git fetch origin alpha
git worktree add --detach <路径> origin/alpha
cd <路径>
```

beta/prod 签名包在 `beforePack` 开始时会先 fetch 并核对:有未提交改动(含未跟踪文件)、HEAD 与
`origin/alpha` 不同、或 fetch 失败都会拒绝,列出改动文件或差异提交。`produce --channel prod|beta`
会再核对一次;打包途中主线前进也会拒绝生成 manifest。被拒后先处理列出的改动或 fetch 故障,
同步到最新主线,从 build 开始重新打包,再跑 `produce`;不要绕过检查或沿用旧包。dev 与未签名打包不受影响。

```bash
# 前端合并复验(REQ-012,546-sync 静默回归教训——v0.1.0 就是跳过这步翻的车):
#    a. cd packages/ui-mac && bun test src/renderer/codepuppy-ui/upstream-anchors.test.ts   # 锚点契约必须绿
#    b. CDP 截图关键屏(首页/会话/模型卡/composer/时间线)对上一版基线肉眼比对(visual-verify-required)
#    上游 sync 后未做过 a+b 的树,禁止打 tag。

# ①′ 刷新内置 catalog 快照(REQ-046):cd packages/ui-mac && node scripts/sync-catalog-snapshot.mjs
#    (拉已发布 catalog + 验签 + 字节快照;codepuppy-catalog.json 禁手编 —— 单测守卫,手编即红。
#     上架/撤架条目一律在 alpha-web catalog-src 操作,联网用户即时生效,发版只是刷新离线底座。)
# ①′′ 刷新随包 extension seed(REQ-102):node scripts/sync-extension-seed.mjs
#    (同样走 trust→stable→payload 全链验签,并与上一步 catalog 字节互钉;resources/extension-seed 禁手编。
#     离线演练可用 --from-dir <alpha-web checkout>,但仍必须验签。脚本连跑两次后 git diff 必须不再变化。)
# ① 版本号:改 packages/ui-mac/package.json 的 "version"(语义真源;About/崩溃屏/updater 都读它)
#    例:0.1.19 → 0.1.20。用真实 semver,别回 0.0.0。
# ①a 同一个字面量还被抄在**另外三处**,必须同批抬(`#1255`:0.1.10 那次只抬了真源,于是两条
#    consumer-pin 断言在 alpha 基线上恒红了两天,与任何人的改动无关,并诱发 `--no-verify`):
#      · packages/codepuppy-contracts-consumer/fixtures/consumers/alpha-code-640/ledger-page.json 的 consumer_version
#      · packages/codepuppy-contracts-consumer/fixtures/consumers/alpha-code-1556/model-catalog-v3.json 的 consumer_version
#        (这两格是 alpha-platform 的 cutover gate 读的「本仓已切到哪一版」)
#      · bun.lock 里 workspaces["packages/ui-mac"].version —— **不要手改**,在仓根跑一次
#        `HUSKY=0 bun install` 让 bun 自己写回(HUSKY=0:不让 husky 的 prepare 改写共享 `.git/config`
#        的 core.hooksPath —— worktree 与主检出共用这一份配置);漏掉它,之后每一次 bun install(含 worktree-bootstrap.sh)
#        都会把工作树弄脏。注意 `bun install --frozen-lockfile` **不**报这个不一致(实测 exit 0)。
#    别照这段清单手工核对 —— 跑判据:
#      bun test --cwd packages/ui-mac src/main/shipped-version-propagation.test.ts
#    它枚举全部 consumer-pin 夹具 + bun.lock,把所有没跟上的格子连同改法一次打出来。

# ② 打签名+公证包(package:mac,不装机)
source ~/.codepuppy-signing/signing.env               # CODEPUPPY_SIGN=1 + Apple 凭证
cd packages/ui-mac
OPENCODE_CHANNEL=prod bun run build                     # prebuild(含 A4 patch)+ 渲染/主进程
OPENCODE_CHANNEL=prod bun run package:mac               # 签名 → 上传 Apple 公证(在线,几分钟)→ dmg/zip

# ③ 验证产物真的签名+公证了(必须都过)
xcrun stapler validate "dist/mac-arm64/Code Puppy.app"    # 期望 "The validate action worked!"
spctl -a -vvv -t install "dist/mac-arm64/Code Puppy.app"  # 期望 "accepted / source=Notarized Developer ID"
ls dist/codepuppy-mac-arm64.dmg dist/codepuppy-mac-arm64.zip dist/latest-mac.yml   # 三件齐

# ③′ 产签名 release manifest(#175;契约 docs/contracts/desktop-release-manifest.md)。
#    从最终 dist 字节计算全部事实(size/digest/签名/公证/SBOM/updater metadata),任何缺失或
#    不一致会打印全部错误并 exit 1 —— 此时**禁止发布**,先修再重打。含 Windows 产物时,把
#    codepuppy-windows-build 的两个 artifact(exe/blockmap 与 *-release-facts)解到一个目录,
#    加 --windows-dir <目录>。默认 beta/prod 未签名 Windows 包在 CI 就已经红了,到不了这一步；
#    REQ-106 唯一例外是经 owner 明确批准的 prod 手动下载包,必须额外传
#    --allow-unsigned-windows。该 flag 会把 installer 标为 manualDownloadOnly、保留其
#    NotSigned facts 和 digest binding、并排除 Windows updater feed；不得用于 beta 或正常更新发布。
#    签名私钥:~/.codepuppy-signing/release-manifest-ed25519.pem(没有则先
#    `bun scripts/release-manifest.ts keygen --out <该路径>` 并把打印的 trust entry 落进
#    docs/contracts/desktop-release-manifest.trust.json)。
OPENCODE_CHANNEL=prod bun scripts/release-manifest.ts produce \
  --channel prod --dist dist \
  --key ~/.codepuppy-signing/release-manifest-ed25519.pem
# 期望:"[release-manifest] OK: …/codepuppy-release-manifest.json (+.sig)";产物三件:
# dist/codepuppy-release-manifest.json + .sig + dist/codepuppy-<版本>-sbom.cdx.json
# 同时打印 "source commit: <完整 SHA>";④ 的 --target 使用这个 SHA。

# REQ-106 Windows x64 未签名手动下载(仅在已有明确批准、已下载 Windows runner 的最终
# installer + signing facts、且官网已经部署 unsigned warning 时):
OPENCODE_CHANNEL=prod bun scripts/release-manifest.ts produce \
  --channel prod --dist dist --windows-dir /absolute/path/to/windows-release-inputs \
  --allow-unsigned-windows \
  --key ~/.codepuppy-signing/release-manifest-ed25519.pem
# 上传时包含 codepuppy-win-x64.exe,但不上传 latest.yml,也不得让它进入自动更新测试。

# ④ 发 GitHub Release(dmg + zip + 两个 .blockmap + latest-mac.yml + manifest 三件一起传,
#    tag = v<版本>)。manifest 是 alpha-web 消费的唯一发布真相,漏传 = 该版本对 web 不存在。
cd dist
gh release create v0.1.25 \
  codepuppy-mac-arm64.dmg codepuppy-mac-arm64.zip \
  codepuppy-mac-arm64.dmg.blockmap codepuppy-mac-arm64.zip.blockmap \
  latest-mac.yml \
  codepuppy-release-manifest.json codepuppy-release-manifest.json.sig \
  codepuppy-0.1.25-sbom.cdx.json \
  --repo jinjunnn/alpha-code --target <produce 打印的 source commit 完整 SHA> \
  --title "Code Puppy 0.1.25" --notes "……"

# ⑤ 确认自动更新 feed 通(electron-updater 就读这个 URL)
curl -sL -o /dev/null -w "%{http_code}\n" \
  https://github.com/jinjunnn/alpha-code/releases/latest/download/latest-mac.yml   # 期望 200
```

**要点**
- `latest-mac.yml` 里的文件名必须与上传的 asset 名**逐字一致**(electron-builder 自动生成,勿改名)。
- Release **不能是 draft/prerelease**(否则 `latest` 渠道拉不到)。tag 用 `v<version>`。
- `--target`:tag `v<version>` 必须指向 **`produce` 打印的 `source commit` 完整 SHA**(就是 ②③ 打包时检出的来源提交),
  不写 `--target alpha` —— 合并之后 alpha 可能已经前进,按分支名打会把 tag 打在包里没有的代码上。
  发布前核对:`produce` 打印的 SHA 与 `--target` 逐字相同。
- 从 Release 下载 `codepuppy-<版本>-sbom.cdx.json`,读取 `metadata.properties` 中
  `codepuppy:release:source-commit` 的 `value`,就是该发布物的来源提交;例如:
  `jq -r '.metadata.properties[] | select(.name == "codepuppy:release:source-commit") | .value' codepuppy-<版本>-sbom.cdx.json`。
- 只想本机自己用、不分发 → 用 `bun run ship:mac`(= build + package + 装到 `/Applications`);发布用 `package:mac`(只出产物,不动你在用的 app)。

### 应用身份切换的那一版(#1571):只能手动安装

这一版把 bundle id 换成 `com.tide.codepuppy`、Electron 应用名换成 `Code Puppy`(钥匙串条目随之改名迁移)。
发版步骤与上面相同,但**已装的旧版不会自动更新到它**:Squirrel 只在 bundle identifier 相同时更新。发布说明与给用户的
安装指引必须写清下面四条:

1. **先退出所有渠道**(正式版、Beta、开发版都退出)再安装。另外两个渠道还在运行时,新版不做
   数据与钥匙串迁移;旧版开着时打开新版,新版会直接退出。
2. **手动安装**:下载 dmg,把 `Code Puppy.app` 拖进「应用程序」替换旧的那个(包名没有变),再从「应用程序」打开。
3. **首次启动会弹钥匙串授权框**:改名本身不弹框(第 0b 步实测),弹框出现在新版第一次读取那条钥匙串记录时,
   框上的记录名可能仍显示旧名。选「**始终允许**」。选了拒绝,新版会把钥匙串记录名改回去、退回全部迁移并退出,
   不会丢登录信息;重开时再选「始终允许」。
4. **系统授权要重新允许**:辅助功能、屏幕录制、自动化等授权按 bundle id 记,新 id 等于新应用 —— 到
   「系统设置 › 隐私与安全性」里重新打开对应开关。

**如果新版弹出「钥匙串里已有一条『Code Puppy Safe Storage』记录……请按升级说明处理后重开」**:说明钥匙串里
新旧两条记录同时存在,新版为避免覆盖停下了,这次没有改动任何数据。处理方法:

1. 退出所有 Code Puppy(新旧版本、各渠道都退出)。
2. 打开「钥匙串访问」,在「登录」钥匙串里搜索 `Code Puppy Safe Storage`,删掉**名字正是 `Code Puppy Safe Storage`
   的那一条**(新名字那条)。名字里是旧品牌的那条**不要动**。
3. 重新打开新版:它会把旧的那条改名接上,首启授权框照第 3 条选「始终允许」。

为什么删新名字那条不会丢数据:迁移完成过的机器不会走到这条提示(完成标记在就整段跳过;只有新名字那条、没有旧的
那条时也直接放行)。走到这里时,旧的那条还在、迁移还没完成过 —— 登录信息、BYOK 密钥和网页登录状态都是用旧的那条
里的密钥加密的;新名字那条是新版在迁移之前生成的随机密钥(例如更早的测试包在旧版开着时被打开过),没有任何已存数据
用它加密。

**开发版(dev 渠道,含本机 `bun run dev`)不迁移,改用 `Code Puppy Dev Safe Storage`**:以前开发版与正式版共用同一条
钥匙串记录,开发版若也迁移,会把正式版那条改成开发版的名字。所以开发版里已存的登录信息与 BYOK 密钥在新名字下第一次
启动会解不开一次(网页登录状态同样丢失),需要重新登录、重新填 BYOK 密钥;正式版与 Beta 不受影响。这是方案 §10 的
既定取舍。

装完验收(票面 AC7):不用重新登录、BYOK 密钥可用、网页登录状态还在;钥匙串弹了几次框、TCC 怎样重新授权,
照实记进本版的验证记录(`docs/verification/`),不承诺无弹窗。

## 2. 随包运行时与原生模块

### 随包 Office 运行时(#1564)

Word / Excel / PowerPoint / PDF 四个文档工具的命令是 `<Resources>/office-runtime/bin/python3 -I -B <Resources>/office-mcp/server.py <格式> {workspace}`
—— 不要用户装 uv,也不在第一次使用时下载依赖。`office-runtime/` 由 `packages/ui-mac/scripts/build-office-runtime.ts`
在 prebuild 里按目标架构产出(落 `native/office-runtime/build/<arch>/`,gitignore;extraResources 只装目标架构那一份):

- 钉版:`resources/office-runtime/requirements.in`(五个顶层包)、`requirements-arm64.lock` / `requirements-x64.lock`
  (完整传递闭包 + sha256,文件头记着生成命令 `uv pip compile … --python-platform <triple> --generate-hashes`;
  升级任何一个包就重跑这两条)、`office-runtime.lock`(python-build-standalone CPython 的 URL + sha256,以及闭包的依赖图)。
  闭包是否完整由 `src/main/office-runtime-lock.test.ts` 判。
- 构建:下载并校验运行时 → `pip install --no-compile --require-hashes --only-binary=:all:` → `pip check` → 已装版本与依赖图逐项对 lock →
  删 `test/`、`tkinter`、`idlelib`、`ensurepip`、`pip` 与 pip 写进 `bin/` 的脚本 → `compileall -f -s <staging>`(unchecked-hash;`.pyc` 里不留构建机路径)。lock 与脚本都没变时复用上次产物。
  下载缓存在 `~/Library/Caches/codepuppy/office-runtime/`(运行时,本机所有 worktree 共用,命中仍按 sha256 核验)与 pip 自己的缓存(轮子)。
- 验证(每次构建都跑,任何一项不过即失败):每个 Mach-O 含目标架构片、没有任何文件带着构建机的 staging 路径、随包解释器 `-I` 逐个 import 闭包里的顶层模块、
  按生产命令形状驱动 `server.py` 四种格式各写一个样例文件再读回。x64 在 arm64 打包机上经 Rosetta(`arch -x86_64`)
  执行同样的安装与验证;没装 Rosetta 时构建直接失败(`softwareupdate --install-rosetta`),不会跳过。
- beforePack 同样核对 `office-runtime/` 下每个 Mach-O 含目标架构片;签名时 electron-builder 把它们与其它内嵌二进制
  同 Team 深签(entitlements 不变)。签名后能否运行、干净账户(无 Homebrew / uv)里四格式读写,归发版回归 T23。

构建日志里的体积行(2026-10-30,CPython 3.11.15 + 11 个发行包,本机未签名构建实测):

```
[alpha:office-runtime] arm64: 111.2 MB (4750 files, 48 Mach-O, 11 top-level modules imported, 4 formats round-tripped)
[alpha:office-runtime] x64: 104.4 MB (4750 files, 48 Mach-O, 11 top-level modules imported, 4 formats round-tripped)
```
本仓 CI 与开发机都没有 x86_64 运行时,Mach-O 架构检查只证明**装进去的片对**,不证明跑得起来。

**进程围栏的原生模块**(REQ-159 `#1321`):`prebuild` 里的
`scripts/build-fence-addon.ts` 一次编出 **fat** 的 `native/codepuppy-fence/build/codepuppy_fence.node`(arm64 + x86_64
同一个文件),编完逐片判 —— `lipo -archs` 缺任一片、或某一片没有 N-API 入口 ⇒ 删产物、构建红。它经
`extraResources` 落到 `Contents/Resources/codepuppy-fence/codepuppy_fence.node`,由流水线深签(与 `pty.node` 同 Team)。
漏了它的包**起不了引擎**(main 拒 fork / sidecar 拒启动,原因可读),不会静默无围栏。
未验证:x86_64 那一片没有被执行过(本机只有 arm64 运行时)。

## 3. 排障 / 已知项
- **打包时弹「codesign 想访问密钥」**:点「**始终允许**」+ 输 Mac 登录密码(不是「允许」——那样每个文件都弹)。授权后长期免弹。若换机后又弹:`security import ~/.codepuppy-signing/devid-backup.p12`(口令 README)。
- **公证失败**:多为凭证/网络。`signing.env` 的 `APPLE_API_*` 是否正确;`.p8` 文件在否;换机后重新 source。API key 是 `开发者` 角色即够公证。
  上传卡住或超时时(0.1.25 踩坑),手动禁用 S3 加速重新提交;打包流水线仍走 electron-builder 内置公证:

  ```sh
  xcrun notarytool submit <文件> --no-s3-acceleration \
    --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER" --wait
  # 返回 Accepted 后,给这次提交对应的 .app / dmg 附上公证票,再回 §1 ③ 验证:
  xcrun stapler staple <对应的.app或.dmg>
  ```

- **A4 已修**:`patch-server-version.ts` 已把 InstallationVersion 从 `local` 改真实版本(v0.1.0 打包实测生效)。若 prebuild 日志出现 `[alpha:patch-server-version] … not found`,说明上游改了那行表达式 → 去更新该脚本(否则 A4 复发)。
- **首个 Release 前**已装 app 检查更新会「无更新」= 正常。
- **appId(bundle id)变更**:userData 目录不跟它走(由 `main/index.ts` 的 `APP_IDS` 决定),会话与项目都在;
  但系统授权(TCC)按 bundle id 记,要重新允许;Squirrel 不跨 identifier 自动更新,那一版只能手动安装(见 §1「应用身份切换的那一版」)。

## 4. 下一个真实版本怎么发(TL;DR)

> ⚠️ **升版本不只改 `packages/ui-mac/package.json`。** 2026-09-28 发 v0.1.17 实测:
> 还有两处 consumer-pin 夹具的 `consumer_version` 必须同步到同一个版本号 ——
> `alpha-platform` 的 cutover gate 读这一格判本仓是否已切:
>
> - `packages/codepuppy-contracts-consumer/fixtures/consumers/alpha-code-640/ledger-page.json`
> - `packages/codepuppy-contracts-consumer/fixtures/consumers/alpha-code-1556/model-catalog-v3.json`
>
> 不同步 ⇒ `packages/codepuppy-contracts-consumer/src/contracts.test.ts`
> (`expect(pin.consumer_version).toBe(shipped.version)`)与
> `packages/ui-mac/src/main/shipped-version-propagation.test.ts` 当场红,push 被拦。
> `bun install` 会顺带把 `bun.lock` 里同一个 workspace 版本字段改掉,**那是该带的**,不是意外。
>
> ⚠️ **本节全部命令都在 `packages/ui-mac/` 下跑**,不是仓根 —— 仓根没有 `build` /
> `package:mac` / `scripts/release-manifest.ts`。照本节抄到仓根会得到
> `error: Script not found "build"` 与 `Module not found`。
改 `package.json` 版本 **+ 两处 consumer-pin 的 `consumer_version`**(见下方⚠️)→ `source signing.env && OPENCODE_CHANNEL=prod bun run build && OPENCODE_CHANNEL=prod bun run package:mac` → stapler/spctl 验证 → `bun scripts/release-manifest.ts produce --channel prod --dist dist --key ~/.codepuppy-signing/release-manifest-ed25519.pem`(拒绝即停,禁止绕过)→ `gh release create v<ver> …`(含 manifest+sig+SBOM)→ curl feed 得 200。签名→公证→feed 链 v0.1.0 已端到端验证;manifest 链自 #175 起为发布必经步骤。

**Windows(beta/prod)**:`codepuppy-windows-build.yml` 打包后自带 Authenticode 硬门 ——
未签名、签名不可验证、或 publisher 不在白名单(REQ-076 T3 采购落地前白名单为空 = 全拒)
⇒ job 红、不出 artifact。dev 渠道照旧出未签名内测包,但事实(status/publisher/sha256)
必须如实落进 `windows-signing-facts.json` 随 artifact 上传。

**唯一例外（REQ-106）**：当且仅当需要公开未签名的 Windows x64 手动下载时，用
`prod` 渠道并明确勾选 workflow_dispatch 的
`allow_unsigned_windows_manual_download`。该步骤会拒绝任何不是
`NotSigned`/无 publisher/无 thumbprint 的事实；发版机仍须使用
`--allow-unsigned-windows` 生成已签名清单。它不生成 Windows updater feed、不能自动更新，
官网必须在按钮旁披露「未签名、可能显示未知发布者、无自动更新」。见
[../contracts/desktop-release-manifest.md](../contracts/desktop-release-manifest.md) §5–6。

## 5. 硬化面(C27/C24,2026-07-04,S11 T6/T7)
- **Electron fuses**(`electron-builder.config.ts` electronFuses):`RunAsNode` / `NODE_OPTIONS` / node-inspect 三注入原语关闭;`EmbeddedAsarIntegrityValidation` + `OnlyLoadAppFromAsar` + `CookieEncryption` 开启。sidecar 走 utilityProcess 不受影响;全仓无 `ELECTRON_RUN_AS_NODE` 用法。
- **entitlements 收紧**(`resources/entitlements.plist`):移除 `disable-executable-page-protection`、`allow-dyld-environment-variables`、`disable-library-validation`(dylib 注入组合);保留 `allow-jit`/`allow-unsigned-executable-memory`(V8)+ `audio-input`。**若签名包 native 模块(node-pty/ghostty)加载失败 → 仅回补 `disable-library-validation` 一项并在此记账。**
- **打包态 CSP + 回环-only CORS**(C24,`renderer-security.ts`):排障逃生 `CODEPUPPY_CSP_DISABLE=1`。
- **引擎进程围栏**(REQ-159 `#1321`,2026-09-09):引擎 sidecar 在 import 引擎前用自己的 N-API 模块
  `sandbox_init` 把整个进程关进 seatbelt,派生的 shell / MCP / LSP / PTY 全部继承;可写集 = 工作区并集 +
  应用目录 + 引擎缓存根(`packages/ui-mac/src/main/process-fence-profile.ts`,唯一权威)。
  **失败形态是「引擎起不来 + 可读原因」,不是「没有围栏但照常服务」**:main 日志 `process fence plan FAILED …`
  或 sidecar 的 `process fence: …` 就是它。排障:①`Contents/Resources/codepuppy-fence/codepuppy_fence.node` 在不在、
  `lipo -archs` 两片、`codesign -dv` 同 Team;②`~/code-puppy` 是不是目录;③日志里 `process fence planned:` 那行
  的 dropped / excluded。用户可见代价(如实披露,基线 §五 子票 4):围栏内 set-ID 二进制(`ps` / `top` …)
  不可 exec;登录 shell 写 `$HOME` 下 rc 产物(`.zcompdump` 等)会静默不落盘;非 zsh 用户的 history 文件不在可写集。
  用户打开的**新**文件夹要到下次启动才可写(启动时取并集,U2 裁决)。
- 验证清单(每次签名发版):stapler validate + spctl ✓ → 启动 → 终端(WASM+PTY)→ diff → 流式会话 → 定制中心 → 登录/账户 → 更新器检查 → **进程围栏**(引擎起来 = 围栏装上了;在项目外写一个文件必须 `operation not permitted`,项目内落盘)。
- Alpha 契约 RC-L3:`packaged app rejects a token whose purpose does not match the route as a visible auth failure`。本项须在真实 packaged executable 上执行并把证据落 `docs/verification/`;#224 只提供 fixture、运行时断言与持久 `role=alert` 边界,不代跑打包。
- **CAS GC worker(REQ-102 #367,L3 项;裁决 Q6 —— bench 总耗时不能证明 main 占用,须按下列五步)**:
  1. 确认 `app.asar/out/main/ext-cas-gc-worker.js` 存在(`npx @electron/asar list <app>/Contents/Resources/app.asar | grep ext-cas-gc-worker`);
  2. packaged app 对隔离 heavy fixture(可用 `packages/ui-mac/scripts/bench-cas-gc.ts` 的 heavy 档参数造店)实际触发一轮(等 5 分钟首跑或临时把 `CAS_GC_INITIAL_DELAY_MS` 建包为短值);
  3. 观察日志出现 `[cas-gc-scheduler] gc-success` 结构化摘要(worker 真跑通、非 gc-exception);
  4. 同时记录 main 事件循环最大延迟或 UI heartbeat,判定 **<100ms**(GC 期间 UI 无可感知冻结);
  5. 该 RC 的执行结果落 `docs/verification/`(唯一权威落点;此处只维护步骤,不存活跃结果)。
- **耦合面复核**(C14):发版/re-freeze 前跑 `upstream-anchors` 契约测试;`providers.ts` 之外不得出现 alpha 组件直 import `@opencode-ai/app`;build 若被 brand/patch strict 拦下 = 上游子串漂移,更新清单而非放行。
