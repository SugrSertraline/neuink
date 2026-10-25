$ErrorActionPreference = 'Stop'
$desktopRoot = Split-Path -Parent $PSScriptRoot
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $desktopRoot '..\..'))
$logDirectory = Join-Path $repositoryRoot 'target\desktop-dev'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logPath = Join-Path $logDirectory 'launcher.log'
$developmentExe = Join-Path $repositoryRoot 'target\debug\neuink-desktop.exe'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NeuInkLauncherWindow {
    [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
}
'@

function Show-DevelopmentWindow {
    foreach ($candidate in @(Get-Process -Name 'neuink-desktop' -ErrorAction SilentlyContinue)) {
        try {
            if ($candidate.Path -ne $developmentExe -or $candidate.MainWindowHandle -eq 0) { continue }
            $handle = $candidate.MainWindowHandle
            $command = if ([NeuInkLauncherWindow]::IsIconic($handle)) { 9 } else { 5 }
            [NeuInkLauncherWindow]::ShowWindowAsync($handle, $command) | Out-Null
            (New-Object -ComObject WScript.Shell).AppActivate($candidate.Id) | Out-Null
            [NeuInkLauncherWindow]::SetForegroundWindow($handle) | Out-Null
            return $true
        } catch { continue } # The app may exit between discovery and activation.
    }
    return $false
}

# Keep repeated shortcut clicks from starting competing development servers.
$launcherMutex = [Threading.Mutex]::new($false, 'Local\NeuInkDesktopDevelopmentLauncher')
$ownsMutex = $false
$startupForm = $null
try {
    if (Show-DevelopmentWindow) { exit 0 }
    try { $ownsMutex = $launcherMutex.WaitOne(0) }
    catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
    if (-not $ownsMutex) {
        (New-Object -ComObject WScript.Shell).Popup('Neuink 正在启动，请稍候。准备好后会自动打开窗口。', 4, 'Neuink 开发测试', 64) | Out-Null
        exit 0
    }

    Set-Location -LiteralPath $desktopRoot
    $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
    "NeuInk development startup: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" | Set-Content -LiteralPath $logPath -Encoding UTF8

    $startupForm = New-Object System.Windows.Forms.Form
    $startupForm.Text = 'Neuink 开发测试'
    $startupForm.ClientSize = New-Object System.Drawing.Size(420, 132)
    $startupForm.StartPosition = 'CenterScreen'
    $startupForm.FormBorderStyle = 'FixedDialog'
    $startupForm.ControlBox = $false
    $startupForm.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 10)
    $statusLabel = New-Object System.Windows.Forms.Label
    $statusLabel.SetBounds(20, 16, 380, 64)
    $statusLabel.Text = "正在启动最新版 Neuink…`r`n首次启动或更新后需要编译，请稍候。"
    $progress = New-Object System.Windows.Forms.ProgressBar
    $progress.SetBounds(20, 94, 380, 12)
    $progress.Style = 'Marquee'
    $startupForm.Controls.AddRange(@($statusLabel, $progress))
    $startupForm.Show()
    [NeuInkLauncherWindow]::ShowWindowAsync($startupForm.Handle, 5) | Out-Null
    [System.Windows.Forms.Application]::DoEvents()

    # Hide only the console. Do not pass SW_HIDE down to the GUI application.
    # Node writes UTF-8 directly so compiler stderr is not a PowerShell error.
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $nodePath
    $startInfo.Arguments = '"' + (Join-Path $PSScriptRoot 'dev-d-data.cjs') + '"'
    $startInfo.WorkingDirectory = $desktopRoot
    $startInfo.UseShellExecute = $false
    $startInfo.CreateNoWindow = $true
    $startInfo.EnvironmentVariables['NEUINK_DEV_LOG_FILE'] = $logPath
    $developmentProcess = [System.Diagnostics.Process]::Start($startInfo)
    $startedAt = Get-Date
    $shown = $false
    while (-not $developmentProcess.HasExited) {
        if (Show-DevelopmentWindow) { $shown = $true; break }
        $elapsed = [int]((Get-Date) - $startedAt).TotalSeconds
        $statusLabel.Text = "正在准备最新版 Neuink… 已等待 $elapsed 秒`r`n准备好后会自动打开，资料仍保存在 D 盘。"
        [System.Windows.Forms.Application]::DoEvents()
        Start-Sleep -Milliseconds 200
    }
    $startupForm.Close()
    if (-not $shown) { throw '启动未完成。请查看启动日志中的具体原因。' }
    $developmentProcess.WaitForExit()
    if ($developmentProcess.ExitCode -ne 0) { throw "开发程序异常退出（$($developmentProcess.ExitCode)）。" }
    exit 0
} catch {
    if ($startupForm) { $startupForm.Close() }
    $_ | Out-String | Add-Content -LiteralPath $logPath -Encoding UTF8
    [System.Windows.Forms.MessageBox]::Show("Neuink 启动失败：$($_.Exception.Message)`r`n`r`n日志位置：$logPath", 'Neuink 开发测试', 'OK', 'Error') | Out-Null
    exit 1
} finally {
    if ($startupForm) { $startupForm.Dispose() }
    if ($ownsMutex) { $launcherMutex.ReleaseMutex() }
    $launcherMutex.Dispose()
}
