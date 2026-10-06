"""Pure stdlib regression guards; no services, browser, or network access."""
from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import weakref

from enterprise_python_allocation_support import (
    AllocationDiagnosticError, AllocationLimits, MIB, PythonAllocationProbe,
    aggregate_snapshot, bounded_sizeof_census,
)


def trace(filename, line, size):
    return SimpleNamespace(size=size, traceback=[SimpleNamespace(filename=filename, lineno=line)])


class Snapshot:
    def __init__(self, traces):
        self.traces = traces


class FakeTracer:
    def __init__(self):
        self.active = False
        self.start_calls = []
        self.stop_calls = 0
        self.snapshot_calls = 0
        self.snapshot_refs = []
        self.storage = 64
        self.frames = 1

    def is_tracing(self):
        return self.active

    def start(self, frames):
        self.active = True
        self.frames = frames
        self.start_calls.append(frames)

    def stop(self):
        self.stop_calls += 1
        self.active = False

    def get_traceback_limit(self):
        return self.frames

    def get_traced_memory(self):
        return (80, 160)

    def get_tracemalloc_memory(self):
        return self.storage

    def take_snapshot(self):
        self.snapshot_calls += 1
        value = Snapshot([trace('/installed/playwright/_impl/_network.py', 123, 80)])
        self.snapshot_refs.append(weakref.ref(value))
        return value


class Owner:
    def __init__(self, protocol_type='Request', initializer=None):
        self._type = protocol_type
        self._guid = 'payload-guid-not-exported'
        self._initializer = initializer or {}
        self._objects = {}


class Forbidden:
    def __sizeof__(self):
        raise AssertionError('Forbidden referent was inspected')


class TickClock:
    def __init__(self, step):
        self.value = 0.0
        self.step = step

    def __call__(self):
        self.value += self.step
        return self.value


class AggregationTests(unittest.TestCase):
    def test_observation_harness_has_a_fixed_diagnostic_label(self):
        result = aggregate_snapshot(Snapshot([
            trace('/checkout/tests/test_enterprise_python_allocation.py', 40, 96),
            trace('/checkout/other/test_enterprise_python_allocation.py', 40, 32),
        ]))
        self.assertEqual(result['modules']['diagnostic.allocation_harness']['bytes'], 96)
        self.assertEqual(result['unclassified']['bytes'], 32)
        self.assertEqual(result['total'], {'bytes': 128, 'allocationBlocks': 2})
        self.assertNotIn('/checkout', json.dumps(result))

    def test_line_cap_preserves_allocation_bytes_blocks_and_unclassified(self):
        values = [trace('/wheel/playwright/_impl/_network.py', line, line)
                  for line in range(1, 206)]
        values.extend([trace('/wheel/playwright/_impl/_network.py', 1, 10),
                       trace('/private/request-value-must-not-escape.py', 1, 27)])
        result = aggregate_snapshot(Snapshot(values))
        group = result['modules']['playwright._impl._network']
        self.assertEqual(len(group['lines']), 200)
        self.assertEqual(group['remainder'], {'bytes': sum(range(201, 206)), 'allocationBlocks': 5})
        self.assertEqual(result['unclassified'], {'bytes': 27, 'allocationBlocks': 1})
        self.assertEqual(result['total'], {'bytes': sum(range(1, 206)) + 37, 'allocationBlocks': 207})
        self.assertEqual(group['bytes'], sum(row['bytes'] for row in group['lines']) + group['remainder']['bytes'])
        self.assertNotIn('request-value', json.dumps(result))

    def test_timeout_marks_partial_totals_incomplete(self):
        result = aggregate_snapshot(Snapshot([trace('/json/decoder.py', 1, 10)] * 10),
                                    clock=TickClock(.6), deadline=2)
        self.assertFalse(result['complete'])
        self.assertLess(result['tracesProcessed'], result['snapshotTraceCount'])


