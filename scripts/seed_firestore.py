#!/usr/bin/env python3
"""Seed Firestore with deterministic DailyBit demo data."""

from __future__ import annotations

import argparse
import base64
import os
import struct
import sys
import zlib
from collections import Counter
from datetime import datetime, timedelta
from typing import Any

import firebase_admin
from firebase_admin import auth, credentials, firestore

TEST_DEVELOPERS = {
    "test-dev-sofia": {"name": "Sofia (test)", "role": "dev"},
    "test-dev-marco": {"name": "Marco (test)", "role": "dev"},
    "test-dev-lena": {"name": "Lena (test)", "role": "dev"},
}

SOFIA_DATE_PICKER_TASK_ID = "fixed-date-picker-normalization"
SERVER_TIMESTAMP = firestore.SERVER_TIMESTAMP


class SeedFailure(RuntimeError):
    """Raised for readable seed failures."""


def local_date(offset_days: int = 0) -> str:
    return (datetime.now() + timedelta(days=offset_days)).strftime("%Y-%m-%d")


def chunk_type(tag: bytes, data: bytes) -> bytes:
    checksum = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", checksum)


def solid_png_data_url(width: int = 16, height: int = 16, rgb: tuple[int, int, int] = (59, 130, 246)) -> str:
    """Return a tiny deterministic solid-color PNG data URL."""
    raw_rows = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))
    png = b"\x89PNG\r\n\x1a\n" + b"".join(
        [
            chunk_type(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)),
            chunk_type(b"IDAT", zlib.compress(raw_rows, level=9)),
            chunk_type(b"IEND", b""),
        ]
    )
    return "data:image/png;base64," + base64.b64encode(png).decode("ascii")


def report_id(uid: str, date: str) -> str:
    return f"{uid}_{date}"


