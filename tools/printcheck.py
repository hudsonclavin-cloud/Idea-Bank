#!/usr/bin/env python3
"""Printability check for STL files: is the mesh a closed solid, does it fit a small
printer, how much of it overhangs, how thin are its walls, and does a real slicer
(PrusaSlicer, if installed) slice it, with how much support.

Needs trimesh (pip install trimesh). The slicer step is skipped if prusa-slicer is
not on PATH. Exits 1 if any STL fails a hard check (not a closed solid, does not
sit on the bed, does not fit the bed, or the slicer fails); overhangs and thin walls
are reported as warnings, because some are deliberate (bridges, chamfers, text).

Usage: python3 tools/printcheck.py <file.stl | folder>... [--bed X,Y,Z] [--json]
"""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile

BED = (180.0, 180.0, 180.0)  # fits small printers (Prusa Mini, Bambu A1 mini) and everything larger
OVERHANG_DEG = 45.0          # steeper than this from vertical needs support (FDM rule of thumb)
MIN_WALL = 0.8               # two perimeters with a 0.4 mm nozzle


def find_stls(args):
    out = []
    for a in args:
        if os.path.isdir(a):
            for root, _, files in os.walk(a):
                if 'node_modules' in root:
                    continue
                out += [os.path.join(root, f) for f in files if f.lower().endswith('.stl')]
        elif a.lower().endswith('.stl'):
            out.append(a)
    return sorted(out)


def thickness_samples(mesh, n=1500):
    """Wall thickness at random surface points: distance along the inward normal to
    the next surface. Returns sorted thicknesses in mm."""
    import numpy as np
    import trimesh
    if len(mesh.faces) == 0:
        return []
    pts, fi = trimesh.sample.sample_surface(mesh, n, seed=1)
    normals = mesh.face_normals[fi]
    origins = pts - normals * 1e-3
    try:
        locs, ray_idx, _ = mesh.ray.intersects_location(origins, -normals, multiple_hits=False)
    except Exception:
        return []
    d = np.full(len(origins), np.inf)
    if len(ray_idx):
        dist = np.linalg.norm(locs - origins[ray_idx], axis=1)
        d[ray_idx] = dist
    d = d[np.isfinite(d)]
    return sorted(float(x) for x in d)


def overhang(mesh):
    """Area of downward-facing faces steeper than OVERHANG_DEG from vertical, not on the bed."""
    import numpy as np
    nz = mesh.face_normals[:, 2]
    areas = mesh.area_faces
    zmin = mesh.bounds[0][2]
    centz = mesh.triangles_center[:, 2]
    on_bed = centz < zmin + 0.05
    limit = -math.sin(math.radians(OVERHANG_DEG))  # normal pointing down more than this
    steep = (nz < limit) & ~on_bed
    flat = (nz < -0.999) & ~on_bed  # horizontal ceilings: bridges or unsupported floors
    return float(areas[steep].sum()), float(areas[flat].sum()), float(areas[on_bed & (nz < -0.999)].sum())


def slice_stats(path, support):
    exe = shutil.which('prusa-slicer') or shutil.which('prusa-slicer-console')
    if not exe:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, 'out.gcode')
        cmd = [exe, '--export-gcode', '--layer-height', '0.2', '--nozzle-diameter', '0.4',
               '--filament-diameter', '1.75', '--filament-density', '1.24', '--temperature', '210', '--bed-temperature', '60',
               '--bed-shape', f'0x0,{BED[0]:g}x0,{BED[0]:g}x{BED[1]:g},0x{BED[1]:g}',
               '--max-print-height', f'{BED[2]:g}', '--center', f'{BED[0] / 2:g},{BED[1] / 2:g}',
               '--dont-arrange', '--output', out, path]
        if support:
            cmd[1:1] = ['--support-material', '--support-material-threshold', str(int(90 - OVERHANG_DEG))]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        except subprocess.TimeoutExpired:
            return {'ok': False, 'error': 'slicer timed out'}
        if r.returncode != 0 or not os.path.exists(out):
            return {'ok': False, 'error': (r.stderr or r.stdout).strip().splitlines()[-1:] or ['slicer failed']}
        text = open(out, encoding='utf-8', errors='replace').read()
        tail = text[-20000:]
        def grab(pat):
            m = re.search(pat, tail)
            return m.group(1) if m else None
        mm = grab(r'; filament used \[mm\] = ([\d.]+)')
        g = grab(r'; filament used \[g\] = ([\d.]+)')
        t = grab(r'; estimated printing time \(normal mode\) = ([^\n]+)')
        return {'ok': True, 'filament_mm': float(mm) if mm else None, 'filament_g': float(g) if g else None, 'time': t}


