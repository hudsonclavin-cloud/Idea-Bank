import argparse, random

def success(n,r):
    if n<1 or not 0<=r<n:raise ValueError('require n >= 1 and 0 <= skip < n')
    return 1/n if r==0 else r/n*sum(1/k for k in range(r,n))

def choose(order,r):
    if not order or not 0<=r<len(order):raise ValueError('invalid order or skip')
    if r==0:return order[0]
    best=max(order[:r])
    return next((x for x in order[r:] if x>best),order[-1])

def simulate(n,r,trials=10000,seed=1):
    if trials<1:raise ValueError('positive trials required')
    success(n,r)
    rng=random.Random(seed);hits=0
    for _ in range(trials):
        order=list(range(n));rng.shuffle(order);hits+=choose(order,r)==n-1
    return hits/trials

def main():
    p=argparse.ArgumentParser(description='Exact optimal stopping odds and an independent simulation.')
    p.add_argument('--candidates',type=int,default=50);p.add_argument('--trials',type=int,default=10000)
    p.add_argument('--seed',type=int,default=1);x=p.parse_args()
    if not 1<=x.candidates<=500 or not 1<=x.trials<=100000:p.error('candidates 1..500; trials 1..100000')
    n=x.candidates;r=max(range(n),key=lambda k:success(n,k))
    print(f'Skip {r} of {n}, then take the first new record (otherwise the last).')
    print(f'Exact chance of best: {success(n,r):.4%}')
    print(f'Simulated: {simulate(n,r,x.trials,x.seed):.4%} over {x.trials} trials')
    print('Assumptions: random order, known pool size, no recall, best-only objective.')
if __name__=='__main__':main()
