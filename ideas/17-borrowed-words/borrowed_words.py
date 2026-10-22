import argparse, re, sys

def tokens(text):return list(re.finditer(r'\w+',text,re.UNICODE))

def find(text,target):
    src=tokens(text);wanted=[m.group().casefold() for m in tokens(target)]
    if not wanted:raise ValueError('target must contain a word')
    starts=[None]*len(wanted);best=None
    for i,token in enumerate(src):
        word=token.group().casefold()
        for j in range(len(wanted)-1,-1,-1):
            if word==wanted[j] and (j==0 or starts[j-1] is not None):
                start=i if j==0 else starts[j-1];starts[j]=start
                if j==len(wanted)-1:
                    candidate=(i-start+1,start,i)
                    if best is None or candidate<best:best=candidate
    if best is None:raise ValueError('target is not an ordered subsequence of the source')
    _,start,end=best;chosen=[];j=0
    for token in src[start:end+1]:
        if token.group().casefold()==wanted[j]:
            chosen.append((token.start(),token.end()));j+=1
            if j==len(wanted):break
    return chosen

def blackout(text,spans):
    keep=set(spans)
    return re.sub(r'\w+',lambda m:m.group() if m.span() in keep else '█'*len(m.group()),text)

def main():
    p=argparse.ArgumentParser(description='Shortest-window ordered blackout; source text on stdin.')
    p.add_argument('target');p.add_argument('--reveal',action='store_true');x=p.parse_args()
    text=sys.stdin.read()
    if len(text)>100000 or len(tokens(x.target))>100:p.error('source limit 100000 characters; target limit 100 words')
    try:spans=find(text,x.target)
    except ValueError as e:p.error(str(e))
    if x.reveal:
        for a,b in spans:print(f'{a}:{b}\t{text[a:b]}')
    else:print(blackout(text,spans))
if __name__=='__main__':main()