class CensusTests(unittest.TestCase):
    def census(self, owners=(), samples=(), metadata=None, **kwargs):
        return bounded_sizeof_census(protocol_objects=owners, resource_samples=samples,
                                    result_metadata=metadata or {}, **kwargs)

    def test_never_walks_ownership_or_opaque_initializer_references_or_exports_values(self):
        dangerous = Forbidden()
        owner = Owner(initializer={'headers': [{'name': 'PRIVATE-HEADER', 'value': 'SECRET-CONTENT'}],
                                   'body': 'SECRET-BODY', 'frame': dangerous})
        for key in ('_parent', '_connection', '_loop', '_frame', '_context', '_page'):
            setattr(owner, key, dangerous)
        result = self.census([owner], metadata={'unlisted': dangerous, 'consoleErrors': ['SECRET-CONSOLE']})
        self.assertTrue(result['complete'])
        self.assertEqual(result['opaqueReferencesExcluded'], 1)
        self.assertGreater(result['directBytes'], 0)
        encoded = json.dumps(result)
        for secret in ('PRIVATE-HEADER', 'SECRET-CONTENT', 'SECRET-BODY', 'SECRET-CONSOLE', 'payload-guid'):
            self.assertNotIn(secret, encoded)

    def test_shared_values_count_once_and_no_input_references_escape(self):
        shared = ['a-shared-value']
        first, second = Owner(initializer={'value': shared}), Owner('Response', {'value': shared})
        ref = weakref.ref(first)
        result = self.census([first, second], samples=[{'items': shared}])
        self.assertGreater(result['sharedReferencesSkipped'], 0)
        self.assertEqual(result['directBytes'], sum(group['directBytes'] for group in result['categories'].values()))
        self.assertEqual(result['uniqueObjects'], sum(group['uniqueObjects'] for group in result['categories'].values()))
        del first
        self.assertIsNone(ref())
        json.dumps(result, allow_nan=False)

    def test_protocol_shell_categories_do_not_assert_live_resources(self):
        result = self.census([Owner(name) for name in ('Artifact', 'Stream', 'Worker')])
        self.assertEqual(result['selectedProtocolOwners'], 3)
        self.assertIn('auxiliary.Worker', result['categories'])
        self.assertIn('NOT_DOMINATED', result['interpretation'])
        self.assertNotIn('liveWorkers', result)

    def test_object_cap_is_incomplete_and_bounded(self):
        limits = replace(AllocationLimits(), census_objects=3)
        result = self.census(samples=[{'x': ['a', 'b', 'c']}], limits=limits)
        self.assertFalse(result['complete'])
        self.assertEqual(result['uniqueObjects'], 3)
        self.assertIn('CENSUS_OBJECT_LIMIT', result['limitReasons'])

    def test_depth_cap_is_not_reported_as_full_attribution(self):
        result = self.census(samples=[[[['deep']]]], limits=replace(AllocationLimits(), census_depth=2))
        self.assertFalse(result['complete'])
        self.assertIn('CENSUS_DEPTH_LIMIT', result['limitReasons'])

    def test_time_cap_stops_without_forced_collection(self):
        result = self.census(samples=list(range(100)), clock=TickClock(.3))
        self.assertFalse(result['complete'])
        self.assertIn('CENSUS_TIME_LIMIT', result['limitReasons'])
        self.assertLess(result['uniqueObjects'], 100)

    def test_unselected_result_tree_is_not_traversed(self):
        result = self.census(metadata={'stages': [[[[[[[Forbidden()]]]]]]],
                                       'nativeRequests': [{'method': 'POST', 'path': '/synthetic'}]})
        self.assertTrue(result['complete'])
        self.assertIn('collector.nativeRequests', result['categories'])
        self.assertNotIn('collector.stages', result['categories'])


class ProbeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='allocation-support-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)

    def checkpoint(self, probe, name):
        return probe.checkpoint(name, protocol_objects=[Owner()], resource_samples=[], result_metadata={})

    def test_off_arm_census_runs_but_tracer_is_untouched(self):
        tracer = FakeTracer()
        probe = PythonAllocationProbe(self.directory, False, trace_module=tracer)
        probe.start()
        first = self.checkpoint(probe, 'baseline')
        second = self.checkpoint(probe, 'endpoint')
        probe.finish()
        self.assertTrue(first['census']['complete'])
        self.assertEqual(first['census']['selectedProtocolOwners'], 1)
        self.assertFalse(second['snapshot']['enabled'])
        self.assertEqual((tracer.start_calls, tracer.snapshot_calls, tracer.stop_calls), ([], 0, 0))

    def test_on_arm_one_frame_exactly_two_snapshots_released_and_metadata_only(self):
        tracer = FakeTracer()
        probe = PythonAllocationProbe(self.directory, True, trace_module=tracer)
        probe.start()
        for label in ('baseline', 'endpoint'):
            value = self.checkpoint(probe, label)
            self.assertEqual(value['status'], 'PASS')
            self.assertEqual(value['tracemalloc']['currentBytes'], 80)
            self.assertTrue(value['snapshot']['complete'])
            self.assertTrue(all(ref() is None for ref in tracer.snapshot_refs))
            self.assertLessEqual((self.directory / ('python-allocation-' + label + '.json')).stat().st_size, MIB)
        self.assertEqual(probe.finish()['twoCheckpointsCompleted'], True)
        self.assertEqual((tracer.start_calls, tracer.snapshot_calls, tracer.stop_calls), ([1], 2, 1))
        self.assertNotIn('payload-guid', ''.join(p.read_text() for p in self.directory.iterdir()))

    def test_ambient_tracing_and_bad_checkpoint_order_are_rejected(self):
        tracer = FakeTracer()
        tracer.active = True
        probe = PythonAllocationProbe(self.directory, False, trace_module=tracer)
        with self.assertRaisesRegex(AllocationDiagnosticError, 'AMBIENT_TRACING'):
            probe.start()
        tracer.active = False
        probe.start()
        with self.assertRaisesRegex(AllocationDiagnosticError, 'CHECKPOINT_ORDER'):
            self.checkpoint(probe, 'endpoint')
        self.checkpoint(probe, 'baseline')
        with self.assertRaisesRegex(AllocationDiagnosticError, 'CHECKPOINT_ORDER'):
            self.checkpoint(probe, 'baseline')
        probe.finish()

    def test_trace_storage_guard_has_stable_reason_and_primitive_receipt(self):
        tracer = FakeTracer()
        probe = PythonAllocationProbe(self.directory, True, trace_module=tracer)
        probe.start()
        tracer.storage = 32 * MIB + 1
        with self.assertRaises(AllocationDiagnosticError) as caught:
            probe.poll()
        self.assertEqual(caught.exception.reason, 'ALLOCATION_TRACE_STORAGE_LIMIT')
        json.dumps(caught.exception.receipt)
        self.assertEqual(tracer.snapshot_calls, 0)
        probe.finish()

    def test_census_incomplete_writes_failure_not_success(self):
        probe = PythonAllocationProbe(self.directory, False, trace_module=FakeTracer(),
                                      limits=replace(AllocationLimits(), census_objects=1))
        probe.start()
        with self.assertRaises(AllocationDiagnosticError) as caught:
            self.checkpoint(probe, 'baseline')
        self.assertEqual(caught.exception.reason, 'ALLOCATION_CENSUS_INCOMPLETE')
        self.assertEqual(json.loads((self.directory / 'python-allocation-baseline.json').read_text())['status'], 'INCOMPLETE')
        probe.finish()

    def test_failed_endpoint_is_attempted_but_not_successfully_completed(self):
        probe = PythonAllocationProbe(self.directory, False, trace_module=FakeTracer(),
                                      limits=replace(AllocationLimits(), census_objects=20))
        probe.start()
        self.checkpoint(probe, 'baseline')
        with self.assertRaisesRegex(AllocationDiagnosticError, 'CENSUS_INCOMPLETE'):
            probe.checkpoint('endpoint', protocol_objects=[], resource_samples=list(range(100)),
                             result_metadata={})
        finished = probe.finish()
        self.assertEqual(finished['attemptedCheckpoints'], ['baseline', 'endpoint'])
        self.assertEqual(finished['successfulCheckpoints'], ['baseline'])
        self.assertEqual(finished['checkpoints'], ['baseline'])
        self.assertFalse(finished['twoCheckpointsCompleted'])
        self.assertEqual(json.loads((self.directory / 'python-allocation-endpoint.json').read_text())['status'], 'INCOMPLETE')

    def test_checkpoint_time_checked_after_snapshot_returns(self):
        clock = TickClock(.5)
        probe = PythonAllocationProbe(self.directory, True, trace_module=FakeTracer(), clock=clock)
        probe.start()
        with self.assertRaises(AllocationDiagnosticError) as caught:
            self.checkpoint(probe, 'baseline')
        self.assertEqual(caught.exception.reason, 'ALLOCATION_CHECKPOINT_TIME_LIMIT')
        self.assertTrue(caught.exception.receipt['timeoutCheckedOnReturn'])
        self.assertFalse(caught.exception.receipt['callIsPreemptible'])
        probe.finish()

    def test_file_cap_never_writes_oversized_allocation_evidence(self):
        probe = PythonAllocationProbe(self.directory, False, trace_module=FakeTracer(),
                                      limits=replace(AllocationLimits(), artifact_bytes=220))
        probe.start()
        with self.assertRaises(AllocationDiagnosticError) as caught:
            self.checkpoint(probe, 'baseline')
        self.assertEqual(caught.exception.reason, 'ALLOCATION_ARTIFACT_SIZE_LIMIT')
        self.assertTrue(all(path.stat().st_size <= 220 for path in self.directory.iterdir()))
        probe.finish()

    def test_slow_evidence_write_is_rejected_after_return(self):
        now = [0.0]
        probe = PythonAllocationProbe(self.directory, False, trace_module=FakeTracer(), clock=lambda: now[0])
        probe.start()
        original_write = probe._write

        def delayed_write(label, receipt, **kwargs):
            value = original_write(label, receipt, **kwargs)
            if not kwargs.get('overwrite_own'):
                now[0] += 2.1
            return value

        with patch.object(probe, '_write', side_effect=delayed_write):
            with self.assertRaises(AllocationDiagnosticError) as caught:
                self.checkpoint(probe, 'baseline')
        self.assertEqual(caught.exception.reason, 'ALLOCATION_CHECKPOINT_TIME_LIMIT')
        self.assertGreater(caught.exception.receipt['durationSeconds'], 2)
        self.assertEqual(json.loads((self.directory / 'python-allocation-baseline.json').read_text())['status'], 'INCOMPLETE')
        probe.finish()

    def test_existing_artifact_is_preserved(self):
        target = self.directory / 'python-allocation-baseline.json'
        target.write_text('existing evidence')
        probe = PythonAllocationProbe(self.directory, False, trace_module=FakeTracer())
        probe.start()
        with self.assertRaisesRegex(AllocationDiagnosticError, 'EVIDENCE_EXISTS'):
            self.checkpoint(probe, 'baseline')
        self.assertEqual(target.read_text(), 'existing evidence')
        probe.finish()

    def test_real_stdlib_tracer_roundtrip_without_gc(self):
        probe = PythonAllocationProbe(self.directory, True)
        probe.start()
        try:
            self.checkpoint(probe, 'baseline')
            allocations = [bytearray(1000) for _ in range(10)]
            result = self.checkpoint(probe, 'endpoint')
            self.assertTrue(result['snapshot']['complete'])
            self.assertGreater(result['snapshot']['total']['bytes'], 0)
            self.assertEqual(len(allocations), 10)
        finally:
            probe.finish()

    def test_limits_cannot_relax_authorized_bounds(self):
        for override in ({'trace_storage_bytes': 33 * MIB}, {'artifact_bytes': MIB + 1},
                         {'checkpoint_seconds': 2.01}, {'census_objects': 200001},
                         {'census_depth': 7}, {'module_lines': 201}):
            with self.assertRaises(ValueError):
                AllocationLimits(**override)


if __name__ == '__main__':
    unittest.main()
