$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://localhost:3000"

Set-Location $projectRoot

Write-Host ""
Write-Host "Festimix v3 inditas" -ForegroundColor Cyan
Write-Host "Projekt: $projectRoot"
Write-Host ""
Write-Host "Web UI: $url"
Write-Host ""

Start-Job -Name "FestimixBrowserOpen" -ScriptBlock {
    param($targetUrl)
    for ($attempt = 0; $attempt -lt 120; $attempt++) {
        try {
            Invoke-WebRequest -Uri $targetUrl -UseBasicParsing -TimeoutSec 1 | Out-Null
            Start-Process $targetUrl
            break
        } catch {
            Start-Sleep -Seconds 1
        }
    }
} -ArgumentList $url | Out-Null

npm run server

Write-Host ""
Read-Host "A szerver leallt. ENTER bezarja ezt az ablakot"
