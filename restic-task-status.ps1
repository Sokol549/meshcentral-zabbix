# Returns scheduler status for tasks created by the Restic generator.
$ErrorActionPreference = 'Stop'
try {
    $tasks = @(Get-ScheduledTask | Where-Object { $_.TaskPath -eq '\' -and $_.TaskName -like 'ResticBackup_*' } | ForEach-Object {
        $task = $_
        $info = $task | Get-ScheduledTaskInfo
        $lastRun = 0
        if ($info.LastRunTime.Year -ge 2000) { $lastRun = [int64]([DateTimeOffset]$info.LastRunTime).ToUnixTimeSeconds() }
        $report = $null
        $workdir = @($task.Actions | Where-Object { $_.WorkingDirectory } | Select-Object -First 1).WorkingDirectory
        if ($workdir) {
            $reportPath = Join-Path ([Environment]::ExpandEnvironmentVariables([string]$workdir)) 'backup_status.json'
            if (Test-Path -LiteralPath $reportPath -PathType Leaf) {
                try { $report = Get-Content -LiteralPath $reportPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { $report = $null }
            }
        }
        $codes = @{ pending=1; running=2; success=3; failed=4; partial=5 }
        $backup = 0; $verification = 0; $cleanup = 0; $confirmedAt = 0; $snapshotId = ''; $reportPresent = 0
        if ($report -and $report.schema -eq 1) {
            $reportPresent = 1
            foreach ($pair in @(@('backup','backup'),@('verification','verification'),@('cleanup','cleanup'))) {
                $prop = $report.PSObject.Properties[$pair[0]]
                if ($prop -and $codes.ContainsKey([string]$prop.Value)) { Set-Variable -Name $pair[1] -Value $codes[[string]$prop.Value] }
            }
            if ($report.last_snapshot_utc) { try { $confirmedAt = [DateTimeOffset]::Parse([string]$report.last_snapshot_utc).ToUnixTimeSeconds() } catch { } }
            if ($report.last_confirmed_id -match '^[0-9a-fA-F]{8,64}$') { $snapshotId = [string]$report.last_confirmed_id }
        }
        [PSCustomObject]@{
            name = [string]$task.TaskName
            path = [string]$task.TaskPath
            state = [string]$task.State
            last_run = $lastRun
            last_result = ([int64]$info.LastTaskResult -band 4294967295L)
            report_present = $reportPresent
            backup = $backup
            verification = $verification
            cleanup = $cleanup
            last_snapshot = $confirmedAt
            snapshot_id = $snapshotId
        }
    })
    @{ tasks = $tasks } | ConvertTo-Json -Depth 5 -Compress
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
