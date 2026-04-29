#!/bin/bash
# Scarlet Technical Device Agent - Linux Installer
# Run as root: sudo bash scarlet-agent-install.sh

set -e

SERVER_URL="__SERVER_URL__"
TOKEN="__TOKEN__"
AGENT_DIR="/opt/scarlet-agent"
AGENT_SCRIPT="$AGENT_DIR/scarlet-agent.sh"
LOCK_SCRIPT="$AGENT_DIR/scarlet-lock.sh"
SERVICE_FILE="/etc/systemd/system/scarlet-agent.service"
TIMER_FILE="/etc/systemd/system/scarlet-agent.timer"
WATCHDOG_SVC="/etc/systemd/system/scarlet-watchdog.service"
WATCHDOG_TMR="/etc/systemd/system/scarlet-watchdog.timer"
UUID_FILE="$AGENT_DIR/device_uuid"
LOG_FILE="/var/log/scarlet-agent.log"

RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'; NC='\033[0m'

echo -e "${CYAN}[Scarlet Technical] Starting Linux agent installation...${NC}"
[ "$EUID" -ne 0 ] && { echo -e "${RED}[ERROR] Must run as root.${NC}"; exit 1; }

# Install dependencies
command -v curl &>/dev/null || { apt-get install -y curl 2>/dev/null || dnf install -y curl 2>/dev/null || true; }
command -v jq &>/dev/null || { apt-get install -y jq 2>/dev/null || dnf install -y jq 2>/dev/null || true; }

mkdir -p "$AGENT_DIR"
chmod 700 "$AGENT_DIR"
chown root:root "$AGENT_DIR"

# Write config
cat > "$AGENT_DIR/config.json" <<CONFEOF
{"server_url":"$SERVER_URL","token":"$TOKEN","poll_interval":300}
CONFEOF
chmod 600 "$AGENT_DIR/config.json"

# Generate device UUID
if [ ! -f "$UUID_FILE" ]; then
  (cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || echo "$(hostname)-$(date +%s%N | sha256sum | head -c 32)") > "$UUID_FILE"
  chmod 600 "$UUID_FILE"
fi

# Download agent script from server
echo "Downloading agent script from $SERVER_URL..."
curl -sf "$SERVER_URL/agents/linux/scarlet-agent.sh" -o "$AGENT_SCRIPT" --connect-timeout 15 --max-time 30 || {
  echo -e "${RED}[ERROR] Could not download agent script. Check server connectivity.${NC}"; exit 1;
}
chmod 700 "$AGENT_SCRIPT"

# Download lock script
curl -sf "$SERVER_URL/agents/linux/scarlet-lock.sh" -o "$LOCK_SCRIPT" --connect-timeout 15 --max-time 30 || {
  echo -e "${RED}[ERROR] Could not download lock script.${NC}"; exit 1;
}
chmod 700 "$LOCK_SCRIPT"

# Write systemd service
cat > "$SERVICE_FILE" <<SVCEOF
[Unit]
Description=Scarlet Technical Device Management Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$AGENT_SCRIPT
StandardOutput=append:$LOG_FILE
StandardError=append:$LOG_FILE
User=root

[Install]
WantedBy=multi-user.target
SVCEOF

# Write timer (every 5 minutes)
cat > "$TIMER_FILE" <<TIMEREOF
[Unit]
Description=Run Scarlet Technical Agent every 5 minutes
Requires=scarlet-agent.service

[Timer]
OnBootSec=30sec
OnUnitActiveSec=5min
Unit=scarlet-agent.service

[Install]
WantedBy=timers.target
TIMEREOF

# Watchdog service
cat > "$WATCHDOG_SVC" <<WDSVCEOF
[Unit]
Description=Scarlet Technical Watchdog
After=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'systemctl is-active --quiet scarlet-agent.timer || systemctl start scarlet-agent.timer'
User=root
WDSVCEOF

cat > "$WATCHDOG_TMR" <<WDTMREOF
[Unit]
Description=Scarlet Watchdog Timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=30min

[Install]
WantedBy=timers.target
WDTMREOF

# Tamper resistance: lock config and agent files
chattr +i "$AGENT_DIR/config.json" 2>/dev/null || true

# Enable and start
systemctl daemon-reload
systemctl enable scarlet-agent.timer scarlet-watchdog.timer 2>/dev/null || true
systemctl start scarlet-agent.timer 2>/dev/null || true
systemctl start scarlet-watchdog.timer 2>/dev/null || true
systemctl start scarlet-agent.service 2>/dev/null || true

echo -e "${GREEN}[Scarlet Technical] Linux agent installed and running.${NC}"
echo -e "${GREEN}Timer: every 5 minutes. Log: $LOG_FILE${NC}"
