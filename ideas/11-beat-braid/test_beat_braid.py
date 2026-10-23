import unittest
import beat_braid as m

class Tests(unittest.TestCase):
 def test_even_gaps(self):
  for n in range(1,33):
   for k in range(1,n+1):
    row=m.rhythm(k,n);hits=[i for i,v in enumerate(row) if v]
    gaps=[(hits[(j+1)%k]-hits[j])%n or n for j in range(k)]
    self.assertEqual(sum(row),k);self.assertLessEqual(max(gaps)-min(gaps),1)
 def test_rotation(self): self.assertEqual(m.rhythm(3,8,8),m.rhythm(3,8))
 def test_silence(self): self.assertEqual(sum(m.rhythm(0,4)),0)
 def test_wav(self):
  import io,wave
  with wave.open(io.BytesIO(m.audio([1,0],[0,1]))) as w:
   self.assertEqual(w.getnchannels(),1);self.assertEqual(w.getsampwidth(),2)
   self.assertGreater(w.getnframes(),22050//2)
 def test_invalid(self):
  with self.assertRaises(ValueError):m.rhythm(9,8)

if __name__ == "__main__": unittest.main()
