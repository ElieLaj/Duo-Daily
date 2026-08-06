<#
    Hote de la zone de notification.

    Lance le bot sans aucune fenetre et place une icone dans la barre systeme
    (fleche "Afficher les icones cachees"), avec un menu pour le piloter.

    Une icone de notification doit vivre dans la session interactive de
    l'utilisateur : c'est pourquoi la tache planifiee ne peut pas utiliser le
    mode S4U, qui s'execute hors session et n'affiche aucune interface.

    Usage : powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File scripts\tray.ps1
            -ShowConsole pour garder la console visible (debogage).
#>
[CmdletBinding()]
param([switch]$ShowConsole)

$ErrorActionPreference = 'Stop'

$root    = Split-Path -Parent $PSScriptRoot
$entry   = Join-Path $root 'src\index.js'
$logFile = Join-Path $root 'logs\bot.log'
$pidFile = Join-Path $root 'logs\bot.pid'

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { throw "node.exe introuvable dans le PATH." }
$node = $nodeCmd.Source
if (-not (Test-Path $entry)) { throw "Point d'entree introuvable : $entry" }

New-Item -ItemType Directory -Force -Path (Join-Path $root 'logs') | Out-Null

# --- Masquage de la console de PowerShell lui-meme --------------------------
# -WindowStyle Hidden ne suffit pas toujours : la console peut apparaitre le
# temps que le processus demarre. ShowWindow la fait disparaitre tout de suite.
if (-not $ShowConsole) {
    $signature = @'
[DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@
    $native = Add-Type -MemberDefinition $signature -Name Win32 -Namespace Tray -PassThru
    $console = $native::GetConsoleWindow()
    if ($console -ne [IntPtr]::Zero) { [void]$native::ShowWindow($console, 0) }  # 0 = SW_HIDE
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# --- Cycle de vie du processus Node -----------------------------------------
$script:bot = $null

# Le PID est ecrit sur disque car la tache planifiee ne tue que PowerShell :
# sans ce fichier, un node orphelin survivrait et un second demarrerait a cote.
function Stop-Orphan {
    if (-not (Test-Path $pidFile)) { return }
    $old = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($old -match '^\d+$') {
        $p = Get-Process -Id ([int]$old) -ErrorAction SilentlyContinue
        if ($p -and $p.ProcessName -eq 'node') {
            try { Stop-Process -Id ([int]$old) -Force -ErrorAction Stop } catch {}
        }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}

function Start-Bot {
    Stop-Orphan
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName         = $node
    $psi.Arguments        = '"src\index.js"'
    $psi.WorkingDirectory = $root
    $psi.UseShellExecute  = $false
    $psi.CreateNoWindow   = $true   # aucune fenetre, aucune entree dans la barre des taches
    $script:bot = [System.Diagnostics.Process]::Start($psi)
    Set-Content -Path $pidFile -Value $script:bot.Id -Encoding ascii
}

function Stop-Bot {
    if ($script:bot -and -not $script:bot.HasExited) {
        try { $script:bot.Kill() } catch {}
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    $script:bot = $null
}

function Test-BotAlive {
    return ($null -ne $script:bot) -and (-not $script:bot.HasExited)
}

# --- Icone et menu ----------------------------------------------------------
# On passe par un PNG plutot qu'un .ico : le type Icon du .NET Framework gere
# mal les .ico a trames PNG, alors qu'un redimensionnement bicubique suivi de
# GetHicon donne un rendu net a la taille exacte attendue par la barre systeme
# (qui varie avec la mise a l'echelle DPI).
function New-TrayIcon {
    param([string]$Path)

    if (-not (Test-Path $Path)) { return [System.Drawing.Icon]::ExtractAssociatedIcon($node) }
    try {
        $source = [System.Drawing.Image]::FromFile($Path)
        $size   = [System.Windows.Forms.SystemInformation]::SmallIconSize
        $bitmap = New-Object System.Drawing.Bitmap $size.Width, $size.Height

        $g = [System.Drawing.Graphics]::FromImage($bitmap)
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        # Rectangles de destination ET de source explicites : l'overload a point
        # unique redimensionne selon le DPI de l'image, pas en pixels.
        $dest = New-Object System.Drawing.Rectangle 0, 0, $size.Width, $size.Height
        $src  = New-Object System.Drawing.Rectangle 0, 0, $source.Width, $source.Height
        $g.DrawImage($source, $dest, $src, [System.Drawing.GraphicsUnit]::Pixel)
        $g.Dispose()
        $source.Dispose()

        # Le HICON n'est pas possede par l'objet Icon : on le laisse vivre aussi
        # longtemps que le processus, ce qui est exactement sa duree d'usage.
        return [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
    }
    catch {
        return [System.Drawing.Icon]::ExtractAssociatedIcon($node)
    }
}

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon    = New-TrayIcon (Join-Path $root 'assets\icon.png')
$icon.Text    = 'Duo Daily'
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$itemStatus = New-Object System.Windows.Forms.ToolStripMenuItem 'Demarrage...'
$itemStatus.Enabled = $false
[void]$menu.Items.Add($itemStatus)
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$itemLog = New-Object System.Windows.Forms.ToolStripMenuItem 'Ouvrir le journal'
$itemLog.Add_Click({
    if (Test-Path $logFile) { Start-Process notepad.exe -ArgumentList "`"$logFile`"" }
})
[void]$menu.Items.Add($itemLog)

$itemNow = New-Object System.Windows.Forms.ToolStripMenuItem 'Poster le resume maintenant'
$itemNow.Add_Click({
    # Instance separee en --now : elle publie puis se termine, sans toucher
    # au bot principal qui continue d'attendre son horaire.
    Start-Process -FilePath $node -ArgumentList '"src\index.js" --now' `
                  -WorkingDirectory $root -WindowStyle Hidden
    $icon.ShowBalloonTip(3000, 'Duo Daily', 'Publication du resume en cours...',
                         [System.Windows.Forms.ToolTipIcon]::Info)
})
[void]$menu.Items.Add($itemNow)

$itemRestart = New-Object System.Windows.Forms.ToolStripMenuItem 'Redemarrer le bot'
$itemRestart.Add_Click({
    Stop-Bot
    Start-Bot
    $icon.ShowBalloonTip(3000, 'Duo Daily', 'Bot redemarre.',
                         [System.Windows.Forms.ToolTipIcon]::Info)
})
[void]$menu.Items.Add($itemRestart)

[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

$itemQuit = New-Object System.Windows.Forms.ToolStripMenuItem 'Quitter'
$itemQuit.Add_Click({
    Stop-Bot
    $icon.Visible = $false
    $icon.Dispose()
    [System.Windows.Forms.Application]::ExitThread()
})
[void]$menu.Items.Add($itemQuit)

$icon.ContextMenuStrip = $menu

# Double-clic sur l'icone : raccourci vers le journal.
$icon.Add_MouseDoubleClick({
    if (Test-Path $logFile) { Start-Process notepad.exe -ArgumentList "`"$logFile`"" }
})

# --- Surveillance -----------------------------------------------------------
# Le texte de l'icone (max 63 caracteres) sert d'indicateur d'etat, et le bot
# est relance automatiquement s'il s'arrete tout seul.
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({
    if (Test-BotAlive) {
        $itemStatus.Text = "En cours (PID $($script:bot.Id))"
        $icon.Text = 'Duo Daily - en cours'
    }
    else {
        $itemStatus.Text = 'Arrete - relance...'
        $icon.Text = 'Duo Daily - arrete'
        Start-Bot
    }
})
$timer.Start()

Start-Bot

# Nettoyage si le processus se termine normalement : sans Dispose, une icone
# fantome reste dans la barre jusqu'a ce qu'on passe la souris dessus.
$context = New-Object System.Windows.Forms.ApplicationContext
try {
    [System.Windows.Forms.Application]::Run($context)
}
finally {
    $timer.Stop()
    Stop-Bot
    if ($icon) { $icon.Visible = $false; $icon.Dispose() }
}
