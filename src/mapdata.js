// Loads the Los Santos layout images and derives everything the engine needs:
// class grid, zones, districts, gang territory, heightfield, distance-to-road field, and the road graph
// (extracted from the road pixels by morphological skeletonisation).
import { clamp, lerp, TAU } from './util.js';

export const MAP_N = 1024;
export const MPP = 2;                 // metres per pixel
export const HALF = MAP_N / 2;
export const WORLD_HALF = HALF * MPP; // 1024 m
export const CLS = { WATER: 0, SAND: 1, GRASS: 2, SCRUB: 3, LAND: 4, CONCRETE: 5, STREET: 6, AVENUE: 7, FREEWAY: 8, RUNWAY: 9 };
const PALETTE = [[24, 70, 130], [226, 208, 158], [84, 138, 66], [150, 132, 88], [150, 150, 146], [196, 196, 190],
  [255, 255, 255], [255, 240, 120], [255, 150, 50], [60, 60, 70]];
export const ROAD_WIDTH = { [CLS.STREET]: 10, [CLS.AVENUE]: 16, [CLS.FREEWAY]: 24 };
export const ROAD_SPEED = { [CLS.STREET]: 13, [CLS.AVENUE]: 18, [CLS.FREEWAY]: 30 }; // m/s cruising speed limits for AI
export const ZONE = { NONE: 0, RES_LOW: 1, RES_MID: 2, COMMERCIAL: 3, DOWNTOWN: 4, INDUSTRIAL: 5, BEACH: 6, RICH: 7, PARK: 8, AIRPORT: 9, DOCKS: 10, STADIUM: 11, WILD: 12, CEMETERY: 13 };
export const GANG = { NONE: 0, EMERALD: 1, VIOLET: 2, SOLES: 3, BLUELINE: 4 };

export const px2w = p => (p - HALF) * MPP;
export const w2px = w => w / MPP + HALF;

async function loadImageData(url) {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return ctx.getImageData(0, 0, c.width, c.height);
}

// Felzenszwalb squared Euclidean distance transform; returns distance in px to nearest source (mask=1).
function distanceTransform(mask, N) {
  const INF = 1e12;
  const f = new Float64Array(N), d = new Float64Array(N), z = new Float64Array(N + 1), v = new Int32Array(N);
  const out = new Float32Array(N * N);
  const tmp = new Float64Array(N * N);
  const run = (n) => {
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
      k++; v[k] = q; z[k] = s; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      const dq = q - v[k];
      d[q] = dq * dq + f[v[k]];
    }
  };
  for (let x = 0; x < N; x++) { // columns
    for (let y = 0; y < N; y++) f[y] = mask[y * N + x] ? 0 : INF;
    run(N);
    for (let y = 0; y < N; y++) tmp[y * N + x] = d[y];
  }
  for (let y = 0; y < N; y++) { // rows
    for (let x = 0; x < N; x++) f[x] = tmp[y * N + x];
    run(N);
    for (let x = 0; x < N; x++) out[y * N + x] = Math.sqrt(d[x]);
  }
  return out;
}

// Zhang-Suen thinning; returns new Uint8Array skeleton.
function thin(src, N) {
  const m = new Uint8Array(src);
  const del = [];
  let changed = true, guard = 0;
  while (changed && guard++ < 60) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      del.length = 0;
      for (let y = 1; y < N - 1; y++) {
        for (let x = 1, i = y * N + 1; x < N - 1; x++, i++) {
          if (!m[i]) continue;
          const p2 = m[i - N], p3 = m[i - N + 1], p4 = m[i + 1], p5 = m[i + N + 1], p6 = m[i + N], p7 = m[i + N - 1], p8 = m[i - 1], p9 = m[i - N - 1];
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const A = (!p2 && p3) + (!p3 && p4) + (!p4 && p5) + (!p5 && p6) + (!p6 && p7) + (!p7 && p8) + (!p8 && p9) + (!p9 && p2);
          if (A !== 1) continue;
          if (step === 0) { if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue; }
          else { if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue; }
          del.push(i);
        }
      }
      for (let k = 0; k < del.length; k++) m[del[k]] = 0;
      if (del.length) changed = true;
    }
  }
  return m;
}

const N8 = [[-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0]];

