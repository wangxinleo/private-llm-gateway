"""Regression coverage for the ``task.py archive`` lifecycle contract.

These tests assume the CLI accepts ``--outcome completed|cancelled`` and
``--reason`` on ``archive``. They invoke the real script from an isolated
temporary repository and never touch this repository's task tree.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
TASK_CLI = REPO_ROOT / ".trellis" / "scripts" / "task.py"
TASKS_RELATIVE = Path(".trellis") / "tasks"
SCRIPTS_ROOT = REPO_ROOT / ".trellis" / "scripts"
SESSION_ENVIRONMENT_KEYS = (
    "TRELLIS_CONTEXT_ID",
    "CLAUDE_SESSION_ID",
    "CLAUDE_CODE_SESSION_ID",
    "CODEX_SESSION_ID",
    "CODEX_THREAD_ID",
    "OPENCODE_SESSION_ID",
    "OPENCODE_SESSIONID",
    "OPENCODE_RUN_ID",
)

if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from common import active_task, task_store


def create_task(
    fixture: Path,
    name: str,
    *,
    children: tuple[str, ...] = (),
    parent: str | None = None,
    notes: str = "",
) -> Path:
    task_dir = fixture / TASKS_RELATIVE / name
    task_dir.mkdir()
    task_data = {
        "id": name,
        "name": name,
        "title": name,
        "status": "in_progress",
        "completedAt": None,
        "closedAt": None,
        "children": list(children),
        "parent": parent,
        "notes": notes,
    }
    (task_dir / "task.json").write_text(
        json.dumps(task_data, indent=2) + "\n",
        encoding="utf-8",
    )
    return task_dir


def create_session_state(fixture: Path, task_name: str) -> Path:
    sessions_dir = fixture / ".trellis" / ".runtime" / "sessions"
    sessions_dir.mkdir(parents=True)
    session_path = sessions_dir / "archive-regression.json"
    session_path.write_text(
        json.dumps(
            {
                "current_task": f".trellis/tasks/{task_name}",
                "marker": "preserve this session",
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    return session_path


def archive_handler_args(task_name: str) -> argparse.Namespace:
    return argparse.Namespace(
        name=task_name,
        outcome="completed",
        reason=None,
        no_commit=True,
    )


def run_archive(
    fixture: Path,
    task_name: str,
    *options: str,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    for key in SESSION_ENVIRONMENT_KEYS:
        env.pop(key, None)
    env.update(
        {
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONIOENCODING": "utf-8",
        }
    )
    return subprocess.run(
        [
            sys.executable,
            str(TASK_CLI),
            "archive",
            task_name,
            "--no-commit",
            *options,
        ],
        cwd=fixture,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def load_task(task_dir: Path) -> dict[str, object]:
    return json.loads((task_dir / "task.json").read_text(encoding="utf-8"))


def snapshot_files(root: Path) -> dict[str, bytes]:
    return {
        path.relative_to(root).as_posix(): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


def find_archived_task(fixture: Path, task_name: str) -> Path:
    archive_root = fixture / TASKS_RELATIVE / "archive"
    month_dirs = [path for path in archive_root.iterdir() if path.is_dir()]
    assert len(month_dirs) == 1
    assert re.fullmatch(r"\d{4}-\d{2}", month_dirs[0].name)
    archived_task = month_dirs[0] / task_name
    assert archived_task.is_dir()
    return archived_task


def assert_iso_timestamp(value: object) -> None:
    assert isinstance(value, str)
    assert value.strip()
    datetime.fromisoformat(value.replace("Z", "+00:00"))


class TaskArchiveTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.fixture = Path(self.temporary_directory.name)
        (self.fixture / TASKS_RELATIVE / "archive").mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_archive_defaults_to_completed_and_records_closure_metadata(self) -> None:
        # Given an active task with an existing note and no archive metadata.
        task_name = "04-01-completed-default"
        task_dir = create_task(self.fixture, task_name, notes="keep this note")

        # When archive is invoked without an outcome.
        result = run_archive(self.fixture, task_name)

        # Then the task is archived as completed with date-shaped metadata.
        self.assertEqual(result.returncode, 0, result.stderr)
        archived_task = find_archived_task(self.fixture, task_name)
        self.assertFalse(task_dir.exists())
        self.assertIn(task_name, result.stdout)

        task_data = load_task(archived_task)
        self.assertEqual(task_data["status"], "completed")
        assert_iso_timestamp(task_data["completedAt"])
        assert_iso_timestamp(task_data["closedAt"])
        self.assertEqual(task_data["notes"], "keep this note")

    def test_archive_rejects_non_object_task_json_without_moving(self) -> None:
        # Given an active task whose metadata is a non-object JSON value.
        task_name = "04-01-non-object-task-json"
        task_dir = self.fixture / TASKS_RELATIVE / task_name
        task_dir.mkdir()
        task_json_path = task_dir / "task.json"
        task_json_path.write_bytes(b"[]\n")
        tasks_root = self.fixture / TASKS_RELATIVE
        before = snapshot_files(tasks_root)

        # When archive is invoked for the malformed task.
        result = run_archive(self.fixture, task_name)

        # Then the CLI rejects it without moving or rewriting any task file.
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(task_json_path.read_bytes(), b"[]\n")
        self.assertEqual(snapshot_files(tasks_root), before)
        archive_root = tasks_root / "archive"
        self.assertFalse(
            any(
                (month_dir / task_name).exists()
                for month_dir in archive_root.iterdir()
                if month_dir.is_dir()
            )
        )

    def test_archive_metadata_write_failure_leaves_active_task_unchanged(self) -> None:
        # Given an active task and a session that points at it.
        task_name = "04-01-metadata-write-failure"
        task_dir = create_task(self.fixture, task_name, notes="keep this metadata")
        task_json_path = task_dir / "task.json"
        session_path = create_session_state(self.fixture, task_name)
        original_metadata = load_task(task_dir)
        original_task_bytes = task_json_path.read_bytes()
        original_session_bytes = session_path.read_bytes()

        # When the metadata write fails before the archive move.
        with (
            patch.object(task_store, "get_repo_root", return_value=self.fixture),
            patch.object(task_store, "write_json", return_value=False) as write_json,
            patch.object(
                active_task,
                "clear_task_from_sessions",
                wraps=active_task.clear_task_from_sessions,
            ) as clear_sessions,
            patch.object(task_store, "archive_task_complete", return_value={}) as archive_move,
        ):
            result = task_store.cmd_archive(archive_handler_args(task_name))

        # Then metadata, session state, and task placement remain unchanged.
        self.assertNotEqual(result, 0)
        write_json.assert_called_once()
        clear_sessions.assert_not_called()
        archive_move.assert_not_called()
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(load_task(task_dir), original_metadata)
        self.assertEqual(task_json_path.read_bytes(), original_task_bytes)
        self.assertEqual(session_path.read_bytes(), original_session_bytes)

    def test_archive_move_failure_restores_metadata_and_session_state(self) -> None:
        # Given an active task and a session that points at it.
        task_name = "04-01-archive-move-failure"
        task_dir = create_task(self.fixture, task_name, notes="restore this metadata")
        task_json_path = task_dir / "task.json"
        session_path = create_session_state(self.fixture, task_name)
        original_metadata = load_task(task_dir)
        original_session_bytes = session_path.read_bytes()

        # When the archive move fails after metadata was written.
        with (
            patch.object(task_store, "get_repo_root", return_value=self.fixture),
            patch.object(task_store, "archive_task_complete", return_value={}) as archive_move,
            patch.object(
                active_task,
                "clear_task_from_sessions",
                wraps=active_task.clear_task_from_sessions,
            ) as clear_sessions,
        ):
            result = task_store.cmd_archive(archive_handler_args(task_name))

        # Then original metadata is restored and session cleanup never runs.
        self.assertNotEqual(result, 0)
        archive_move.assert_called_once_with(task_dir, self.fixture)
        clear_sessions.assert_not_called()
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(load_task(task_dir), original_metadata)
        self.assertEqual(session_path.read_bytes(), original_session_bytes)
        archive_root = self.fixture / TASKS_RELATIVE / "archive"
        self.assertFalse(
            any(
                (month_dir / task_name).exists()
                for month_dir in archive_root.iterdir()
                if month_dir.is_dir()
            )
        )

    def test_archive_cancelled_records_reason_without_completion_timestamp(self) -> None:
        # Given an active task that will be cancelled for a user-visible reason.
        task_name = "04-01-cancelled"
        reason = "Scope was withdrawn"
        task_dir = create_task(self.fixture, task_name)

        # When archive is invoked with the cancelled outcome and reason.
        result = run_archive(
            self.fixture,
            task_name,
            "--outcome",
            "cancelled",
            "--reason",
            reason,
        )

        # Then closure metadata records cancellation, reason, and no completion.
        self.assertEqual(result.returncode, 0, result.stderr)
        archived_task = find_archived_task(self.fixture, task_name)
        self.assertFalse(task_dir.exists())

        task_data = load_task(archived_task)
        self.assertEqual(task_data["status"], "cancelled")
        self.assertIsNone(task_data["completedAt"])
        assert_iso_timestamp(task_data["closedAt"])
        self.assertIsInstance(task_data["notes"], str)
        self.assertIn(reason, task_data["notes"])

    def test_archive_cancelled_rejects_missing_reason_without_mutation(self) -> None:
        for reason_options in ((), ("--reason", "   ")):
            with self.subTest(reason_options=reason_options):
                with tempfile.TemporaryDirectory() as directory:
                    # Given an active task and a snapshot of its task tree.
                    fixture = Path(directory)
                    (fixture / TASKS_RELATIVE / "archive").mkdir(parents=True)
                    task_name = "04-01-cancelled-without-reason"
                    task_dir = create_task(fixture, task_name)
                    tasks_root = fixture / TASKS_RELATIVE
                    before = snapshot_files(tasks_root)

                    # When cancellation is requested without a non-blank reason.
                    result = run_archive(
                        fixture,
                        task_name,
                        "--outcome",
                        "cancelled",
                        *reason_options,
                    )

                    # Then the CLI rejects it before changing any task or archive file.
                    self.assertNotEqual(result.returncode, 0)
                    self.assertIn(
                        "reason",
                        f"{result.stdout}\n{result.stderr}".lower(),
                    )
                    self.assertTrue(task_dir.is_dir())
                    self.assertEqual(snapshot_files(tasks_root), before)

    def test_archive_parent_with_active_child_rejects_without_mutation(self) -> None:
        # Given a parent whose active child directory is still present.
        parent_name = "04-01-parent"
        child_name = "04-01-parent-child"
        parent_dir = create_task(self.fixture, parent_name, children=(child_name,))
        child_dir = create_task(self.fixture, child_name, parent=parent_name)
        tasks_root = self.fixture / TASKS_RELATIVE
        before = snapshot_files(tasks_root)

        # When archive is requested for the parent.
        result = run_archive(self.fixture, parent_name)

        # Then the active-child guard rejects the request before mutation.
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("child", f"{result.stdout}\n{result.stderr}".lower())
        self.assertTrue(parent_dir.is_dir())
        self.assertTrue(child_dir.is_dir())
        self.assertEqual(snapshot_files(tasks_root), before)
