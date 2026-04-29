# Scarlet Technical — Windows Device Lock Agent

Background service that survives reboots, shows a full-screen lock overlay on missed payments, and phones home every 5 minutes for commands. No build step required — pure PowerShell.

---

## How It Works

1. **Installer** (`installer-template.ps1`) — runs once at setup time. Creates agent directory, downloads the agent script, sets up scheduled tasks.
2. **Agent** (`ScarletAgent.ps1`) — runs every 5 minutes as SYSTEM. Sends heartbeat to server, processes lock/unlock/wipe commands.
3. **Watchdog** — hourly task that re-creates the main task if it's been deleted.

---

## Deployment (Admin Dashboard → Devices → Install Agent → Windows)

1. Generate a Windows enrollment token in the admin dashboard
2. Click **Download PowerShell Installer** — this downloads `scarlet-agent-install.ps1` with the token pre-embedded
3. Copy the installer to the customer's Windows PC (USB drive, email, etc.)
4. On the customer's PC:
   ```
   powershell -ExecutionPolicy Bypass -File scarlet-agent-install.ps1
   ```
   Or right-click the file → **Run with PowerShell** as Administrator
5. The installer will:
   - Create `C:\Windows\System32\ScarletAgent\` (restricted permissions)
   - Download `ScarletAgent.ps1` from the server
   - Create a scheduled task that runs every 5 minutes as SYSTEM
   - Create a watchdog task that runs hourly
   - Run the agent immediately to enroll the device

---

## Files

| File | Purpose |
|------|---------|
| `ScarletAgent.ps1` | Main agent script — heartbeat, lock/unlock/wipe |
| `installer-template.ps1` | Installer with `__SERVER_URL__` and `__TOKEN__` placeholders (server fills them in at download time) |

---

## Lock Behavior

When the admin issues a `lock` command:
- The agent launches a **full-screen WPF overlay** (black background, red "DEVICE LOCKED" text)
- Shows the custom payment message from the server
- Shows contact info: `(765) 555-0100` and `scarlet-technical.onrender.com`
- Blocks Alt+F4, Escape, and window close events
- On every subsequent heartbeat, if lock_status=locked and no overlay is running, it re-launches the overlay

When the admin issues an `unlock` command:
- The agent kills all running lock overlay jobs
- Removes the lock flag file

---

## Tamper Resistance

- Agent directory (`C:\Windows\System32\ScarletAgent\`) is ACL'd to SYSTEM + Administrators only
- Runs as SYSTEM — cannot be stopped by standard user
- Watchdog recreates the scheduled task if it's deleted
- Even if an admin deletes the tasks and agent, the device will remain "locked" in the database until an unlock command is issued and agent re-installed

---

## System Requirements

- Windows 7+ (PowerShell 3+)
- Administrator rights to install
- HTTPS outbound (port 443) to `scarlet-technical.onrender.com`

---

## Code-Only Notice

This agent is **code-only** — no build step is needed. PowerShell scripts run directly. To deploy, generate a token from the admin dashboard and download the pre-configured installer.
