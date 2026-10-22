import argparse, random

def circuit(w,h,seed=1):
    if w<3 or h<3:raise ValueError('dimensions must both be at least 3')
    adj={(x,y):set() for y in range(h) for x in range(w)}
    for x,y in adj:
        for b in (((x+1)%w,y),(x,(y+1)%h)):
            adj[x,y].add(b);adj[b].add((x,y))
    rng=random.Random(seed);stack=[(0,0)];out=[]
    while stack:
        a=stack[-1]
        if adj[a]:
            b=rng.choice(sorted(adj[a]));adj[a].remove(b);adj[b].remove(a);stack.append(b)
        else:out.append(stack.pop())
    return out[::-1]

def svg(route,w,h):
    parts=[]
    def line(a,b,color,dashed=False):
        x,y=a;u,v=b
        dash=' stroke-dasharray="3 3"' if dashed else ''
        return f'<path d="M {40+x*40} {40+y*40} L {40+u*40} {40+v*40}" stroke="{color}"{dash}/>'
    for i,(a,b) in enumerate(zip(route,route[1:])):
        color=f'hsl({i*300/(len(route)-1):.1f},55%,38%)'
        if abs(a[0]-b[0])>1:
            for p in (a,b):parts.append(line(p,(-.7 if p[0]==0 else w-.3,p[1]),color,True))
        elif abs(a[1]-b[1])>1:
            for p in (a,b):parts.append(line(p,(p[0],-.7 if p[1]==0 else h-.3),color,True))
        else:parts.append(line(a,b,color))
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {(w+1)*40} {(h+1)*40}"><title>One Thread; dashed lines wrap to opposite edge</title><rect width="100%" height="100%" fill="#faf3e4"/><g fill="none" stroke-width="2">'+''.join(parts)+'</g></svg>'

def main():
    p=argparse.ArgumentParser(description='A single Euler thread across a periodic grid.')
    p.add_argument('--width',type=int,default=8);p.add_argument('--height',type=int,default=6)
    p.add_argument('--seed',type=int,default=1);p.add_argument('--svg',action='store_true');x=p.parse_args()
    if not 3<=x.width<=30 or not 3<=x.height<=30:p.error('dimensions must be 3..30')
    route=circuit(x.width,x.height,x.seed)
    if x.svg:print(svg(route,x.width,x.height))
    else:
        for i,(a,b) in enumerate(route):print(f'{i:4}  {a},{b}')
if __name__=='__main__':main()
