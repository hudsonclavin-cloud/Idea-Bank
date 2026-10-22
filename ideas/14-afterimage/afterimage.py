import argparse, random

def rule(row):
    if not row:raise ValueError('nonempty ring required')
    return tuple(row[(i-1)%len(row)] ^ row[(i+1)%len(row)] for i in range(len(row)))

def step(state, reverse=False):
    a,b=state
    if len(a)!=len(b) or not a or any(v not in (0,1) for v in a+b):raise ValueError('equal binary rings required')
    if reverse:return tuple(x^y for x,y in zip(b,rule(a))),a
    return b,tuple(x^y for x,y in zip(a,rule(b)))

def journey(width=81, steps=100, seed=1, rewind=False):
    rng=random.Random(seed);state=((0,)*width,tuple(rng.randrange(2) for _ in range(width)))
    rows=[state[1]]
    for _ in range(steps):state=step(state);rows.append(state[1])
    if rewind:
        for _ in range(steps):state=step(state,True);rows.append(state[1])
    return rows

def svg(rows):
    w=len(rows[0]);h=len(rows)
    cells=''.join(f'<path d="M {x} {y} h 1 v 1 h -1 Z"/>' for y,r in enumerate(rows) for x,v in enumerate(r) if v)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}"><title>Afterimage: time flowing downward</title><rect width="{w}" height="{h}" fill="#eee7d5"/><g fill="#204b50">{cells}</g></svg>'

def main():
    p=argparse.ArgumentParser(description='A reversible cellular print. SVG to stdout.')
    p.add_argument('--width',type=int,default=81);p.add_argument('--steps',type=int,default=100)
    p.add_argument('--seed',type=int,default=1);p.add_argument('--rewind',action='store_true');x=p.parse_args()
    if not 3<=x.width<=160 or not 1<=x.steps<=200:p.error('width 3..160; steps 1..200')
    print(svg(journey(x.width,x.steps,x.seed,x.rewind)))
if __name__=='__main__':main()
