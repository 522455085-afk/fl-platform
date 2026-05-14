# ForgottenLand 玩家平台

> 一个 Discord 风格的玩家社区，专为《被遗忘之地》定制。
> 核心模块：文字 / 语音频道、组队大厅、玩家间交易市场。

## 技术栈

- **Next.js 16** (App Router, Turbopack, 静态导出)
- **React 19**
- **TypeScript** (严格模式)
- **TailwindCSS 4** + 原生 CSS 变量主题
- **Supabase** 提供：
  - Auth（邮箱注册/登录）
  - PostgreSQL（profiles / messages / trade_listings / parties）
  - Realtime（消息推送 + presence 在线状态）
- **Zustand** 客户端状态
- **Lucide Icons**

## 项目结构

```
fl-platform/
├── src/
│   ├── app/
│   │   ├── layout.tsx          # 根布局（中文 lang，奇幻字体）
│   │   ├── page.tsx            # 主界面（带移动端 drawer）
│   │   ├── login/page.tsx      # 登录/注册（"踏上归途"）
│   │   └── globals.css         # 暗紫金主题色 + 全局样式
│   ├── components/
│   │   ├── ServerSidebar.tsx   # 公会图标侧栏（72px）
│   │   ├── ChannelSidebar.tsx  # 频道列表
│   │   ├── ChatView.tsx        # 文字频道（实时消息）
│   │   ├── TradeMarketView.tsx # 交易市场（实时挂单 + 上架弹窗）
│   │   ├── PartyView.tsx       # 组队大厅（实时 + 加入/退出）
│   │   ├── MemberList.tsx      # 在线成员（基于 Presence）
│   │   └── AuthBootstrap.tsx   # 应用启动时同步 Supabase session
│   └── lib/
│       ├── supabase.ts         # 客户端 + 类型定义
│       ├── auth-store.ts       # zustand auth + login/register
│       ├── use-presence.ts     # Realtime Presence hook
│       ├── mock-data.ts        # 公会/频道/物品稀有度等静态配置
│       └── utils.ts            # cn() 等工具
├── supabase/
│   └── schema.sql              # 数据库 schema（粘到 Supabase SQL Editor 跑）
├── .env.local                  # NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY
├── next.config.ts              # output: "export" 静态导出
└── DEPLOY.md                   # 部署到 EdgeOne / Vercel 的详细步骤
```

## 本地开发

```bash
# 1. 安装依赖（首次）
npm install

# 2. 配置 Supabase（已配置则跳过）
#    复制 .env.example 为 .env.local，填入：
#    NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
#    NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxx

# 3. 在 Supabase SQL Editor 跑 supabase/schema.sql（首次）
#    并去 Authentication → Sign In / Providers → Email
#    把"确认邮件"开关关掉（测试用），或保留并配置 SMTP

# 4. 启动 dev server
npm run dev
# 打开 http://localhost:3000
```

## 构建静态站点

```bash
npm run build
# 产物在 out/ 目录，可直接上传到任何静态托管
```

## 部署

详见 [DEPLOY.md](./DEPLOY.md)。当前推荐：

- **国内访问**：腾讯云 EdgeOne Pages（免费 + 国内秒开）
- **海外访问**：Vercel / Cloudflare Pages

## 已完成 / 待办

✅ **已完成**

- 登录注册（Supabase Auth，奇幻风文案）
- 文字频道实时聊天（Supabase Realtime）
- 交易市场（创建挂单 / 实时刷新 / 下架）
- 组队大厅（创建队伍 / 实时刷新 / 加入退出 / 解散）
- 在线成员（Realtime Presence，多设备去重）
- 暗紫金奇幻品牌（避开 Discord 配色）
- 移动端响应式（汉堡菜单 drawer）
- 静态导出，部署成本极低

🚧 **待办**

- LiveKit 接入语音频道
- 图床（玩家上传截图 / 物品图标）
- 玩家个人资料页（编辑头像 / 角色信息）
- 公会管理（角色 / 权限）
- 通知与未读计数
- 国际化（i18n，至少英文）
- 自动清理过期 listing / party 的 Edge Function
