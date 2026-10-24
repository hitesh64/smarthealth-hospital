"""Sends appointment reminder mails that are due (and retries mails that failed earlier).
Run it on a schedule, e.g. hourly from Windows Task Scheduler:

    python scripts/send_reminders.py

The admin panel also runs it on login and from Notifications > "Send due reminders".
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from backend.routes.clinic import send_due_reminders  # noqa: E402

if __name__ == "__main__":
    print(f"Reminders processed: {send_due_reminders()}")
