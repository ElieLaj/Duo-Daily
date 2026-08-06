<#
    Enregistre le bot comme tache planifiee Windows, declenchee a l'ouverture
    de session. A relancer si tu deplaces le dossier du projet.

    Usage :  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
#>
[CmdletBinding()]
param(
    [string]$TaskName = 'BotElo',
    [int]$DelaySeconds = 45,
    # -NoTray : lance node directement, sans icone dans la zone de notification.
    [switch]$NoTray
)

$ErrorActionPreference = 'Stop'

$root  = Split-Path -Parent $PSScriptRoot
$entry = Join-Path $root 'src\index.js'
if (-not (Test-Path $entry)) { throw "Point d'entree introuvable : $entry" }

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw "node.exe est introuvable dans le PATH. Installe Node.js puis relance ce script." }
$node = $nodeCmd.Source

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    throw "Dependances absentes. Lance d'abord : npm install"
}

$logFile = Join-Path $root 'logs\bot.log'

# C'est l'application qui ecrit logs\bot.log (voir src/logger.js) : aucun
# wrapper cmd.exe pour rediriger la sortie, sinon le planificateur ne
# controlerait que cmd et laisserait node orphelin a l'arret.
if ($NoTray) {
    $action = New-ScheduledTaskAction -Execute $node `
                                      -Argument '"src\index.js"' `
                                      -WorkingDirectory $root
}
else {
    # L'hote de la zone de notification masque sa propre console et lance node
    # en enfant invisible : rien dans la barre des taches, une icone dans la
    # barre systeme. Voir scripts/tray.ps1.
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
                                      -Argument '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "scripts\tray.ps1"' `
                                      -WorkingDirectory $root
}

$userId  = "$env:USERDOMAIN\$env:USERNAME"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
# Laisse le temps a la connexion reseau de s'etablir avant de joindre Discord.
$trigger.Delay = "PT${DelaySeconds}S"

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
                                         -DontStopIfGoingOnBatteries `
                                         -StartWhenAvailable `
                                         -RestartCount 3 `
                                         -RestartInterval (New-TimeSpan -Minutes 5) `
                                         -ExecutionTimeLimit ([TimeSpan]::Zero)
$settings.Hidden = $true

$description = 'Bot Discord : resume quotidien de progression LP (League of Legends)'

function Register-Task([string]$LogonType) {
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType $LogonType -RunLevel Limited
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
                           -Settings $settings -Principal $principal `
                           -Description $description -Force | Out-Null
}

if ($NoTray) {
    # S4U ("run whether user is logged on or not", sans mot de passe stocke)
    # execute la tache hors session interactive : aucune fenetre du tout.
    # Certaines configurations le refusent ; on retombe alors sur Interactive.
    try {
        Register-Task 'S4U'
        $mode = 'S4U (aucune fenetre, pas d icone)'
    }
    catch {
        Write-Warning "Mode S4U refuse ($($_.Exception.Message.Trim())). Repli en mode interactif."
        Register-Task 'Interactive'
        $mode = 'Interactive (une fenetre console peut apparaitre brievement)'
    }
}
else {
    # Obligatoirement Interactive : une icone de zone de notification ne peut
    # exister que dans la session de l'utilisateur. S4U tourne en session 0,
    # qui n'a aucune interface graphique, et l'icone n'apparaitrait jamais.
    Register-Task 'Interactive'
    $mode = 'Interactive + icone dans la zone de notification'
}

Write-Host ""
Write-Host "Tache '$TaskName' enregistree." -ForegroundColor Green
Write-Host "  Mode        : $mode"
Write-Host "  Declencheur : ouverture de session (+${DelaySeconds}s)"
Write-Host "  Dossier     : $root"
Write-Host "  Journal     : $logFile"

# Un demarrage immediat n'aurait aucun sens si la config Discord est incomplete.
$envFile = Join-Path $root '.env'
$ready = $false
if (Test-Path $envFile) {
    $content = Get-Content $envFile -Raw
    $ready = ($content -match '(?m)^\s*DISCORD_TOKEN\s*=\s*\S') -and
             ($content -match '(?m)^\s*DISCORD_CHANNEL_ID\s*=\s*\S')
}

Write-Host ""
if ($ready) {
    Write-Host "Demarrage immediat..." -ForegroundColor Cyan
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Lance. Verifie le journal : Get-Content '$logFile' -Wait"
} else {
    Write-Warning "DISCORD_TOKEN et/ou DISCORD_CHANNEL_ID ne sont pas remplis dans .env."
    Write-Host "Remplis-les, puis demarre avec : Start-ScheduledTask -TaskName '$TaskName'"
}
