$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = "http://localhost:3000"

Set-Location $projectRoot

$env:FESTIMIX_DEFAULT_MIXER = "rmeBabyfaceOsc"
$env:FESTIMIX_SKIP_LAST_RUN = "1"
$env:O1V_DEFAULT_WORKSPACE = Join-Path ([Environment]::GetFolderPath("MyDocuments")) "12-4-2 live mixer.tmws"

Write-Host ""
Write-Host "Festimix V3.1osc inditas" -ForegroundColor Cyan
Write-Host "Projekt: $projectRoot"
Write-Host "Default mixer: RME Babyface OSC"
Write-Host "Workspace: $env:O1V_DEFAULT_WORKSPACE"
Write-Host ""
Write-Host "Figyelmeztetes: legyen bekapcsolva az adat extender (Behringer ADA vagy mas)." -ForegroundColor Yellow
Write-Host "Web UI: $url"
Write-Host ""

Start-Job -Name "FestimixV31OscBrowserOpen" -ScriptBlock {
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
