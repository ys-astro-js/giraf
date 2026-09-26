"""Live workflow diagnostics contracts, written before implementation."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
from astropy.io import fits

from giraf import server
from giraf.workflow_diagnostics import workflow_diagnostics


class WorkflowDiagnosticsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)
        self.image = self.folder / "source.fits"
        fits.writeto(self.image, np.ones((4, 4), dtype="float32"))
        self.row = server.register(self.image)

    def node(self, id="n", inputs=None, parameters=None):
        return {
            "id": id,
            "label": id,
            "payload": {
                "task": "images.imutil.imcopy",
                "inputs": inputs or {},
                "parameters": parameters or {},
                "workingDirectory": str(self.folder),
            },
        }

    def inspect(self, nodes, connections=()):
        return workflow_diagnostics(
            {"nodes": nodes, "connections": list(connections), "workingDirectory": str(self.folder)},
            lambda id: self.row if id == self.row["id"] else None,
        )

    def test_missing_input_then_fixed_then_missing_again(self):
        first = self.inspect([self.node()])
        self.assertTrue(any(d["nodeId"] == "n" and d["severity"] == "error" for d in first))
        fixed = self.inspect([self.node(inputs={"input": [self.row["id"]]})])
        self.assertFalse(any(d["severity"] == "error" for d in fixed), fixed)
        self.assertEqual(first, self.inspect([self.node()]))

    def test_missing_result_uses_display_name_with_or_without_connection(self):
        path = self.folder / 'o00000.fits'
        self.image.rename(path)
        self.row = server.register(path, '정렬한 영상.fits', 'old-run')
        nodes = [self.node('a'), self.node(inputs={'input': [self.row['id']]})]
        edge = {'id': 'result', 'source': {'kind': 'result', 'taskId': 'a', 'ids': [self.row['id']]}, 'target': 'n', 'role': 'input'}
        path.unlink()
        for edges in ([edge], []):
            messages = [d['message'] for d in self.inspect(nodes, edges) if d['nodeId'] == 'n']
            self.assertTrue(any('정렬한 영상.fits' in m for m in messages), messages)
            self.assertTrue(all('o00000.fits' not in m for m in messages), messages)

    def test_pending_output_is_waiting_but_bad_edge_and_parameter_are_reported(self):
        edge = {"id": "e", "source": {"kind": "pending", "taskId": "a"}, "target": "b", "role": "input"}
        nodes = [self.node("a", {"input": [self.row["id"]]}), self.node("b")]
        self.assertFalse(any(d["nodeId"] == "b" for d in self.inspect(nodes, [edge])))
        bad = self.inspect([nodes[0], self.node("b", parameters={"unknown": 1})], [{**edge, "role": "bad"}])
        self.assertTrue(any(d.get("connectionId") == "e" for d in bad))
        self.assertTrue(any(d["nodeId"] == "b" and "파라미터" in d["message"] for d in bad))
        legacy = self.node("a", {"input": [self.row["id"]]})
        legacy["payload"]["task"] = "combine"
        wrong_output = self.inspect([legacy, self.node("b")], [{**edge, "source": {**edge["source"], "outputRole": "missing"}}])
        self.assertTrue(any(d.get("connectionId") == "e" for d in wrong_output))
        missing = self.node("missing")
        missing["payload"]["task"] = "uninstalled.task"
        self.assertTrue(any(d["nodeId"] == "missing" for d in self.inspect([missing])))
        single = self.node("single", {"input": [self.row["id"]], "reference": [self.row["id"], self.row["id"]]})
        single["payload"]["task"] = "images.immatch.imalign"
        self.assertTrue(any(d["nodeId"] == "single" and "한 개" in d["message"] for d in self.inspect([single])))

    def test_external_file_changes_and_recovers_without_hash_or_mutation(self):
        nodes = [self.node("a", {"input": [self.row["id"]]}), self.node(inputs={"input": [self.row["id"]]})]
        edge = {"id": "result-edge", "source": {"kind": "result", "taskId": "a", "runId": "completed", "ids": [self.row["id"]]}, "target": "n", "role": "input"}
        before = self.image.read_bytes()
        with patch("giraf.task_jobs.digest", side_effect=AssertionError("hash")), patch("giraf.generic_tasks.validation.file_hash", side_effect=AssertionError("hash")):
            self.assertFalse(any(d["severity"] == "error" for d in self.inspect(nodes, [edge])))
            self.image.unlink()
            self.assertTrue(any(d["nodeId"] == "n" and "파일" in d["message"] for d in self.inspect(nodes, [edge])))
            self.image.write_bytes(b"broken FITS")
            self.assertTrue(any(d["severity"] == "error" for d in self.inspect(nodes)))
            self.image.write_bytes(before)
            self.assertFalse(any(d["severity"] == "error" for d in self.inspect(nodes, [edge])))
        self.assertEqual(self.image.read_bytes(), before)
        self.assertEqual(sorted(p.name for p in self.folder.iterdir()), ["source.fits"])
        expression = [self.node(inputs={}, parameters={})]
        expression[0]["payload"]["expressions"] = {"input": "source*.fits"}
        listing = self.folder / "sources.list"
        listing.write_text("source.fits\n")
        selected_list = [self.node(inputs={"input": ["list"]})]
        def resolve(id):
            if id == "list":
                return {"id": id, "path": str(listing), "name": listing.name, "asset": "image-list"}
            return self.row if id == self.row["id"] else None
        with patch("giraf.task_expressions.resolve_expression", side_effect=AssertionError("IRAF expansion")), patch("tempfile.TemporaryDirectory", side_effect=AssertionError("temporary folder")):
            self.assertFalse(any(d["severity"] == "error" for d in self.inspect(expression)))
            self.assertFalse(any(d["severity"] == "error" for d in workflow_diagnostics(
                {"nodes": selected_list, "connections": [], "workingDirectory": str(self.folder)}, resolve)))


class GraphDiagnosticsTests(unittest.TestCase):
    def edge(self, source, target, role='input'):
        return dict(id=f'{source}-{target}-{role}', target=target, role=role,
                    source=dict(kind='pending', taskId=source))

    def diagnose(self, ids, connections):
        spec = dict(name='test', adapter='generic',
                    inputs=[dict(name='input', kind='image', multiple=True),
                            dict(name='reference', kind='image', multiple=False)],
                    outputs=[dict(name='output', kind='image')])
        request = dict(nodes=[dict(id=id, payload=dict(task='test')) for id in ids],
                       connections=connections)
        with patch('giraf.workflow_diagnostics.TASKS', {'test': spec}), patch(
            'giraf.workflow_diagnostics.validate_task', return_value={'warnings': []}
        ):
            return workflow_diagnostics(request, lambda _: None)

    def test_marks_every_cycle_edge_but_not_bridges_or_downstream_edges(self):
        edges = [self.edge(a, b) for a, b in [
            ('a', 'b'), ('b', 'a'), ('b', 'c'), ('c', 'd'), ('d', 'c'),
            ('d', 'e'), ('self', 'self'), ('missing', 'e')]]
        issues = self.diagnose(['a', 'b', 'c', 'd', 'e', 'self'], edges)
        cyclic = {issue['connectionId'] for issue in issues if '순환' in issue['message']}
        self.assertEqual(cyclic, {edges[i]['id'] for i in (0, 1, 3, 4, 6)})
        self.assertTrue(any(issue['connectionId'] == edges[-1]['id'] and '삭제' in issue['message'] for issue in issues))

    def test_long_chain_and_cycle_do_not_depend_on_python_recursion_limit(self):
        ids = [str(i) for i in range(1200)]
        edges = [self.edge(a, b) for a, b in zip(ids, ids[1:])]
        self.assertEqual(self.diagnose(ids, edges), [])
        edges.append(self.edge(ids[-1], ids[0]))
        self.assertEqual({issue['connectionId'] for issue in self.diagnose(ids, edges)},
                         {edge['id'] for edge in edges})

    def test_graph_checks_have_a_linear_connection_visit_budget(self):
        class CountedConnections(list):
            visits = 0

            def __iter__(self):
                for edge in super().__iter__():
                    self.visits += 1
                    yield edge

        ids = [str(i) for i in range(40)]
        for role in ('input', 'reference'):
            with self.subTest(role=role):
                edges = CountedConnections(self.edge(a, b, role) for a, b in zip(ids, ids[1:]))
                self.assertEqual(self.diagnose(ids, edges), [])
                self.assertLessEqual(edges.visits, 10 * (len(ids) + len(edges)))

    def test_single_input_duplicate_errors_keep_priority_over_cycle_errors(self):
        edges = [self.edge('a', 'b', 'reference'), self.edge('c', 'b', 'reference'), self.edge('b', 'a')]
        issues = self.diagnose(['a', 'b', 'c'], edges)
        for edge in edges[:2]:
            self.assertTrue(any(issue['connectionId'] == edge['id'] and '하나만' in issue['message'] for issue in issues))
        self.assertTrue(any(issue['connectionId'] == edges[2]['id'] and '순환' in issue['message'] for issue in issues))


if __name__ == "__main__":
    unittest.main()
