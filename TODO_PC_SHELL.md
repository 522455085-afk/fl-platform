# PC 桌面端壳化 — 延后

决策日期：2026-05-07

## 需求

把当前 Next.js 网页打包成 Windows / macOS 桌面软件 (.exe / .dmg)，并提供
**「启动游戏」按钮**：点击后用 Node child_process / Tauri shell::open 启动
本机的 ForgottenLand 游戏可执行文件。

## 候选技术

| 方案 | 体积 | 工作量 | 推荐度 |
|---|---|---|---|
| **Tauri** (Rust) | ~10MB | 中（要装 Rust） | ⭐⭐⭐⭐⭐ |
| **Electron** (Node) | ~80MB | 低（Node 已在） | ⭐⭐⭐ |

## 启动游戏按钮的实现要点

1. 游戏路径：默认 `%LOCALAPPDATA%\ForgottenLand\Win64\ForgottenLand.exe`
   或玩家在设置里配置；也可读注册表 `HKEY_CURRENT_USER\Software\ForgottenLand\InstallPath`
2. 启动参数：可附加 `-launchfromplatform=1` 让游戏知道是平台调起的，
   后续可做"自动登录"流程。
3. 仅在桌面端显示按钮，Web/Mobile 端隐藏（用 `window.__TAURI__` 或
   `window.process?.versions?.electron` 检测）。
4. 桌面端可挂托盘图标 + 快捷键，玩家在游戏中切出后回平台秒开。

## 触发条件

当以下任一满足时再做：
- 完成 CloudBase 后端迁移
- 完成游戏 API 集成
- 玩家测试反馈"想要桌面端"
