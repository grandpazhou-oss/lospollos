"""Deadline regressions: controlled clocks/processes, explicitly NOT native solves."""
from pathlib import Path
import sys
import time
import unittest
from unittest.mock import MagicMock, patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / 'optimizer'), str(ROOT / 'tests')]
import facility_mvp1 as facility
import supply_chain_jobs_v6 as jobs
from enterprise_native_soak_payloads import make_payloads, make_job
from test_supply_chain_v7_jobs import await_done, controlled, program


class FacilityDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.payload = make_payloads(10, 2, 1)['/facility-optimize-v19']

    def controlled_cp(self):
        cp = MagicMock()
        cp.CpModel.return_value.new_bool_var.return_value = 0
        cp.OPTIMAL, cp.FEASIBLE, cp.INFEASIBLE, cp.MODEL_INVALID, cp.UNKNOWN = range(5)
        cp.CpSolver.return_value.solve.return_value = cp.UNKNOWN
        return cp

    def test_valid_one_second_request_uses_subsecond_remaining_compute(self):
        payload = {**self.payload, 'options': {**self.payload['options'], 'timeLimitSeconds': 1}}
        cp = self.controlled_cp()
        with patch.object(facility.time, 'monotonic', return_value=.1):
            result = facility._solve_one(cp, payload, 2, [], deadline=1)
        self.assertEqual(result['status'], 'UNKNOWN')
        self.assertAlmostEqual(cp.CpSolver.return_value.parameters.max_time_in_seconds, .9)
        cp.CpSolver.return_value.solve.assert_called_once()
        self.assertEqual(payload['options']['timeLimitSeconds'], 1)

    def test_long_server_deadline_does_not_expand_short_user_limit(self):
        cp = self.controlled_cp()
        with patch.object(facility.time, 'monotonic', return_value=0):
            facility._solve_one(cp, self.payload, 2, [], deadline=5)
        self.assertEqual(cp.CpSolver.return_value.parameters.max_time_in_seconds, 2)

    def test_model_preparation_consumes_global_deadline_without_native_start(self):
        cp = self.controlled_cp()
        with patch.object(facility.time, 'monotonic', return_value=3.1):
            result = facility._solve_one(cp, self.payload, 2, [], deadline=3)
        self.assertEqual(result['status'], 'TIME_LIMIT')
        self.assertEqual(result['reasonCode'], 'GLOBAL_DEADLINE_EXHAUSTED')
        cp.CpSolver.assert_not_called()

    def test_completed_candidate_retained_when_next_subproblem_exhausts_deadline(self):
        candidate = {'facilityCount': 2, 'status': 'OPTIMAL', 'selectedSiteIds': ['S000', 'S001'],
                     'assignments': [], 'objectiveValue': 0}
        clock = [0.0]
        def controlled_solve(*args, **kwargs):
            self.assertEqual(kwargs['deadline'], 3)
            self.assertEqual(args[1]['options']['timeLimitSeconds'], 2)
            clock[0] = 3.1
            return dict(candidate)
        with patch.object(facility.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(facility, '_solve_one', side_effect=controlled_solve) as solve_one:
            result = facility.solve_facility(self.payload, None, 'CONTROLLED_NO_NATIVE', deadline=3)
        self.assertEqual(solve_one.call_count, 1)
        self.assertEqual(len(result['results']), 1)
        self.assertEqual(result['results'][0]['status'], 'OPTIMAL')
        self.assertTrue(result['budgetExhausted'])
        self.assertFalse(result['candidateSetComplete'])

    def test_current_baseline_receives_deadline_and_unmodified_request_limit(self):
        payload = {**self.payload, 'options': {**self.payload['options'], 'currentPortfolioSiteIds': ['S000', 'S001']}}
        with patch.object(facility.time, 'monotonic', return_value=0), \
                patch.object(facility, '_solve_one', return_value={'facilityCount': 2, 'status': 'INFEASIBLE'}) as solve_one:
            facility.solve_facility(payload, None, 'CONTROLLED_NO_NATIVE', deadline=.5)
        baseline = solve_one.call_args_list[-1]
        self.assertEqual(baseline.args[4], ['S000', 'S001'])
        self.assertEqual(baseline.kwargs['deadline'], .5)
        self.assertEqual(baseline.args[1]['options']['timeLimitSeconds'], 2)

    def test_public_subsecond_request_is_still_invalid(self):
        changed = {**self.payload, 'options': {**self.payload['options'], 'timeLimitSeconds': .5}}
        with self.assertRaises(facility.FacilityError) as caught:
            facility._validate(changed)
        self.assertEqual(caught.exception.code, 'FACILITY_TIME_LIMIT_INVALID')

    def test_real_manager_reports_partial_for_no_candidate_budget_result(self):
        spec = make_job(self.payload, 1)
        result = facility.solve_facility(spec['requests'][0]['payload'], None, 'CONTROLLED_NO_NATIVE',
                                         deadline=time.monotonic() - .1)
        events = [{'event': 'STARTED'}, {'event': 'PHASE', 'phase': 'CANDIDATES'},
                  {'event': 'RESULT', 'phase': 'CANDIDATES', 'result': result},
                  {'event': 'BUDGET_EXHAUSTED'}, {'event': 'COMPLETE'}]
        manager = jobs.JobManager()
        with patch.object(jobs, 'check_dependencies'), controlled(program(events)):
            started = manager.start(spec)
            final = await_done(manager, started['jobId'])
        self.assertEqual(final['status'], 'PARTIAL')
        self.assertEqual(final['exitCode'], 0)
        self.assertEqual(final['feasible'], 0)
        self.assertEqual(final['results']['CANDIDATES']['results'], [])
        self.assertIsNone(final['error'])
        self.assertFalse(manager.admission.busy)


if __name__ == '__main__':
    unittest.main()
