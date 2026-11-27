export * as NpmConfig from "./package-manager-npm-config"

import { Effect } from "effect"
import { NpmConfig } from "../../util/src/npm-config"
import { packageManagerEnvironment } from "../src/shared/package-manager-environment"

export const registry = NpmConfig.registry

export const load = (directory: string) => NpmConfig.load(directory).pipe(Effect.map((config) => {
  const cache = packageManagerEnvironment().npm_config_cache
  return config.cache === undefined && cache !== undefined ? { ...config, cache } : config
}))
