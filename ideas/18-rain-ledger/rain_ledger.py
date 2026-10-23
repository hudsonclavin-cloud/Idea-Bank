import argparse, csv, io, math, sys

DEMO='day,rain_mm,demand_l\n1,12,30\n2,0,30\n3,0,30\n4,0,30\n5,25,30\n6,0,30\n7,0,30\n'

def read(text):
    rows=[]
    for row in csv.DictReader(io.StringIO(text)):
        try:
            rain=float(row['rain_mm']);demand=float(row['demand_l']);day=row['day']
            if not all(math.isfinite(x) and x>=0 for x in (rain,demand)):raise ValueError()
        except (KeyError,ValueError,TypeError):raise ValueError('CSV requires day,rain_mm,demand_l with finite nonnegative amounts')
        rows.append((day,rain,demand))
    if not rows:raise ValueError('CSV contains no observations')
    return rows

def run(rows,capacity,area=10,efficiency=.8,initial=0):
    if not all(math.isfinite(x) for x in (capacity,area,efficiency,initial)) or capacity<0 or area<0 or not 0<=efficiency<=1 or not 0<=initial<=capacity:raise ValueError('invalid tank, area, efficiency or initial storage')
    stored=initial;out=[]
    for day,rain,demand in rows:
        incoming=rain*area*efficiency;spill=max(0,stored+incoming-capacity)
        available=min(capacity,stored+incoming);served=min(demand,available);stored=available-served
        out.append((day,incoming,served,demand-served,spill,stored))
    return out

def main():
    p=argparse.ArgumentParser(description='Rainwater storage accounting; demo or CSV file.')
    p.add_argument('csv',nargs='?');p.add_argument('--area',type=float,default=10)
    p.add_argument('--efficiency',type=float,default=.8);p.add_argument('--capacity',type=float,default=120)
    p.add_argument('--daily',action='store_true');x=p.parse_args()
    try:
        if x.csv:
            with open(x.csv,encoding='utf-8') as f:text=f.read()
        else:text=DEMO
        rows=read(text);ledger=run(rows,x.capacity,x.area,x.efficiency)
        writer=csv.writer(sys.stdout,lineterminator='\n')
        if x.daily:
            writer.writerow(('day','harvest_l','served_l','shortage_l','spill_l','stored_l'));writer.writerows(ledger)
        else:
            writer.writerow(('capacity_l','shortage_l','spill_l'))
            for c in (0,30,60,120,240,480):
                result=run(rows,c,x.area,x.efficiency);writer.writerow((c,sum(r[3] for r in result),sum(r[4] for r in result)))
    except (OSError,ValueError) as e:p.error(str(e))
if __name__=='__main__':main()
