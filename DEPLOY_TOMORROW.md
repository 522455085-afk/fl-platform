# 明天部署清单

## ✅ 一、CloudBase 控制台新建 3 个集合

打开 [CloudBase 控制台](https://console.cloud.tencent.com/tcb) → 你的环境 → 数据库 → 新建集合。

每个集合的**安全规则**都是：

```json
{
  "read": "auth != null",
  "write": "auth != null"
}
```

| 集合名 | 用途 | 必填字段 |
|---|---|---|
| `message_reactions` | 表情反应 | `id, message_id, emoji, user_id, user_name, created_at` |
| `servers` | 用户自创服务器 | `id, name, icon_text, icon_color, creator_id, creator_name, member_count, is_official, created_at` |
| `server_members` | 服务器成员关系 | `id, server_id, user_id, user_name, role, joined_at` |

**注意**：CloudBase 自动建表，不需要预先指定字段，第一次 add 时自动推断。但权限规则**必须**手动设。

## ✅ 二、上传新 zip

`E:\fl-platform\fl-platform-out.zip`（约 500 KB）→ EdgeOne 控制台 → Pages → 上传。

部署完成后 Ctrl+F5 强刷。

## ✅ 三、登录后测试清单

逐项勾选：

- [ ] **注册新号**：用户名输入「测试1」，验证后查看左下用户名是不是「测试1」（**不是**邮箱前缀）
- [ ] **公告频道**：切到「大殿」/「御林骑士团」→「规则与公告」→ 你（平台 admin）能发送，他人看到锁定横条
- [ ] **表情反应**：悬停消息 → 出现 🙂₊ → 选 ⚔ → 看到 `⚔ 1` 徽章
- [ ] **创建服务器**：左下 `+` → 名称「测试公会」→ 选颜色 → 创建
- [ ] **服务器管理**：悬停新服务器图标 → 右上 ⚙ 出现 → 点击打开管理面板
- [ ] **添加管理员**：在管理面板搜索另一个用户名 → 设为管理员
- [ ] **解散服务器**：危险区 → 解散 → 服务器从左侧栏消失
- [ ] **语音/直播**：点「突袭语音 1」/「直播间 1」→ 看到「功能开发中」占位（**不再有幽灵成员**）

## 🛠️ 控制台调试工具（F12 输）

```js
__fl.help();                    // 列出所有命令
__fl.cleanAllReactions();       // 清掉我所有的表情反应
__fl.cleanAllMyServers();       // 解散我创建的所有服务器
__fl.clearMyDocs("trade");      // 清掉某集合中我的所有数据
```

## 🔑 .env.local 提醒

如果要把自己设为平台 admin（公告频道发布权限）：

```
NEXT_PUBLIC_ADMIN_USER_IDS=<your_user_id>
```

改完必须重新 `npm run build` 才生效（环境变量在编译时注入）。

## 🐛 已知限制

- `disbandServer` 只能删自己的 membership 行（CloudBase 权限规则限制）。彻底清场要么用 `__fl.cleanAllMyServers()`，要么之后接入云函数。
- `member_count` 不会随加入自动 +1（join 流程还没做 UI），目前在 `servers` 行里手动维护。
- `promote-by-username` 需要被提升者的 `profiles` 表有行。新注册用户登录一次后才有。

## 下一波要做的事（优先级排序）

1. **加入服务器**：发现公会页面 + 邀请链接
2. **频道管理**：给自创服务器添加/重命名/删除频道
3. **云函数收紧权限**：防止用户自己改自己的 role
4. **真实推流**：接入腾讯云 TRTC 实现语音房 + 直播
