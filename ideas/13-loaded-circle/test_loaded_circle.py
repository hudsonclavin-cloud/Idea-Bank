import unittest
import loaded_circle as m

class Tests(unittest.TestCase):
 def test_cycle(self):
  a,b,c=(2,2,4,4,9,9),(1,1,6,6,8,8),(3,3,5,5,7,7)
  from fractions import Fraction
  for x,y in ((a,b),(b,c),(c,a)):self.assertEqual(m.match(x,y)[0],Fraction(5,9))
 def test_partition(self):
  for a,b in (([1],[1]),([1,2,3],[2,4]),([-2,0],[0,9])):
   w,t,l=m.match(a,b);self.assertEqual(w+t+l,1);self.assertEqual(w,m.match(b,a)[2])
 def test_ties(self):self.assertEqual(m.match([7],[7]),(0,1,0))
 def test_empty(self):
  with self.assertRaises(ValueError):m.match([], [1])

if __name__ == "__main__": unittest.main()
