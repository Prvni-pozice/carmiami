// mapcity.js — 3D scéna z reálných dat OpenStreetMap (Skrýšov u Pelhřimova,
// zdroj půdorysů cuzk:km). Každá budova = reálný půdorys vytažený do zdí +
// sedlová/valbová/plochá střecha nebo věž (kaplička). Cesty, rybníky, pole,
// louky a les se malují do jedné ground textury. Kolize: orientované boxy
// (obox) podle budov. Data: src/data/skrysov.json.
import * as THREE from 'three'
import DATA from './data/skrysov.json' with { type: 'json' }

// ── reálný výškopis (EU-DEM 25m) → bilineární heightAt ──
const EL = DATA.elev
function heightAt(x, z) {
  if (!EL) return 0
  const g = EL.g, half = EL.half, step = (2 * half) / (g - 1)
  let fx = (x + half) / step, fz = (z + half) / step
  fx = Math.max(0, Math.min(g - 1.001, fx)); fz = Math.max(0, Math.min(g - 1.001, fz))
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, d = EL.data
  const h00 = d[j * g + i], h10 = d[j * g + i + 1], h01 = d[(j + 1) * g + i], h11 = d[(j + 1) * g + i + 1]
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz
}

// vodorovně orientovaný kvádr (ploty, živé ploty)
function addOrientedBox(mb, cx, cy, cz, L, H, W, ang, col) {
  const ca = Math.cos(ang), sa = Math.sin(ang), hl = L / 2, hw = W / 2, y0 = cy - H / 2, y1 = cy + H / 2
  const pt = (u, w, y) => [cx + u * ca - w * sa, y, cz + u * sa + w * ca]
  const a = pt(-hl, -hw, y0), b = pt(hl, -hw, y0), c = pt(hl, hw, y0), d = pt(-hl, hw, y0)
  const e = pt(-hl, -hw, y1), f = pt(hl, -hw, y1), g = pt(hl, hw, y1), h = pt(-hl, hw, y1)
  mb.quad(e, f, g, h, col); mb.quad(a, d, c, b, col)
  mb.quad(a, b, f, e, col); mb.quad(d, h, g, c, col); mb.quad(b, c, g, f, col); mb.quad(a, e, h, d, col)
}

// ── geometrie do sdílených bufferů (1 draw call pro všechny budovy) ──
class MeshBuilder {
  constructor() { this.pos = []; this.nor = []; this.col = []; this.uv = [] }
  _n(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const ux = bx - ax, uy = by - ay, uz = bz - az
    const vx = cx - ax, vy = cy - ay, vz = cz - az
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const l = Math.hypot(nx, ny, nz) || 1
    return [nx / l, ny / l, nz / l]
  }
  tri(a, b, c, col, uvs = null) {
    const [nx, ny, nz] = this._n(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2])
    const pts = [a, b, c]
    for (let i = 0; i < 3; i++) {
      const p = pts[i]
      this.pos.push(p[0], p[1], p[2])
      this.nor.push(nx, ny, nz)
      this.col.push(col.r, col.g, col.b)
      const u = uvs ? uvs[i] : [p[0] * 0.25, p[2] * 0.25]
      this.uv.push(u[0], u[1])
    }
  }
  quad(a, b, c, d, col, uvs = null) {
    const u = uvs || [null, null, null, null]
    this.tri(a, b, c, col, uvs ? [u[0], u[1], u[2]] : null)
    this.tri(a, c, d, col, uvs ? [u[0], u[2], u[3]] : null)
  }
  geometry() {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3))
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2))
    return g
  }
  get triCount() { return this.pos.length / 9 }
}

function signedArea(poly) {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]
    a += x0 * z1 - x1 * z0
  }
  return a / 2
}

function centroid(poly) {
  let x = 0, z = 0
  for (const p of poly) { x += p[0]; z += p[1] }
  return [x / poly.length, z / poly.length]
}

/** Vrátí kopii polygonu s CCW vinutím (deterministická orientace stěn ven). */
function orientCCW(poly) {
  return signedArea(poly) >= 0 ? poly.slice() : poly.slice().reverse()
}

// stěny: svislé quady po hranách CCW půdorysu — normála VŽDY ven (žádná
// heuristika přes těžiště; ta u členitých katastrálních půdorysů selhávala
// a stěny otočené dovnitř dělaly "průhledné" domy).
function addWalls(mb, ccwPoly, baseY, h, col) {
  const y0 = baseY - 0.9, y1 = baseY + h
  for (let i = 0; i < ccwPoly.length; i++) {
    const [x0, z0] = ccwPoly[i], [x1, z1] = ccwPoly[(i + 1) % ccwPoly.length]
    const eL = Math.hypot(x1 - x0, z1 - z0)
    const a = [x0, y0, z0], b = [x1, y0, z1], c = [x1, y1, z1], d = [x0, y1, z0]
    // CCW → pořadí (a,d,c,b) míří ven
    mb.quad(a, d, c, b, col, [[0, y0 / 2], [0, y1 / 2], [eL / 2, y1 / 2], [eL / 2, y0 / 2]])
  }
}

/** Strop v úrovni okapu — utěsní pohled dovnitř u členitých půdorysů,
 *  kde obdélníková střecha nekryje celý půdorys. */
function addCeiling(mb, ccwPoly, y, col) {
  const pts2 = ccwPoly.map(([x, z]) => new THREE.Vector2(x, z))
  const tris = THREE.ShapeUtils.triangulateShape(pts2, [])
  for (const [i0, i1, i2] of tris) {
    const A = ccwPoly[i0], B = ccwPoly[i1], C = ccwPoly[i2]
    mb.tri([A[0], y, A[1]], [C[0], y, C[1]], [B[0], y, B[1]], col) // otočeno → normála vzhůru
  }
}

