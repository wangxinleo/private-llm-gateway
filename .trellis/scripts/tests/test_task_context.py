from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

REPO_ROOT = Path(__file__).resolve().parents[3]
SCRIPTS_ROOT = REPO_ROOT / ".trellis" / "scripts"

if str(SCRIPTS_ROOT) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_ROOT))

from common import session_context
from common.tasks import children_progress, is_terminal_status


def make_task(
    name: str,
    status: str,
    *,
    assignee: str = "alice",
    children: tuple[str, ...] = (),
    parent: str | None = None,
) -> SimpleNamespace:
    return SimpleNamespace(
        dir_name=name,
        name=name,
        title=name,
        status=status,
        assignee=assignee,
        priority="P2",
        children=children,
        parent=parent,
        meta={},
    )


class TaskContextTests(unittest.TestCase):
    def test_terminal_statuses_preserve_done_semantics_and_include_cancelled(self) -> None:
        self.assertTrue(is_terminal_status("completed"))
        self.assertTrue(is_terminal_status("cancelled"))
        self.assertTrue(is_terminal_status("done"))
        self.assertFalse(is_terminal_status("in_progress"))
        self.assertEqual(
            children_progress(
                ("completed", "cancelled", "done", "archived"),
                {
                    "completed": "completed",
                    "cancelled": "cancelled",
                    "done": "done",
                },
            ),
            " [4/4 done]",
        )

    def test_context_views_exclude_terminal_assigned_tasks(self) -> None:
        tasks = [
            make_task("active-task", "in_progress"),
            make_task("completed-task", "completed"),
            make_task("cancelled-task", "cancelled"),
            make_task("done-task", "done"),
        ]

        with self._patched_context(tasks):
            text = session_context.get_context_text(Path("/tmp/trellis-test"))
            record_text = session_context.get_context_text_record(Path("/tmp/trellis-test"))
            record_json = session_context.get_context_record_json(Path("/tmp/trellis-test"))

        my_tasks = text.split("## MY TASKS (Assigned to me)", 1)[1].split(
            "## JOURNAL FILE", 1
        )[0]
        active_record_tasks = record_text.split("## [!!!] MY ACTIVE TASKS", 1)[1].split(
            "## GIT STATUS", 1
        )[0]

        self.assertIn("active-task", my_tasks)
        self.assertNotIn("completed-task", my_tasks)
        self.assertNotIn("cancelled-task", my_tasks)
        self.assertNotIn("done-task", my_tasks)
        self.assertIn("active-task", active_record_tasks)
        self.assertNotIn("cancelled-task", active_record_tasks)
        self.assertEqual([task["dir"] for task in record_json["myTasks"]], ["active-task"])

    def test_record_context_counts_cancelled_and_archived_children_as_terminal(self) -> None:
        tasks = [
            make_task(
                "parent-task",
                "in_progress",
                children=("cancelled-child", "archived-child"),
            ),
            make_task("cancelled-child", "cancelled", parent="parent-task"),
        ]

        with self._patched_context(tasks):
            record_json = session_context.get_context_record_json(Path("/tmp/trellis-test"))

        parent = record_json["myTasks"][0]
        self.assertEqual(parent["childrenDone"], 2)

    @staticmethod
    def _patched_context(tasks: list[SimpleNamespace]):
        return patch.multiple(
            session_context,
            get_developer=lambda _root: "alice",
            _collect_root_git_info=lambda _root: {
                "isRepo": True,
                "branch": "test",
                "isClean": True,
                "uncommittedChanges": 0,
                "recentCommits": [],
            },
            _collect_package_git_info=lambda _root, discover_unconfigured=False: [],
            _append_package_git_context=lambda _lines, _packages: None,
            get_current_task=lambda _root: None,
            get_tasks_dir=lambda _root: Path("/tmp/trellis-test/.trellis/tasks"),
            get_active_journal_file=lambda _root: None,
            get_packages_section=lambda _root: "",
            iter_active_tasks=lambda _tasks_dir: iter(tasks),
        )


class WorkflowBreadcrumbTests(unittest.TestCase):
    def test_cancelled_workflow_state_is_authoritative(self) -> None:
        hook_path = REPO_ROOT / ".claude" / "hooks" / "inject-workflow-state.py"
        spec = importlib.util.spec_from_file_location("inject_workflow_state", hook_path)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader)
        hook = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(hook)

        breadcrumbs = hook.load_breadcrumbs(REPO_ROOT)

        self.assertIn("cancelled", breadcrumbs)
        self.assertIn("terminal", breadcrumbs["cancelled"])


if __name__ == "__main__":
    unittest.main()
