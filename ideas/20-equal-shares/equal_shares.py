import argparse
from fractions import Fraction

def allocate(weights,seats):
    if seats<0 or not weights or any(w<=0 for w in weights):raise ValueError('positive weights and nonnegative seats required')
    quotas=[Fraction(w*seats,sum(weights)) for w in weights];out=[q.numerator//q.denominator for q in quotas]
    order=sorted(range(len(weights)),key=lambda i:(-(quotas[i]-out[i]),i))
    for i in order[:seats-sum(out)]:out[i]+=1
    return out

def paradoxes(weights,start,stop):
    for seats in range(start,stop):
        a=allocate(weights,seats);b=allocate(weights,seats+1)
        losers=[i for i in range(len(a)) if b[i]<a[i]]
        if losers:yield seats,a,b,losers

def main():
    p=argparse.ArgumentParser(description='Largest remainders, exact quotas, and a bigger-pie paradox.')
    p.add_argument('--weights',default='1500,1500,900,500,500,200')
    p.add_argument('--compare',type=int,default=25);p.add_argument('--scan',type=int,metavar='MAX_SEATS')
    x=p.parse_args()
    try:
        weights=list(map(int,x.weights.split(',')))
        if len(weights)>100 or any(w<=0 for w in weights):raise ValueError('use 1..100 positive weights')
        if not 0<=x.compare<=10000:raise ValueError('compare must be 0..10000')
        if x.scan is not None:
            if not 2<=x.scan<=10000:raise ValueError('scan must be 2..10000')
            found=list(paradoxes(weights,1,x.scan))
            for seats,a,b,losers in found:print(f'{seats} -> {seats+1}: {a} -> {b}; losing groups {[i+1 for i in losers]}')
            if not found:print('No paradox in this interval.')
        else:
            a=allocate(weights,x.compare);b=allocate(weights,x.compare+1)
            print('group weight before after change')
            for i,(w,u,v) in enumerate(zip(weights,a,b)):print(f'{i+1:5} {w:6} {u:6} {v:5} {v-u:+6}')
        print('Tie rule: earlier input position wins equal remainders.')
    except ValueError as e:p.error(str(e))
if __name__=='__main__':main()
