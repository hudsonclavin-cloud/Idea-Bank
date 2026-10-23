import argparse, io, math, struct, sys, wave

def rhythm(k, n, rotate=0):
    if n < 1 or not 0 <= k <= n:
        raise ValueError('require 0 <= pulses <= slots and slots > 0')
    row = [int((i+1)*k//n != i*k//n) for i in range(n)]
    return [row[(i-rotate) % n] for i in range(n)]

def audio(a, b, bpm=108):
    if not a or len(a) != len(b) or not 20 <= bpm <= 300:
        raise ValueError('equal nonempty rows and tempo 20..300 required')
    rate = 22050
    slot = 60 / bpm / 4
    length = int((len(a)*slot*2 + .18)*rate)
    samples = [0.0]*length
    for row, pitch in ((a, 660), (b, 440)):
        for i in range(len(row)*2):
            if row[i % len(row)]:
                start = round(i*slot*rate)
                for j in range(int(.15*rate)):
                    t = j/rate
                    samples[start+j] += .38*min(1,t/.003)*math.exp(-38*t)*math.sin(2*math.pi*pitch*t)
    out = io.BytesIO()
    with wave.open(out,'wb') as w:
        w.setparams((1,2,rate,0,'NONE','not compressed'))
        w.writeframes(b''.join(struct.pack('<h',round(max(-1,min(1,s))*32767)) for s in samples))
    return out.getvalue()

def main():
    p=argparse.ArgumentParser(description='Even pulses, two intertwined clocks. Text score or WAV to stdout.')
    p.add_argument('--slots',type=int,default=16)
    p.add_argument('--a',type=int,default=5);p.add_argument('--b',type=int,default=7)
    p.add_argument('--rotate',type=int,default=0);p.add_argument('--bpm',type=int,default=108)
    p.add_argument('--wav',action='store_true');x=p.parse_args()
    if not 1 <= x.slots <= 128: p.error('slots must be 1..128')
    try:
        a=rhythm(x.a,x.slots);b=rhythm(x.b,x.slots,x.rotate)
        if x.wav:
            if sys.stdout.isatty(): p.error('redirect --wav output to a file')
            sys.stdout.buffer.write(audio(a,b,x.bpm))
        else:
            print('\n'.join(''.join('X' if v else '.' for v in row) for row in (a,b)))
    except ValueError as e: p.error(str(e))
if __name__=='__main__':main()
