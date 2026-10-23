import unittest
import borrowed_words as m

class Tests(unittest.TestCase):
 def test_shortest(self):
  s='we travel across the night we keep night'
  spans=m.find(s,'we night');self.assertEqual([s[a:b] for a,b in spans],['we','night'])
  self.assertEqual(spans[0][0],s.rindex('we'))
 def test_repeats(self):self.assertEqual(m.find('a a b a','a a'),[(0,1),(2,3)])
 def test_unicode(self):self.assertEqual(m.find('ÉTÉ calme été','été'),[(0,3)])
 def test_missing(self):
  for target in ('','b a','a a a'):
   with self.assertRaises(ValueError):m.find('a b',target)
 def test_oracle(self):
  import itertools
  for seq in itertools.product('ab',repeat=5):
   s=' '.join(seq)
   for target in ('a b','a a','b a b'):
    w=target.split();candidates=[]
    for ix in itertools.combinations(range(5),len(w)):
     if [seq[i] for i in ix]==w:candidates.append((ix[-1]-ix[0]+1,ix[0]))
    if candidates:
     spans=m.find(s,target);self.assertEqual(((spans[-1][0]-spans[0][0])//2+1,spans[0][0]//2),min(candidates))
    else:
     with self.assertRaises(ValueError):m.find(s,target)

if __name__ == "__main__": unittest.main()
