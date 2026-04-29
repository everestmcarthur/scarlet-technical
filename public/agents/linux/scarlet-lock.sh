#!/bin/bash
# Scarlet Technical - Device Lock Overlay
# Full-screen lock with: override PIN entry, unlock request, payment URL, call support
# The user can ONLY do these 4 things — everything else is blocked.

CONFIG_FILE="/opt/scarlet-agent/config.json"
STATE_FILE="/opt/scarlet-agent/state.json"
LOG_FILE="/var/log/scarlet-agent.log"

MESSAGE="${1:-This device has been locked by Scarlet Technical. Resolve your balance to regain access.}"
SERVER_URL=$(jq -r '.server_url' "$CONFIG_FILE" 2>/dev/null || echo "")
DEVICE_TOKEN=$(jq -r '.device_token' "$STATE_FILE" 2>/dev/null || echo "")
DEVICE_UUID=$(cat /opt/scarlet-agent/device_uuid 2>/dev/null || echo "")
SUPPORT_PHONE="(765) 555-0100"
PAYMENT_URL=""

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') [lock] $1" >> "$LOG_FILE" 2>/dev/null || true; }

# Try to find X display
if [ -z "$DISPLAY" ]; then
  for d in /tmp/.X11-unix/X*; do
    [ -S "$d" ] && DISPLAY=":$(basename "$d" | sed 's/X//')" && export DISPLAY && break
  done
fi
[ -z "$DISPLAY" ] && export DISPLAY=":0"
[ -z "$DBUS_SESSION_BUS_ADDRESS" ] && export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"

# ─── API helper ──────────────────────────────────────────────────────────────
api_post() {
  local endpoint="$1" data="$2"
  curl -sf -X POST "${SERVER_URL}${endpoint}" \
    -H "Content-Type: application/json" \
    -d "$data" --connect-timeout 10 --max-time 15 2>/dev/null
}

verify_pin() {
  local pin="$1"
  api_post "/api/agent/verify-pin" \
    "{\"device_token\":\"$DEVICE_TOKEN\",\"device_uuid\":\"$DEVICE_UUID\",\"pin\":\"$pin\"}"
}

request_unlock() {
  local reason="$1" contact="$2"
  api_post "/api/agent/unlock-request" \
    "{\"device_token\":\"$DEVICE_TOKEN\",\"device_uuid\":\"$DEVICE_UUID\",\"reason\":\"$reason\",\"contact_info\":\"$contact\"}"
}

# ─── Python/tkinter full lock screen (best experience) ──────────────────────
try_python() {
  command -v python3 &>/dev/null || return 1
  python3 << 'PYEOF'
import sys, os, json, time, threading
try:
    import tkinter as tk
    from tkinter import messagebox, simpledialog
    import urllib.request
except ImportError:
    sys.exit(1)

MSG = os.environ.get("LOCK_MESSAGE", "This device has been locked by Scarlet Technical.")
SERVER_URL = os.environ.get("SERVER_URL", "")
DEVICE_TOKEN = os.environ.get("DEVICE_TOKEN", "")
DEVICE_UUID = os.environ.get("DEVICE_UUID", "")
SUPPORT_PHONE = os.environ.get("SUPPORT_PHONE", "(765) 555-0100")

def api_post(endpoint, data):
    try:
        req = urllib.request.Request(
            SERVER_URL + endpoint,
            data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read()), resp.status
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read())
        except:
            body = {"error": str(e)}
        return body, e.code
    except Exception as e:
        return {"error": str(e)}, 0

