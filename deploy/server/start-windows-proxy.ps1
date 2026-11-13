param(
    [Parameter(Mandatory)][string]$Server,
    [Parameter(Mandatory)][string]$IdentityFile,
    [ValidateRange(1,65535)][int]$LocalProxyPort = 7890,
    [ValidateRange(1,65535)][int]$RemoteProxyPort = 17890
)
$ErrorActionPreference = 'Stop'
if ($Server -notmatch '^[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+$') { throw 'Use username@hostname for Server.' }
$identity = (Resolve-Path -LiteralPath $IdentityFile).Path
if ($identity.Contains('"')) { throw 'Unsupported quote in identity path.' }
if (!(Test-NetConnection 127.0.0.1 -Port $LocalProxyPort -InformationLevel Quiet -WarningAction SilentlyContinue)) {
    throw 'Start the Windows local proxy first.'
}
$logDir = Join-Path $PSScriptRoot '../../target/server-deploy'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$logDir = (Resolve-Path -LiteralPath $logDir).Path
# The remote listener is loopback-only. Fail rather than replace an existing tunnel.
$arguments = @('-F','NUL','-N','-T','-i',('"' + $identity + '"'),
    '-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes',
    '-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',
    '-R',("127.0.0.1:{0}:127.0.0.1:{1}" -f $RemoteProxyPort,$LocalProxyPort),$Server)
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$errLog = Join-Path $logDir "proxy-$stamp-error.log"
$process = Start-Process ssh -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardError $errLog -RedirectStandardOutput (Join-Path $logDir "proxy-$stamp-output.log")
Start-Sleep -Seconds 2
$process.Refresh()
if ($process.HasExited) { throw "Proxy tunnel did not start. See $errLog" }
Set-Content -LiteralPath (Join-Path $logDir 'proxy.pid') -Value $process.Id -Encoding utf8
Write-Output "SSH tunnel started (PID $($process.Id)). Verify remote HTTP access before use. Closing Windows or its proxy interrupts this tunnel."
