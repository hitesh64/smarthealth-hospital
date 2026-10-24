"""Copies the whole hospital database from one MongoDB to another - e.g. from this computer to
MongoDB Atlas, so the hosted site (Render) has the same admins, roles, doctors, patients, lab tests ...

    python scripts/copy_database.py

It asks for the target link (paste the mongodb+srv://... link from Atlas > Connect > Drivers); the
link with its password is never written to a file. The source is MONGO_URI from .env (this computer).
Collections that already have data in the target are skipped unless you answer "yes" to replacing them.
"""
import sys
from getpass import getpass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pymongo import MongoClient  # noqa: E402

from backend import config  # noqa: E402

SKIP = {"geo_cache", "locks"}  # cache and short-lived locks are rebuilt by themselves


def main():
    target_uri = getpass("Target MongoDB link (input hidden, e.g. mongodb+srv://user:password@cluster0.xxxx.mongodb.net/): ").strip()
    if not target_uri.startswith(("mongodb://", "mongodb+srv://")):
        sys.exit("That does not look like a MongoDB link.")
    target_name = input(f"Target database name [{config.MONGO_DB}]: ").strip() or config.MONGO_DB

    src = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=8000)[config.MONGO_DB]
    try:
        dst_client = MongoClient(target_uri, serverSelectionTimeoutMS=15000)
        dst_client.admin.command("ping")
    except Exception as exc:
        sys.exit(f"Could not connect to the target: {exc}\nCheck the password and that Atlas > Network Access allows your IP.")
    dst = dst_client[target_name]

    names = [n for n in src.list_collection_names() if n not in SKIP]
    busy = [n for n in names if dst[n].estimated_document_count()]
    replace = False
    if busy:
        replace = input(f"These collections already have data in the target: {', '.join(busy)}.\n"
                        "Replace them with this computer's data? (yes/no) [no]: ").strip().lower() == "yes"
    for name in sorted(names):
        docs = list(src[name].find())
        if dst[name].estimated_document_count() and not replace:
            print(f"  {name:22} skipped (target already has data)")
            continue
        dst[name].delete_many({})
        if docs:
            dst[name].insert_many(docs)
        print(f"  {name:22} {len(docs)} copied")
    print("\nDone. Open https://<your-site>/api/health to check the hosted site sees the data.")


if __name__ == "__main__":
    main()
