// alpha account reads (balance / membership / token usage) from the alpha-platform (B) in-region
// account-server, authed with the JWT alpha-web (C) issued. MAIN-ONLY: the renderer never sees the
// token, only the resolved summary over IPC (account-ipc.ts).
//
// Contract: alpha-platform docs/contracts/account-billing.md —
//   GET {ACCOUNT_BASE}/v1/account/summary   Authorization: Bearer <JWT>   → AccountSummary
//   GET {ACCOUNT_BASE}/v1/billing/transactions
//   401 = JWT 失效/缺失 → main 单飞续期并经 token-generation 换血入口旋转 sidecar;
//   续期失败或重试仍 401 才向 renderer 暴露 unauthorized。
// Account reads hit the in-region account-server (PII/金融 must stay in-region), NOT the model
// gateway. Overridable via CODEPUPPY_ACCOUNT_URL for dev/staging (consistent with CODEPUPPY_WEB_URL /
// CODEPUPPY_PLATFORM_URL; see shared/codepuppy-config.ts).

import { CODEPUPPY_PATHS } from "../shared/codepuppy-config"
import { decodeJsonContract, isContractIncompatibleError } from "@codepuppy/contracts-consumer"
import { resolveEndpoints } from "./codepuppy-endpoints"
import { getAccessToken, getAuthIdentityEpoch, refreshTokens } from "./codepuppy-auth"
import { getLogger } from "./logging"
import { reportContractFailure } from "./codepuppy-contract-health"
import type { AccountResult, AccountSummary, AccountTransaction } from "../preload/types"
import { createAuthedGet } from "./codepuppy-account-request"
import { decodeAccountSummary } from "./codepuppy-account-contract"

// Resolved by codepuppy-endpoints (env CODEPUPPY_ACCOUNT_URL > userData pin > login discovery > default).
const accountBase = () => resolveEndpoints().account

// B2 defense-in-depth:如果「续期后重试仍 401」,说明该 access token 确实被端点拒绝(不是过期),
// 再续也只是白烧往返(#601 当时每次续期还会重启引擎;REQ-236 `#1562` 起续期热应用、不重启)。该 purpose 的
// 账户驱动刷新就此锁住,直到该端点出现非 401 成功或用户登入/登出,不再用有限冷却窗口当终局(当时会自激成
// 每 30 秒中断一次会话的 respawn 循环)。
// B2:401 拦截 —— access token 失效时先续期一次再重试(单飞在 refreshTokens 内);续期失败(会话
// revoked → 那边已降级登出)才把 unauthorized 交给 renderer 触发重新登录。
const authedGet = createAuthedGet({
  accountBase,
  getAccessToken,
  refreshTokens,
  authIdentityEpoch: getAuthIdentityEpoch,
  fetch,
  warn: (message, error) => getLogger().warn(message, error),
  isContractIncompatibleError,
  reportContractFailure,
})

// #631: decoded, not cast — an account-server response the published contract does not describe
// becomes `contract-incompatible` (reported to the renderer's contract-health alert) instead of a
// structurally broken AccountSummary. See codepuppy-account-contract.ts.
export const fetchAccountSummary = (): Promise<AccountResult<AccountSummary>> =>
  authedGet(CODEPUPPY_PATHS.accountSummary, "account.read", decodeAccountSummary)

export const fetchTransactions = (limit?: number): Promise<AccountResult<{ transactions: AccountTransaction[] }>> =>
  authedGet(
    limit ? `${CODEPUPPY_PATHS.transactions}?limit=${limit}` : CODEPUPPY_PATHS.transactions,
    "account.read",
    (text) => ({
      // #640: the page is append-only ledger facts (platform#101 hard cut). Carried through
      // verbatim — no display copy is synthesised here and no domain arithmetic is done, because
      // wallet amounts are fen and allowance amounts are credits.
      transactions: decodeJsonContract("LedgerPageV1", text, "account").transactions.map((entry) => ({
        seq: entry.seq,
        opId: entry.op_id,
        kind: entry.kind,
        domain: entry.domain,
        amount: entry.amount,
        actionId: entry.action_id,
        reservationId: entry.reservation_id,
        windowId: entry.window_id,
        externalRef: entry.external_ref,
        createdAt: entry.created_at,
      })),
    }),
  )
