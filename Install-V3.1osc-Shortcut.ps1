$ErrorActionPreference = "Stop"

$projectRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Path }
$startScript = Join-Path $projectRoot "Start-V3.1osc.bat"
$iconPath = Join-Path $projectRoot "assets\homescreen512.ico"

$shell = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath("Desktop")
$startMenuPath = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"

$shortcuts = @(
    (Join-Path $desktopPath "V3.1osc.lnk"),
    (Join-Path $startMenuPath "V3.1osc.lnk")
)

foreach ($shortcutPath in $shortcuts) {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcut.TargetPath = $startScript
    $shortcut.WorkingDirectory = $projectRoot
    if (Test-Path $iconPath) {
        $shortcut.IconLocation = $iconPath
    }
    $shortcut.Save()
    Write-Host "Shortcut created: $shortcutPath"
}
