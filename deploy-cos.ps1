# ============================================================
# 腾讯云 CloudBase 静态托管部署脚本
# 用法：在 fl-platform 目录下运行 .\deploy-cos.ps1
# 前提：已登录 tcb（tcb login）
# ============================================================

# ---- Build ----
Write-Host ">> Building..." -ForegroundColor Cyan
npx next build
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed"; exit 1 }

# ---- Deploy ----
Write-Host ">> Deploying to CloudBase static hosting..." -ForegroundColor Cyan
tcb hosting deploy ./out
if ($LASTEXITCODE -ne 0) { Write-Error "Deploy failed"; exit 1 }

Write-Host ">> Done! https://fl-platform-d9ggvxhq738a2a52a-1375707165.tcloudbaseapp.com" -ForegroundColor Green
