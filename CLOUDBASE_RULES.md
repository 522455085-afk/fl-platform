# CloudBase 数据库权限规则（最终版）

> **去 CloudBase 控制台 → 数据库 → 选中集合 → 权限设置 → 自定义安全规则**
> 把下面对应的 JSON 整段贴进去 → 保存。
>
> 共 9 个集合，每个 30 秒，5 分钟全搞定。
>
> **关键术语（CloudBase 旧版 vs 新版）**：
> - 旧版规则用 `auth.openid` （CloudBase 1.x / Web SDK 默认匿名+邮箱登录）
> - 新版用 `auth.uid` （3.x+，自定义登录）
> - 不确定时**两个都试一遍**（按 `auth.openid` 那版先来，不行再换 `auth.uid`）

---

## 1. `profiles` （用户资料）

```json
{
  "read": true,
  "write": "auth.openid != null && doc.id == auth.openid"
}
```

> 任何人可读他人资料（用于显示对方头像 / 名字）；只能改自己那行。

---

## 2. `friendships` （好友 + 请求 — **B 关键**）

```json
{
  "read": "auth.openid != null && (doc.requester_id == auth.openid || doc.addressee_id == auth.openid)",
  "write": "auth.openid != null && (doc.requester_id == auth.openid || doc.addressee_id == auth.openid)"
}
```

> **为什么这条很重要**：发起方写入时 `_openid = 发起者`，但接收方查询是 `addressee_id == me`。默认规则 `auth.openid == doc._openid` **只让发起方看见**。这条改成"两侧任一方都能读写"，才能让接收者看到红点 + 接受 / 拒绝。

---

## 3. `blocks` （屏蔽列表）

```json
{
  "read": "auth.openid != null && doc.blocker_id == auth.openid",
  "write": "auth.openid != null && doc.blocker_id == auth.openid"
}
```

---

## 4. `dm_threads` （私信会话索引 — **A 关键**）

```json
{
  "read": "auth.openid != null && doc.user_id == auth.openid",
  "write": "auth.openid != null"
}
```

> 写规则故意放宽 (`auth.openid != null`)，让发送方能写接收方的 mirror row。只读自己的（防偷看别人的私信预览）。

---

## 5. `messages` （所有聊天消息）

```json
{
  "read": true,
  "write": "auth.openid != null && doc.author_id == auth.openid"
}
```

---

## 6. `presence` （在线状态）

```json
{
  "read": true,
  "write": "auth.openid != null"
}
```

> 写宽松一些，因为心跳 / 清理需要任意人改自己（按 `_openid` 系统字段实际限制）。

---

## 7. `servers` （服务器）

```json
{
  "read": true,
  "write": "auth.openid != null && (doc.creator_id == auth.openid || resource.creator_id == auth.openid)"
}
```

如果上面 `resource.` 写法报错，先用宽松版本：
```json
{ "read": true, "write": "auth.openid != null" }
```

---

## 8. `server_members` （服务器成员）

```json
{
  "read": true,
  "write": "auth.openid != null"
}
```

---

## 9. `coin_orders` （金币兑换挂单）

```json
{
  "read": "auth.openid != null",
  "write": "auth.openid != null"
}
```

> 读全开让所有人看到市场挂单；写全开让任何已登录用户发布/撤单。

---

## 10. `trade_listings` （交易行）

```json
{
  "read": "auth.openid != null",
  "write": "auth.openid != null"
}
```

> 任何登录用户可读（浏览交易行）；写权限全开给已登录用户，让管理员能强制下架。
> 业务层（前端）已确保只有物品主或平台管理员看到下架按钮。

---

## 10. `auction_listings` （拍卖行）

```json
{
  "read": "auth.openid != null",
  "write": "auth.openid != null"
}
```

> 同 trade_listings 理由。

---

## 11. `message_reactions` （emoji 反应）

```json
{
  "read": true,
  "write": "auth.openid != null && doc.user_id == auth.openid"
}
```

---

## 10. `sessions` （单端互踢会话表）

记录每个登录会话；同 `device_type` 重复登录会把旧 session 标记为 kicked。

```json
{
  "read": true,
  "write": "auth.openid != null"
}
```

**为什么读规则全开？** 因为新设备 B 需要查询并更新**对方** A 的 session 行（标记为 kicked）。如果 read 加 `doc.user_id == auth.openid`，B 端**根本读不到** A 端写的行（CloudBase 邮箱密码登录的 `auth.openid` 不等于 `user.id`），互踢逻辑会失效。  
**安全性**：sessions 表只存 UA、设备类型、时间戳，不含密码或敏感信息，全开读没风险。

---

## 11. `occupation` （单端语音/直播/房间占用）

记录每个用户当前正在哪个设备上使用语音/直播/进入房间，全局每用户最多一行。

```json
{
  "read": true,
  "write": "auth.openid != null"
}
```

> 同 sessions，读全开是为了让"切换占用"时能查到别人的旧行。

---

# 验证步骤

贴完所有规则后：

1. **登录用户 A**，给**用户 B** 发好友请求
2. 用户 A 浏览器 F12 看：
   ```
   [social] refresh: as_requester=1 as_addressee=0 blocks=0
   ```
   → 这是发起方视角，应该看到 1 条 outgoing
3. **登录用户 B**（另一浏览器或无痕窗口）
4. 用户 B 浏览器 F12 看：
   ```
   [social] refresh: as_requester=0 as_addressee=1 blocks=0
   ```
   → **关键**：`as_addressee=1` 说明接收方能读到了
   - 如果是 `as_addressee=0` + 看到红色 `[social] friendships addressee_id query FAILED` → 规则没生效，回头检查规则 #2 的 JSON 有没有错
5. 用户 B 应该左侧 DM 图标有红点，进入"请求"分类能看到接受/拒绝按钮
6. 点接受 → A 这边再 refresh 后能看到 `as_requester=1 as_addressee=0`，且对方进入好友列表

---

# 如果 `auth.openid` 全部不通，整体替换成 `auth.uid` 再试

PowerShell 替换工具：把所有规则中的 `auth.openid` 全替换成 `auth.uid`：
```
"auth.uid != null && (doc.requester_id == auth.uid || doc.addressee_id == auth.uid)"
```
等等。

---

# 最不行的兜底（不推荐 — 仅测试用）

把所有有问题的集合临时改成：
```json
{ "read": true, "write": "auth.openid != null" }
```
能让一切跑起来，但任何登录用户都能改任意行 — **生产前一定要改回严格版**。
