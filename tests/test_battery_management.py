"""Regress the actual blueprint decision templates, without device side effects.

Requires PyYAML and Jinja2. Full blueprint substitution/actions were also tested
with disposable helpers in Home Assistant; see examples/battery-management/TESTING.md.
"""
import ast
import math
import unittest
from pathlib import Path
import yaml
from jinja2.nativetypes import NativeEnvironment

class Loader(yaml.SafeLoader):
    pass
Loader.add_constructor('!input', lambda loader, node: loader.construct_scalar(node))
BLUEPRINT = yaml.load((Path(__file__).parents[1] / 'blueprints/automation/battery-management.yaml').read_text(), Loader=Loader)

def is_number(value):
    try:
        return math.isfinite(float(value))
    except (ValueError, TypeError):
        return False

def decide(*, temp='10', unit='°C', soc='50', storage=False, protection=True,
           held=False, blocked=False, calibration=False, **limits):
    states = {'temp':temp, 'soc':soc, 'storage':'on' if storage else 'off',
              'protection':'on' if protection else 'off', 'held':'on' if held else 'off',
              'blocked':'on' if blocked else 'off', 'calibration':'on' if calibration else 'off'}
    env = NativeEnvironment()
    env.globals.update(states=lambda entity: states.get(entity, 'unknown'),
        is_state=lambda entity, state: states.get(entity)==state,
        state_attr=lambda entity, attr: unit, is_number=is_number)
    values = dict(temperature_entity='temp', soc_entity='soc', storage_entity='storage',
        protection_entity='protection', hold_entity='held', cold_entity='blocked',
        calibration_entity='calibration', low=45, high=55, cutoff=0, resume=2.3)
    values.update(limits)
    for key, template in BLUEPRINT['actions'][0]['variables'].items():
        result = env.from_string(template).render(values)
        if isinstance(result,str):
            try:
                result=ast.literal_eval(result.strip())
            except (ValueError,SyntaxError):
                pass
        values[key]=result
    return values['cold'], values['holding']

class Decisions(unittest.TestCase):
    def test_temperature_boundaries(self):
        for temp,previous,expected in [(-0.1,False,True),(0,False,False),(1,True,True),(2.3,True,False)]:
            self.assertEqual(decide(temp=str(temp),blocked=previous)[0],expected)
    def test_fahrenheit(self):
        self.assertTrue(decide(temp='30',unit='°F')[0])
        self.assertFalse(decide(temp='32',unit='°F')[0])
        self.assertTrue(decide(temp='33',unit='°F',blocked=True)[0])
        self.assertFalse(decide(temp='36.2',unit='°F',blocked=True)[0])
    def test_invalid_temperature(self):
        for temp in ['unknown','unavailable','nan','inf','']:
            self.assertTrue(decide(temp=temp)[0])
        self.assertTrue(decide(unit='K')[0])
    def test_independent_features(self):
        self.assertEqual(decide(temp='unknown',soc='unknown',protection=False),(False,False))
        self.assertEqual(decide(temp='unknown',storage=True,protection=False),(False,False))
        self.assertEqual(decide(soc='unknown'),(False,False))
    def test_storage_hysteresis(self):
        self.assertTrue(decide(soc='55',storage=True)[1])
        self.assertTrue(decide(soc='50',storage=True,held=True)[1])
        self.assertFalse(decide(soc='45',storage=True,held=True)[1])
    def test_invalid_soc(self):
        for soc in ['unknown','nan','-1','101']:
            self.assertTrue(decide(soc=soc,storage=True)[1])
    def test_invalid_threshold_order(self):
        self.assertTrue(decide(storage=True,low=60,high=50)[1])
        self.assertTrue(decide(cutoff=3,resume=2)[0])
    def test_calibration_never_bypasses_cold(self):
        self.assertEqual(decide(soc='90',temp='-1',storage=True,calibration=True),(True,False))
    def test_optional_sensor_defaults(self):
        inputs=BLUEPRINT['blueprint']['input']['sensors']['input']
        self.assertEqual(inputs['temperature_sensor']['default'],[])
        self.assertEqual(inputs['temperature_sensor']['selector']['entity'],{'domain':'sensor'})

if __name__=='__main__':
    unittest.main()
