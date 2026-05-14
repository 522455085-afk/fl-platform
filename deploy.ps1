#!/usr/bin/env pwsh
# deploy.ps1 — 一键构建并部署到 Netlify
Set-Location $PSScriptRoot
npm run build
if ($LASTEXITCODE -ne 0) { Write-Error "Build failed"; exit 1 }
netlify deploy --dir=out --prod