def check(path):
    import trimesh
    res = {'file': path, 'errors': [], 'warnings': []}
    mesh = trimesh.load(path, force='mesh')
    res['triangles'] = int(len(mesh.faces))
    res['bodies'] = int(len(mesh.split(only_watertight=False))) if len(mesh.faces) < 400000 else None
    res['watertight'] = bool(mesh.is_watertight)
    res['winding_consistent'] = bool(mesh.is_winding_consistent)
    res['is_volume'] = bool(mesh.is_volume)
    ext = [float(x) for x in mesh.extents]
    res['size_mm'] = [round(x, 2) for x in ext]
    res['min_z'] = round(float(mesh.bounds[0][2]), 3)
    if not mesh.is_watertight or not mesh.is_winding_consistent or not mesh.is_volume:
        res['errors'].append('not a closed, consistently wound solid (watertight=%s, winding=%s, volume=%s)' % (mesh.is_watertight, mesh.is_winding_consistent, mesh.is_volume))
    else:
        res['volume_cm3'] = round(float(mesh.volume) / 1000, 2)
        if mesh.volume <= 0:
            res['errors'].append('negative volume: normals point inward')
    if abs(res['min_z']) > 0.01:
        res['errors'].append(f'lowest point is at z = {res["min_z"]} mm, not on the bed (z = 0)')
    if any(e > b + 1e-6 for e, b in zip(sorted(ext), sorted(BED))):
        res['errors'].append(f'does not fit a {BED[0]:g} x {BED[1]:g} x {BED[2]:g} mm bed in any orientation of its axes: {res["size_mm"]}')
    elif any(e > b + 1e-6 for e, b in zip(ext, BED)):
        res['warnings'].append(f'as oriented, exceeds a {BED[0]:g} x {BED[1]:g} x {BED[2]:g} mm bed: {res["size_mm"]}')
    steep, ceil, bed = overhang(mesh)
    total = float(mesh.area)
    res['bed_contact_mm2'] = round(bed, 1)
    res['overhang_mm2'] = round(steep, 1)
    res['ceiling_mm2'] = round(ceil, 1)
    res['overhang_share'] = round(steep / total, 4) if total else 0
    if bed < 1:
        res['errors'].append('no flat face on the bed: the part will not stick')
    if steep > 0.02 * total:
        res['warnings'].append(f'{steep:.0f} mm² ({100 * steep / total:.1f}% of the surface) faces down more than {OVERHANG_DEG:g}° from vertical, off the bed: bridges, or needs support')
    th = thickness_samples(mesh) if res['watertight'] else []
    if th:
        res['thickness_p1_mm'] = round(th[max(0, int(0.01 * len(th)) - 1)], 3)
        res['thickness_p5_mm'] = round(th[int(0.05 * len(th))], 3)
        res['thickness_min_mm'] = round(th[0], 3)
        if res['thickness_p5_mm'] < MIN_WALL:
            res['warnings'].append(f'5% of sampled points have walls thinner than {res["thickness_p5_mm"]} mm (two perimeters is {MIN_WALL} mm)')
    if not res['errors']:
        plain = slice_stats(path, support=False)
        if plain is None:
            res['slicer'] = 'skipped (prusa-slicer not installed)'
        elif not plain['ok']:
            res['errors'].append(f'slicer failed: {plain["error"]}')
        else:
            sup = slice_stats(path, support=True)
            res['slice'] = plain
            if sup and sup['ok'] and plain['filament_mm'] and sup['filament_mm']:
                extra = sup['filament_mm'] - plain['filament_mm']
                res['support_filament_mm'] = round(max(0.0, extra), 1)
                res['support_share'] = round(max(0.0, extra) / plain['filament_mm'], 4)
                if res['support_share'] > 0.02:
                    res['warnings'].append(f'slicing with supports at {OVERHANG_DEG:g}° adds {100 * res["support_share"]:.1f}% filament: the part needs support as oriented')
    return res


def main():
    global BED
    args = sys.argv[1:]
    as_json = '--json' in args
    if '--bed' in args:
        i = args.index('--bed')
        BED = tuple(float(x) for x in args[i + 1].split(','))
        del args[i:i + 2]
    args = [a for a in args if a != '--json']
    try:
        import trimesh  # noqa: F401
    except ImportError:
        print('printcheck: skipped (pip install trimesh to enable)')
        return 0
    stls = find_stls(args)
    if not stls:
        print('printcheck: no STL files found')
        return 0
    failed = 0
    results = []
    for p in stls:
        try:
            r = check(p)
        except Exception as e:  # a mesh that cannot be loaded is a failure, not a crash
            r = {'file': p, 'errors': [f'could not load: {e}'], 'warnings': []}
        results.append(r)
        failed += bool(r['errors'])
        if not as_json:
            s = r.get('slice') or {}
            bits = [f"{'x'.join(f'{v:g}' for v in r.get('size_mm', []))} mm"]
            if 'volume_cm3' in r:
                bits.append(f"{r['volume_cm3']} cm³")
            if s:
                bits.append(f"{s.get('filament_g')} g, {s.get('time')}")
            if 'support_share' in r:
                bits.append(f"support +{100 * r['support_share']:.1f}%")
            if 'thickness_p5_mm' in r:
                bits.append(f"walls p5 {r['thickness_p5_mm']} mm")
            print(f"{'FAIL' if r['errors'] else 'ok  '} {p}  ({'; '.join(bits)})")
            for e in r['errors']:
                print(f'       error: {e}')
            for w in r['warnings']:
                print(f'       warn:  {w}')
    if as_json:
        print(json.dumps(results, indent=1))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
