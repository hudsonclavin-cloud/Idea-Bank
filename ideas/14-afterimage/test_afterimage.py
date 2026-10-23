import unittest
import afterimage as m

class Tests(unittest.TestCase):
 def test_bijection(self):
  import itertools
  for bits in itertools.product((0,1),repeat=6):
   state=(bits[:3],bits[3:]);self.assertEqual(m.step(m.step(state),True),state)
 def test_return(self):
  rows=m.journey(31,50,4,True);self.assertEqual(rows,rows[::-1])
 def test_seed(self):self.assertNotEqual(m.journey(seed=1),m.journey(seed=2))
 def test_invalid(self):
  with self.assertRaises(ValueError):m.step(((1,),(0,1)))

if __name__ == "__main__": unittest.main()
