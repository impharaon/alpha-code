// #1686:发送框的提交前预检用到组件库 Banner,而 Banner 的 `./providers` 转口整棵 `@opencode-ai/app`
// (冻结前端,测试构建解析不了它的 `@/` 别名)。Banner 只用 useContractHealth;组件测试构建里换成这个替身
// (与 test-visual/vite.config.ts 换 composer 的 providers、catalog-failure-banner.cases.ts 同法)。
export const useContractHealth = () => () => null
