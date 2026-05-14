# 明天部署清单（FL Platform）

> 准备好了再开始 — 不要边做边查。预计 15 分钟可全部完成。

## 1. 上传前端 zip

文件：`e:\fl-platform\out-deploy.zip`（19:14 时间戳，已重新构建）

包含本次修复：
- ✅ supabase shim 的 `.insert/update().select().single()` mode 覆盖 bug（用户名 / 头像写入静默失败的根因）
- ✅ profile 持久化（用户名注册后稳定）
- ✅ 头像 `avatar_url` 全链路传播（presence / messages / dm_threads / friendships）
- ✅ MemberList / ChatView / DmSidebar / DmHome / UserProfileCard 使用统一 `<Avatar>` 组件渲染
- ✅ 软删 + 硬删（manager-node 后台真删 auth 行）

操作：
1. EdgeOne Pages → fl-platform → 部署 → 移除旧 zip
2. 拖入 `out-deploy.zip` → 开始部署
3. 等成功后 Ctrl+F5 强刷网站

## 2. **必须**手动建的 3 个新集合 + 权限规则

> 这些集合代码已经在写入，**没建好就会跑 fallback**（数据丢失或写不进去）。

### 集合 1：`message_reactions`
- CloudBase 控制台 → 数据库 → 新建集合 `message_reactions`
- 权限规则（自定义安全规则）：
```json
{
  "read": true,
  "write": "auth != null && doc.user_id == auth.uid"
}
```

### 集合 2：`server_members`
- 新建集合 `server_members`
- 权限规则：
```json
{
  "read": true,
  "write": "auth != null && (doc.user_id == auth.uid || get(`database.servers.${doc.server_id}`).creator_id == auth.uid)"
}
```
- 备注：如果 `get(...)` 语法 EdgeOne / CloudBase 拒绝，先用宽松版：
```json
{ "read": true, "write": "auth != null" }
```
后续再收紧。

### 集合 3：`servers`
- 新建集合 `servers`（如果还没建）
- 权限规则：
```json
{
  "read": true,
  "write": "auth != null && (doc.creator_id == auth.uid || resource.creator_id == auth.uid)"
}
```
- 同上，如果语法不通过先用 `{ "read": true, "write": "auth != null" }`。

### 集合 4（已建但确认权限）：`profiles`
**重要**：测试用的全开规则要收紧回安全版：
```json
{
  "read": true,
  "write": "doc.id == auth.uid"
}
```

### 集合 5（已建但确认）：`dm_threads`
```json
{
  "read": "auth != null && doc.user_id == auth.uid",
  "write": "auth != null && doc.user_id == auth.uid"
}
```

### 集合 6（已建但确认）：`friendships`
```json
{
  "read": "auth != null && (doc.requester_id == auth.uid || doc.addressee_id == auth.uid)",
  "write": "auth != null && (doc.requester_id == auth.uid || doc.addressee_id == auth.uid)"
}
```

### 集合 7（已建但确认）：`blocks`
```json
{
  "read": "auth != null && doc.blocker_id == auth.uid",
  "write": "auth != null && doc.blocker_id == auth.uid"
}
```

### 集合 8（已建但确认）：`messages`
```json
{
  "read": true,
  "write": "auth != null && doc.author_id == auth.uid"
}
```

## 3. 测试清单（按顺序，确认每步）

清浏览器存储 → 强刷 → 注册新邮箱（用户名填 `阿狸`），跑下面：

| # | 操作 | 预期结果 | 集合状态 |
|---|------|----------|----------|
| 1 | 注册新邮箱 | Console: `[auth] ensureProfile: profile inserted OK` | profiles 多 1 行（id=uid, username=阿狸） |
| 2 | 退出再登录 | 用户名仍是 `阿狸`，不变数字 | profiles 不变 |
| 3 | 上传头像 | UserPanel（左下角）头像变了 | profiles 该行多 `avatar_url` |
| 4 | 看 MemberList（服务器右侧） | 自己头像变了 | — |
| 5 | 在大厅频道发条消息 | 消息上头像是图片 | messages 行有 `author_avatar_url` |
| 6 | 与人开 DM | DM 顶栏 + 大头像都用图片 | dm_threads 有 `partner_avatar_url` |
| 7 | 加好友、屏蔽 | 写入正常 | friendships / blocks 多行 |
| 8 | 设置 → 注销账号 | 同邮箱可立即重新注册 | profile tombstone + auth 行真删 |

## 4. 已知**未实现**功能（不是 bug，是缺特性）

不要花时间排查这些：

- 🚧 **语音房间**：UI 占位，无 WebRTC / TRTC 实现。`v-1/v-2/v-3` 频道可点击但不会建立通话；members 数组始终为空。
- 🚧 **直播频道**：仅 UI 占位，无推拉流实现。
- 🚧 **角色名（游戏内）**：注册时填的是「平台用户名」，不是游戏角色名。游戏角色由 UE 客户端 `FLLobbyCharacterManager` 管理（独立系统，跑在 protobuf-over-HTTP 上，对应 `FL_GAME_API_SPEC.md`）。

要做这些需要：
- 语音 → 接腾讯云 TRTC SDK（Web 版 `trtc-js-sdk`）+ 房间 token 后端签发
- 直播 → 同样 TRTC 或 LCB-Push 直播 SDK
- 平台用户名 ↔ 游戏角色名打通 → 后端约定一个 `display_name` 字段，UE 拉时优先用这个

## 5. 当前商用就绪度

| 模块 | 状态 |
|---|---|
| 注册 / 登录 / 持久化 | ✅ |
| 用户名 ✓ 头像上传 ✓ | ✅ |
| 头像跨页面同步 | ✅ |
| 注销账号（软+硬） | ✅ |
| 注销后立即可重注册 | ✅ |
| DM / 私信 | ✅ |
| 好友 / 屏蔽 | ✅ |
| 公会（servers）/ 成员 / 角色提升 | ✅ |
| 公告频道 | ✅ |
| 交易市场（trade） | ✅ |
| 组队（party） | ✅ |
| 表情反应 | ✅ |
| 语音 / 直播 | 🚧 未实现 |
| 游戏内角色名联动 | 🚧 未实现 |

---

## 应急回退

如果新版本上线后发现严重问题：
1. EdgeOne 控制台 → 部署历史 → 选上一版本 → 回滚
2. 通知用户清浏览器存储 + 强刷
3. 看 F12 Console 里 `[auth]` 日志定位问题
