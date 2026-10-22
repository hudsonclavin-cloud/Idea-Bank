import argparse
from fractions import Fraction

def match(a,b):
    if not a or not b:raise ValueError('dice must have at least one face')
    wins=sum(x>y for x in a for y in b)
    ties=sum(x==y for x in a for y in b)
    total=len(a)*len(b)
    return Fraction(wins,total),Fraction(ties,total),Fraction(total-wins-ties,total)

def parse_die(s):
    try:
        a=tuple(map(int,s.split(',')))
        if not 1 <= len(a) <= 100:raise ValueError()
        return a
    except ValueError:raise argparse.ArgumentTypeError('use 1..100 comma-separated integer faces')

def report(dice):
    lines=[]
    for i,a in enumerate(dice):
        for j,b in enumerate(dice):
            if i==j:continue
            w,t,l=match(a,b)
            lines.append(f'{chr(65+i)} vs {chr(65+j)}: win {w}, tie {t}, lose {l}'+('  -> advantage' if w>l else ''))
    return '\n'.join(lines)

def main():
    p=argparse.ArgumentParser(description='Exact odds for dice that refuse to form a ranking.')
    p.add_argument('--die',type=parse_die,action='append',help='repeat for each die; example 2,2,4,4,9,9')
    x=p.parse_args();dice=x.die or [(2,2,4,4,9,9),(1,1,6,6,8,8),(3,3,5,5,7,7)]
    if not 2 <= len(dice) <= 12:p.error('provide 2..12 dice')
    print(report(dice))
if __name__=='__main__':main()
