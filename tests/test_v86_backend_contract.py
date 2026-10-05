"""Adversarial input vectors; separate from native solve evidence."""
import copy
import sys
from pathlib import Path
import unittest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'optimizer'))
from facility_mvp1 import _validate, FacilityError

BASE = {'schemaVersion':'stct-facility-solve-request-v1.9-mvp1', 'demands':[{'demandId':'D','demand':{'volume':1}}], 'sites':[{'siteId':'W','fixedCost':0,'handlingCostPerUnit':0}], 'matrix':{'rows':[{'siteId':'W','demandId':'D','distanceMeters':1,'travelSeconds':1}]}, 'options':{'facilityCounts':[1]}}
class Inputs(unittest.TestCase):
    def reject(self, value, code):
        with self.assertRaises(FacilityError) as error: _validate(value)
        self.assertEqual(error.exception.code, code)
    def test_good(self): _validate(BASE)
    def test_nonobjects(self):
        for value in ([], 'request', None): self.reject(value,'FACILITY_REQUEST_OBJECT_REQUIRED')
    def test_entity_shapes(self):
        for field in ('demands','sites'):
            value=copy.deepcopy(BASE);value[field]=['invalid'];self.reject(value,'FACILITY_ARRAY_OBJECTS_REQUIRED')
    def test_duplicate_demand(self):
        value=copy.deepcopy(BASE);value['demands']*=2;self.reject(value,'FACILITY_ENTITY_ID_INVALID')
    def test_duplicate_site(self):
        value=copy.deepcopy(BASE);value['sites']*=2;self.reject(value,'FACILITY_ENTITY_ID_INVALID')
    def test_nested(self):
        value=copy.deepcopy(BASE);value['demands'][0]['demand']=1;self.reject(value,'FACILITY_REQUEST_OBJECT_REQUIRED')
    def test_reference(self):
        value=copy.deepcopy(BASE);value['matrix']['rows'][0]['demandId']='UNKNOWN';self.reject(value,'FACILITY_MATRIX_REFERENCE_INVALID')
    def test_counts(self):
        for counts in ([True],['1'],[0],[2],[1,1],[],1):
            value=copy.deepcopy(BASE);value['options']['facilityCounts']=counts;self.reject(value,'FACILITY_COUNT_INVALID')
    def test_duration(self):
        value=copy.deepcopy(BASE);value['matrix']['rows'][0]['travelSeconds']=-1;self.reject(value,'FACILITY_MATRIX_ROW_INVALID')
    def test_nan(self):
        value=copy.deepcopy(BASE);value['demands'][0]['demand']['volume']=float('nan');self.reject(value,'FACILITY_NUMERIC_INPUT_INVALID')
if __name__=='__main__': unittest.main(verbosity=2)