// lokál OBB → world
function toWorld(o, u, v) {
  const ca = Math.cos(o.a), sa = Math.sin(o.a)
  return [o.cx + u * ca - v * sa, o.cz + u * sa + v * ca]
}

function addRoof(mb, o, he, rr, kind, col) {
  const ov = 0.45                       // přesah střechy
  const hu = o.L / 2 + ov, hv = o.W / 2 + ov
  const dark = col.clone().multiplyScalar(0.82)

  if (kind === 'flat') {
    // nízká plochá deska (mírný parapet)
    const c = [toWorld(o, -hu, -hv), toWorld(o, hu, -hv), toWorld(o, hu, hv), toWorld(o, -hu, hv)]
    const y = he + rr
    mb.quad([c[0][0], y, c[0][1]], [c[1][0], y, c[1][1]], [c[2][0], y, c[2][1]], [c[3][0], y, c[3][1]], col)
    // boční parapet
    for (let i = 0; i < 4; i++) {
      const p = c[i], q = c[(i + 1) % 4]
      mb.quad([p[0], he, p[1]], [q[0], he, q[1]], [q[0], y, q[1]], [p[0], y, p[1]], dark)
    }
    return
  }
  if (kind === 'spire' || kind === 'hip') {
    // jehlan do vrcholu (kaplička = štíhlý a vysoký, valba = nízká)
    const apex = [o.cx, he + rr, o.cz]
    const c = [toWorld(o, -hu, -hv), toWorld(o, hu, -hv), toWorld(o, hu, hv), toWorld(o, -hu, hv)]
    for (let i = 0; i < 4; i++) {
      const p = c[i], q = c[(i + 1) % 4]
      mb.tri([p[0], he, p[1]], [q[0], he, q[1]], apex, i % 2 ? col : dark)
    }
    return
  }
  // gable — sedlová: hřeben podél L (delší osy)
  const A = toWorld(o, -hu, -hv), B = toWorld(o, hu, -hv)
  const C = toWorld(o, hu, hv), D = toWorld(o, -hu, hv)
  const R0 = toWorld(o, -hu, 0), R1 = toWorld(o, hu, 0)
  const ry = he + rr
  const eA = [A[0], he, A[1]], eB = [B[0], he, B[1]], eC = [C[0], he, C[1]], eD = [D[0], he, D[1]]
  const r0 = [R0[0], ry, R0[1]], r1 = [R1[0], ry, R1[1]]
  mb.quad(eA, eB, r1, r0, col)       // slope -v
  mb.quad(eD, r0, r1, eC, col)       // slope +v
  mb.tri(eA, r0, eD, dark)           // štít u -u
  mb.tri(eB, eC, r1, dark)           // štít u +u
}

// ── ground textura: pole, louky, les, voda, cesty ──
function groundTexture(half) {
  const N = 4096
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  const P = m => (m + half) / (2 * half) * N            // world → px (obě osy stejně)
  const scale = N / (2 * half)

  g.fillStyle = '#7cc24f'; g.fillRect(0, 0, N, N)       // základ: sytá letní tráva
  const areaFill = { farmland: '#e0bd5a', meadow: '#8fd04e', grassland: '#93d055', grass: '#83cc48', forest: '#356b2f', wood: '#3a7333', scrub: '#6ea84a' }
  const poly = pts => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z)))); g.closePath() }

  for (const a of DATA.areas) {
    g.fillStyle = areaFill[a.kind] || '#8fb46a'
    poly(a.poly); g.fill()
    if (a.kind === 'farmland') {                         // brázdy polí
      g.save(); poly(a.poly); g.clip()
      g.strokeStyle = 'rgba(150,120,70,0.4)'; g.lineWidth = 2
      const [cx, cz] = centroid(a.poly)
      for (let k = -60; k <= 60; k += 3) {
        g.beginPath(); g.moveTo(P(cx + k) , 0); g.lineTo(P(cx + k), N); g.stroke()
      }
      g.restore()
    }
  }
  // květy na loukách/trávě (letní barvitost)
  const FLOWERS = ['#f7e04a', '#ffffff', '#e85d8a', '#c86ff0', '#ff8a3c']
  for (const a of DATA.areas) {
    if (!['meadow', 'grass', 'grassland'].includes(a.kind)) continue
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const [x, z] of a.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
    const n = Math.floor((x1 - x0) * (z1 - z0) / 12)
    for (let i = 0; i < Math.min(n, 900); i++) {
      const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0)
      if (!pointInPoly(x, z, a.poly)) continue
      g.fillStyle = FLOWERS[(Math.random() * FLOWERS.length) | 0]
      g.beginPath(); g.arc(P(x), P(z), 2.4, 0, Math.PI * 2); g.fill()
    }
  }
  for (const w of DATA.water) { g.fillStyle = '#4a86b0'; poly(w.poly); g.fill() }

  // cesty: podklad + asfalt + středová čára u hlavních
  const roadColor = { tertiary: '#5a5a60', residential: '#63636a', service: '#6b6b6b', track: '#9a8460', path: '#a89070', footway: '#b0a080', cycleway: '#7a6a8a', pedestrian: '#8a8a90' }
  for (const r of DATA.roads) {
    if (r.pts.length < 2) continue
    g.strokeStyle = 'rgba(60,55,45,0.5)'; g.lineWidth = (r.w + 1.6) * scale
    g.lineCap = 'round'; g.lineJoin = 'round'
    g.beginPath(); r.pts.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z)))); g.stroke()
  }
  for (const r of DATA.roads) {
    if (r.pts.length < 2) continue
    g.strokeStyle = roadColor[r.kind] || '#63636a'; g.lineWidth = r.w * scale
    g.lineCap = 'round'; g.lineJoin = 'round'
    g.beginPath(); r.pts.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z)))); g.stroke()
  }
  g.setLineDash([6 * scale, 5 * scale])
  g.strokeStyle = 'rgba(230,225,210,0.6)'
  for (const r of DATA.roads) {
    if (r.kind !== 'tertiary' || r.pts.length < 2) continue
    g.lineWidth = 0.28 * scale
    g.beginPath(); r.pts.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z)))); g.stroke()
  }
  g.setLineDash([])

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

