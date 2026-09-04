from __future__ import annotations

import copy
import json
import pathlib
import subprocess
import sys
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from optimizer.routing_contract_v16 import (  # noqa: E402
    RoutingContractError,
    optimizer_matrix_payload,
    validate_matrix,
    validate_route,
)


def node_fixture() -> dict:
    source = r"""
const F=require('./road-network-fixture-v16.js');
const R=require('./road-routing-v16.js');
const g=F.createFixture();
const n=new Map(g.nodes.map(x=>[x.nodeId,x]));
const points=['DEPOT','B','C'].map(id=>({pointId:id,lon:n.get(id).lon,lat:n.get(id).lat}));
const request={schemaVersion:'stct-routing-request-v1.6',providerId:'SYNTHETIC_ROAD_FIXTURE',profile:'light-truck',points,distanceUnit:'km',durationUnit:'minutes',snapToleranceMeters:120};
const matrix=R.matrix(g,request,{id:'SYNTHETIC_ROAD_FIXTURE',version:'1.6.0-fixture'});
const routeRequest={...request,points:[points[0],points[2]]};
const route=R.buildRoute(g,routeRequest,{id:'SYNTHETIC_ROAD_FIXTURE',version:'1.6.0-fixture'});
const unreachableRequest={...request,points:[points[0],{pointId:'ISOLATED',lon:n.get('ISOLATED').lon,lat:n.get('ISOLATED').lat}]};
const unreachable=R.matrix(g,unreachableRequest,{id:'SYNTHETIC_ROAD_FIXTURE',version:'1.6.0-fixture'});
process.stdout.write(JSON.stringify({matrix,route,unreachable}));
"""
    completed = subprocess.run(["node", "-e", source], cwd=ROOT, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    return json.loads(completed.stdout)


class RoutingContractV16Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture = node_fixture()

    def test_cross_language_matrix_hash(self) -> None:
        value = validate_matrix(self.fixture["matrix"], expected_point_ids=["DEPOT", "B", "C"])
        self.assertEqual(value["matrixHash"], self.fixture["matrix"]["matrixHash"])

    def test_stale_matrix_rejected(self) -> None:
        value = copy.deepcopy(self.fixture["matrix"])
        value["distances"][0][1] += 1
        with self.assertRaisesRegex(RoutingContractError, "hash") as context:
            validate_matrix(value)
        self.assertEqual(context.exception.code, "MATRIX_HASH_STALE")

    def test_point_mapping_rejected(self) -> None:
        with self.assertRaises(RoutingContractError) as context:
            validate_matrix(self.fixture["matrix"], expected_point_ids=["DEPOT", "C", "B"])
        self.assertEqual(context.exception.code, "MATRIX_POINT_MAPPING_MISMATCH")

    def test_optimizer_payload_is_authoritative(self) -> None:
        payload = optimizer_matrix_payload(self.fixture["matrix"], ["DEPOT", "B", "C"])
        self.assertTrue(payload["authoritative"])
        self.assertFalse(payload["fallbackUsed"])
        self.assertEqual(payload["distanceMeters"][0][1], round(self.fixture["matrix"]["distances"][0][1] * 1000))
        self.assertEqual(payload["durationSeconds"][0][1], round(self.fixture["matrix"]["durations"][0][1] * 60))

    def test_unreachable_never_substitutes_haversine(self) -> None:
        value = validate_matrix(self.fixture["unreachable"], expected_point_ids=["DEPOT", "ISOLATED"])
        self.assertIsNone(value["distances"][0][1])
        with self.assertRaises(RoutingContractError) as context:
            optimizer_matrix_payload(self.fixture["unreachable"], ["DEPOT", "ISOLATED"])
        self.assertEqual(context.exception.code, "MATRIX_UNREACHABLE_FOR_SOLVE")

    def test_cross_language_route_hash(self) -> None:
        value = validate_route(self.fixture["route"])
        self.assertEqual(value["routeHash"], self.fixture["route"]["routeHash"])

    def test_route_total_and_hash_rejected_after_mutation(self) -> None:
        total = copy.deepcopy(self.fixture["route"])
        total["totalDistance"] += 1
        with self.assertRaises(RoutingContractError) as context:
            validate_route(total)
        self.assertEqual(context.exception.code, "ROUTE_DISTANCE_TOTAL_MISMATCH")
        stale = copy.deepcopy(self.fixture["route"])
        stale["warnings"] = ["non-semantic"]
        self.assertEqual(validate_route(stale)["routeHash"], self.fixture["route"]["routeHash"])


if __name__ == "__main__":
    unittest.main()