function douglasPeucker(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxd = 0, mi = -1;
    const ax = pts[a].x, az = pts[a].z, bx = pts[b].x, bz = pts[b].z;
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
    for (let i = a + 1; i < b; i++) {
      let d;
      if (l2 < 1e-9) d = Math.hypot(pts[i].x - ax, pts[i].z - az);
      else d = Math.abs((pts[i].x - ax) * dz - (pts[i].z - az) * dx) / Math.sqrt(l2);
      if (d > maxd) { maxd = d; mi = i; }
    }
    if (maxd > eps && mi >= 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
function chaikin(pts, iters) {
  for (let it = 0; it < iters; it++) {
    if (pts.length < 3) break;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      out.push({ x: lerp(a.x, b.x, 0.25), z: lerp(a.z, b.z, 0.25) }, { x: lerp(a.x, b.x, 0.75), z: lerp(a.z, b.z, 0.75) });
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

export class MapData {
  constructor() {
    this.N = MAP_N;
    this.cls = new Uint8Array(MAP_N * MAP_N);
    this.zone = new Uint8Array(MAP_N * MAP_N);
    this.district = new Uint8Array(MAP_N * MAP_N);
    this.gang = new Uint8Array(MAP_N * MAP_N);
    this.heightPx = new Float32Array(MAP_N * MAP_N);
    this.districts = [];
    this.nodes = []; this.edges = [];
    this.runways = [];
  }

  static async load(base = 'assets/', progress = () => {}) {
    const m = new MapData();
    progress('Reading map image…', 0.02);
    const [mapImg, zoneImg, hImg, dj] = await Promise.all([
      loadImageData(base + 'map.png'), loadImageData(base + 'zones.png'), loadImageData(base + 'height.png'),
      fetch(base + 'districts.json').then(r => r.json())
    ]);
    m.districts = dj.districts || [];
    m.districtById = {}; for (const d of m.districts) m.districtById[d.id] = d;
    const N = MAP_N;
    // classify
    const cache = new Map();
    const md = mapImg.data, zd = zoneImg.data, hd = hImg.data;
    for (let i = 0; i < N * N; i++) {
      const r = md[i * 4], g = md[i * 4 + 1], b = md[i * 4 + 2];
      const key = (r << 16) | (g << 8) | b;
      let c = cache.get(key);
      if (c === undefined) {
        let best = 1e9; c = 0;
        for (let k = 0; k < PALETTE.length; k++) {
          const p = PALETTE[k]; const d = (p[0] - r) ** 2 + (p[1] - g) ** 2 + (p[2] - b) ** 2;
          if (d < best) { best = d; c = k; }
        }
        cache.set(key, c);
      }
      m.cls[i] = c;
      m.zone[i] = zd[i * 4]; m.district[i] = zd[i * 4 + 1]; m.gang[i] = zd[i * 4 + 2];
      m.heightPx[i] = ((hd[i * 4] * 256 + hd[i * 4 + 1]) / 256) - 20;
    }
    m.gang0 = m.gang.slice();
    await new Promise(r => setTimeout(r, 0));
    progress('Analysing terrain…', 0.08);
    m._buildFields();
    await new Promise(r => setTimeout(r, 0));
    progress('Tracing road network…', 0.14);
    m._buildGraph();
    progress('Road network ready', 0.2);
    return m;
  }

  _buildFields() {
    const N = MAP_N, n = N * N;
    const road = new Uint8Array(n), notRoad = new Uint8Array(n), water = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = this.cls[i];
      const isRoad = c >= CLS.STREET && c <= CLS.FREEWAY;
      road[i] = isRoad ? 1 : 0; notRoad[i] = isRoad ? 0 : 1;
      water[i] = c === CLS.WATER ? 1 : 0;
    }
    this.roadMask = road;
    const dOut = distanceTransform(road, N);       // px distance to nearest road pixel (0 on road)
    const dIn = distanceTransform(notRoad, N);     // px distance to nearest non-road (0 off road)
    this.roadDist = new Float32Array(n);           // metres: >0 outside road (distance to road edge), <0 inside road
    for (let i = 0; i < n; i++) this.roadDist[i] = road[i] ? -(dIn[i] - 0.5) * MPP : (dOut[i] - 0.5) * MPP;
    this.halfWidthPx = dIn;                        // for road px: distance to edge (px)
    this.waterDist = distanceTransform(water, N);  // px
    // runways (connected components of RUNWAY)
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (this.cls[i] !== CLS.RUNWAY || seen[i]) continue;
      const q = [i]; seen[i] = 1; let sx = 0, sy = 0, cnt = 0, sxx = 0, syy = 0, sxy = 0;
      const pts = [];
      while (q.length) {
        const p = q.pop(); const x = p % N, y = (p / N) | 0;
        sx += x; sy += y; cnt++; pts.push(x, y);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
          const j = ny * N + nx;
          if (this.cls[j] === CLS.RUNWAY && !seen[j]) { seen[j] = 1; q.push(j); }
        }
      }
      if (cnt < 60) continue;
      const cx = sx / cnt, cy = sy / cnt;
      for (let k = 0; k < pts.length; k += 2) { const dx = pts[k] - cx, dy = pts[k + 1] - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
      const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal axis in px space (x right, y down)
      const ux = Math.cos(ang), uy = Math.sin(ang);
      let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9;
      for (let k = 0; k < pts.length; k += 2) {
        const dx = pts[k] - cx, dy = pts[k + 1] - cy; const u = dx * ux + dy * uy, v = -dx * uy + dy * ux;
        if (u < minU) minU = u; if (u > maxU) maxU = u; if (v < minV) minV = v; if (v > maxV) maxV = v;
      }
      this.runways.push({ x: px2w(cx), z: px2w(cy), dirx: ux, dirz: uy, len: (maxU - minU) * MPP, wid: (maxV - minV) * MPP, cu: (maxU + minU) / 2 * MPP, cv: (maxV + minV) / 2 * MPP });
    }
  }

  // ---------- accessors (world coordinates) ----------
  _idx(x, z) { return clamp(Math.floor(z / MPP + HALF), 0, MAP_N - 1) * MAP_N + clamp(Math.floor(x / MPP + HALF), 0, MAP_N - 1); }
  inBounds(x, z, margin = 0) { return Math.abs(x) < WORLD_HALF - margin && Math.abs(z) < WORLD_HALF - margin; }
  classAt(x, z) { return this.cls[this._idx(x, z)]; }
  zoneAt(x, z) { return this.zone[this._idx(x, z)]; }
  districtAt(x, z) { return this.districtById[this.district[this._idx(x, z)]] || null; }
  gangAt(x, z) { return this.gang[this._idx(x, z)]; }
  restoreGang() { if (this.gang0) this.gang.set(this.gang0); }
  roadDistAt(x, z) { // bilinear signed distance to road edge in metres (<0 on road)
    const fx = x / MPP + HALF - 0.5, fz = z / MPP + HALF - 0.5;
    const x0 = clamp(Math.floor(fx), 0, MAP_N - 2), z0 = clamp(Math.floor(fz), 0, MAP_N - 2);
    const tx = clamp(fx - x0, 0, 1), tz = clamp(fz - z0, 0, 1);
    const r = this.roadDist, i = z0 * MAP_N + x0;
    return lerp(lerp(r[i], r[i + 1], tx), lerp(r[i + MAP_N], r[i + MAP_N + 1], tx), tz);
  }
  onRoad(x, z) { return this.roadDistAt(x, z) < 0; }
  heightPxAt(x, z) { // bilinear on the 2 m grid (raw, used to build the terrain mesh)
    const fx = x / MPP + HALF - 0.5, fz = z / MPP + HALF - 0.5;
    const x0 = clamp(Math.floor(fx), 0, MAP_N - 2), z0 = clamp(Math.floor(fz), 0, MAP_N - 2);
    const tx = clamp(fx - x0, 0, 1), tz = clamp(fz - z0, 0, 1);
    const h = this.heightPx, i = z0 * MAP_N + x0;
    return lerp(lerp(h[i], h[i + 1], tx), lerp(h[i + MAP_N], h[i + MAP_N + 1], tx), tz);
  }
  isWaterAt(x, z) { return this.classAt(x, z) === CLS.WATER; }

  // ---------- road graph ----------
  _buildGraph() {
    const N = MAP_N;
    // only roads (not runways) for the skeleton
    const skel = thin(this.roadMask, N);
    this.skel = skel;
    const T = new Uint8Array(N * N);       // transition count per skeleton pixel
    const ring = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    let skelCount = 0;
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = y * N + x; if (!skel[i]) continue;
      skelCount++;
      let t = 0;
      for (let k = 0; k < 8; k++) {
        const a = skel[i + ring[k][1] * N + ring[k][0]], b = skel[i + ring[(k + 1) & 7][1] * N + ring[(k + 1) & 7][0]];
        if (!a && b) t++;
      }
      T[i] = t;
    }
    // junction clusters
    const cluster = new Int32Array(N * N).fill(-1);
    const nodes = []; // {px,py,pix:[...],deg}
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      const i = y * N + x;
      if (!skel[i] || T[i] < 3 || cluster[i] >= 0) continue;
      const id = nodes.length; const q = [i]; cluster[i] = id; let sx = 0, sy = 0; const pix = [];
      while (q.length) {
        const p = q.pop(); const px = p % N, py = (p / N) | 0; sx += px; sy += py; pix.push(p);
        for (const [dx, dy] of N8) { const j = p + dy * N + dx; if (skel[j] && T[j] >= 3 && cluster[j] < 0) { cluster[j] = id; q.push(j); } }
      }
      nodes.push({ px: sx / pix.length, py: sy / pix.length, pix, kind: 'j' });
    }
    // trace edges
    const visited = new Uint8Array(N * N);
    const edges = []; // {a,b,pts:[{x,z}] in px coords}
    const addEndNode = (p) => { nodes.push({ px: p % N, py: (p / N) | 0, pix: [p], kind: 'e' }); return nodes.length - 1; };
    const nJ = nodes.length;
    for (let ni = 0; ni < nJ; ni++) {
      for (const p0 of nodes[ni].pix) {
        for (const [dx, dy] of N8) {
          const q0 = p0 + dy * N + dx;
          if (!skel[q0] || T[q0] >= 3 || visited[q0]) continue;
          const path = [q0]; visited[q0] = 1; let cur = q0, endNode = -1;
          for (let guard = 0; guard < 20000; guard++) {
            if (T[cur] === 1) { endNode = addEndNode(cur); break; }
            let next = -1, junc = -1, bestFour = -1;
            for (let k = 0; k < 8; k++) {
              const j = cur + N8[k][1] * N + N8[k][0];
              if (!skel[j]) continue;
              if (T[j] >= 3) { const c = cluster[j]; if (c !== ni || path.length > 4) junc = c; continue; }
              if (visited[j]) continue;
              if (N8[k][0] === 0 || N8[k][1] === 0) { if (bestFour < 0) bestFour = j; } else if (next < 0) next = j;
            }
            if (junc >= 0) { endNode = junc; break; }
            if (bestFour >= 0) next = bestFour;
            if (next < 0) { endNode = addEndNode(cur); break; }
            visited[next] = 1; path.push(next); cur = next;
          }
          if (endNode < 0) continue;
          const pts = [{ x: nodes[ni].px, z: nodes[ni].py }];
          for (const p of path) pts.push({ x: p % N, z: (p / N) | 0 });
          pts.push({ x: nodes[endNode].px, z: nodes[endNode].py });
          edges.push({ a: ni, b: endNode, pts });
        }
      }
    }
    // ---- graph cleanup ----
    const pathLen = pts => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z); return l; };
    let alive = edges.map(() => true);
    const adj = () => { const a = nodes.map(() => []); edges.forEach((e, i) => { if (alive[i]) { a[e.a].push(i); a[e.b].push(i); } }); return a; };
    // remove self-loops tiny, prune spurs (dead-end edges shorter than threshold), iterate
    for (let iter = 0; iter < 4; iter++) {
      const A = adj();
      for (let i = 0; i < edges.length; i++) {
        if (!alive[i]) continue; const e = edges[i];
        const la = pathLen(e.pts);
        if (e.a === e.b && la < 12) { alive[i] = false; continue; }
        const ea = nodes[e.a].kind === 'e' || A[e.a].length === 1, eb = nodes[e.b].kind === 'e' || A[e.b].length === 1;
        if ((ea || eb) && !(ea && eb) && la < 8) alive[i] = false;       // spur attached to a junction
        else if (ea && eb && la < 10) alive[i] = false;                   // isolated fragment
      }
    }
    // contract short edges between junction nodes (merge nodes) via union-find
    const uf = nodes.map((_, i) => i);
    const find = x => { while (uf[x] !== x) { uf[x] = uf[uf[x]]; x = uf[x]; } return x; };
    for (let i = 0; i < edges.length; i++) {
      if (!alive[i]) continue; const e = edges[i];
      if (e.a !== e.b && nodes[e.a].kind === 'j' && nodes[e.b].kind === 'j' && pathLen(e.pts) < 9) { uf[find(e.a)] = find(e.b); alive[i] = false; }
    }
    const groups = new Map();
    nodes.forEach((n, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); });
    for (const [r, list] of groups) {
      if (list.length < 2) continue;
      let sx = 0, sy = 0; for (const i of list) { sx += nodes[i].px; sy += nodes[i].py; }
      const cx = sx / list.length, cy = sy / list.length;
      for (const i of list) { nodes[i].px = cx; nodes[i].py = cy; }
    }
    for (let i = 0; i < edges.length; i++) {
      if (!alive[i]) continue; const e = edges[i];
      e.a = find(e.a); e.b = find(e.b);
      const na = nodes[e.a], nb = nodes[e.b];
      e.pts[0] = { x: na.px, z: na.py }; e.pts[e.pts.length - 1] = { x: nb.px, z: nb.py };
    }
    // contract degree-2 nodes
    let changed = true;
    while (changed) {
      changed = false;
      const A = nodes.map(() => []);
      edges.forEach((e, i) => { if (alive[i]) { A[e.a].push(i); if (e.b !== e.a) A[e.b].push(i); else A[e.a].push(i); } });
      for (let ni = 0; ni < nodes.length; ni++) {
        if (find(ni) !== ni) continue;
        if (A[ni].length !== 2) continue;
        const [i1, i2] = A[ni]; if (i1 === i2) continue;
        const e1 = edges[i1], e2 = edges[i2];
        // orient e1 to end at ni, e2 to start at ni
        let p1 = e1.pts, o1 = e1.a; if (e1.b !== ni) { p1 = p1.slice().reverse(); o1 = e1.b; }
        let p2 = e2.pts, o2 = e2.b; if (e2.a !== ni) { p2 = p2.slice().reverse(); o2 = e2.a; }
        if (o1 === o2 && o1 === ni) continue;
        const merged = { a: o1, b: o2, pts: p1.concat(p2.slice(1)) };
        alive[i1] = false; alive[i2] = false;
        edges.push(merged); alive.push(true);
        changed = true; break;
      }
    }
    // finalise: convert to world coordinates with smoothing; compact node list
    const used = new Map(); const outNodes = []; const outEdges = [];
    const nodeId = (ni) => {
      if (!used.has(ni)) { used.set(ni, outNodes.length); outNodes.push({ id: outNodes.length, x: px2w(nodes[ni].px + 0.5), z: px2w(nodes[ni].py + 0.5), edges: [], kind: nodes[ni].kind }); }
      return used.get(ni);
    };
    for (let i = 0; i < edges.length; i++) {
      if (!alive[i]) continue; const e = edges[i];
      if (e.a === e.b && pathLen(e.pts) < 25) continue;
      let pts = e.pts.map(p => ({ x: p.x + 0.5, z: p.z + 0.5 }));
      pts = douglasPeucker(pts, 1.1);
      if (pts.length > 2) pts = chaikin(pts, 2);
      // road class: majority of road class along the path, width from distance field
      const count = {}; let hw = 0, hwn = 0;
      for (let k = 0; k < e.pts.length; k += 2) {
        const c = this.cls[(Math.floor(e.pts[k].z)) * N + Math.floor(e.pts[k].x)]; count[c] = (count[c] || 0) + 1;
        hw += this.halfWidthPx[(Math.floor(e.pts[k].z)) * N + Math.floor(e.pts[k].x)]; hwn++;
      }
      let cls = CLS.STREET, bestc = -1; for (const c in count) if (count[c] > bestc && +c >= CLS.STREET && +c <= CLS.FREEWAY) { bestc = count[c]; cls = +c; }
      const a = nodeId(e.a), b = nodeId(e.b);
      const wpts = pts.map(p => ({ x: px2w(p.x), z: px2w(p.z) }));
      wpts[0] = { x: outNodes[a].x, z: outNodes[a].z }; wpts[wpts.length - 1] = { x: outNodes[b].x, z: outNodes[b].z };
      const cum = [0]; for (let k = 1; k < wpts.length; k++) cum.push(cum[k - 1] + Math.hypot(wpts[k].x - wpts[k - 1].x, wpts[k].z - wpts[k - 1].z));
      const edge = { id: outEdges.length, a, b, pts: wpts, cum, len: cum[cum.length - 1], cls, w: ROAD_WIDTH[cls], measuredHalf: (hw / Math.max(1, hwn)) * MPP };
      outEdges.push(edge);
      outNodes[a].edges.push(edge.id); if (b !== a) outNodes[b].edges.push(edge.id);
    }
    // extend dead-ends a bit (skeleton stops half-width short of road end)
    for (const n of outNodes) {
      if (n.edges.length !== 1) continue;
      const e = outEdges[n.edges[0]]; const atA = e.a === n.id;
      const p = atA ? e.pts[0] : e.pts[e.pts.length - 1], q = atA ? e.pts[1] : e.pts[e.pts.length - 2];
      const d = Math.hypot(p.x - q.x, p.z - q.z) || 1; const ext = e.w * 0.5 - 1;
      p.x += (p.x - q.x) / d * ext; p.z += (p.z - q.z) / d * ext; n.x = p.x; n.z = p.z;
      e.len += ext;
      e.cum = [0]; for (let k = 1; k < e.pts.length; k++) e.cum.push(e.cum[k - 1] + Math.hypot(e.pts[k].x - e.pts[k - 1].x, e.pts[k].z - e.pts[k - 1].z)); e.len = e.cum[e.cum.length - 1];
    }
    this.nodes = outNodes; this.edges = outEdges;
    // node attributes
    for (const n of outNodes) {
      n.maxW = 0; for (const id of n.edges) n.maxW = Math.max(n.maxW, outEdges[id].w);
      n.deg = n.edges.length;
    }
    // edge segment spatial grid for nearest-road queries
    this._buildEdgeGrid();
  }

  _buildEdgeGrid() {
    this.edgeCell = 32; this.edgeGrid = new Map();
    const c = this.edgeCell;
    for (const e of this.edges) {
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i], b = e.pts[i + 1];
        const seg = { e, i };
        const x0 = Math.floor(Math.min(a.x, b.x) / c), x1 = Math.floor(Math.max(a.x, b.x) / c);
        const z0 = Math.floor(Math.min(a.z, b.z) / c), z1 = Math.floor(Math.max(a.z, b.z) / c);
        for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
          const k = ix * 10007 + iz; let arr = this.edgeGrid.get(k); if (!arr) this.edgeGrid.set(k, arr = []); arr.push(seg);
        }
      }
    }
  }

  // nearest point on the road graph. returns {edge, seg i, s (arclength along edge), d (dist), x, z, tx, tz} or null
  nearestRoad(x, z, maxR = 48) {
    const c = this.edgeCell, r = Math.ceil(maxR / c);
    const cx = Math.floor(x / c), cz = Math.floor(z / c);
    let best = null, bd = maxR * maxR;
    for (let ix = cx - r; ix <= cx + r; ix++) for (let iz = cz - r; iz <= cz + r; iz++) {
      const arr = this.edgeGrid.get(ix * 10007 + iz); if (!arr) continue;
      for (const seg of arr) {
        const a = seg.e.pts[seg.i], b = seg.e.pts[seg.i + 1];
        const dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
        const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
        const px = a.x + dx * t, pz = a.z + dz * t; const d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 < bd) { bd = d2; const l = Math.sqrt(l2); best = { edge: seg.e, i: seg.i, s: seg.e.cum[seg.i] + t * l, d: Math.sqrt(d2), x: px, z: pz, tx: dx / l, tz: dz / l }; }
      }
    }
    return best;
  }
  nearestNode(x, z, maxR = 1e9, minDeg = 1) {
    let best = null, bd = maxR * maxR;
    for (const n of this.nodes) { if (n.deg < minDeg) continue; const d2 = (n.x - x) ** 2 + (n.z - z) ** 2; if (d2 < bd) { bd = d2; best = n; } }
    return best;
  }
}

// position/tangent along an edge at arclength s (clamped)
export function edgePointAt(e, s, out = {}) {
  s = clamp(s, 0, e.len);
  const cum = e.cum; let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (cum[mid] <= s) lo = mid; else hi = mid; }
  const a = e.pts[lo], b = e.pts[lo + 1]; const seg = cum[lo + 1] - cum[lo] || 1e-9; const t = (s - cum[lo]) / seg;
  out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
  out.tx = (b.x - a.x) / seg; out.tz = (b.z - a.z) / seg;
  return out;
}