def build_report(uid: str, date: str, sections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = [
        {
            "path": f"reports/{report_id(uid, date)}",
            "data": {
                "userId": uid,
                "date": date,
                "createdAt": SERVER_TIMESTAMP,
                "updatedAt": SERVER_TIMESTAMP,
            },
        }
    ]

    for section in sections:
        section_id = section["id"]
        ops.append(
            {
                "path": f"reports/{report_id(uid, date)}/sections/{section_id}",
                "data": {"title": section["title"], "order": section["order"]},
            }
        )
        for task in section["tasks"]:
            task_data = {"description": task["description"], "order": task["order"]}
            if "links" in task:
                task_data["links"] = task["links"]
            ops.append(
                {
                    "path": f"reports/{report_id(uid, date)}/sections/{section_id}/tasks/{task['id']}",
                    "data": task_data,
                }
            )
    return ops


def build_seed_data(lead_uid: str, lead_name: str, today: str, yesterday: str) -> list[dict[str, Any]]:
    ops: list[dict[str, Any]] = [
        {"path": f"users/{lead_uid}", "data": {"name": lead_name, "role": "lead"}},
    ]
    ops.extend({"path": f"users/{uid}", "data": profile} for uid, profile in TEST_DEVELOPERS.items())
    ops.append(
        {
            "path": "settings/team",
            "data": {"memberOrder": list(TEST_DEVELOPERS.keys()), "updatedAt": SERVER_TIMESTAMP},
        }
    )

    ops.extend(
        build_report(
            "test-dev-sofia",
            today,
            [
                {
                    "id": "frontend",
                    "title": "Frontend",
                    "order": 0,
                    "tasks": [
                        {"id": "polished-login-form-styling", "description": "Polished login form styling", "order": 0},
                        {
                            "id": SOFIA_DATE_PICKER_TASK_ID,
                            "description": "Fixed date picker normalization",
                            "order": 1,
                            "links": [{"label": "PR", "url": "https://github.com/example/dailybit/pull/12"}],
                        },
                        {"id": "refactored-report-card-layout", "description": "Refactored report card layout", "order": 3},
                    ],
                },
                {
                    "id": "docs",
                    "title": "Docs",
                    "order": 1,
                    "tasks": [{"id": "updated-onboarding-notes", "description": "Updated onboarding notes", "order": 0}],
                },
            ],
        )
    )
    ops.extend(
        build_report(
            "test-dev-marco",
            today,
            [
                {
                    "id": "api",
                    "title": "API",
                    "order": 0,
                    "tasks": [
                        {"id": "drafted-reports-rollup-endpoint", "description": "Drafted reports rollup endpoint", "order": 0},
                        {
                            "id": "reviewed-security-rules",
                            "description": "Reviewed security rules",
                            "order": 1,
                            "links": [{"url": "https://firebase.google.com/docs/firestore/security/get-started"}],
                        },
                    ],
                }
            ],
        )
    )
    ops.extend(
        build_report(
            "test-dev-lena",
            today,
            [
                {
                    "id": "infra",
                    "title": "Infra",
                    "order": 0,
                    "tasks": [
                        {"id": "set-up-staging-project", "description": "Set up staging project", "order": 0},
                        {
                            "id": "cost-review-base64-storage",
                            "description": "Cost review of Base64 storage",
                            "order": 1,
                        },
                    ],
                }
            ],
        )
    )
    lena_today = report_id("test-dev-lena", today)
    ops.extend(
        [
            {
                "path": f"reports/{lena_today}/sections/infra/tasks/cost-review-base64-storage/images/image-1",
                "data": {
                    "imageBase64": solid_png_data_url(rgb=(59, 130, 246)),
                    "createdAt": SERVER_TIMESTAMP,
                },
            },
            {
                "path": f"reports/{lena_today}/sections/infra/tasks/cost-review-base64-storage/images/image-2",
                "data": {
                    "imageBase64": solid_png_data_url(rgb=(16, 185, 129)),
                    "createdAt": SERVER_TIMESTAMP,
                },
            },
        ]
    )

    ops.extend(
        build_report(
            "test-dev-sofia",
            yesterday,
            [
                {
                    "id": "frontend",
                    "title": "Frontend",
                    "order": 0,
                    "tasks": [
                        {"id": "checked-auth-flow", "description": "Checked auth flow", "order": 0},
                        {"id": "triaged-date-picker-history", "description": "Triaged date picker history", "order": 1},
                    ],
                }
            ],
        )
    )

    sofia_today = report_id("test-dev-sofia", today)
    ops.extend(
        [
            {
                "path": f"reports/{sofia_today}/questions/mvp-ship-date",
                "data": {
                    "questionText": "Ship the MVP this Friday or next Monday?",
                    "options": ["This Friday", "Next Monday", "Decide at standup"],
                },
            },
            {
                # A section question: anchored to "frontend" and interleaved
                # with its tasks (order 2, between the date-picker task at
                # order 1 and the now-bumped report-card task at order 3).
                "path": f"reports/{sofia_today}/questions/frontend-review-approach",
                "data": {
                    "questionText": "Should the report card refactor land before or after the login polish ships?",
                    "options": ["Before", "After", "Doesn't matter"],
                    "sectionId": "frontend",
                    "order": 2,
                },
            },
            {
                "path": f"reports/{sofia_today}/questions/task-limit-ok",
                "data": {
                    "questionText": "Is the 500-char task limit ok?",
                    "options": ["Yes, keep it", "Raise to 1000"],
                    "selectedAnswer": 0,
                    "answeredBy": lead_uid,
                    "answeredAt": SERVER_TIMESTAMP,
                },
            },
            {
                "path": f"reports/{sofia_today}/leadNotes/report-login-polish",
                "data": {
                    "noteText": "Great progress on the login polish.",
                    "targetTaskId": "",
                    "createdAt": SERVER_TIMESTAMP,
                },
            },
            {
                "path": f"reports/{sofia_today}/leadNotes/date-picker-edge-case",
                "data": {
                    "noteText": "Nice catch on the empty date edge case.",
                    "targetTaskId": SOFIA_DATE_PICKER_TASK_ID,
                    "createdAt": SERVER_TIMESTAMP,
                },
            },
            {
                "path": f"reports/{sofia_today}/leadQuestions/date-picker-follow-up",
                "data": {
                    "taskId": SOFIA_DATE_PICKER_TASK_ID,
                    "sectionId": "frontend",
                    "questionText": "Can you share the exact edge case you fixed?",
                    "kind": "text",
                    "createdAt": SERVER_TIMESTAMP,
                },
            },
            {
                "path": f"reports/{sofia_today}/leadQuestions/login-form-follow-up",
                "data": {
                    "taskId": "polished-login-form-styling",
                    "sectionId": "frontend",
                    "questionText": "Which login form change should we ship first?",
                    "kind": "options",
                    "options": ["Spacing fix", "Color contrast fix", "Both together"],
                    "createdAt": SERVER_TIMESTAMP,
                },
            },
        ]
    )
    return ops


def collection_name(path: str) -> str:
    parts = path.split("/")
    return parts[-2] if len(parts) % 2 == 0 else parts[-1]


def print_plan(ops: list[dict[str, Any]], dry_run: bool) -> None:
    verb = "Would set" if dry_run else "Prepared"
    print(f"✓ {verb} {len(ops)} deterministic Firestore documents")
    counts = Counter(collection_name(op["path"]) for op in ops)
    for name in sorted(counts):
        print(f"  - {name}: {counts[name]}")


def apply_ops(db: firestore.Client, ops: list[dict[str, Any]]) -> None:
    batch = db.batch()
    for op in ops:
        batch.set(db.document(op["path"]), op["data"])
    batch.commit()


def read_back(db: firestore.Client, today: str) -> dict[str, int]:
    return {
        "users": len(list(db.collection("users").stream())),
        "reports_today": len(list(db.collection("reports").where("date", "==", today).stream())),
        "questions": len(list(db.collection_group("questions").stream())),
        "leadNotes": len(list(db.collection_group("leadNotes").stream())),
        "leadQuestions": len(list(db.collection_group("leadQuestions").stream())),
        "images": len(list(db.collection_group("images").stream())),
        "settings_team": 1 if db.document("settings/team").get().exists else 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed DailyBit Firestore demo data.")
    parser.add_argument("--key-path", default="key.json", help="Path to the Firebase service account JSON file.")
    parser.add_argument("--email", required=True, help="Lead user's Firebase Auth email.")
    parser.add_argument("--name", default="Lead", help="Lead user's display name.")
    parser.add_argument("--dry-run", action="store_true", help="Build and print the seed plan without writing to Firestore.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        key_path = os.path.abspath(args.key_path)
        print("✓ DailyBit Firestore seed starting")
        print(f"✓ Using service account key path: {key_path}")
        if not os.path.exists(key_path):
            raise SeedFailure(f"Service account key not found at {key_path}")

        today = local_date()
        yesterday = local_date(-1)
        print(f"✓ Local seed dates: today={today}, yesterday={yesterday}")

        cred = credentials.Certificate(key_path)
        firebase_admin.initialize_app(cred)
        db = firestore.client()
        print("✓ Firebase Admin initialized")

        try:
            user = auth.get_user_by_email(args.email)
        except auth.UserNotFoundError as exc:
            raise SeedFailure(f"Auth user {args.email} was not found. Sign up in the app first, then re-run this script.") from exc
        print(f"✓ Found Firebase Auth user for {args.email}; uid={user.uid}")

        ops = build_seed_data(user.uid, args.name, today, yesterday)
        print_plan(ops, args.dry_run)

        if args.dry_run:
            print("✓ Dry run complete; no Firestore writes performed")
            return 0

        apply_ops(db, ops)
        print(f"✓ Wrote {len(ops)} documents with idempotent set() operations")

        summary = read_back(db, today)
        print("✓ Read-back summary")
        for name, count in summary.items():
            print(f"  - {name}: {count}")

        print("✓ Firestore seed completed successfully")
        return 0
    except Exception as exc:
        print(f"✗ Seed failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
