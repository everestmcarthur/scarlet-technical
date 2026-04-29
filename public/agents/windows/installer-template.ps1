# Scarlet Technical Device Agent - Windows Installer
# Run as Administrator: powershell -ExecutionPolicy Bypass -File scarlet-agent-install.ps1

param([string]$ServerUrl = "__SERVER_URL__", [string]$Token = "__TOKEN__")

$AgentDir = "C:\Windows\System32\ScarletAgent"
$AgentScript = "$AgentDir\ScarletAgent.ps1"
$TaskName = "ScarletTechnicalAgent"
$WatchdogTask = "ScarletTechnicalWatchdog"

Write-Host "[Scarlet Technical] Starting agent installation..." -ForegroundColor Cyan

# Require admin
$CurrentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($CurrentUser)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "[ERROR] Must run as Administrator" -ForegroundColor Red
    Start-Process powershell -Verb RunAs -ArgumentList "-ExecutionPolicy Bypass -File `"$PSCommandPath`""
    exit 1
}

# Create agent directory
if (-not (Test-Path $AgentDir)) { New-Item -ItemType Directory -Path $AgentDir -Force | Out-Null }

# Restrict directory permissions (SYSTEM + Admins only)
$Acl = Get-Acl $AgentDir
$Acl.SetAccessRuleProtection($true, $false)
$SysRule = New-Object System.Security.AccessControl.FileSystemAccessRule("SYSTEM","FullControl","ContainerInherit,ObjectInherit","None","Allow")
$AdminRule = New-Object System.Security.AccessControl.FileSystemAccessRule("Administrators","FullControl","ContainerInherit,ObjectInherit","None","Allow")
$Acl.AddAccessRule($SysRule)
$Acl.AddAccessRule($AdminRule)
Set-Acl -Path $AgentDir -AclObject $Acl

# Write config
@{ ServerUrl = $ServerUrl; Token = $Token; PollIntervalSeconds = 300 } | ConvertTo-Json | Set-Content "$AgentDir\config.json" -Force

# Download the agent script from server
$AgentUrl = "$ServerUrl/agents/windows/ScarletAgent.ps1"
try {
    Invoke-WebRequest -Uri $AgentUrl -OutFile $AgentScript -UseBasicParsing
    Write-Host "[Scarlet Technical] Agent script downloaded." -ForegroundColor Cyan
} catch {
    Write-Host "[ERROR] Could not download agent script: $_" -ForegroundColor Red
    exit 1
}

# Create scheduled task (runs every 5 minutes as SYSTEM)
schtasks /Delete /TN "$TaskName" /F 2>$null
schtasks /Create /TN "$TaskName" /TR "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$AgentScript`"" /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F
schtasks /Run /TN "$TaskName"

# Create watchdog (runs hourly)
$WatchdogScript = "$AgentDir\watchdog.ps1"
@"
`$TaskName = "ScarletTechnicalAgent"
`$AgentScript = "C:\Windows\System32\ScarletAgent\ScarletAgent.ps1"
`$task = Get-ScheduledTask -TaskName `$TaskName -ErrorAction SilentlyContinue
if (-not `$task) {
  schtasks /Create /TN "`$TaskName" /TR "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"`$AgentScript`"" /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F
  schtasks /Run /TN "`$TaskName"
}
"@ | Set-Content $WatchdogScript -Force -Encoding UTF8
schtasks /Delete /TN "$WatchdogTask" /F 2>$null
schtasks /Create /TN "$WatchdogTask" /TR "powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$WatchdogScript`"" /SC HOURLY /RU SYSTEM /RL HIGHEST /F

Write-Host "[Scarlet Technical] Agent installed successfully." -ForegroundColor Green
Write-Host "Agent will run every 5 minutes. Lock/unlock commands will be processed automatically." -ForegroundColor Green
