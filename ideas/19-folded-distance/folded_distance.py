import argparse

def point(order,index):
    if not 0<=order<=9 or not 0<=index<4**order:raise ValueError('invalid Hilbert order or index')
    x=y=0;t=index;s=1
    while s<2**order:
        rx=1 & (t//2);ry=1 & (t^rx)
        if ry==0:
            if rx:x=s-1-x;y=s-1-y
            x,y=y,x
        x+=s*rx;y+=s*ry;t//=4;s*=2
    return x,y

def svg(order):
    n=2**order;count=n*n;parts=[];block=max(1,count//32)
    for start in range(0,count-1,block):
        points=[point(order,i) for i in range(start,min(count,start+block+1))]
        path=' '.join(f'{x+.5},{y+.5}' for x,y in points)
        parts.append(f'<polyline points="{path}" stroke="hsl({220-start/count*200:.1f},65%,42%)"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 {n+2} {n+2}"><title>Folded Distance: Hilbert order {order}</title><rect x="-1" y="-1" width="{n+2}" height="{n+2}" fill="#f5efdF"/><g fill="none" stroke-width=".22" stroke-linecap="round" stroke-linejoin="round">'+''.join(parts)+'</g></svg>'

def main():
    p=argparse.ArgumentParser(description='Print a Hilbert curve SVG or its exact coordinate table.')
    p.add_argument('--order',type=int,default=5);p.add_argument('--table',action='store_true');x=p.parse_args()
    if not 1<=x.order<=7:p.error('order must be 1..7')
    if x.table:
        print('index,x,y')
        for i in range(4**x.order):
            a,b=point(x.order,i);print(f'{i},{a},{b}')
    else:print(svg(x.order))
if __name__=='__main__':main()
