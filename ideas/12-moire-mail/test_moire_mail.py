import unittest
import moire_mail as m

class Tests(unittest.TestCase):
 def test_geometry(self):
  self.assertAlmostEqual(m.wavelength(10,60),10)
  self.assertAlmostEqual(m.wavelength(10,-4),m.wavelength(10,4))
  self.assertGreater(m.wavelength(10,2),m.wavelength(10,4))
 def test_svg(self):
  import xml.etree.ElementTree as ET
  root=ET.fromstring(m.svg());self.assertGreater(len(list(root.iter())),400)
 def test_invalid(self):
  for a in (0,91,float('nan')):
   with self.assertRaises(ValueError):m.wavelength(10,a)

if __name__ == "__main__": unittest.main()