// ── stromy (listnaté + smrky), instancované ──
function pointInPoly(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

function paintGeo(geo, hex) {
  const col = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

function mergeSimple(geos) {
  // jen position+color, bez indexů
  let total = 0
  for (const g of geos) total += g.attributes.position.count
  const pos = new Float32Array(total * 3), col = new Float32Array(total * 3), nor = new Float32Array(total * 3)
  let o = 0
  for (const g of geos) {
    const gp = g.attributes.position.array, gc = g.attributes.color.array
    g.computeVertexNormals()
    const gn = g.attributes.normal.array
    pos.set(gp, o * 3); col.set(gc, o * 3); nor.set(gn, o * 3)
    o += g.attributes.position.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  return out
}

function treeGeometry(spruce) {
  if (spruce) {
    const parts = [paintGeo(new THREE.CylinderGeometry(0.16, 0.24, 1.3, 8).translate(0, 0.65, 0), 0x6b4a30)]
    for (let i = 0; i < 5; i++) {
      const r = 1.7 - i * 0.28, h = 1.7 - i * 0.18, y = 1.1 + i * 1.05
      parts.push(paintGeo(new THREE.ConeGeometry(r, h, 10).translate(0, y + h / 2, 0), i % 2 ? 0x2c5730 : 0x35663a))
    }
    return mergeSimple(parts)
  }
  const parts = [paintGeo(new THREE.CylinderGeometry(0.17, 0.26, 2.0, 8).translate(0, 1.0, 0), 0x7a5a3c)]
  const greens = [0x4a7d3a, 0x568c42, 0x3f6f34, 0x62a04a, 0x4f8a3e]
  const crown = (c, r) => { const g = new THREE.IcosahedronGeometry(r, 1); g.scale(1, 0.85, 1); return paintGeo(g, c) }
  const blobs = [[0, 2.8, 0, 1.5], [0.95, 2.35, 0.35, 1.05], [-0.85, 2.45, -0.4, 1.0], [0.3, 3.4, -0.5, 0.85], [-0.4, 2.9, 0.7, 0.8]]
  blobs.forEach(([x, y, z, r], i) => { const g = crown(greens[i % greens.length], r); g.translate(x, y, z); parts.push(g) })
  return mergeSimple(parts)
}

// trs letní trávy (5 stébel z báze), vertex color tmavá báze→světlá špička
function grassClumpGeometry() {
  const mb = new MeshBuilder()
  const base = new THREE.Color(0x4f8a34), tip = new THREE.Color(0x9fd35a)
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + Math.random(), lean = 0.12 + Math.random() * 0.12
    const bx = Math.cos(a) * 0.05, bz = Math.sin(a) * 0.05
    const tx = Math.cos(a) * lean * 3, tz = Math.sin(a) * lean * 3, ty = 0.5 + Math.random() * 0.35
    const w = 0.045
    const px = -Math.sin(a) * w, pz = Math.cos(a) * w
    // trojúhelníkové stéblo (báze široká, špička)
    mb.tri([bx - px, 0, bz - pz], [bx + px, 0, bz + pz], [bx + tx, ty, bz + tz], base)
    // barevný přechod: přepiš barvu špičky ručně
    const n = mb.col.length
    mb.col[n - 3] = tip.r; mb.col[n - 2] = tip.g; mb.col[n - 1] = tip.b
  }
  return mb.geometry()
}

// ── fasádní detaily: okna, dveře, komíny ──
// hrana CCW polygonu → tangenta + normála VEN (deterministicky z vinutí)
function outwardNormal(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz)
  if (L < 1e-4) return null
  const tx = dx / L, tz = dz / L
  return { tx, tz, nx: tz, nz: -tx, L }
}

// styly oken pro pestrost (rám, okenice, poměr stran)
const WIN_STYLES = [
  { frame: 0xffffff, shutter: null, wr: 1.0, hr: 1.0 },
  { frame: 0xf0e6d2, shutter: 0x3d6e46, wr: 0.85, hr: 1.1 },
  { frame: 0xe8e8e8, shutter: 0x8a4a2e, wr: 0.9, hr: 1.0 },
  { frame: 0x6b4326, shutter: null, wr: 1.1, hr: 0.9 },
  { frame: 0xffffff, shutter: 0x3a5a8c, wr: 0.8, hr: 1.15 },
  { frame: 0xf4ead8, shutter: null, wr: 1.0, hr: 1.25 },
]

function addPanel(mb, cx, cy, cz, tx, tz, nx, nz, w, h, off, col) {
  const hw = w / 2, hh = h / 2
  const ax = cx - tx * hw + nx * off, az = cz - tz * hw + nz * off
  const bx = cx + tx * hw + nx * off, bz = cz + tz * hw + nz * off
  mb.quad([ax, cy - hh, az], [bx, cy - hh, bz], [bx, cy + hh, bz], [ax, cy + hh, az], col)
}

function addFacade(mbDet, mbGlass, poly, baseY, wallH, kind, styleIdx) {
  if (kind === 'flat') return // ploché haly bez oken
  const st = WIN_STYLES[styleIdx % WIN_STYLES.length]
  const frame = new THREE.Color(st.frame)
  const glass = new THREE.Color(0x7fb0c8)
  const sill = new THREE.Color(0xe2dacb)
  const shutter = st.shutter != null ? new THREE.Color(st.shutter) : null
  const doorCol = new THREE.Color(st.shutter != null ? st.shutter : 0x6b4326)
  const floors = Math.max(1, Math.round(wallH / 3.0))
  const floorH = wallH / floors
  // najít nejdelší hranu pro dveře
  let doorEdge = -1, doorLen = 0
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]
    const L = Math.hypot(x1 - x0, z1 - z0)
    if (L > doorLen) { doorLen = L; doorEdge = i }
  }
  for (let i = 0; i < poly.length; i++) {
    const [x0, z0] = poly[i], [x1, z1] = poly[(i + 1) % poly.length]
    const e = outwardNormal(x0, z0, x1, z1)
    if (!e || e.L < 2.2) continue
    const cols = Math.max(1, Math.floor(e.L / 2.4))
    const winW = Math.min(1.15, (e.L / cols) * 0.55) * st.wr
    const winH = Math.min(1.45, floorH * 0.55) * st.hr
    for (let f = 0; f < floors; f++) {
      const cy = baseY + f * floorH + floorH * 0.55
      for (let k = 0; k < cols; k++) {
        const along = (k + 0.5) * (e.L / cols)
        const cx = x0 + e.tx * along, cz = z0 + e.tz * along
        if (f === 0 && i === doorEdge && k === (cols >> 1)) {
          addPanel(mbDet, cx, baseY + 1.05, cz, e.tx, e.tz, e.nx, e.nz, 1.05 + 0.16, 2.1 + 0.16, 0.04, frame)
          addPanel(mbDet, cx, baseY + 1.02, cz, e.tx, e.tz, e.nx, e.nz, 1.05, 2.1, 0.06, doorCol)
          continue
        }
        addPanel(mbDet, cx, cy, cz, e.tx, e.tz, e.nx, e.nz, winW + 0.2, winH + 0.2, 0.03, frame)
        addPanel(mbGlass, cx, cy, cz, e.tx, e.tz, e.nx, e.nz, winW, winH, 0.06, glass)
        addPanel(mbDet, cx, cy - winH / 2 - 0.12, cz, e.tx, e.tz, e.nx, e.nz, winW + 0.3, 0.12, 0.09, sill)
        if (shutter) {
          addPanel(mbDet, cx - e.tx * (winW / 2 + 0.28), cy, cz - e.tz * (winW / 2 + 0.28), e.tx, e.tz, e.nx, e.nz, 0.4, winH + 0.1, 0.05, shutter)
          addPanel(mbDet, cx + e.tx * (winW / 2 + 0.28), cy, cz + e.tz * (winW / 2 + 0.28), e.tx, e.tz, e.nx, e.nz, 0.4, winH + 0.1, 0.05, shutter)
        }
      }
    }
  }
}

