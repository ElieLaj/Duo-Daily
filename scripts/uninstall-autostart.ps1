<#
    Supprime la tache planifiee creee par install-autostart.ps1.

    Usage :  powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart.ps1

    NOTE : ce fichier est volontairement en ASCII pur. Windows PowerShell 5.1
    lit un .ps1 sans BOM comme de l'ANSI ; un caractere UTF-8 accentue s'y
    decode en U+201D, que le parseur prend pour un guillemet fermant.
#>
[CmdletBinding()]
param([string]$TaskName = 'BotElo')

$ErrorActionPreference = 'Stop'

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $task) {
    Write-Host "Aucune tache '$TaskName' enregistree, rien a faire."
    return
}

if ($task.State -eq 'Running') { Stop-ScheduledTask -TaskName $TaskName }

# Le planificateur ne tue que le processus qu'il a lance (l'hote de la zone de
# notification) : le node enfant survivrait sans ce nettoyage explicite.
$root    = Split-Path -Parent $PSScriptRoot
$pidFile = Join-Path $root 'logs\bot.pid'
if (Test-Path $pidFile) {
    $botPid = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($botPid -match '^\d+$') {
        $p = Get-Process -Id ([int]$botPid) -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq 'node') {
            Stop-Process -Id ([int]$botPid) -Force -ErrorAction SilentlyContinue
            Write-Host "Processus du bot (PID $botPid) arrete."
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false

Write-Host "Tache '$TaskName' supprimee." -ForegroundColor Green
Write-Host "Le projet, le .env et l'historique (data\snapshots.json) sont conserves."
