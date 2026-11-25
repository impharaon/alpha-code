// alpha-code#1569 AC1(R5)—— 侧栏 4 个 localStorage 键:首读之前从旧名复制到新名并删旧。
import { describe, expect, test } from "bun:test"
import { migrateLegacyStorageKeys } from "./sidebar-state"

function mapStorage(initial: Record<string, string>) {
  const map = new Map(Object.entries(initial))
  return {
    map,
    storage: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      removeItem: (key: string) => void map.delete(key),
    },
  }
}

describe("migrateLegacyStorageKeys", () => {
  test("4 对键:旧值复制到新名、旧键删除;新键已在则留新删旧;别的键不动", () => {
    const { map, storage } = mapStorage({
      "alpha.sidebar.collapsed": "1",
      "alpha.sidebar.expanded": '["/p"]',
      "alpha.sidebar.hidden": '["/old"]',
      "alpha.sidebar.viewed": '{"ses_1":5}',
      "codepuppy.sidebar.hidden": '["/already-new"]',
      "other.key": "x",
    })
    migrateLegacyStorageKeys(storage)
    expect(Object.fromEntries(map)).toEqual({
      "codepuppy.sidebar.collapsed": "1",
      "codepuppy.sidebar.expanded": '["/p"]',
      "codepuppy.sidebar.hidden": '["/already-new"]',
      "codepuppy.sidebar.viewed": '{"ses_1":5}',
      "other.key": "x",
    })
  })

  test("没有旧键 ⇒ 什么都不写", () => {
    const { map, storage } = mapStorage({ "codepuppy.sidebar.collapsed": "0" })
    migrateLegacyStorageKeys(storage)
    expect(Object.fromEntries(map)).toEqual({ "codepuppy.sidebar.collapsed": "0" })
  })
})
