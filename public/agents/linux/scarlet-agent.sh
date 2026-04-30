#!/bin/bash
# Scarlet Technical Device Agent - Linux Agent
# Runs every 5 minutes via systemd timer

CONFIG_FILE="/opt/scarlet-agent/config.json"
STATE_FILE="/opt/scarlet-agent/state.json"
LOG_FILE="/var/log/scarlet-agent.log"
UUID_FILE="/opt/scarlet-agent/device_uuid"
LOCK_SCRIPT="/opt/scarlet-agent/scarlet-lock.sh"
LOCK_PID_FILE="/opt/scarlet-agent/lock.pid"

log() {
  echo "$(date '+%Y-%m-%d %H:%M:%S') $1" >> "$LOG_FILE" 2>/dev/null || true
}

[ ! -f "$CONFIG_FILE" ] && log "No config file" && exit 1

SERVER_URL=$(jq -r '.server_url' "$CONFIG_FILE")
TOKEN=$(jq -r '.token' "$CONFIG_FILE")
DEVICE_UUID=$(cat "$UUID_FILE" 2>/dev/null || echo "unknown")
HOSTNAME_VAL=$(hostname)
OS_INFO=$(grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"' || uname -sr)

# Load or get device token
DEVICE_TOKEN=""
if [ -f "$STATE_FILE" ]; then
  DEVICE_TOKEN=$(jq -r '.device_token // empty' "$STATE_FILE" 2>/dev/null || echo "")
fi

# Enroll if no device token
if [ -z "$DEVICE_TOKEN" ]; then
  log "Enrolling device..."
  RESP=$(curl -sf -X POST "$SERVER_URL/api/agent/enroll" \
    -H "Content-Type: application/json" \
    -d "{\"enrollment_token\":\"$TOKEN\",\"device_uuid\":\"$DEVICE_UUID\",\"hostname\":\"$HOSTNAME_VAL\",\"os_info\":\"$OS_INFO\",\"platform\":\"linux\",\"agent_version\":\"1.0.0\"}" \
    --connect-timeout 15 --max-time 30 2>/dev/null)
  if [ $? -eq 0 ]; then
    DEVICE_TOKEN=$(echo "$RESP" | jq -r '.device_token // empty' 2>/dev/null)
    DEVICE_ID=$(echo "$RESP" | jq -r '.device_id // empty' 2>/dev/null)
    if [ -n "$DEVICE_TOKEN" ]; then
      echo "{\"device_token\":\"$DEVICE_TOKEN\",\"device_id\":\"$DEVICE_ID\"}" > "$STATE_FILE"
      chmod 600 "$STATE_FILE"
      log "Enrolled as device ID $DEVICE_ID"
    else
      log "Enrollment failed: $RESP"
      exit 1
    fi
  else
    log "Enrollment request failed (server unreachable)"
    exit 0
  fi
fi

# Collect telemetry
CPU_USAGE=$(top -bn1 2>/dev/null | grep "Cpu(s)" | awk '{print $2+$4}' || echo "")
MEM_USAGE=$(free 2>/dev/null | awk '/Mem:/{printf("%.1f", $3/$2*100)}' || echo "")
DISK_USAGE=$(df -h / 2>/dev/null | awk 'NR==2{gsub(/%/,""); print $5}' || echo "")
UPTIME_VAL=$(awk '{printf "%d", $1}' /proc/uptime 2>/dev/null || echo "")
BATTERY=""
if command -v upower &>/dev/null; then
  BATTERY=$(upower -i $(upower -e | grep battery | head -1) 2>/dev/null | grep percentage | awk '{gsub(/%/,""); print $2}' || echo "")
fi
IP_ADDR=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")

# Heartbeat
RESP=$(curl -sf -X POST "$SERVER_URL/api/agent/heartbeat" \
  -H "Content-Type: application/json" \
  -d "{\"device_token\":\"$DEVICE_TOKEN\",\"device_uuid\":\"$DEVICE_UUID\",\"current_status\":\"online\",\"hostname\":\"$HOSTNAME_VAL\",\"os_info\":\"$OS_INFO\",\"ip_address\":\"$IP_ADDR\",\"uptime\":\"$UPTIME_VAL\",\"cpu_usage\":\"$CPU_USAGE\",\"memory_usage\":\"$MEM_USAGE\",\"disk_usage\":\"$DISK_USAGE\",\"battery\":\"$BATTERY\",\"agent_version\":\"1.1.0\"}" \
  --connect-timeout 15 --max-time 30 2>/dev/null)

if [ $? -ne 0 ]; then log "Heartbeat failed (server unreachable)"; exit 0; fi

LOCK_STATUS=$(echo "$RESP" | jq -r '.lock_status // "unlocked"' 2>/dev/null)
CMD_ACTION=$(echo "$RESP" | jq -r '.command.action // empty' 2>/dev/null)
CMD_ID=$(echo "$RESP" | jq -r '.command.id // empty' 2>/dev/null)
CMD_MSG=$(echo "$RESP" | jq -r '.command.message // empty' 2>/dev/null)

log "Heartbeat OK. Lock: $LOCK_STATUS. Command: $CMD_ACTION"

NEW_LOCK_STATUS="$LOCK_STATUS"
RESULT="success"

if [ "$CMD_ACTION" = "lock" ]; then
  log "Executing LOCK command"
  NEW_LOCK_STATUS="locked"
  # Kill any existing lock
  if [ -f "$LOCK_PID_FILE" ]; then kill $(cat "$LOCK_PID_FILE") 2>/dev/null || true; fi
  nohup bash "$LOCK_SCRIPT" "$CMD_MSG" > /dev/null 2>&1 &
  echo $! > "$LOCK_PID_FILE"

elif [ "$CMD_ACTION" = "unlock" ]; then
  log "Executing UNLOCK command"
  NEW_LOCK_STATUS="unlocked"
  if [ -f "$LOCK_PID_FILE" ]; then
    LOCK_PID=$(cat "$LOCK_PID_FILE")
    kill "$LOCK_PID" 2>/dev/null || true
    rm -f "$LOCK_PID_FILE"
  fi
  pkill -f "scarlet-lock" 2>/dev/null || true
  pkill -f "zenity.*DEVICE LOCKED" 2>/dev/null || true
  pkill -f "xmessage.*DEVICE LOCKED" 2>/dev/null || true

elif [ "$CMD_ACTION" = "wipe" ]; then
  log "Executing WIPE command"
  NEW_LOCK_STATUS="wiped"
  # Wipe home directories
  for dir in Documents Desktop Downloads Pictures Videos Music; do
    rm -rf ~/Desktop/* ~/Documents/* ~/Downloads/* ~/Pictures/* ~/Videos/* ~/Music/* 2>/dev/null || true
    rm -rf /root/Desktop/* /root/Documents/* /root/Downloads/* /root/Pictures/* 2>/dev/null || true
  done
fi

# Acknowledge command
if [ -n "$CMD_ID" ]; then
  curl -sf -X POST "$SERVER_URL/api/agent/command-ack" \
    -H "Content-Type: application/json" \
    -d "{\"device_token\":\"$DEVICE_TOKEN\",\"device_uuid\":\"$DEVICE_UUID\",\"command_id\":$CMD_ID,\"result\":\"$RESULT\",\"new_lock_status\":\"$NEW_LOCK_STATUS\"}" \
    --connect-timeout 15 --max-time 30 2>/dev/null
  log "Command $CMD_ACTION acknowledged"
fi

# Re-enforce lock if still locked and overlay not running
if [ "$LOCK_STATUS" = "locked" ] && [ "$CMD_ACTION" != "lock" ]; then
  LOCK_RUNNING=false
  if [ -f "$LOCK_PID_FILE" ]; then
    LOCK_PID=$(cat "$LOCK_PID_FILE")
    kill -0 "$LOCK_PID" 2>/dev/null && LOCK_RUNNING=true
  fi
  if [ "$LOCK_RUNNING" = "false" ]; then
    DEFAULT_MSG="This device has been locked due to a missed payment. Please contact Scarlet Technical at (765) 555-0100 or visit scarlet-technical.onrender.com"
    nohup bash "$LOCK_SCRIPT" "$DEFAULT_MSG" > /dev/null 2>&1 &
    echo $! > "$LOCK_PID_FILE"
    log "Re-applied lock overlay"
  fi
fi
