# 部署 delete-user 云函数

让「永久注销账号」从**软删除**升级为**真正删除**（清除 CloudBase 登录凭证 + 所有数据）。

> 不部署也没关系：客户端会自动 fallback 到软删除。但软删的话邮箱+密码仍能登入，强烈建议部署。

## 一、本地准备

云函数代码已经在 `cloud-functions/delete-user/` 目录：

```
cloud-functions/
└─ delete-user/
   ├─ index.js
   └─ package.json
```

## 二、部署到 CloudBase

### 方式 A：控制台手动上传（最简单，推荐第一次用）

1. 登录 [腾讯云 CloudBase 控制台](https://console.cloud.tencent.com/tcb)
2. 选择你的环境（与前端 `.env.local` 中 `NEXT_PUBLIC_TCB_ENV_ID` 一致）
3. 左边栏 → **云函数 SCF** → **新建**
4. 填写：
   - 函数名称：**delete-user**（必须严格一致，前端会调这个名字）
   - 运行环境：**Node.js 16** 或更高
   - 函数代码：选择「上传文件夹」→ 上传整个 `cloud-functions/delete-user/` 目录
   - 内存：128MB（足够）
   - 超时：30 秒
   - 网络：默认（不需要 VPC）
5. 创建完后 → **「触发器」** tab → 不需要新增（前端通过 SDK 调，无 HTTP 触发器）
6. **「权限」** tab → 角色：默认即可（云函数有当前环境的所有权限）

### 方式 B：CLI（适合后续迭代）

```powershell
# 安装 CloudBase CLI（一次性）
npm install -g @cloudbase/cli

# 登录（一次性）
tcb login

# 部署函数（每次更新代码用）
cd cloud-functions/delete-user
npm install
cd ../..
tcb fn deploy delete-user --envId <你的环境ID>
```

## 三、测试

1. 上传新版前端 zip 到 EdgeOne 并强刷
2. 登录 → 个人设置 → 注销账号 → 走完确认流程 → 点「永久注销账号」
3. 看 F12 控制台：
   - 看到 `[auth] deleteAccount: hard-deleted via cloud function` → ✅ 真删成功
   - 看到 `[auth] delete-user cloud function not available; falling back to soft delete` → ❌ 函数没部署（或名字不对），走了软删
4. 用同一邮箱+密码尝试**重新登录**：
   - 真删成功 → 应该报「邮箱或密码错误」（CloudBase 已找不到该 auth 用户）
   - 软删 → 仍能登录但被立刻踢出，提示「此账号已注销」

## 四、注意事项

- **创始人保护**：如果用户是某服务器的 creator，云函数会先检查并拒绝注销，提示用户先转让/解散。客户端也有同样检查（双重防护）。
- **auth.deleteUser API**：不同 SDK 版本对外暴露的方法名不同。`index.js` 已尝试多种调用方式，无法删除时会返回 `authDeleted: false` + 警告，但数据已清空。
- **数据清理范围**：profiles / server_members / dm_threads / dm_messages / message_reactions / presence。如果之后加了新集合存用户数据，记得回来加上。
- **云函数权限**：云函数运行时有"当前环境的全部权限"，相当于服务端 admin 角色，能直接绕过 read/write 规则。这就是为什么必须从客户端禁止用户冒充别的 uid 调用（context.userInfo.uid 是 CloudBase 网关注入的，无法伪造）。

## 五、回滚

如果云函数有 bug 想暂时回到软删除：
- 控制台直接**禁用**或**删除** `delete-user` 函数
- 客户端不需要改代码，会自动 fallback

## 六、未来增强建议

| 升级项 | 说明 |
|---|---|
| 24 小时冷静期 | 注销时不立即删，写一个 `pending_delete` 集合，定时任务 24h 后真正执行 |
| 数据导出 | 注销前提供 JSON 下载（GDPR / PIPL 合规） |
| 审计日志 | 把每次删除写到 `audit_logs` 集合保留 90 天 |
