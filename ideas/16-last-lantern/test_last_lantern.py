import unittest
import last_lantern as m

class Tests(unittest.TestCase):
 def test_exhaustive(self):
  import itertools,math
  for n in range(1,8):
   for r in range(n):
    wins=sum(m.choose(p,r)==n-1 for p in itertools.permutations(range(n)))
    self.assertAlmostEqual(wins/math.factorial(n),m.success(n,r))
 def test_large_pool(self):
  n=500;r=max(range(n),key=lambda r:m.success(n,r))
  self.assertTrue(.36<r/n<.38)
 def test_seed(self):self.assertEqual(m.simulate(20,7,100,4),m.simulate(20,7,100,4))
 def test_invalid(self):
  with self.assertRaises(ValueError):m.success(5,5)

if __name__ == "__main__": unittest.main()
