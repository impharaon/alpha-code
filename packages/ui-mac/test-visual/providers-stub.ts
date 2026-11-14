// 视觉 harness:composer 只用到 useCommand();其余上游 provider 不在本 harness 范围。
const command = { options: [], trigger: () => {} }
export const useCommand = () => command
// #1686:组件库 Banner 只用到 useContractHealth()(cloud-preflight.html 场景)。
export const useContractHealth = () => () => null
