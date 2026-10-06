"""Bounded, metadata-only Python allocation evidence for the paired diagnostic.

No browser operations, collection requests, protocol mutations, or extra
dependencies. RSS admission and process watchdogs belong to the caller.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
import json
from pathlib import Path
import sys
import time
import tracemalloc


MIB = 1024 * 1024
RESULT_FIELDS = ('nativeRequests', 'consoleErrors', 'genuineNativeSuccesses', 'latestDraftRoundtrip')
PROTOCOL_TYPES = ('Request', 'Response', 'Route', 'Artifact', 'Stream', 'Worker')
PRIMITIVES = (type(None), bool, int, float, str, bytes, bytearray)
CONTAINERS = (dict, defaultdict, list, tuple, set, frozenset)
OWNER_CONTAINER_FIELDS = ('_initializer', '_timing', '_event_to_subscription_mapping')
OWNER_SCALAR_FIELDS = ('_guid', '_type')
OWNER_SHALLOW_FIELDS = ('_finished_future', '_all_headers_future', '_raw_headers_future', '_handling_future')
AUXILIARY_FIELDS = {
    '_provisional_headers': ('_headers_array', '_headers_map'),
    '_fallback_overrides': ('url', 'headers', 'post_data_buffer'),
    '_channel': ('_guid',),
}

# Output contains these fixed labels and source line numbers, never arbitrary
# filenames, request URLs, header/body values, object reprs, or user payloads.
MODULE_SUFFIXES = {
    **{f'/playwright/_impl/{name}.py': f'playwright._impl.{name}' for name in (
        '_connection', '_network', '_transport', '_impl_to_api_mapping', '_sync_base', '_page')},
    **{f'/asyncio/{name}.py': f'stdlib.asyncio.{name}' for name in (
        'base_events', 'events', 'futures', 'tasks', 'locks', 'streams')},
    **{f'/json/{name}.py': f'stdlib.json.{name}' for name in ('__init__', 'decoder', 'encoder')},
    '/pyee/asyncio.py': 'pyee.asyncio',
    '/pyee/base.py': 'pyee.base',
    '/tests/enterprise_browser_soak_support.py': 'harness.resource_support',
    '/tests/test_enterprise_browser_soak.py': 'harness.browser_soak',
    '/tests/test_enterprise_synthetic_full_ui.py': 'harness.synthetic_ui',
    '/tests/test_enterprise_ui_faults.py': 'harness.ui_faults',
    '/tests/enterprise_python_allocation_support.py': 'diagnostic.allocation_support',
    '/tests/test_enterprise_python_allocation.py': 'diagnostic.allocation_harness',
}


@dataclass(frozen=True)
class AllocationLimits:
    trace_storage_bytes: int = 32 * MIB
    artifact_bytes: int = MIB
    checkpoint_seconds: float = 2.0
    census_objects: int = 200000
    census_depth: int = 6
    module_lines: int = 200

    def __post_init__(self):
        for name, maximum in (('trace_storage_bytes', 32 * MIB), ('artifact_bytes', MIB),
                              ('checkpoint_seconds', 2.0), ('census_objects', 200000),
                              ('census_depth', 6), ('module_lines', 200)):
            value = getattr(self, name)
            if not 0 < value <= maximum:
                raise ValueError('ALLOCATION_LIMIT_INVALID:' + name)


class AllocationDiagnosticError(AssertionError):
    def __init__(self, reason, receipt=None):
        self.reason = reason
        self.receipt = receipt or {'status': 'INCOMPLETE', 'reason': reason}
        super().__init__(reason)


def module_label(filename):
    normalized = str(filename).replace('\\', '/')
    for suffix, label in MODULE_SUFFIXES.items():
        if normalized.endswith(suffix):
            return label
    return None


def aggregate_snapshot(snapshot, *, limits=None, clock=time.monotonic, deadline=None):
    """Aggregate every trace once, with bounded per-module line dictionaries.