class LockScreen:
    def __init__(self):
        self.root = tk.Tk()
        self.root.title("DEVICE LOCKED")
        self.root.configure(bg="black")
        self.root.attributes("-fullscreen", True)
        self.root.attributes("-topmost", True)
        self.root.overrideredirect(True)
        self.root.resizable(False, False)

        # Block close events
        self.root.protocol("WM_DELETE_WINDOW", lambda: None)
        self.root.bind("<Escape>", lambda e: None)
        self.root.bind("<Alt-F4>", lambda e: "break")

        # Main frame
        frame = tk.Frame(self.root, bg="black")
        frame.place(relx=0.5, rely=0.5, anchor="center")

        # Lock icon + title
        tk.Label(frame, text="🔒  DEVICE LOCKED", font=("Helvetica", 42, "bold"),
                 fg="#DC143C", bg="black").pack(pady=(0, 10))
        tk.Label(frame, text="Scarlet Technical", font=("Helvetica", 20),
                 fg="white", bg="black").pack(pady=(0, 16))
        tk.Label(frame, text=MSG, font=("Helvetica", 14), fg="white", bg="black",
                 wraplength=700, justify="center").pack(pady=(0, 24))

        # Divider
        tk.Frame(frame, bg="#333", height=1, width=600).pack(pady=(0, 20))

        # ── PIN entry ────────────────────────────────────────────────────
        tk.Label(frame, text="Have an override PIN?", font=("Helvetica", 11),
                 fg="#AAA", bg="black").pack(pady=(0, 6))
        pin_row = tk.Frame(frame, bg="black")
        pin_row.pack(pady=(0, 4))

        self.pin_entry = tk.Entry(pin_row, font=("Helvetica", 18), width=10,
                                   justify="center", bg="#2a2a2a", fg="white",
                                   insertbackground="white", relief="flat")
        self.pin_entry.pack(side="left", padx=(0, 8), ipady=6)

        tk.Button(pin_row, text="UNLOCK", font=("Helvetica", 12, "bold"),
                  bg="#DC143C", fg="white", activebackground="#B91030",
                  relief="flat", padx=20, command=self.verify_pin).pack(side="left")

        self.pin_status = tk.Label(frame, text="", font=("Helvetica", 11),
                                    fg="#CCC", bg="black")
        self.pin_status.pack(pady=(2, 16))

        # Divider
        tk.Frame(frame, bg="#333", height=1, width=600).pack(pady=(0, 20))

        # ── Action buttons ───────────────────────────────────────────────
        btn_frame = tk.Frame(frame, bg="black")
        btn_frame.pack(pady=(0, 16))

        for text, color, cmd in [
            ("💳  Make a Payment", "#1E8E3E", self.make_payment),
            ("🔓  Request Unlock", "#1A73E8", self.request_unlock),
            ("📞  Call Support: " + SUPPORT_PHONE, "#444", self.show_phone),
        ]:
            tk.Button(btn_frame, text=text, font=("Helvetica", 13),
                      bg=color, fg="white", activebackground=color,
                      relief="flat", width=36, pady=8, command=cmd
                      ).pack(pady=4)

        # Footer
        tk.Label(frame, text=f"Support: {SUPPORT_PHONE}",
                 font=("Helvetica", 12, "bold"), fg="yellow", bg="black").pack(pady=(16, 4))
        tk.Label(frame, text="This device is managed by Scarlet Technical\nUnauthorized use is prohibited",
                 font=("Helvetica", 9), fg="#666", bg="black").pack(pady=(0, 0))

        # Check for unlock every 10 seconds
        self.check_unlock()

    def verify_pin(self):
        pin = self.pin_entry.get().strip()
        if not pin:
            self.pin_status.config(text="Enter the 6-digit PIN from your technician.", fg="#FF6666")
            return
        self.pin_status.config(text="Verifying...", fg="#CCC")
        self.root.update()

        def do_verify():
            resp, code = api_post("/api/agent/verify-pin", {
                "device_token": DEVICE_TOKEN, "device_uuid": DEVICE_UUID, "pin": pin
            })
            self.root.after(0, lambda: self.handle_pin_result(resp, code))

        threading.Thread(target=do_verify, daemon=True).start()

    def handle_pin_result(self, resp, code):
        if code == 200 and resp.get("success"):
            self.pin_status.config(text="✓ Device unlocked!", fg="#66FF66")
            # Remove lock flag so the agent doesn't re-lock
            try:
                state_path = "/opt/scarlet-agent/state.json"
                with open(state_path) as f:
                    state = json.load(f)
                state["unlocked_by_pin"] = True
                with open(state_path, "w") as f:
                    json.dump(state, f)
            except:
                pass
            self.root.after(1500, self.root.destroy)
        else:
            msg = resp.get("error", "Invalid PIN")
            self.pin_status.config(text=msg, fg="#FF6666")
            self.pin_entry.delete(0, "end")

    def make_payment(self):
        url = SERVER_URL + f"/api/agent/payment-url/{DEVICE_UUID}" if SERVER_URL else ""
        if url:
            try:
                import subprocess
                subprocess.Popen(["xdg-open", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except:
                messagebox.showinfo("Payment", f"Visit: {url}")
        else:
            messagebox.showinfo("Payment", "Payment URL not available. Call support.")

    def request_unlock(self):
        reason = simpledialog.askstring("Request Unlock", "Reason for unlock request:",
                                         parent=self.root)
        if not reason:
            return
        contact = simpledialog.askstring("Contact Info", "Your phone or email:",
                                          parent=self.root)
        self.pin_status.config(text="Submitting request...", fg="#CCC")
        self.root.update()

        def do_request():
            resp, code = api_post("/api/agent/unlock-request", {
                "device_token": DEVICE_TOKEN, "device_uuid": DEVICE_UUID,
                "reason": reason, "contact_info": contact or ""
            })
            msg = resp.get("message", resp.get("error", "Request failed"))
            self.root.after(0, lambda: self.pin_status.config(
                text=msg, fg="#66FF66" if code == 200 else "#FF6666"))

        threading.Thread(target=do_request, daemon=True).start()

    def show_phone(self):
        messagebox.showinfo("Support", f"Call Scarlet Technical:\n{SUPPORT_PHONE}")

    def check_unlock(self):
        # Periodically check if device was unlocked by the agent service
        try:
            with open("/opt/scarlet-agent/state.json") as f:
                state = json.load(f)
            if state.get("unlocked_by_pin") or state.get("unlocked"):
                self.root.destroy()
                return
        except:
            pass
        self.root.after(10000, self.check_unlock)

    def run(self):
        self.root.mainloop()

# Export env vars for api_post
os.environ["LOCK_MESSAGE"] = MSG
os.environ["SERVER_URL"] = SERVER_URL
os.environ["DEVICE_TOKEN"] = DEVICE_TOKEN
os.environ["DEVICE_UUID"] = DEVICE_UUID
os.environ["SUPPORT_PHONE"] = SUPPORT_PHONE

LockScreen().run()
PYEOF
  return $?
}

# ─── Zenity fallback (limited but works) ─────────────────────────────────────
try_zenity() {
  command -v zenity &>/dev/null || return 1
  while true; do
    CHOICE=$(zenity --list --title="DEVICE LOCKED - Scarlet Technical" \
      --text="🔒 DEVICE LOCKED\n\n$MESSAGE\n\nSelect an option:" \
      --column="Action" \
      "Enter Override PIN" "Request Unlock" "Make Payment" "Call Support: $SUPPORT_PHONE" \
      --width=600 --height=450 --cancel-label="" 2>/dev/null)

    case "$CHOICE" in
      "Enter Override PIN")
        PIN=$(zenity --entry --title="Override PIN" --text="Enter the 6-digit PIN from your technician:" --width=400 2>/dev/null)
        if [ -n "$PIN" ]; then
          RESULT=$(verify_pin "$PIN")
          SUCCESS=$(echo "$RESULT" | jq -r '.success // false' 2>/dev/null)
          if [ "$SUCCESS" = "true" ]; then
            zenity --info --text="✓ Device unlocked!" --width=300 2>/dev/null
            exit 0
          else
            ERROR=$(echo "$RESULT" | jq -r '.error // "Invalid PIN"' 2>/dev/null)
            zenity --error --text="$ERROR" --width=300 2>/dev/null
          fi
        fi
        ;;
      "Request Unlock")
        REASON=$(zenity --entry --title="Request Unlock" --text="Reason:" --width=400 2>/dev/null)
        CONTACT=$(zenity --entry --title="Contact Info" --text="Your phone or email:" --width=400 2>/dev/null)
        if [ -n "$REASON" ]; then
          RESULT=$(request_unlock "$REASON" "$CONTACT")
          MSG_RESP=$(echo "$RESULT" | jq -r '.message // .error // "Request submitted"' 2>/dev/null)
          zenity --info --text="$MSG_RESP" --width=300 2>/dev/null
        fi
        ;;
      "Make Payment")
        xdg-open "${SERVER_URL}/api/agent/payment-url/${DEVICE_UUID}" 2>/dev/null || \
          zenity --info --text="Visit: ${SERVER_URL}/portal/" --width=300 2>/dev/null
        ;;
      *)
        ;;
    esac
    sleep 1
  done
}

