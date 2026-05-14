# FL 桌面客户端 · 活动状态接入规范

版本：v1.0  
更新：2026-05-09

---

## 概述

ForgottenLand 社交平台在用户面板显示"正在进行"活动标签（如"正在玩 三角洲行动"）。
该信息由**桌面客户端**自动检测用户运行的进程，通过 WebView 的 JavaScript 桥注入到前端页面。
**玩家无需手动输入**，客户端负责全流程。

---

## 接口

WebView 加载完成后，以下两个全局函数由前端注册：

### `window.__flSetActivity(text, source?)`

设置活动状态。

| 参数 | 类型 | 说明 |
|---|---|---|
| `text` | `string` | 显示文本，最长 80 字，超出自动截断 |
| `source` | `"game" \| "auto"` | 来源标签，默认 `"game"`；显示在 UI 右上角 |

```js
window.__flSetActivity("正在玩 三角洲行动", "game")
```

### `window.__flClearActivity()`

清除当前活动状态（进程退出或超时时调用）。

```js
window.__flClearActivity()
```

---

## 调用时机

| 事件 | 动作 |
|---|---|
| 检测到白名单进程启动 | `__flSetActivity(text, "game")` |
| 白名单进程退出 | `__flClearActivity()` |
| 用户锁屏 / 系统空闲 > N 分钟 | `__flClearActivity()`（可选） |
| 切换到另一个白名单进程 | 直接调 `__flSetActivity` 覆盖，无需先 Clear |

> **注意**：桥函数在 WebView DOM ready 后才可用，建议监听 `window.onload` 或轮询
> `typeof window.__flSetActivity !== "undefined"` 后再调用。

---

## 进程白名单

客户端应维护一份进程名 → 显示名称的映射表。  
格式建议（JSON）：

```json
[
  { "process": "delta_force.exe",       "display": "正在玩 三角洲行动" },
  { "process": "DeltaForce-Win64-Ship", "display": "正在玩 三角洲行动" },
  { "process": "csgo2.exe",             "display": "正在玩 CS2" },
  { "process": "RainbowSix.exe",        "display": "正在玩 彩虹六号：围攻" }
]
```

- 匹配规则：**进程名不区分大小写，精确匹配**（不做子串匹配，防误报）。
- 轮询间隔：建议 **10–30 秒**，兼顾实时性和性能。
- 多进程命中时：取列表中**优先级最高**（排序靠前）的一条。

---

## 前端行为说明

- `activity` 非空时，UserPanel 状态菜单展示"正在进行"区块（只读）。
- `activity` 为空时，该区块不显示。
- `source === "game"` 时右上角显示 **来自游戏**；`source === "auto"` 时显示 **自动检测**。
- 活动状态持久化到 `localStorage`（key: `fl:activity`），刷新页面后保留，直到下次 `__flClearActivity()` 或进程重新检测覆盖。

---

## 调试方法

在浏览器控制台（F12）手动模拟：

```js
// 模拟游戏启动
window.__flSetActivity("正在玩 三角洲行动", "game")

// 模拟游戏退出
window.__flClearActivity()
```

---

## 相关文件

| 文件 | 说明 |
|---|---|
| `src/lib/activity-store.ts` | Zustand store + 桥函数注册 |
| `src/components/AuthBootstrap.tsx` | 调用 `installActivityBridge()` |
| `src/components/UserPanel.tsx` | 只读展示活动状态 |
| `src/components/MemberList.tsx` | 成员列表中展示他人活动 |
