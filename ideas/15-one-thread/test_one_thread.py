import unittest
import one_thread as m

class Tests(unittest.TestCase):
 def test_every_edge_once(self):
  for w,h in ((3,3),(4,7),(8,6)):
   r=m.circuit(w,h);edges=[frozenset((a,b)) for a,b in zip(r,r[1:])]
   self.assertEqual(r[0],r[-1]);self.assertEqual(len(edges),2*w*h)
   self.assertEqual(len(set(edges)),len(edges))
   for a,b in zip(r,r[1:]):
    dx=(a[0]-b[0])%w;dy=(a[1]-b[1])%h
    self.assertTrue((dx in (1,w-1) and dy==0) or (dy in (1,h-1) and dx==0))
 def test_svg(self):
  import xml.etree.ElementTree as ET
  ET.fromstring(m.svg(m.circuit(4,4),4,4))

if __name__ == "__main__": unittest.main()
