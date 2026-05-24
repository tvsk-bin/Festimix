$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$startScript = Join-Path $projectRoot "Start-Yamaha01V.bat"
$iconPath = Join-Path $projectRoot "assets\homescreen512.ico"

$shell = New-Object -ComObject WScript.Shell
$desktopPath = [Environment]::GetFolderPath("Desktop")
$startMenuPath = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs"

$shortcuts = @(
    (Join-Path $desktopPath "01vv2.lnk"),
    (Join-Path $startMenuPath "01vv2.lnk")
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
