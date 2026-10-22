import unittest
import folded_distance as m

class Tests(unittest.TestCase):
 def test_visit_and_adjacency(self):
  for order in range(1,7):
   n=2**order;p=[m.point(order,i) for i in range(n*n)]
   self.assertEqual(set(p),{(x,y) for x in range(n) for y in range(n)})
   self.assertTrue(all(abs(a[0]-b[0])+abs(a[1]-b[1])==1 for a,b in zip(p,p[1:])))
 def test_known(self):self.assertEqual([m.point(1,i) for i in range(4)],[(0,0),(0,1),(1,1),(1,0)])
 def test_svg(self):
  import xml.etree.ElementTree as ET
  ET.fromstring(m.svg(4))
 def test_invalid(self):
  with self.assertRaises(ValueError):m.point(2,16)

if __name__ == "__main__": unittest.main()
