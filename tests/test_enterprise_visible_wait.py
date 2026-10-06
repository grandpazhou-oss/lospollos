"""Pure guards for the explicitly selected browser-soak visibility adapter.

No browser, HTTP server, native solver or product data is used by these tests.
Real visibility qualification runs separately in the existing browser smoke.
"""
from contextlib import contextmanager
from pathlib import Path
import sys
import tempfile
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch

import test_enterprise_browser_soak as soak
import test_enterprise_synthetic_full_ui as ui


class PublicTimeoutError(Exception):
    pass


@contextmanager
def fake_playwright(assertion):
    module = ModuleType('playwright.sync_api')
    module.expect = Mock(return_value=assertion)
    module.TimeoutError = PublicTimeoutError
    with patch.dict(sys.modules, {'playwright.sync_api': module}):
        yield module


def snapshot(primary=25, secondary=0, component=0):
    values = {'primary': primary, 'secondary': secondary, 'component': component}
    return {'byType': {'ElementHandle': sum(values.values())}, 'unassignedByType': {},
            'byPage': {name: {'pageGUID': name + '-guid', 'byType': {'ElementHandle': count}}
                       for name, count in values.items()}}


class VisibleWaitGuardTests(unittest.TestCase):
    def test_reveal_preserves_default_and_open_details_before_callback(self):
        control = MagicMock()
        control.is_visible.return_value = True
        ui.reveal(control)
        control.wait_for.assert_called_once_with(state='visible')
        control.reset_mock()
        control.is_visible.return_value = False
        details = control.locator.return_value
        details.count.return_value = 1
        details.evaluate.return_value = False
        order = []
        details.locator.return_value.first.click.side_effect = lambda: order.append('open')
        callback = Mock(side_effect=lambda locator: order.append('wait'))
        ui.reveal(control, visible_wait=callback)
        self.assertEqual(order, ['open', 'wait'])
        callback.assert_called_once_with(control)
        control.wait_for.assert_not_called()

    def test_download_propagates_selected_callback_and_preserves_bytes(self):
        with tempfile.TemporaryDirectory() as root:
            suite = ui.Suite.__new__(ui.Suite)
            suite.evidence, suite.runtime = Path(root), Path(root) / 'runtime'
            page, control, callback = MagicMock(), MagicMock(), Mock()
            control.is_visible.return_value = True
            pending = page.expect_download.return_value.__enter__.return_value
            pending.value.save_as.side_effect = lambda path: Path(path).write_text('{"synthetic":true}')
            result = suite.download('package-export', 'draft.json', page=page, control=control,
                                    visible_wait=callback)
            self.assertEqual(result, '{"synthetic":true}')
            callback.assert_called_once_with(control)
            control.wait_for.assert_not_called()
            control.click.assert_called_once_with()
            page.expect_download.assert_called_once_with()

    def test_public_history_preserves_default_and_propagates_callback(self):
        suite, page = ui.Suite.__new__(ui.Suite), MagicMock()
        locator = page.locator.return_value
        locator.evaluate_all.return_value = ['hash-one', 'hash-two']
        self.assertEqual(suite.public_history(page, 'pointer'), ['hash-one', 'hash-two'])
        locator.first.wait_for.assert_called_once_with()
        locator.reset_mock()
        callback = Mock()
        self.assertEqual(suite.public_history(page, 'pointer', visible_wait=callback), ['hash-one', 'hash-two'])
        callback.assert_called_once_with(locator.first)
        locator.first.wait_for.assert_not_called()
        self.assertEqual(locator.click.call_count, 4)  # Step, list and two history toggles share this fake locator.

    def test_conflict_controls_preserve_three_default_waits_and_callback(self):
        suite, page = ui.Suite.__new__(ui.Suite), MagicMock()
        recovery, advanced, message = MagicMock(), MagicMock(), MagicMock()
        children = [MagicMock(), MagicMock()]
        recovery.locator.side_effect = children
        page.locator.side_effect = lambda selector: {
            '.sc-recovery-actions': recovery, '.sc-advanced': advanced, '.sc-message.is-error': message}[selector]
        advanced.last.text_content.return_value = 'REVISION_CONFLICT'
        message.is_visible.return_value = True
        suite.conflict_controls(page)
        for locator in (recovery, *children):
            locator.wait_for.assert_called_once_with(state='visible')
            locator.reset_mock()
        recovery.locator.side_effect = children
        callback = Mock()
        self.assertIs(suite.conflict_controls(page, visible_wait=callback), recovery)
        self.assertEqual([call.args[0] for call in callback.call_args_list], [recovery, *children])
        for locator in (recovery, *children):
            locator.wait_for.assert_not_called()
        recovery.locator.side_effect = children
        advanced.last.text_content.return_value = 'GENERIC_ERROR'
        with self.assertRaises(AssertionError):
            suite.conflict_controls(page, visible_wait=callback)

    def test_adapter_forwards_exact_main_timeout_and_converts_only_assertion_with_cause(self):
        locator, assertion = object(), Mock()
        with fake_playwright(assertion) as api:
            soak.expect_visible_without_handles(locator)
            api.expect.assert_called_once_with(locator)
            assertion.to_be_visible.assert_called_once_with(timeout=25000)
            original = AssertionError('not visible')
            assertion.to_be_visible.side_effect = original
            with self.assertRaises(PublicTimeoutError) as caught:
                soak.expect_visible_without_handles(locator, timeout_ms=150)
            self.assertIs(caught.exception.__cause__, original)
            assertion.to_be_visible.assert_called_with(timeout=150)

    def test_other_api_errors_are_identical_and_pass_through(self):
        error = RuntimeError('target closed')
        assertion = Mock()
        assertion.to_be_visible.side_effect = error
        with fake_playwright(assertion), self.assertRaises(RuntimeError) as caught:
            soak.expect_visible_without_handles(object())
        self.assertIs(caught.exception, error)
        self.assertIsNone(caught.exception.__cause__)

    def test_only_successful_selected_waits_are_counted(self):
        suite = soak.BrowserSoakSuite.__new__(soak.BrowserSoakSuite)
        suite.current_cycle, suite.stage, suite.selected_wait_counts = 1, 'UI_SOAK', {}
        suite.guard = Mock()
        locator = object()
        with patch.object(soak, 'expect_visible_without_handles', side_effect=PublicTimeoutError('timeout')):
            with self.assertRaises(PublicTimeoutError):
                suite.selected_visible_wait(locator, label='history')
        self.assertEqual(suite.selected_wait_counts, {})
        with patch.object(soak, 'expect_visible_without_handles') as wait:
            suite.selected_visible_wait(locator, label='history')
            wait.assert_called_once_with(locator, timeout_ms=25000)
        self.assertEqual(suite.selected_wait_counts, {'1': {'history': 1}})
        suite.selected_wait_counts.clear()
        suite.guard.side_effect = [None, AssertionError('budget')]
        with patch.object(soak, 'expect_visible_without_handles'), self.assertRaises(AssertionError):
            suite.selected_visible_wait(locator, label='history')
        self.assertEqual(suite.selected_wait_counts, {})
        suite.stage = 'PERIODIC_NATIVE_RETRY'
        with self.assertRaisesRegex(AssertionError, 'OUTSIDE_UI'):
            suite.selected_visible_wait(locator, label='history')

    def test_exact_cycle_coverage_rejects_missing_duplicate_and_extra_waits(self):
        counts = {str(number): dict(soak.SELECTED_WAITS_PER_CYCLE) for number in range(1, 31)}
        self.assertEqual(soak.check_selected_wait_coverage(counts, 30), 270)
        for changed in ({}, {**counts, '31': dict(soak.SELECTED_WAITS_PER_CYCLE)},
                        {**counts, '1': {**soak.SELECTED_WAITS_PER_CYCLE, 'history': 2}}):
            with self.assertRaises(AssertionError):
                soak.check_selected_wait_coverage(changed, 30)

    def test_handle_attribution_rejects_unknown_owner_missing_page_and_changed_identity(self):
        self.assertEqual(soak.element_handle_delta(snapshot(), snapshot(55)),
                         {'primary': 30, 'secondary': 0, 'component': 0})
        bad = snapshot(55)
        bad['unassignedByType']['ElementHandle'] = 1
        with self.assertRaisesRegex(AssertionError, 'OWNER_UNKNOWN'):
            soak.element_handle_delta(snapshot(), bad)
        bad = snapshot(55)
        del bad['byPage']['secondary']
        with self.assertRaisesRegex(AssertionError, 'PAGE_SET'):
            soak.element_handle_delta(snapshot(), bad)
        bad = snapshot(55)
        bad['byPage']['secondary']['pageGUID'] = 'replacement-page'
        with self.assertRaisesRegex(AssertionError, 'IDENTITY_CHANGED'):
            soak.element_handle_delta(snapshot(), bad)

    def test_retention_gate_expects_unchanged_native_30_not_zero_and_rejects_drift(self):
        suite = soak.BrowserSoakSuite.__new__(soak.BrowserSoakSuite)
        suite.args = SimpleNamespace(ui_cycles=30, native_every=5)
        suite.selected_wait_counts = {str(number): dict(soak.SELECTED_WAITS_PER_CYCLE) for number in range(1, 31)}
        suite.wait_protocol_baseline = snapshot()
        suite.result, suite.events = {'uiWaitRetentionCheckedCycles': 30}, Mock()
        suite.native_wait_records = [{'initialBeforeBaseline': cycle == 0, 'uiCycle': cycle,
            'elementHandleDeltaByPage': {'primary': 5, 'secondary': 0, 'component': 0}}
            for cycle in range(0, 31, 5)]
        suite.protocol_object_counts = Mock(return_value=snapshot(55))
        suite.validate_selected_wait_retention()
        self.assertEqual(suite.result['selectedWaitRetentionValidation']['status'], 'PASS')
        for wrong in (snapshot(25), snapshot(56), snapshot(55, secondary=1)):
            suite.protocol_object_counts.return_value = wrong
            with self.assertRaisesRegex(AssertionError, 'FINAL_HANDLE_DELTA'):
                suite.validate_selected_wait_retention()
            self.assertEqual(suite.result['selectedWaitRetentionValidation']['status'], 'FAIL')

    def test_each_ui_cycle_requires_zero_handle_growth_and_failures_do_not_advance_coverage(self):
        suite = soak.BrowserSoakSuite.__new__(soak.BrowserSoakSuite)
        suite.result, suite.events = {}, Mock()
        suite.protocol_object_counts = Mock(return_value=snapshot())
        suite.validate_ui_wait_retention(1, snapshot())
        self.assertEqual(suite.result['uiWaitRetentionCheckedCycles'], 1)
        self.assertEqual(suite.result['latestUiWaitRetention']['status'], 'PASS')
        # Equal whole-window totals cannot hide an extra handle within a UI cycle.
        for wrong in (snapshot(26), snapshot(25, secondary=1), snapshot(24)):
            suite.protocol_object_counts.return_value = wrong
            with self.assertRaisesRegex(AssertionError, 'UI_CYCLE_WAIT_HANDLE_DELTA'):
                suite.validate_ui_wait_retention(2, snapshot())
            self.assertEqual(suite.result['uiWaitRetentionCheckedCycles'], 1)
            self.assertEqual(suite.result['latestUiWaitRetention']['status'], 'FAIL')
        suite.protocol_object_counts.return_value = snapshot()
        with self.assertRaisesRegex(AssertionError, 'CYCLE_ORDER'):
            suite.validate_ui_wait_retention(3, snapshot())
        self.assertEqual(suite.result['latestUiWaitRetention']['status'], 'FAIL')


if __name__ == '__main__':
    unittest.main()
