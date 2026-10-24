// Writes the committed STL files from the same code the page uses:
//   default.stl  the box for the page's opening settings (45.0 deg N, 0 deg E, flat horizons, 100 mm, 1.2 mm slits)
//   coupon.stl   the test coupon (five slits from 0.8 to 1.6 mm, a groove and a slot)
// Usage, from the repository root: node ideas/71-first-light/build-stl.mjs
// firstlight.test.mjs regenerates both and checks they are byte-identical to the committed files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = createRequire(import.meta.url)('./firstlight.js');

export function defaultBytes() {
  const m = F.boxMesh(F.DEFAULTS);
  return Buffer.from(F.stl(m, F.stlLabel(m.design)));
}
export function couponBytes() {
  return Buffer.from(F.stl(F.couponMesh(), F.COUPON_LABEL));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(path.join(HERE, 'default.stl'), defaultBytes());
  fs.writeFileSync(path.join(HERE, 'coupon.stl'), couponBytes());
  console.log('wrote default.stl and coupon.stl');
}