function addBox(mb, cx, cy, cz, sx, sy, sz, col) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2
  const P = (a, b, c) => [cx + a * hx, cy + b * hy, cz + c * hz]
  const v = { A: P(-1,-1,-1), B: P(1,-1,-1), C: P(1,-1,1), D: P(-1,-1,1), E: P(-1,1,-1), F: P(1,1,-1), G: P(1,1,1), H: P(-1,1,1) }
  mb.quad(v.E, v.F, v.G, v.H, col)   // top
  mb.quad(v.A, v.D, v.C, v.B, col)   // bottom
  mb.quad(v.D, v.H, v.G, v.C, col)   // +z
  mb.quad(v.B, v.F, v.E, v.A, col)   // -z
  mb.quad(v.C, v.G, v.F, v.B, col)   // +x
  mb.quad(v.A, v.E, v.H, v.D, col)   // -x
}

function addChimney(mb, o, he, rr) {
  if (o.L < 4) return
  const u = o.L * (Math.random() * 0.3 + 0.1), v = 0
  const [x, z] = toWorld(o, u, v)
  const y = he + rr * 0.6
  addBox(mb, x, y + 0.5, z, 0.55, rr * 0.9 + 1.0, 0.55, new THREE.Color(0x8a5a44))
  addBox(mb, x, y + rr * 0.9 + 1.0, z, 0.68, 0.16, 0.68, new THREE.Color(0x6a4636))
}

function addCross(mb, o, he, rr) {
  const [x, z] = [o.cx, o.cz]
  const top = he + rr
  const gold = new THREE.Color(0xd8c060)
  addBox(mb, x, top + 0.55, z, 0.09, 1.1, 0.09, gold)
  addBox(mb, x, top + 0.7, z, 0.5, 0.09, 0.09, gold)
}

