import argparse, math

def wavelength(spacing, angle):
    if spacing <= 0 or not 0 < abs(angle) <= 90: raise ValueError('positive spacing and angle magnitude in (0,90] required')
    return spacing/(2*math.sin(math.radians(abs(angle))/2))

def svg(spacing=9, angle=4):
    beat=wavelength(spacing,angle)
    lines=[]
    for rotation,color in ((0,'#123c45'),(angle,'#b04436')):
        lines.append(f'<g transform="rotate({rotation} 450 300)" stroke="{color}" stroke-width="1.2">')
        for y in range(-900,1501,spacing):lines.append(f'<path d="M -900 {y} H 1800"/>')
        lines.append('</g>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 600">'
      '<title>Moire Mail</title><rect width="900" height="600" fill="#f6eedb"/>'
      '<defs><clipPath id="field"><rect x="40" y="70" width="820" height="460"/></clipPath></defs>'
      '<g clip-path="url(#field)">'+''.join(lines)+'</g>'
      f'<text x="40" y="40" font-family="monospace" font-size="18">MOIRE MAIL / {angle:g} deg / beat {beat:.1f} units</text></svg>')

def main():
    p=argparse.ArgumentParser(description='Print a vector interference postcard to stdout.')
    p.add_argument('--spacing',type=int,default=9);p.add_argument('--angle',type=float,default=4);x=p.parse_args()
    if not 3 <= x.spacing <= 40:p.error('spacing must be 3..40')
    try:print(svg(x.spacing,x.angle))
    except ValueError as e:p.error(str(e))
if __name__=='__main__':main()
