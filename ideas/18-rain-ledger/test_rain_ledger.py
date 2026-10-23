import unittest
import rain_ledger as m

class Tests(unittest.TestCase):
 def test_conservation(self):
  rows=m.read(m.DEMO);previous=0
  for row,entry in zip(rows,m.run(rows,120)):
   _,incoming,served,shortage,spill,stored=entry
   self.assertAlmostEqual(previous+incoming,served+spill+stored)
   self.assertAlmostEqual(served+shortage,row[2]);self.assertTrue(0<=stored<=120);previous=stored
 def test_capacity_monotonic(self):
  rows=m.read(m.DEMO);short=[sum(r[3] for r in m.run(rows,c)) for c in range(0,301,10)]
  self.assertEqual(short,sorted(short,reverse=True))
 def test_units(self):self.assertEqual(m.run([('a',1,0)],100,10,1)[0][-1],10)
 def test_invalid(self):
  for value in ('nan','inf','-1','oops'):
   with self.assertRaises(ValueError):m.read('day,rain_mm,demand_l\na,'+value+',3')

if __name__ == "__main__": unittest.main()