// ── procedurální textury: omítka (jemný šum) a pálené tašky ──
function plasterTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#fafafa'; g.fillRect(0, 0, 256, 256)
  for (let i = 0; i < 2600; i++) {
    const v = 238 + Math.random() * 17 | 0
    g.fillStyle = `rgba(${v},${v},${v - 3},0.5)`
    g.fillRect(Math.random() * 256, Math.random() * 256, 2 + Math.random() * 4, 2 + Math.random() * 4)
  }
  for (let i = 0; i < 60; i++) { // svislé stopy počasí
    g.fillStyle = 'rgba(180,178,170,0.08)'
    g.fillRect(Math.random() * 256, 0, 1 + Math.random() * 2, 256)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

function roofTileTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  g.fillStyle = '#e8e0d8'; g.fillRect(0, 0, 256, 256)
  const rowH = 32, tileW = 36
  for (let r = 0; r < 8; r++) {
    const off = (r % 2) * tileW / 2
    g.fillStyle = 'rgba(120,105,95,0.55)' // stín pod řadou
    g.fillRect(0, r * rowH + rowH - 5, 256, 5)
    for (let x = -1; x < 9; x++) {
      const tx = x * tileW + off
      const shade = 200 + Math.random() * 45 | 0
      g.fillStyle = `rgba(${shade},${shade - 10},${shade - 18},0.75)`
      g.fillRect(tx + 1, r * rowH + 1, tileW - 3, rowH - 6)
      g.fillStyle = 'rgba(90,80,72,0.5)' // mezera mezi taškami
      g.fillRect(tx + tileW - 2, r * rowH, 2, rowH)
      g.beginPath() // oblá pata tašky
      g.fillStyle = 'rgba(255,250,240,0.28)'
      g.arc(tx + tileW / 2, r * rowH + 6, 9, Math.PI, 0)
      g.fill()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

// ── funkcionalistická vila (SV dům u lesa): bílá, plochá střecha s přesahem,
//    prosklená fasáda, obvodový balkon ──
function buildVilla(mbDet, mbGlass, b, baseY) {
  const o = b.obb
  const white = new THREE.Color(0xf7f7f4)
  const H = 6.6, floorH = 3.3
  // bílé obvodové stěny (plné rohy — sklo jde přes ně v pásech)
  addOrientedBox(mbDet, o.cx, baseY + H / 2 - 0.45, o.cz, o.L, H + 0.9, o.W, o.a, white)
  // prosklené pásy na všech 4 fasádách, obě podlaží
  const faces = [
    { u: 0, v: (o.W / 2 + 0.06), len: o.L - 1.2, rot: o.a },
    { u: 0, v: -(o.W / 2 + 0.06), len: o.L - 1.2, rot: o.a },
    { u: (o.L / 2 + 0.06), v: 0, len: o.W - 1.2, rot: o.a + Math.PI / 2 },
    { u: -(o.L / 2 + 0.06), v: 0, len: o.W - 1.2, rot: o.a + Math.PI / 2 },
  ]
  const glass = new THREE.Color(0x8fc4dc)
  const mullion = new THREE.Color(0x2a2e32)
  for (const f of faces) {
    const [fx, fz] = toWorld(o, f.u, f.v)
    for (let fl = 0; fl < 2; fl++) {
      const cy = baseY + fl * floorH + 1.85
      addOrientedBox(mbGlass, fx, cy, fz, f.len, 1.9, 0.08, f.rot, glass)
      addOrientedBox(mbDet, fx, cy + 1.02, fz, f.len, 0.14, 0.1, f.rot, mullion)
      addOrientedBox(mbDet, fx, cy - 1.02, fz, f.len, 0.14, 0.1, f.rot, mullion)
      // svislé příčky
      const n = Math.max(2, Math.round(f.len / 2.2))
      for (let k = 1; k < n; k++) {
        const [px, pz] = toWorld(o,
          f.u === 0 ? -f.len / 2 + (f.len / n) * k : f.u,
          f.u === 0 ? f.v : -f.len / 2 + (f.len / n) * k)
        addOrientedBox(mbDet, px, cy, pz, 0.09, 1.9, 0.12, f.rot, mullion)
      }
    }
  }
  // obvodový balkon v patře
  addOrientedBox(mbDet, o.cx, baseY + floorH, o.cz, o.L + 2.4, 0.16, o.W + 2.4, o.a, white)
  addOrientedBox(mbDet, o.cx, baseY + floorH + 0.55, o.cz, o.L + 2.4, 0.05, 0.05, o.a, mullion)
  // zábradlí (2 vodorovné tyče kolem dokola)
  for (const dv of [1, -1]) {
    const [rx, rz] = toWorld(o, 0, dv * (o.W / 2 + 1.2))
    addOrientedBox(mbDet, rx, baseY + floorH + 0.55, rz, o.L + 2.4, 0.06, 0.06, o.a, mullion)
    const [rx2, rz2] = toWorld(o, dv * (o.L / 2 + 1.2), 0)
    addOrientedBox(mbDet, rx2, baseY + floorH + 0.55, rz2, 0.06, 0.06, o.W + 2.4, o.a, mullion)
  }
  // plochá střecha s výrazným přesahem
  addOrientedBox(mbDet, o.cx, baseY + H + 0.14, o.cz, o.L + 2.8, 0.28, o.W + 2.8, o.a, white)
}

export function buildMapCity(scene) {
  const half = DATA.half
  const obstacles = []

  // ── terén (reálný výškopis EU-DEM) ──
  const SEG = 500
  const groundGeo = new THREE.PlaneGeometry(half * 2, half * 2, SEG, SEG).rotateX(-Math.PI / 2)
  const gp = groundGeo.attributes.position
  for (let i = 0; i < gp.count; i++) gp.setY(i, heightAt(gp.getX(i), gp.getZ(i)))
  groundGeo.computeVertexNormals()
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ map: groundTexture(half), roughness: 0.95 }))
  ground.receiveShadow = true
  scene.add(ground)

  // ── vodní hladiny (lehce nad terénem) ──
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x3f78a0, roughness: 0.2, metalness: 0.3, transparent: true, opacity: 0.85 })
  for (const w of DATA.water) {
    if (w.poly.length < 3) continue
    const shape = new THREE.Shape()
    w.poly.forEach(([x, z], i) => (i ? shape.lineTo(x, z) : shape.moveTo(x, z)))
    const [wcx, wcz] = centroid(w.poly)
    const geo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2)
    const mesh = new THREE.Mesh(geo, waterMat)
    mesh.position.y = heightAt(wcx, wcz) + 0.15
    mesh.receiveShadow = true
    scene.add(mesh)
  }

  // ── budovy: 4 buffery (zdi+strop / střechy / detaily / skla) — každý
  //    s vlastní texturou/materiálem, pořád jen 4 draw cally za celou ves ──
  const VW = [0xffffff, 0xfff3d0, 0xffe08a, 0xffd24d, 0xffb84d, 0xff9f5e, 0xf5804d, 0xe86b52, 0xf5b6c4, 0xf59ab0, 0xd6ec9e, 0xb3dd72, 0x8fd0a0, 0x9fd8ec, 0x74b3e8, 0xbca8ec, 0xf2ede2, 0xe6cfa4]
  const VR = [0xc85a34, 0xbb4f2e, 0xd06438, 0xa8482f, 0x8f4030, 0x7a4230, 0x565049, 0x6b4636, 0xb0503a]
  const mbWall = new MeshBuilder()
  const mbRoof = new MeshBuilder()
  const mbDet = new MeshBuilder()
  const mbGlass = new MeshBuilder()

  // SV dům u lesa = funkcionalistická vila (zadání Zdeněk)
  let villaIdx = -1, villaScore = -Infinity
  DATA.buildings.forEach((b, bi) => {
    const area = b.obb.L * b.obb.W
    if (b.kind !== 'gable' || area < 60 || area > 420) return
    const score = b.obb.cx - b.obb.cz // východ (+x) a sever (−z)
    if (score > villaScore) { villaScore = score; villaIdx = bi }
  })

  DATA.buildings.forEach((b, bi) => {
    if (b.poly.length < 3) return
    let baseY = Infinity
    for (const [x, z] of b.poly) baseY = Math.min(baseY, heightAt(x, z))
    obstacles.push({ type: 'obox', x: b.obb.cx, z: b.obb.cz, hw: b.obb.L / 2, hd: b.obb.W / 2, a: b.obb.a })

    if (bi === villaIdx) {
      buildVilla(mbDet, mbGlass, b, baseY)
      return
    }
    const ccw = orientCCW(b.poly)
    const wc = new THREE.Color(VW[(bi * 7) % VW.length])
    const rc = b.kind === 'spire' ? new THREE.Color(0x585552) : new THREE.Color(VR[(bi * 5) % VR.length])
    addWalls(mbWall, ccw, baseY, b.walls, wc)
    addCeiling(mbWall, ccw, baseY + b.walls, wc.clone().multiplyScalar(0.55))
    addRoof(mbRoof, b.obb, baseY + b.walls, b.roof, b.kind, rc)
    addFacade(mbDet, mbGlass, ccw, baseY, b.walls, b.kind, bi)
    if (b.kind === 'gable') addChimney(mbDet, b.obb, baseY + b.walls, b.roof)
    if (b.kind === 'spire') addCross(mbDet, b.obb, baseY + b.walls, b.roof)
  })

  const wallsMesh = new THREE.Mesh(mbWall.geometry(), new THREE.MeshStandardMaterial({
    vertexColors: true, map: plasterTexture(), roughness: 0.85, flatShading: true, side: THREE.DoubleSide,
  }))
  const roofMesh = new THREE.Mesh(mbRoof.geometry(), new THREE.MeshStandardMaterial({
    vertexColors: true, map: roofTileTexture(), roughness: 0.8, flatShading: true, side: THREE.DoubleSide,
  }))
  const detMesh = new THREE.Mesh(mbDet.geometry(), new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.7, flatShading: true, side: THREE.DoubleSide,
  }))
  const glassMesh = new THREE.Mesh(mbGlass.geometry(), new THREE.MeshPhysicalMaterial({
    vertexColors: true, metalness: 0.15, roughness: 0.1, transparent: true, opacity: 0.72, side: THREE.DoubleSide,
  }))
  for (const m of [wallsMesh, roofMesh, detMesh]) { m.castShadow = true; m.receiveShadow = true; scene.add(m) }
  scene.add(glassMesh)
  const mb = { triCount: mbWall.triCount + mbRoof.triCount + mbDet.triCount + mbGlass.triCount }

  // ── živé ploty kolem ~40 % domů (jedna strana = vjezd) ──
  const hb = new MeshBuilder()
  const hedgeCol = new THREE.Color(0x4e8f3e)
  DATA.buildings.forEach((b, bi) => {
    if (b.kind !== 'gable' || (bi % 5) >= 2) return
    const o = b.obb, gap = 3.4, HL = o.L / 2 + gap, HW = o.W / 2 + gap
    const corners = [[-HL, -HW], [HL, -HW], [HL, HW], [-HL, HW]]
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      if (sIdx === (bi % 4)) continue
      const [u0, v0] = corners[sIdx], [u1, v1] = corners[(sIdx + 1) % 4]
      const [x0, z0] = toWorld(o, u0, v0), [x1, z1] = toWorld(o, u1, v1)
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2
      addOrientedBox(hb, mx, heightAt(mx, mz) + 0.55, mz, Math.hypot(x1 - x0, z1 - z0), 1.1, 0.5, Math.atan2(z1 - z0, x1 - x0), hedgeCol)
    }
  })
  if (hb.triCount) {
    const hm = new THREE.Mesh(hb.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }))
    hm.castShadow = true; scene.add(hm)
  }

  // ── vegetace: stromy (les/remízky/meze/sady) + keře. Dekorace (bez kolizí,
  //    ať fyzika zůstane levná i s tisíci stromy). Vše na terénu.
  const treeSpots = []
  const push = (x, z, k) => { if (Math.abs(x) < half - 4 && Math.abs(z) < half - 4) treeSpots.push([x, z, k]) }
  for (const a of DATA.areas.filter(a => ['forest', 'wood', 'scrub'].includes(a.kind))) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const [x, z] of a.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
    const n = Math.min(800, Math.floor((x1 - x0) * (z1 - z0) / 42))
    for (let i = 0; i < n; i++) {
      const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0)
      if (pointInPoly(x, z, a.poly)) push(x, z, a.kind === 'scrub' ? 0.7 : (Math.random() < 0.7 ? 0.2 : 0.85))
    }
  }
  // stromořadí podél mezí (hrany polí a luk)
  for (const a of DATA.areas.filter(a => ['meadow', 'farmland', 'grass', 'grassland'].includes(a.kind))) {
    for (let i = 0; i < a.poly.length; i++) {
      const [x0, z0] = a.poly[i], [x1, z1] = a.poly[(i + 1) % a.poly.length]
      const n = Math.floor(Math.hypot(x1 - x0, z1 - z0) / 17)
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        push(x0 + (x1 - x0) * t + (Math.random() - 0.5) * 3, z0 + (z1 - z0) * t + (Math.random() - 0.5) * 3, Math.random() < 0.6 ? 0.9 : 0.3)
      }
    }
  }
  // ovocné sady za domy
  DATA.buildings.forEach((b, bi) => {
    if (bi % 3) return
    const o = b.obb
    for (let t = 0; t < 2; t++) {
      const [x, z] = toWorld(o, (Math.random() - 0.5) * o.L, (o.W / 2 + 4 + Math.random() * 4) * (Math.random() < 0.5 ? 1 : -1))
      push(x, z, 0.95)
    }
  })
  const trees = treeSpots.slice(0, 2600)

  const decidGeo = treeGeometry(false), spruceGeo = treeGeometry(true)
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3()
  for (const [geo, sel] of [[decidGeo, trees.filter(t => t[2] >= 0.45)], [spruceGeo, trees.filter(t => t[2] < 0.45)]]) {
    if (!sel.length) continue
    const inst = new THREE.InstancedMesh(geo, treeMat, sel.length)
    inst.castShadow = true
    sel.forEach(([x, z], i) => {
      const s = 0.8 + Math.random() * 0.8
      sc.set(s, s + Math.random() * 0.4, s)
      q.setFromAxisAngle(up, Math.random() * Math.PI * 2)
      m4.compose(new THREE.Vector3(x, heightAt(x, z) - 0.45 * s, z), q, sc)
      inst.setMatrixAt(i, m4)
    })
    scene.add(inst)
  }

  // keře (rozptýlené mimo budovy)
  const bushGeo = (() => { const g = new THREE.IcosahedronGeometry(0.9, 1); g.scale(1, 0.68, 1); return paintGeo(g, 0x4e8f3e) })()
  const bushSpots = []
  for (let i = 0; i < 320; i++) {
    const x = (Math.random() * 2 - 1) * half * 0.85, z = (Math.random() * 2 - 1) * half * 0.85
    let ok = true
    for (const o of obstacles) if (o.type === 'obox' && Math.abs(x - o.x) < o.hw + 1.5 && Math.abs(z - o.z) < o.hd + 1.5) { ok = false; break }
    if (ok) bushSpots.push([x, z])
  }
  if (bushSpots.length) {
    const bi = new THREE.InstancedMesh(bushGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), bushSpots.length)
    bi.castShadow = true
    bushSpots.forEach(([x, z], i) => {
      const s = 0.6 + Math.random() * 0.9
      sc.set(s, s, s); q.setFromAxisAngle(up, Math.random() * 6)
      m4.compose(new THREE.Vector3(x, heightAt(x, z) - 0.22 * s, z), q, sc); bi.setMatrixAt(i, m4)
    })
    scene.add(bi)
  }
  const treeCount = trees.length

  // ── letní tráva (instancované trsy na loukách/pastvinách/mezích) ──
  const grassSpots = []
  for (const a of DATA.areas.filter(a => ['meadow', 'grass', 'grassland', 'farmland'].includes(a.kind))) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity
    for (const [x, z] of a.poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z) }
    const n = Math.min(4000, Math.floor((x1 - x0) * (z1 - z0) / 26))
    for (let i = 0; i < n; i++) {
      const x = x0 + Math.random() * (x1 - x0), z = z0 + Math.random() * (z1 - z0)
      if (pointInPoly(x, z, a.poly)) grassSpots.push([x, z])
    }
  }
  const grass = grassSpots.slice(0, 20000)
  if (grass.length) {
    const gi = new THREE.InstancedMesh(grassClumpGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, side: THREE.DoubleSide }), grass.length)
    grass.forEach(([x, z], i) => {
      const sxz = 0.7 + Math.random() * 0.9
      sc.set(sxz, 0.7 + Math.random() * 0.7, sxz); q.setFromAxisAngle(up, Math.random() * 6)
      m4.compose(new THREE.Vector3(x, heightAt(x, z), z), q, sc); gi.setMatrixAt(i, m4)
    })
    scene.add(gi)
  }
  const grassCount = grass.length

  const roadsForSpawn = DATA.roads.filter(r => ['residential', 'tertiary', 'service'].includes(r.kind) && r.pts.length >= 2)
  const city = {
    half,
    heightAt,
    place: DATA.place,
    obstacles,
    buildingCount: DATA.buildings.length,
    treeCount,
    triCount: mb.triCount,
    roadSpawn() {
      for (let tries = 0; tries < 50; tries++) {
        if (!roadsForSpawn.length) break
        const r = roadsForSpawn[Math.floor(Math.random() * roadsForSpawn.length)]
        const si = Math.floor(Math.random() * (r.pts.length - 1))
        const [x0, z0] = r.pts[si], [x1, z1] = r.pts[si + 1]
        const t = Math.random(), x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t
        if (Math.abs(x) > half - 8 || Math.abs(z) > half - 8) continue
        return { x, z, yaw: Math.atan2(x1 - x0, z1 - z0) }
      }
      const p = this.randomFreePos(4)
      return { x: p.x, z: p.z, yaw: 0 }
    },
    randomFreePos(margin = 3) {
      for (let i = 0; i < 160; i++) {
        let x, z
        if (i < 120 && DATA.buildings.length) {
          // 75 % pokusů: poblíž náhodného domu (vesnice žije u domů)
          const o = DATA.buildings[Math.floor(Math.random() * DATA.buildings.length)].obb
          const ang = Math.random() * Math.PI * 2
          const r = 6 + Math.random() * 22
          x = o.cx + Math.cos(ang) * r
          z = o.cz + Math.sin(ang) * r
          if (Math.abs(x) > half - margin - 4 || Math.abs(z) > half - margin - 4) continue
        } else {
          x = (Math.random() * 2 - 1) * (half - margin - 4)
          z = (Math.random() * 2 - 1) * (half - margin - 4)
        }
        let free = true
        for (const o of obstacles) {
          if (o.type === 'circle') { if (Math.hypot(x - o.x, z - o.z) < o.r + margin) { free = false; break } }
          else { if (Math.abs(x - o.x) < o.hw + margin && Math.abs(z - o.z) < o.hd + margin) { free = false; break } }
        }
        if (free) return { x, z }
      }
      return { x: 0, z: 0 }
    },
  }
  return city
}

