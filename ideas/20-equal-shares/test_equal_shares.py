import unittest
import equal_shares as m

class Tests(unittest.TestCase):
 def test_witness(self):
  w=[1500,1500,900,500,500,200]
  self.assertEqual(m.allocate(w,25),[7,7,4,3,3,1]);self.assertEqual(m.allocate(w,26),[8,8,5,2,2,1])
 def test_quota_and_total(self):
  import random
  from fractions import Fraction
  rng=random.Random(42)
  for _ in range(300):
   w=[rng.randint(1,999) for _ in range(rng.randint(1,15))];n=rng.randint(0,200);a=m.allocate(w,n)
   self.assertEqual(sum(a),n)
   for weight,seats in zip(w,a):
    q=Fraction(weight*n,sum(w));floor=q.numerator//q.denominator
    self.assertTrue(floor<=seats<=floor+(q.denominator!=1))
 def test_tie(self):self.assertEqual(m.allocate([1,1,1],2),[1,1,0])
 def test_invalid(self):
  with self.assertRaises(ValueError):m.allocate([1,0],2)

if __name__ == "__main__": unittest.main()
