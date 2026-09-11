from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

from test_task_archive import (
    TASKS_RELATIVE,
    archive_handler_args,
    create_session_state,
    create_task,
    run_archive,
    snapshot_files,
)

from common import active_task, io, task_store


class ArchiveCriticalTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.fixture = Path(self.temporary_directory.name)
        (self.fixture / TASKS_RELATIVE / "archive").mkdir(parents=True)

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_archive_rejects_absolute_and_traversal_paths_outside_tasks_root(self) -> None:
        for path_kind in ("absolute", "traversal"):
            with self.subTest(path_kind=path_kind):
                with tempfile.TemporaryDirectory(dir=self.fixture.parent) as directory:
                    outside_task = Path(directory) / "outside-task"
                    outside_task.mkdir()
                    task_json = outside_task / "task.json"
                    original_bytes = b'{"status":"in_progress","marker":"outside"}\n'
                    task_json.write_bytes(original_bytes)
                    task_ref = (
                        str(outside_task)
                        if path_kind == "absolute"
                        else os.path.relpath(outside_task, self.fixture)
                    )

                    result = run_archive(self.fixture, task_ref)

                    self.assertNotEqual(result.returncode, 0)
                    self.assertTrue(outside_task.is_dir())
                    self.assertEqual(task_json.read_bytes(), original_bytes)

    def test_archive_rejects_archive_root_as_source_without_mutation(self) -> None:
        tasks_root = self.fixture / TASKS_RELATIVE
        before = snapshot_files(tasks_root)

        result = run_archive(self.fixture, "archive")

        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(snapshot_files(tasks_root), before)

    def test_archive_rejects_symlinked_source_without_mutation(self) -> None:
        with tempfile.TemporaryDirectory(dir=self.fixture.parent) as directory:
            real_task = Path(directory) / "real-task"
            real_task.mkdir()
            (real_task / "task.json").write_text("{}\n", encoding="utf-8")
            linked_task = self.fixture / TASKS_RELATIVE / "linked-task"
            linked_task.symlink_to(real_task, target_is_directory=True)
            before = snapshot_files(self.fixture / TASKS_RELATIVE)

            result = run_archive(self.fixture, linked_task.name)

            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(linked_task.is_symlink())
            self.assertTrue(real_task.is_dir())
            self.assertEqual(snapshot_files(self.fixture / TASKS_RELATIVE), before)

    def test_archive_rejects_symlinked_task_json_without_mutation(self) -> None:
        task_name = "04-02-symlinked-task-json"
        task_dir = create_task(self.fixture, task_name)
        task_json = task_dir / "task.json"
        external_metadata = self.fixture / "external-task.json"
        external_bytes = b'{"status":"in_progress","marker":"external"}\n'
        external_metadata.write_bytes(external_bytes)
        task_json.unlink()
        task_json.symlink_to(external_metadata)
        before = snapshot_files(self.fixture / TASKS_RELATIVE)

        result = run_archive(self.fixture, task_name)

        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(task_dir.is_dir())
        self.assertTrue(task_json.is_symlink())
        self.assertEqual(external_metadata.read_bytes(), external_bytes)
        self.assertEqual(snapshot_files(self.fixture / TASKS_RELATIVE), before)

    def test_archive_rejects_symlinked_archive_root_without_mutation(self) -> None:
        tasks_root = self.fixture / TASKS_RELATIVE
        archive_root = tasks_root / "archive"
        archive_root.rmdir()
        with tempfile.TemporaryDirectory(dir=self.fixture.parent) as directory:
            archive_target = Path(directory) / "archive-target"
            archive_target.mkdir()
            archive_root.symlink_to(archive_target, target_is_directory=True)
            task_name = "04-02-symlinked-archive-root"
            task_dir = create_task(self.fixture, task_name)

            result = run_archive(self.fixture, task_name)

            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(task_dir.is_dir())
            self.assertEqual(tuple(archive_target.iterdir()), ())

    def test_archive_rejects_symlinked_month_destination_without_mutation(self) -> None:
        tasks_root = self.fixture / TASKS_RELATIVE
        archive_root = tasks_root / "archive"
        month_name = datetime.now().strftime("%Y-%m")
        with tempfile.TemporaryDirectory(dir=self.fixture.parent) as directory:
            archive_target = Path(directory) / "archive-target"
            archive_target.mkdir()
            (archive_root / month_name).symlink_to(
                archive_target,
                target_is_directory=True,
            )
            task_name = "04-02-symlinked-month-destination"
            task_dir = create_task(self.fixture, task_name)
            before = snapshot_files(tasks_root)

            result = run_archive(self.fixture, task_name)

            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(task_dir.is_dir())
            self.assertEqual(tuple(archive_target.iterdir()), ())
            self.assertEqual(snapshot_files(tasks_root), before)

    def test_archive_rejects_existing_destination_without_nesting_or_mutation(self) -> None:
        task_name = "04-02-existing-destination"
        task_dir = create_task(self.fixture, task_name)
        month_dir = self.fixture / TASKS_RELATIVE / "archive" / datetime.now().strftime("%Y-%m")
        destination = month_dir / task_name
        destination.mkdir(parents=True)
        marker = destination / "marker.txt"
        marker.write_bytes(b"keep destination")
        before = snapshot_files(self.fixture / TASKS_RELATIVE)

        result = run_archive(self.fixture, task_name)

        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(marker.read_bytes(), b"keep destination")
        self.assertEqual(snapshot_files(self.fixture / TASKS_RELATIVE), before)

    def test_archive_requires_regular_object_task_json(self) -> None:
        task_name = "04-02-missing-task-json"
        task_dir = self.fixture / TASKS_RELATIVE / task_name
        task_dir.mkdir()
        before = snapshot_files(self.fixture / TASKS_RELATIVE)

        result = run_archive(self.fixture, task_name)

        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(snapshot_files(self.fixture / TASKS_RELATIVE), before)

    def test_atomic_json_write_failure_preserves_exact_bytes_and_cleans_temp(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "task.json"
            original_bytes = b'{\n  "status": "in_progress",\n  "unknown": [1, 2]\n}\n'
            path.write_bytes(original_bytes)

            with patch.object(io.os, "replace", side_effect=OSError("replace failed")):
                result = io.write_json(path, {"status": "completed"})

            self.assertFalse(result)
            self.assertEqual(path.read_bytes(), original_bytes)
            self.assertEqual(tuple(path.parent.iterdir()), (path,))

    def test_archive_move_failure_restores_exact_original_metadata_bytes(self) -> None:
        task_name = "04-02-exact-rollback"
        task_dir = create_task(self.fixture, task_name)
        task_json = task_dir / "task.json"
        original_bytes = (
            b'{\n'
            b'  "unknown": {"keep": true},\n'
            b'  "status": "in_progress",\n'
            b'  "children": []\n'
            b'}\n'
        )
        task_json.write_bytes(original_bytes)

        with (
            patch.object(task_store, "get_repo_root", return_value=self.fixture),
            patch.object(task_store, "archive_task_complete", return_value={}),
        ):
            result = task_store.cmd_archive(archive_handler_args(task_name))

        self.assertNotEqual(result, 0)
        self.assertTrue(task_dir.is_dir())
        self.assertEqual(task_json.read_bytes(), original_bytes)

    def test_archive_clears_equivalent_absolute_and_relative_session_pointers(self) -> None:
        task_name = "04-02-equivalent-session-pointers"
        task_dir = create_task(self.fixture, task_name)
        sessions_dir = self.fixture / ".trellis" / ".runtime" / "sessions"
        sessions_dir.mkdir(parents=True)
        (sessions_dir / "relative.json").write_text(
            json.dumps({"current_task": f".trellis/tasks/{task_name}"}) + "\n",
            encoding="utf-8",
        )
        (sessions_dir / "absolute.json").write_text(
            json.dumps({"current_task": str(task_dir)}) + "\n",
            encoding="utf-8",
        )

        with patch.object(task_store, "get_repo_root", return_value=self.fixture):
            result = task_store.cmd_archive(archive_handler_args(task_name))

        self.assertEqual(result, 0)
        self.assertEqual(tuple(sessions_dir.iterdir()), ())

    def test_archive_surfaces_session_cleanup_failure(self) -> None:
        task_name = "04-02-session-cleanup-failure"
        task_dir = create_task(self.fixture, task_name)
        session_path = create_session_state(self.fixture, task_name)

        with (
            patch.object(task_store, "get_repo_root", return_value=self.fixture),
            patch.object(active_task, "_remove_file", return_value=False),
        ):
            result = task_store.cmd_archive(archive_handler_args(task_name))

        self.assertNotEqual(result, 0)
        self.assertFalse(task_dir.exists())
        self.assertTrue(session_path.exists())


if __name__ == "__main__":
    unittest.main()