/** Kolize auta (kruh) s hranicí, orientovanými boxy budov a stromy (kruh). */
export function resolveCollisions(car, city, carRadius) {
  const half = city.half
  let hit = false
  let nAccX = 0, nAccZ = 0

  if (car.pos.x > half - carRadius) { car.pos.x = half - carRadius; nAccX -= 1; hit = true }
  if (car.pos.x < -half + carRadius) { car.pos.x = -half + carRadius; nAccX += 1; hit = true }
  if (car.pos.z > half - carRadius) { car.pos.z = half - carRadius; nAccZ -= 1; hit = true }
  if (car.pos.z < -half + carRadius) { car.pos.z = -half + carRadius; nAccZ += 1; hit = true }

  for (const o of city.obstacles) {
    if (o.type === 'circle') {
      const dx = car.pos.x - o.x, dz = car.pos.z - o.z
      const dist = Math.hypot(dx, dz)
      const minDist = carRadius + o.r
      if (dist < minDist && dist > 1e-4) {
        const nx = dx / dist, nz = dz / dist, push = minDist - dist
        car.pos.x += nx * push; car.pos.z += nz * push
        nAccX += nx; nAccZ += nz; hit = true
      }
    } else if (o.type === 'obox') {
      const ca = Math.cos(o.a), sa = Math.sin(o.a)
      const dx = car.pos.x - o.x, dz = car.pos.z - o.z
      // do lokálního rámce boxu (rotace o -a)
      const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca
      const cxl = Math.max(-o.hw, Math.min(lx, o.hw))
      const czl = Math.max(-o.hd, Math.min(lz, o.hd))
      let ndx = lx - cxl, ndz = lz - czl
      let dist = Math.hypot(ndx, ndz)
      if (dist < carRadius) {
        let lnx, lnz
        if (dist > 1e-4) { lnx = ndx / dist; lnz = ndz / dist }
        else {
          // střed auta uvnitř — vytlačit k nejbližší stěně
          const dl = o.hw + lx, dr = o.hw - lx, db = o.hd + lz, dt = o.hd - lz
          const m = Math.min(dl, dr, db, dt)
          lnx = m === dl ? -1 : m === dr ? 1 : 0
          lnz = m === db ? -1 : m === dt ? 1 : 0
          dist = -m
        }
        const push = carRadius - dist
        // normála zpět do world (rotace o +a)
        const nx = lnx * ca - lnz * sa, nz = lnx * sa + lnz * ca
        car.pos.x += nx * push; car.pos.z += nz * push
        nAccX += nx; nAccZ += nz; hit = true
      }
    }
  }

  if (hit) {
    const nl = Math.hypot(nAccX, nAccZ)
    if (nl > 1e-4) {
      const nx = nAccX / nl, nz = nAccZ / nl
      const vn = car.vel.x * nx + car.vel.z * nz
      if (vn < 0) {
        car.vel.x -= nx * vn * 1.15
        car.vel.z -= nz * vn * 1.15
        car.vel.multiplyScalar(0.96)
      }
    }
    if (city.heightAt) car.pos.y = city.heightAt(car.pos.x, car.pos.z)
  }
  return hit
}
