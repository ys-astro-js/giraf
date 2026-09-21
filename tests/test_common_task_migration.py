import unittest
from giraf.task_schema import parameter_profile

class CommonTaskMigrationTests(unittest.TestCase):

    def test_modified_image_nouns_are_ports_without_task_names(self):
        p = dict(name='reference_data', type='s', mode='h', default='', prompt='Zero level calibration image')
        s = parameter_profile([p])['profile']['inputs']
        self.assertEqual([(i['name'], i['kind']) for i in s], [('reference_data','image')])
        self.assertEqual(parameter_profile([dict(p, prompt='CCD image type to correct')])['profile']['inputs'], [])
