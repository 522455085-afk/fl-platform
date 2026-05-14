# CI/CD 部署指南

本项目使用 GitHub Actions 实现自动化 CI/CD 流程。

## 📋 工作流程

### 1. Test Job（测试）
- 运行单元测试 (`npm test`)
- 运行代码检查 (`npm run lint`)
- 确保代码质量

### 2. Build Job（构建）
- 安装依赖 (`npm ci`)
- 构建项目 (`npm run build`)
- 上传构建产物 (`out/` 目录)

### 3. Deploy Job（部署）
- 仅当推送到 `main` 或 `master` 分支时触发
- 下载构建产物
- 部署到 EdgeOne Pages（需要配置）

## 🔧 配置 GitHub Secrets

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加以下密钥：

### 必需配置
| Secret 名称 | 说明 | 示例 |
|-------------|------|------|
| `NEXT_PUBLIC_CLOUDBASE_ENV_ID` | CloudBase 环境 ID | `fl-platform-xxx` |
| `NEXT_PUBLIC_FOUNDER_IDS` | 创始人 ID（逗号分隔） | `user-id-1,user-id-2` |

### 可选配置（性能监控）
| Secret 名称 | 说明 | 示例 |
|-------------|------|------|
| `NEXT_PUBLIC_RUM_APP_ID` | 腾讯云 RUM 应用 ID | `123456` |
| `NEXT_PUBLIC_RUM_REPORT_URL` | 腾讯云 RUM 上报地址 | `https://rum-report.xxx` |
| `NEXT_PUBLIC_RUM_SAMPLE_RATE` | 采样率（0-1） | `1` |

### 部署配置
| Secret 名称 | 说明 | 示例 |
|-------------|------|------|
| `EDGEONE_API_TOKEN` | EdgeOne API Token | `xxx` |
| `EDGEONE_PROJECT_ID` | EdgeOne 项目 ID | `xxx` |

## 🚀 部署到 EdgeOne Pages

### 方式一：使用 EdgeOne CLI（推荐）

1. 安装 EdgeOne CLI：
```bash
npm install -g @tencent/edgeone-cli
```

2. 配置 API Token：
```bash
edgeone login --token $EDGEONE_API_TOKEN
```

3. 部署项目：
```bash
cd out/
edgeone deploy --project $EDGEONE_PROJECT_ID
```

### 方式二：使用 GitHub Actions

在 `.github/workflows/ci.yml` 的 `Deploy to EdgeOne Pages` 步骤中配置：

```yaml
- name: Deploy to EdgeOne Pages
  env:
    EDGEONE_API_TOKEN: ${{ secrets.EDGEONE_API_TOKEN }}
    EDGEONE_PROJECT_ID: ${{ secrets.EDGEONE_PROJECT_ID }}
  run: |
    npm install -g @tencent/edgeone-cli
    edgeone login --token $EDGEONE_API_TOKEN
    cd out/
    edgeone deploy --project $EDGEONE_PROJECT_ID
```

## 📦 构建产物

构建成功后，会在 `out/` 目录生成静态文件，包括：
- `index.html` - 首页
- `login.html` - 登录页
- `_next/` - Next.js 静态资源
- `manifest.json` - PWA 配置
- `sw.js` - Service Worker

## 🔍 查看工作流运行结果

1. 进入 GitHub 仓库
2. 点击 **Actions** 标签页
3. 选择对应的工作流运行记录
4. 查看每个步骤的详细日志

## ❓ 常见问题

### 1. 构建失败：TypeScript 错误
**原因**：代码中存在类型错误  
**解决**：本地运行 `npm run build` 检查错误并修复

### 2. 部署失败：EdgeOne API Token 无效
**原因**：API Token 过期或权限不足  
**解决**：在 EdgeOne 控制台重新生成 API Token

### 3. 部署成功但页面 404
**原因**：构建产物路径错误  
**解决**：检查 `next.config.ts` 中的 `basePath` 配置

## 📚 参考文档

- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [EdgeOne Pages 文档](https://www.tencentcloud.com/document/product/1145)
- [Next.js 静态导出](https://nextjs.org/docs/app/building-your-application/deploying/static-exports)