The first `module_lines` distinct source lines per module are itemized; all
others go into that module's remainder. They are not advertised as top lines.
An elapsed-time interruption is explicit, and invalidates full attribution.
"""
    limits = limits or AllocationLimits()
    totals = {'bytes': 0, 'allocationBlocks': 0}
    unclassified = {'bytes': 0, 'allocationBlocks': 0}
    modules = {}
    complete = True
    for trace in snapshot.traces:
        if deadline is not None and clock() > deadline:
            complete = False
            break
        size = int(trace.size)
        totals['bytes'] += size
        totals['allocationBlocks'] += 1
        frame = trace.traceback[-1] if trace.traceback else None
        label = module_label(frame.filename) if frame is not None else None
        if label is None:
            unclassified['bytes'] += size
            unclassified['allocationBlocks'] += 1
            continue
        module = modules.setdefault(label, {'bytes': 0, 'allocationBlocks': 0, 'lines': {},
                                            'remainder': {'bytes': 0, 'allocationBlocks': 0}})
        module['bytes'] += size
        module['allocationBlocks'] += 1
        line = int(frame.lineno)
        if line not in module['lines'] and len(module['lines']) >= limits.module_lines:
            bucket = module['remainder']
        else:
            bucket = module['lines'].setdefault(line, {'bytes': 0, 'allocationBlocks': 0})
        bucket['bytes'] += size
        bucket['allocationBlocks'] += 1
    return {
        'complete': complete, 'total': totals, 'unclassified': unclassified,
        'modules': {label: {**value, 'lines': [dict(line=line, **counts)
                    for line, counts in sorted(value['lines'].items())]}
                    for label, value in sorted(modules.items())},
        'sourceLineSelection': 'FIRST_DISTINCT_LINES_WITH_COMPLETE_REMAINDER',
        'interpretation': 'LIVE_TRACED_ALLOCATION_BLOCKS_NOT_OBJECT_COUNTS_OR_RSS',
        'tracesProcessed': totals['allocationBlocks'], 'snapshotTraceCount': len(snapshot.traces),
    }


def _plain_dict(value):
    try:
        result = object.__getattribute__(value, '__dict__')
    except (AttributeError, TypeError):
        return None
    return result if type(result) is dict else None


def bounded_sizeof_census(*, protocol_objects, resource_samples, result_metadata,
                         limits=None, clock=time.monotonic, deadline=None):
    """Count a declared reachable subset; never follow arbitrary referents.