# ─── xmessage fallback (minimal) ────────────────────────────────────────────
try_xmessage() {
  command -v xmessage &>/dev/null || return 1
  while true; do
    xmessage -center -buttons "OK:0" \
      "DEVICE LOCKED - Scarlet Technical

$MESSAGE

To unlock: Call $SUPPORT_PHONE or visit ${SERVER_URL}/portal/
Override PIN: Call support to get a one-time PIN" 2>/dev/null
    sleep 1
  done
}

# ─── Console-only fallback ───────────────────────────────────────────────────
try_console() {
  while true; do
    clear
    echo "═══════════════════════════════════════════════════════"
    echo "  🔒  DEVICE LOCKED  — Scarlet Technical"
    echo "═══════════════════════════════════════════════════════"
    echo ""
    echo "  $MESSAGE"
    echo ""
    echo "  1) Enter Override PIN"
    echo "  2) Request Unlock"
    echo "  3) Make Payment"
    echo "  4) Call Support: $SUPPORT_PHONE"
    echo ""
    echo "═══════════════════════════════════════════════════════"
    read -p "  Choose [1-4]: " choice
    case "$choice" in
      1)
        read -p "  Enter 6-digit PIN: " pin
        RESULT=$(verify_pin "$pin")
        SUCCESS=$(echo "$RESULT" | jq -r '.success // false' 2>/dev/null)
        if [ "$SUCCESS" = "true" ]; then
          echo "  ✓ Device unlocked!"
          exit 0
        else
          ERROR=$(echo "$RESULT" | jq -r '.error // "Invalid PIN"' 2>/dev/null)
          echo "  ✗ $ERROR"
          sleep 3
        fi
        ;;
      2)
        read -p "  Reason: " reason
        read -p "  Your phone/email: " contact
        RESULT=$(request_unlock "$reason" "$contact")
        MSG_RESP=$(echo "$RESULT" | jq -r '.message // .error // "Submitted"' 2>/dev/null)
        echo "  $MSG_RESP"
        sleep 3
        ;;
      3)
        xdg-open "${SERVER_URL}/api/agent/payment-url/${DEVICE_UUID}" 2>/dev/null || \
          echo "  Visit: ${SERVER_URL}/portal/"
        sleep 3
        ;;
      4)
        echo "  Call: $SUPPORT_PHONE"
        sleep 5
        ;;
    esac
  done
}

# Export for Python subprocess
export LOCK_MESSAGE="$MESSAGE"
export SERVER_URL="$SERVER_URL"
export DEVICE_TOKEN="$DEVICE_TOKEN"
export DEVICE_UUID="$DEVICE_UUID"
export SUPPORT_PHONE="$SUPPORT_PHONE"

log "Lock screen starting. Server: $SERVER_URL"

# Try each method in order of quality
try_python || try_zenity || try_xmessage || try_console
