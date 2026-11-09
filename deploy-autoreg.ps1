#Requires -RunAsAdministrator
[CmdletBinding()]
param([string]$Server = '160.5.219.29', [string]$Hostname = $env:COMPUTERNAME, [string]$Site, [string]$RegistrationKey, [ValidateSet('cash','occasional')][string]$Mode = 'occasional', [bool]$ResticMonitoring = $false)
$ErrorActionPreference = 'Stop'
if (-not $Site) { $Site = Read-Host 'Enter pharmacy name or number (Latin letters, digits, dash or underscore)' }
$Site = $Site.Trim()
if ($Site -notmatch '^[A-Za-z0-9_-]{1,64}$') { throw 'Pharmacy name must be 1-64 Latin letters, digits, dashes or underscores.' }
$Hostname = "$Site-$Hostname"
if ($Hostname.Length -gt 128) { throw 'The resulting host name exceeds 128 characters.' }
if ($Hostname -notmatch '^[A-Za-z0-9_. -]+$' -or $Server -notmatch '^[A-Za-z0-9.:-]+$') { throw 'Invalid hostname or server.' }
if (-not [Environment]::Is64BitOperatingSystem) { throw 'This installer requires 64-bit Windows.' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$existingConfig = 'C:\Program Files\Zabbix Agent 2\zabbix_agent2.conf'
if ((Test-Path -LiteralPath $existingConfig) -and -not (Test-Path -LiteralPath 'C:\zabbix\autoregistration.psk')) { throw 'An existing agent configuration was detected. It was not changed; contact the administrator before migration.' }
if (Test-Path -LiteralPath $existingConfig) {
    $currentHost = @(Get-Content -LiteralPath $existingConfig | Where-Object { $_ -match '^\s*Hostname\s*=' })
    if ($currentHost.Count -ne 1) { throw 'Existing agent configuration must contain exactly one explicit Hostname. No changes were made.' }
    $existingHost = ($currentHost[0] -split '=',2)[1].Trim()
    if (-not $existingHost -or $existingHost.Length -gt 128 -or $existingHost -notmatch '^[A-Za-z0-9_. -]+$') { throw 'Existing agent Hostname is invalid or uses an unsupported format. No changes were made.' }
    if ($existingHost -cne $Hostname) { Write-Host "Existing Zabbix host name preserved: $existingHost" }
    $Hostname = $existingHost
}
if (Test-Path -LiteralPath 'C:\zabbix\autoregistration.psk') {
    $existingKey = [IO.File]::ReadAllText('C:\zabbix\autoregistration.psk').Trim()
    if ($existingKey -notmatch '^[0-9a-fA-F]{64}$' -or $existingKey -ine $RegistrationKey) { throw 'The existing registration key is invalid or differs from the supplied key. No changes were made.' }
}
function Install-PackageIfMissing($Path, $Id, $Version, $Url, $Sha256, $Kind) {
    if (Test-Path -LiteralPath $Path) { return }
    $installer = Join-Path $env:TEMP $(if ($Kind -eq 'msi') { 'zabbix-agent2-7.0.19.msi' } else { 'smartmontools-7.5.exe' })
    Write-Host "Downloading $Id..."
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $installer
    if ((Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash -ne $Sha256) { throw "Checksum mismatch for $Id; installation stopped." }
    if ($Kind -eq 'msi') {
        $process = Start-Process msiexec.exe -ArgumentList @('/i', ('"' + $installer + '"'), '/qn', '/norestart', 'SERVER=127.0.0.1') -Wait -PassThru
    } else {
        $process = Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
    }
    if ($process.ExitCode -notin @(0, 3010, 1641) -or -not (Test-Path -LiteralPath $Path)) { throw "Installation failed for $Id (exit $($process.ExitCode)); executable not found or installer failed." }
}
$smart = 'C:\Program Files\smartmontools\bin\smartctl.exe'
$agent = 'C:\Program Files\Zabbix Agent 2\zabbix_agent2.exe'
$conf = 'C:\Program Files\Zabbix Agent 2\zabbix_agent2.conf'
Install-PackageIfMissing $smart 'smartmontools' '7.5' 'https://github.com/smartmontools/smartmontools/releases/download/RELEASE_7_5/smartmontools-7.5.win32-setup.exe' '896337FCC253220614CF8CDBD5CF2321C5AA326A37A04160A672A281E6104C70' 'exe'
Install-PackageIfMissing $agent 'Zabbix Agent 2' '7.0.19' 'https://cdn.zabbix.com/zabbix/binaries/stable/7.0/7.0.19/zabbix_agent2-7.0.19-windows-amd64-openssl.msi' '8806383AF824F085464C9FC2B2C067FEBB0EFCF34FC48EA95BA9310B56509C9C' 'msi'
if (-not (Test-Path -LiteralPath $conf)) { throw "Agent configuration not found: $conf" }
$bin = Split-Path $smart
$machinePath = [Environment]::GetEnvironmentVariable('Path','Machine')
if (($machinePath -split ';') -notcontains $bin) { [Environment]::SetEnvironmentVariable('Path', "$machinePath;$bin", 'Machine') }
New-Item -ItemType Directory -Path 'C:\zabbix' -Force | Out-Null
$tempScript = @'
$ErrorActionPreference = 'Stop'
try {
    $zones = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Where-Object { $_.CurrentTemperature -gt 0 })
    if ($zones.Count -eq 0) { throw 'No ACPI thermal sensors available' }
    $temperature = ($zones | ForEach-Object { ($_.CurrentTemperature / 10.0) - 273.15 } | Measure-Object -Maximum).Maximum
    if ($temperature -lt -50 -or $temperature -gt 150) { throw 'Invalid ACPI temperature' }
    [Console]::WriteLine($temperature.ToString('F1', [Globalization.CultureInfo]::InvariantCulture))
} catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }
'@
[IO.File]::WriteAllText('C:\zabbix\get_temp.ps1', $tempScript, [Text.Encoding]::ASCII)
$pskPath = 'C:\zabbix\autoregistration.psk'
if (-not (Test-Path -LiteralPath $pskPath)) {
    $psk = $RegistrationKey
    if ($psk -notmatch '^[0-9a-fA-F]{64}$') { throw 'The registration key must contain 64 hexadecimal characters.' }
    [IO.File]::WriteAllText($pskPath, $psk, [Text.Encoding]::ASCII)
} else { $psk = [IO.File]::ReadAllText($pskPath).Trim() }
if ($psk -notmatch '^[0-9a-fA-F]{64}$') { throw 'Invalid existing registration key.' }
if ($RegistrationKey -and $psk -ine $RegistrationKey) { throw 'The existing registration key differs from the supplied key. No configuration was changed.' }
& icacls.exe $pskPath /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to secure the PSK file.' }
$identity = 'kzvs-pharmacies-registration-v1'
$metadata = "kzvs-pharmacy-windows-v1 kzvs-mode-$Mode"
if ($ResticMonitoring) {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'restic-task-status.ps1') -Destination 'C:\zabbix\restic-task-status.ps1' -Force
    $metadata += ' kzvs-restic-yes'
} else { $metadata += ' kzvs-restic-no' }
$lines = @(Get-Content -LiteralPath $conf | Where-Object { $_ -notmatch '^\s*(Server|ServerActive|Hostname|Plugins\.Smart\.Path|TLSConnect|TLSAccept|TLSPSKIdentity|TLSPSKFile|HostMetadata)\s*=' -and $_ -notmatch '^\s*UserParameter\s*=\s*windows\.temp\.cpu\s*,' -and $_ -notmatch '^\s*UserParameter\s*=\s*restic\.tasks\.get\s*,' })
$lines += "Server=$Server", "ServerActive=$Server", "Hostname=$Hostname", "Plugins.Smart.Path=$smart", 'UserParameter=windows.temp.cpu,powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\zabbix\get_temp.ps1', "HostMetadata=$metadata", 'TLSConnect=psk', 'TLSAccept=psk', "TLSPSKIdentity=$identity", "TLSPSKFile=$pskPath"
if ($ResticMonitoring) { $lines += 'UserParameter=restic.tasks.get,powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\zabbix\restic-task-status.ps1' }
Copy-Item -LiteralPath $conf -Destination "$conf.before-zabbix-infra.bak" -Force
Set-Content -LiteralPath $conf -Value $lines -Encoding ASCII
& $agent -c $conf -t agent.ping
if ($LASTEXITCODE -ne 0) { throw 'Agent configuration test failed; see backup beside config.' }
Restart-Service -Name 'Zabbix Agent 2' -ErrorAction Stop
Write-Host "`n===== ZABBIX HOST SETTINGS ====="
Write-Host "Host name: $Hostname"
Write-Host "Pharmacy: $Site"
Write-Host "Server: $Server (active checks, TCP 10051)"
Write-Host "Templates: SMART by Zabbix agent 2 active; Windows ACPI temperature"
Write-Host 'Connections from host: PSK (disable No encryption)'
Write-Host "PSK identity: $identity"
Write-Host 'Registration will complete automatically if the registration key is valid.'
Write-Host 'The registration key is shared and must remain secret.'
Write-Host "PSK file: $pskPath"