Only integer IDs are retained during traversal; all input references remain
local and disappear before this primitive-only receipt is returned. Shared
objects are assigned once in protocol/resource/result traversal order.
"""
    limits = limits or AllocationLimits()
    started = clock()
    deadline = min(started + limits.checkpoint_seconds, deadline) if deadline is not None else started + limits.checkpoint_seconds
    seen, categories = set(), {}
    summary = {'complete': True, 'limitReasons': [], 'uniqueObjects': 0, 'directBytes': 0,
               'sharedReferencesSkipped': 0, 'opaqueReferencesExcluded': 0,
               'protocolOwnersExamined': 0, 'selectedProtocolOwners': 0}

    def fail(reason):
        summary['complete'] = False
        if reason not in summary['limitReasons']:
            summary['limitReasons'].append(reason)

    def admit():
        if clock() > deadline:
            fail('CENSUS_TIME_LIMIT')
        return summary['complete']

    def count(value, category, type_name):
        if not admit():
            return False
        identity = id(value)
        if identity in seen:
            summary['sharedReferencesSkipped'] += 1
            return False
        if len(seen) >= limits.census_objects:
            fail('CENSUS_OBJECT_LIMIT')
            return False
        seen.add(identity)
        amount = sys.getsizeof(value)
        summary['uniqueObjects'] += 1
        summary['directBytes'] += amount
        group = categories.setdefault(category, {'directBytes': 0, 'uniqueObjects': 0, 'byType': {}})
        group['directBytes'] += amount
        group['uniqueObjects'] += 1
        by_type = group['byType'].setdefault(type_name, {'directBytes': 0, 'uniqueObjects': 0})
        by_type['directBytes'] += amount
        by_type['uniqueObjects'] += 1
        return True

    def walk(value, category, depth=0):
        if not summary['complete']:
            return
        kind = type(value)
        if kind not in PRIMITIVES and kind not in CONTAINERS:
            summary['opaqueReferencesExcluded'] += 1
            return
        if not count(value, category, kind.__name__):
            return
        if kind in PRIMITIVES or not value:
            return
        if depth >= limits.census_depth:
            fail('CENSUS_DEPTH_LIMIT')
            return
        if kind in (dict, defaultdict):
            for key, item in dict.items(value):
                walk(key, category, depth + 1)
                walk(item, category, depth + 1)
                if not summary['complete']:
                    break
        else:
            for item in value:
                walk(item, category, depth + 1)
                if not summary['complete']:
                    break

    def shell(value, category, name):
        if value is None or not count(value, category, name):
            return None
        data = _plain_dict(value)
        if data is not None:
            count(data, category, 'dict')
        return data

    for owner in protocol_objects:
        if not admit():
            break
        summary['protocolOwnersExamined'] += 1
        if summary['protocolOwnersExamined'] > limits.census_objects:
            fail('CENSUS_PROTOCOL_SCAN_LIMIT')
            break
        data = _plain_dict(owner)
        if data is None or data.get('_type') not in PROTOCOL_TYPES:
            continue
        protocol_type = data['_type']
        category = ('network.' if protocol_type in ('Request', 'Response', 'Route') else 'auxiliary.') + protocol_type
        summary['selectedProtocolOwners'] += 1
        if shell(owner, category, protocol_type) is None:
            continue
        for name in OWNER_SCALAR_FIELDS + OWNER_CONTAINER_FIELDS:
            if name in data:
                walk(data[name], category)
        # Child maps are measured shallowly. Their owners are independently
        # enumerated above; connection/page/frame ownership edges are not walked.
        children = data.get('_objects')
        if type(children) is dict:
            count(children, category, 'dict')
        for name in OWNER_SHALLOW_FIELDS:
            value = data.get(name)
            if value is not None:
                count(value, category, 'future_shell')
        for name, fields in AUXILIARY_FIELDS.items():
            value = data.get(name)
            if value is None:
                continue
            extra = shell(value, category, name[1:] + '_shell')
            if extra is not None:
                for field in fields:
                    if field in extra:
                        walk(extra[field], category)
        if not summary['complete']:
            break
    if summary['complete']:
        walk(resource_samples, 'collector.resource_samples')
    if summary['complete'] and type(result_metadata) is dict:
        for key in RESULT_FIELDS:
            if key in result_metadata:
                walk(result_metadata[key], 'collector.' + key)
            if not summary['complete']:
                break
    duration = clock() - started
    if duration > limits.checkpoint_seconds:
        fail('CENSUS_TIME_LIMIT')
    return {
        **summary, 'durationSeconds': duration,
        'categories': dict(sorted(categories.items())),
        'interpretation': 'DECLARED_REACHABLE_SUBSET_NOT_DOMINATED_RETAINED_BYTES_OR_RSS',
        'completeMeaning': 'COMPLETE_ONLY_WITHIN_DECLARED_FIELD_AND_TYPE_ALLOWLIST',
        'assignmentOrder': 'PROTOCOL_THEN_RESOURCE_SAMPLES_THEN_RESULT_FIELDS',
        'bounds': {'uniqueObjects': limits.census_objects, 'containerDepth': limits.census_depth,
                   'seconds': limits.checkpoint_seconds},
        'allowlist': {'protocolTypes': list(PROTOCOL_TYPES),
                      'ownerContainerFields': list(OWNER_CONTAINER_FIELDS),
                      'ownerScalarFields': list(OWNER_SCALAR_FIELDS),
                      'ownerShallowFields': list(OWNER_SHALLOW_FIELDS) + ['_objects'],
                      'auxiliaryFields': {key: list(fields) for key, fields in AUXILIARY_FIELDS.items()},
                      'resultFields': list(RESULT_FIELDS),
                      'primitiveTypes': [kind.__name__ for kind in PRIMITIVES],
                      'containerTypes': [kind.__name__ for kind in CONTAINERS]},
        'excluded': ['parent', 'connection', 'frame', 'page', 'context', 'event_loop',
                     'callbacks', 'globals', 'arbitrary_object_referents', 'unlisted_result_fields'],
    }


class PythonAllocationProbe:
    """One arm's exact two-checkpoint probe; caller owns the resource guard."""
    def __init__(self, evidence_dir, enabled, *, limits=None, clock=time.monotonic, trace_module=None):
        self.evidence_dir = Path(evidence_dir)
        self.enabled = bool(enabled)
        self.limits = limits or AllocationLimits()
        self.clock = clock
        self.trace = trace_module or tracemalloc
        self.started = False
        self.finished = False
        self.owns_tracing = False
        # labels records attempts for the exact two-call/order guard. Success is
        # recorded only after measurement, persistence, and limits all pass.
        self.labels = []
        self.successful_labels = []

    def start(self):
        if self.started or self.finished:
            raise AllocationDiagnosticError('ALLOCATION_PROBE_ALREADY_STARTED_OR_FINISHED')
        if self.trace.is_tracing():
            raise AllocationDiagnosticError('ALLOCATION_AMBIENT_TRACING_PRESENT')
        self.evidence_dir.mkdir(parents=True, exist_ok=True)
        if self.enabled:
            self.trace.start(1)
            self.owns_tracing = True
        self.started = True

    def poll(self):
        if not self.started or self.finished:
            raise AllocationDiagnosticError('ALLOCATION_PROBE_NOT_ACTIVE')
        value = {'enabled': self.enabled, 'currentBytes': None, 'peakBytes': None,
                 'storageBytes': None, 'tracebackFrames': 1 if self.enabled else 0}
        if self.enabled:
            if not self.trace.is_tracing() or self.trace.get_traceback_limit() != 1:
                raise AllocationDiagnosticError('ALLOCATION_TRACER_STATE_CHANGED')
            value['currentBytes'], value['peakBytes'] = self.trace.get_traced_memory()
            value['storageBytes'] = self.trace.get_tracemalloc_memory()
            if value['storageBytes'] > self.limits.trace_storage_bytes:
                raise AllocationDiagnosticError('ALLOCATION_TRACE_STORAGE_LIMIT',
                    {'status': 'INCOMPLETE', 'reason': 'ALLOCATION_TRACE_STORAGE_LIMIT', 'tracemalloc': value})
        elif self.trace.is_tracing():
            raise AllocationDiagnosticError('ALLOCATION_OFF_ARM_TRACING_PRESENT')
        return value

    def _write(self, label, receipt, *, overwrite_own=False):
        target = self.evidence_dir / ('python-allocation-' + label + '.json')
        encoded = (json.dumps(receipt, ensure_ascii=True, separators=(',', ':'), allow_nan=False) + '\n').encode('utf-8')
        if len(encoded) > self.limits.artifact_bytes:
            failure = {'status': 'INCOMPLETE', 'reason': 'ALLOCATION_ARTIFACT_SIZE_LIMIT',
                       'checkpoint': label, 'attemptedBytes': len(encoded),
                       'limitBytes': self.limits.artifact_bytes}
            small = (json.dumps(failure, separators=(',', ':')) + '\n').encode('utf-8')
            if len(small) <= self.limits.artifact_bytes:
                with target.open('wb' if overwrite_own else 'xb') as stream:
                    stream.write(small)
            raise AllocationDiagnosticError('ALLOCATION_ARTIFACT_SIZE_LIMIT', failure)
        with target.open('wb' if overwrite_own else 'xb') as stream:
            stream.write(encoded)
        return len(encoded)

    def checkpoint(self, label, *, protocol_objects, resource_samples, result_metadata):
        expected = ('baseline', 'endpoint')
        if len(self.labels) >= 2 or label != expected[len(self.labels)]:
            raise AllocationDiagnosticError('ALLOCATION_CHECKPOINT_ORDER_INVALID')
        if (self.evidence_dir / ('python-allocation-' + label + '.json')).exists():
            raise AllocationDiagnosticError('ALLOCATION_CHECKPOINT_EVIDENCE_EXISTS')
        self.labels.append(label)
        started = self.clock()
        deadline = started + self.limits.checkpoint_seconds
        value = self.poll()
        snapshot_result = {'enabled': False, 'complete': True}
        if self.enabled:
            snapshot = self.trace.take_snapshot()
            try:
                snapshot_result = {'enabled': True, **aggregate_snapshot(
                    snapshot, limits=self.limits, clock=self.clock, deadline=deadline)}
            finally:
                # No snapshot, traceback, or raw trace leaves this call.
                del snapshot
        census = bounded_sizeof_census(protocol_objects=protocol_objects,
            resource_samples=resource_samples, result_metadata=result_metadata,
            limits=self.limits, clock=self.clock, deadline=deadline)
        duration = self.clock() - started
        reason = None
        if duration > self.limits.checkpoint_seconds or not snapshot_result['complete']:
            reason = 'ALLOCATION_CHECKPOINT_TIME_LIMIT'
        elif not census['complete']:
            reason = 'ALLOCATION_CENSUS_INCOMPLETE'
        try:
            value_after = self.poll()
        except AllocationDiagnosticError as exc:
            reason = reason or exc.reason
            value_after = exc.receipt.get('tracemalloc', value)
        receipt = {'checkpoint': label, 'status': 'INCOMPLETE' if reason else 'PASS',
                   'reason': reason, 'enabled': self.enabled, 'durationSeconds': duration,
                   'measurementDurationSeconds': duration,
                   'timingScope': 'MEASUREMENT_BEFORE_EVIDENCE_WRITE',
                   'checkpointLimitSeconds': self.limits.checkpoint_seconds,
                   'timeoutCheckedOnReturn': True, 'callIsPreemptible': False,
                   'tracemalloc': value_after, 'tracemallocBefore': value,
                   'snapshot': snapshot_result, 'census': census,
                   'rssGuard': 'CALLER_OWNED_1856_MIB_PREVENTIVE_AND_2_GIB_HARD_LIMIT',
                   'otherProcessAttribution': 'NODE_AND_CHROME_NOT_MEASURED',
                   'forcedGC': False, 'rawObjectDataExported': False}
        self._write(label, receipt)
        # The returned receipt measures the initial evidence write as well. Its
        # caller also times the complete API call, including any failure write.
        receipt['durationSeconds'] = self.clock() - started
        receipt['timingScope'] = 'CHECKPOINT_THROUGH_INITIAL_EVIDENCE_WRITE'
        if receipt['durationSeconds'] > self.limits.checkpoint_seconds:
            reason = 'ALLOCATION_CHECKPOINT_TIME_LIMIT'
            receipt.update(status='INCOMPLETE', reason=reason)
            # Only replace the checkpoint file this call successfully created.
            # A slow final write cannot turn an already failed receipt into PASS.
            self._write(label, receipt, overwrite_own=True)
        if reason:
            raise AllocationDiagnosticError(reason, receipt)
        self.successful_labels.append(label)
        return receipt

    def finish(self):
        if self.owns_tracing:
            self.trace.stop()
            self.owns_tracing = False
        self.finished = True
        return {'enabled': self.enabled, 'checkpoints': list(self.successful_labels),
                'attemptedCheckpoints': list(self.labels),
                'successfulCheckpoints': list(self.successful_labels),
                'twoCheckpointsCompleted': self.successful_labels == ['baseline', 'endpoint']}
