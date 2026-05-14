# 部署手册

## 部署前必做：刷新 Supabase Schema

每次拉到新代码后，先确认 `supabase/schema.sql` 里的所有表已经在你的 Supabase 项目里创建。

1. 打开 https://supabase.com/dashboard/project/&lt;你的项目&gt;/sql
2. 点 **+ New query**
3. 把 `supabase/schema.sql` 文件**整段**复制粘贴
4. 点 Run

脚本是**幂等**的：可以重复跑，已经存在的表/策略会被跳过或覆盖更新。

> 当前版本需要的表：`profiles`、`messages`、`trade_listings`、`parties`。

---

## 方案 A：腾讯云 EdgeOne Pages（推荐 · 国内访问极快）

### 一次性准备

1. 注册腾讯云账号 https://cloud.tencent.com/（建议微信扫码 + 实名认证）
2. 进入 EdgeOne Pages 控制台 https://console.cloud.tencent.com/edgeone/pages
3. 首次进入会引导开通服务，点 **立即开通**（免费）

### 部署步骤

1. 在本地构建静态站点：
   ```powershell
   npm run build
   ```
   产物在 `out/` 目录。
2. 把 `out/` 文件夹**整体压成 zip**：
   ```powershell
   Compress-Archive -Path out\* -DestinationPath fl-platform-out.zip -Force
   ```
3. 在 EdgeOne Pages 控制台：
   - 点 **新建项目** → 选 **直接上传**
   - 项目名：`fl-platform`
   - 上传 `fl-platform-out.zip`（或者直接选 `out` 文件夹）
4. 等 1-2 分钟构建完成，会拿到一个 `https://fl-platform-xxx.edgeone.app` 链接
5. 手机直接打开测试

### 后续更新

每次代码改完：
```powershell
npm run build
Compress-Archive -Path out\* -DestinationPath fl-platform-out.zip -Force
```
然后到 EdgeOne 控制台对应项目 → **重新上传** zip。

> **进阶：Git 自动部署**
>
> 当代码推到 GitHub 后，可以在 EdgeOne 项目设置里**关联 GitHub 仓库**，
> 配置：
> - 构建命令：`npm run build`
> - 输出目录：`out`
> - 环境变量：
>   - `NEXT_PUBLIC_SUPABASE_URL`
>   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
>
> 之后每次 `git push`，EdgeOne 会自动构建+发布。

---

## 方案 B：Vercel（海外用户友好）

> ⚠️ 注意：Vercel 在国内无 CDN 节点，从中国大陆访问 `vercel.app` 域名经常超时。
> 国内用户需要自定义域名 + 配 Cloudflare 中转，或者用方案 A。

### 一次性准备

```powershell
npx vercel login
```

### 部署

```powershell
npx vercel --prod
```

环境变量已经在 Vercel 项目里配好（`NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`），不需要重复设置。

---

## 方案 C：阿里云 OSS / 腾讯云 COS（纯静态托管）

适合需要**自定义域名 + ICP 备案**的正式上线。

1. 创建 OSS / COS 存储桶（开启**静态网站托管**功能）
2. 把 `out/` 目录里的所有文件上传到桶根目录
3. 配置：
   - 默认首页：`index.html`
   - 默认 404 页：`404.html`
4. 绑定自定义域名（已备案）+ CDN 加速

---

## 域名建议

如果你想用类似 `forgottenland.cn` 这种自有域名：

| 注册商 | 价格（cn 域名） | 备案 |
|---|---|---|
| 阿里云万网 | ~¥30/年 | 必须 |
| 腾讯云 DNSPod | ~¥30/年 | 必须 |
| Cloudflare | ~$10/年（仅 .com 等） | 国内访问需配 CDN |

**推荐流程**：阿里云买域名 → 备案（10-20 天）→ 在腾讯云 EdgeOne Pages 绑定域名。

---

## 常见问题

### 1. 部署后页面打不开 / 一直转圈

**最常见**：浏览器扩展（广告拦截、隐私插件）拦截了 Supabase 请求。
- 用**无痕模式**测试一下
- 或者临时禁用拦截类扩展

### 2. 注册成功但登录卡住

**最常见**：Supabase 后台 **Confirm email** 没关，注册需要点邮件链接。
- 去 Authentication → Sign In / Providers → Email → 关掉 **Confirm email**

### 3. 消息发出去别人收不到 / 实时不工作

确认 schema.sql 末尾的 `alter publication supabase_realtime add table ...` 跑过：
```sql
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.trade_listings;
alter publication supabase_realtime add table public.parties;
```

### 4. 我能看到自己的消息但其他人看不到

检查 RLS 策略。`schema.sql` 里有 `select to authenticated using (true)`，
说明所有登录用户都能读所有消息。如果改了策略，可能误把自己锁出去了。

### 5. 上线后想回滚到旧版本

EdgeOne / Vercel 都支持版本历史，进控制台找到旧的 deployment，
点 **设为生产**（Promote to Production）即可。
