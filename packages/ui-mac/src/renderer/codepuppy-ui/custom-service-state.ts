// 「接入其它服务」对话框开着时,发起它的模型选择器弹层先收起(冻结稿:对话框后面没有选择器)。
// 对话框由 AddProvider 持有(随弹层的生命周期),所以弹层只是看不见、不卸载;对话框关掉后由 onCustomClosed 真正关掉弹层。
import { createSignal } from "solid-js"

const [open, setOpen] = createSignal(false)
export const customServiceOpen = open
export const setCustomServiceOpen = setOpen
