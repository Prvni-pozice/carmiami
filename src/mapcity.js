// mapcity.js — 3D scéna z reálných dat OpenStreetMap (Skrýšov u Pelhřimova,
// zdroj půdorysů cuzk:km). Každá budova = reálný půdorys vytažený do zdí +
// sedlová/valbová/plochá střecha nebo věž (kaplička). Cesty, rybníky, pole,
// louky a les se malují do jedné ground textury. Kolize: orientované boxy
// (obox) podle budov. Data: src/data/skrysov.json.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import DATA from './data/skrysov.json' with { type: 'json' }

// ── reálné CC0 PBR textury (Polyhaven, viz public/textures/CREDITS.md) ──
// Načtou se JEDNOU asynchronně před stavbou scény; při chybě (chybějící
// soubor apod.) build tiše spadne zpět na procedurální textury níže —
// hra nesmí zůstat viset na rozbitém obrázku.
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('nepodařilo se načíst ' + url))
    img.src = url
  })
}

export async function loadCityTextures() {
  try {
    const loader = new THREE.TextureLoader()
    const [grassImg, dirtImg, asphaltImg, plasterDiff, plasterNor, roofDiff, roofNor] = await Promise.all([
      loadImage('/textures/grass_diff.jpg'),
      loadImage('/textures/dirt_diff.jpg'),
      loadImage('/textures/asphalt_diff.jpg'),
      loader.loadAsync('/textures/plaster_diff.jpg'),
      loader.loadAsync('/textures/plaster_nor.jpg'),
      loader.loadAsync('/textures/roof_diff.jpg'),
      loader.loadAsync('/textures/roof_nor.jpg'),
    ])
    const grassNorTex = await loader.loadAsync('/textures/grass_nor.jpg')
    plasterDiff.colorSpace = roofDiff.colorSpace = THREE.SRGBColorSpace
    for (const t of [plasterDiff, plasterNor, roofDiff, roofNor, grassNorTex]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping
      t.anisotropy = 8 // ostrá textura i pod ostrým úhlem (bez toho "rozmazané kostky")
    }
    return { grassImg, dirtImg, asphaltImg, plasterDiff, plasterNor, roofDiff, roofNor, grassNorTex }
  } catch (e) {
    console.warn('Reálné textury se nepodařilo načíst, používám procedurální náhradu:', e.message)
    return null
  }
}

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

// vzdálenost bodu od úsečky (pro ořez plotů proti silnicím)
function distToSegment(x, z, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0
  const len2 = dx * dx + dz * dz
  let t = len2 > 1e-6 ? ((x - x0) * dx + (z - z0) * dz) / len2 : 0
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (x0 + t * dx), z - (z0 + t * dz))
}

/** Nejmenší vzdálenost bodu od libovolné silnice (okraj vozovky, ne osa). */
function distToNearestRoad(x, z) {
  let best = Infinity
  for (const r of DATA.roads) {
    if (r.pts.length < 2) continue
    for (let i = 0; i < r.pts.length - 1; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1]
      const d = distToSegment(x, z, x0, z0, x1, z1) - r.w / 2
      if (d < best) best = d
    }
  }
  return best
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
    const l = Math.hypot(nx, ny, nz)
    // Degenerovaný (kolineární/nulový) trojúhelník → cross product je (0,0,0).
    // Bývalé "|| 1" tu jen bránilo dělení nulou, ale vracelo normálu (0,0,0) —
    // ta žádné světlo neodrazí = trojúhelník vykreslený černě bez ohledu na
    // velikost. Reálná katastrální data mívají skoro totožné/kolineární body
    // (zejména po triangulaci stropu), takže tohle byl zdroj "černých střepů".
    if (l < 1e-8) return [0, 1, 0]
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

/**
 * Odstraní skoro-duplicitní/kolineární sousední body (běžné u reálných
 * katastrálních dat). Bez tohohle čištění umí ShapeUtils.triangulateShape
 * (strop budov) vyprodukovat degenerované trojúhelníky — obrana do budoucna
 * navíc k opravené _n() výše.
 */
function dedupePoly(poly, eps = 0.05) {
  const out = []
  for (const p of poly) {
    const prev = out[out.length - 1]
    if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > eps) out.push(p)
  }
  if (out.length > 1 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) <= eps) out.pop()
  return out.length >= 3 ? out : poly
}

/**
 * Mřížková prostorová index (spatial hash) překážek — bez ní by kolize
 * musely projet CELÝ seznam (budovy + tisíce stromů/keřů) pro KAŽDÉ auto
 * KAŽDÝ snímek. S mřížkou se prohledávají jen buňky v okolí auta.
 */
function buildSpatialHash(obstacles, cellSize) {
  const cellMap = new Map()
  const add = (cx, cz, idx) => {
    const k = cx + ',' + cz
    let arr = cellMap.get(k)
    if (!arr) { arr = []; cellMap.set(k, arr) }
    arr.push(idx)
  }
  obstacles.forEach((o, idx) => {
    if (o.type === 'circle') {
      add(Math.floor(o.x / cellSize), Math.floor(o.z / cellSize), idx)
    } else { // obox — vlož do všech buněk, které protíná jeho (konzervativní) AABB
      const r = Math.hypot(o.hw, o.hd)
      const cx0 = Math.floor((o.x - r) / cellSize), cx1 = Math.floor((o.x + r) / cellSize)
      const cz0 = Math.floor((o.z - r) / cellSize), cz1 = Math.floor((o.z + r) / cellSize)
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) add(cx, cz, idx)
    }
  })
  return { cellMap, cellSize }
}

/** Překážky v okolí bodu (buňka + 8 sousedů), bez duplicit. */
function queryNearby(hash, x, z) {
  const cx = Math.floor(x / hash.cellSize), cz = Math.floor(z / hash.cellSize)
  const seen = new Set(), out = []
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const arr = hash.cellMap.get((cx + dx) + ',' + (cz + dz))
    if (!arr) continue
    for (const idx of arr) if (!seen.has(idx)) { seen.add(idx); out.push(idx) }
  }
  return out
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
  if (kind === 'hipr') {
    // valbová: hřeben zkrácený z obou konců (klasická česká valba)
    const inset = Math.min(hu * 0.45, hv * 1.15)
    const A = toWorld(o, -hu, -hv), B = toWorld(o, hu, -hv)
    const C = toWorld(o, hu, hv), D = toWorld(o, -hu, hv)
    const R0 = toWorld(o, -hu + inset, 0), R1 = toWorld(o, hu - inset, 0)
    const ry2 = he + rr
    const eA = [A[0], he, A[1]], eB = [B[0], he, B[1]], eC = [C[0], he, C[1]], eD = [D[0], he, D[1]]
    const r0 = [R0[0], ry2, R0[1]], r1 = [R1[0], ry2, R1[1]]
    mb.quad(eA, eB, r1, r0, col, [[0, 0], [o.L / 1.6, 0], [(o.L - inset) / 1.6, hv / 1.4], [inset / 1.6, hv / 1.4]])
    mb.quad(eD, r0, r1, eC, col, [[0, 0], [inset / 1.6, hv / 1.4], [(o.L - inset) / 1.6, hv / 1.4], [o.L / 1.6, 0]])
    mb.tri(eA, r0, eD, dark, [[0, 0], [hv / 1.4, hv / 1.4], [2 * hv / 1.6, 0]])
    mb.tri(eB, eC, r1, dark, [[0, 0], [2 * hv / 1.6, 0], [hv / 1.4, hv / 1.4]])
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
function groundTexture(half, textures) {
  const N = 4096
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')
  const P = m => (m + half) / (2 * half) * N            // world → px (obě osy stejně)
  const scale = N / (2 * half)

  // reálné foto textury jako dlaždicový pattern (fotka zmenšená na velikost
  // jedné "dlaždice" ve světových metrech, pak canvas pattern 'repeat') —
  // bez tohohle by 1 fotka natažená na celou mapu byla jen rozmazaná skvrna
  const tilePattern = (img, worldTileSize) => {
    if (!img) return null
    const px = Math.max(8, Math.round(worldTileSize * scale))
    const t = document.createElement('canvas')
    t.width = t.height = px
    t.getContext('2d').drawImage(img, 0, 0, px, px)
    return g.createPattern(t, 'repeat')
  }
  // Dlaždice patternu musí být na 4096px canvasu (≈4.4 px/m) dost velká:
  // při 2.4 m měla jen ~10 px → viditelná mřížka "kostiček". 9 m dlaždice
  // = ~40 px: opakování splyne, detail zblízka dodá normal mapa terénu.
  const grassPat = textures ? tilePattern(textures.grassImg, 9.0) : null
  const dirtPat = textures ? tilePattern(textures.dirtImg, 5.5) : null
  const asphaltPat = textures ? tilePattern(textures.asphaltImg, 5.0) : null

  g.fillStyle = grassPat || '#7cc24f'; g.fillRect(0, 0, N, N) // základ: tráva (foto nebo procedurální)
  // barevné tónování ploch PŘES fotoreálnou trávu — rozliší typy, foto
  // textura ale prosvítá skrz (poloprůhledné), takže zůstává detail zblízka
  const areaFill = textures
    ? { farmland: 'rgba(224,189,90,0.55)', meadow: 'rgba(143,208,78,0.3)', grassland: 'rgba(147,208,85,0.28)', grass: 'rgba(131,204,72,0.22)', forest: 'rgba(53,107,47,0.62)', wood: 'rgba(58,115,51,0.58)', scrub: 'rgba(110,168,74,0.4)' }
    : { farmland: '#e0bd5a', meadow: '#8fd04e', grassland: '#93d055', grass: '#83cc48', forest: '#356b2f', wood: '#3a7333', scrub: '#6ea84a' }
  const poly = pts => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z)))); g.closePath() }

  for (const a of DATA.areas) {
    g.fillStyle = areaFill[a.kind] || (textures ? 'rgba(143,180,106,0.18)' : '#8fb46a')
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

  // cesty: podklad + povrch (asfalt/hlína — foto pattern nebo procedurální barva)
  const roadColor = { tertiary: '#5a5a60', residential: '#63636a', service: '#6b6b6b', track: '#9a8460', path: '#a89070', footway: '#b0a080', cycleway: '#7a6a8a', pedestrian: '#8a8a90' }
  const roadSurface = { tertiary: 'asphalt', residential: 'asphalt', service: 'asphalt', cycleway: 'asphalt', pedestrian: 'asphalt', track: 'dirt', path: 'dirt', footway: 'dirt' }
  for (const r of DATA.roads) {
    if (r.pts.length < 2) continue
    g.strokeStyle = 'rgba(60,55,45,0.5)'; g.lineWidth = (r.w + 1.6) * scale
    g.lineCap = 'round'; g.lineJoin = 'round'
    g.beginPath(); r.pts.forEach(([x, z], i) => (i ? g.lineTo(P(x), P(z)) : g.moveTo(P(x), P(z)))); g.stroke()
  }
  for (const r of DATA.roads) {
    if (r.pts.length < 2) continue
    const surf = roadSurface[r.kind] === 'asphalt' ? asphaltPat : roadSurface[r.kind] === 'dirt' ? dirtPat : null
    g.strokeStyle = surf || roadColor[r.kind] || '#63636a'; g.lineWidth = r.w * scale
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

// ── stromy v3: organické koruny (šumová deformace vrcholů) s barevným
//    gradientem podle výšky, větve, 3 listnaté + 2 smrkové varianty ──
// Deterministický "šum" z pozice vrcholu: STEJNÁ hodnota pro duplicitní
// vrcholy na švech non-indexed geometrie (jinak by se koruna roztrhla).
function posNoise(x, y, z, seed) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 91.7) * 43758.5453
  return v - Math.floor(v)
}

function deformRadial(geo, amp, seed) {
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i)
    const k = 1 + (posNoise(Math.round(x * 20), Math.round(y * 20), Math.round(z * 20), seed) - 0.5) * amp
    pos.setXYZ(i, x * k, y * k, z * k)
  }
  return geo
}

/** Barva podle výšky: tmavá zespodu, světlá (osluněná) nahoře + jemný jitter. */
function colorByHeight(geo, lowHex, highHex, seed) {
  const lo = new THREE.Color(lowHex), hi = new THREE.Color(highHex)
  const pos = geo.attributes.position
  let minY = Infinity, maxY = -Infinity
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); if (y < minY) minY = y; if (y > maxY) maxY = y }
  const span = Math.max(1e-3, maxY - minY)
  const arr = new Float32Array(pos.count * 3)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - minY) / span
    const j = (posNoise(Math.round(pos.getX(i) * 20), Math.round(pos.getY(i) * 20), Math.round(pos.getZ(i) * 20), seed + 5) - 0.5) * 0.12
    c.copy(lo).lerp(hi, Math.min(1, Math.max(0, t + j)))
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

// ── stromy v4: texturované billboardy (3 zkřížené alfa quady) ──
// Předchozí šumově deformované koule se TRHALY (plovoucí polygony,
// "prstenec" na fotkách). Billboard s namalovanou siluetou listí drží
// vždy pohromadě, dá výrazně lepší dojem a je i mnohem levnější (6 △).
// alphaTest (ostrý ořez, ne blending) = žádné řazení průhlednosti.

/** Canvas textura stromu s alfa kanálem. kind: 'decid' | 'spruce'. */
function treeTexture(kind, seed) {
  const W = 256, H = 320
  const c = document.createElement('canvas')
  c.width = W; c.height = H
  const g = c.getContext('2d')
  let rnd = seed * 9301 + 49297
  const rand = () => { rnd = (rnd * 9301 + 49297) % 233280; return rnd / 233280 }

  // kmen (dolní ~28 %)
  const trunkTop = kind === 'spruce' ? H * 0.86 : H * 0.72
  g.fillStyle = kind === 'spruce' ? '#5a4028' : '#6e5236'
  g.fillRect(W / 2 - 10, trunkTop, 20, H - trunkTop)
  g.fillStyle = 'rgba(40,28,16,0.4)'
  g.fillRect(W / 2 - 3, trunkTop, 4, H - trunkTop)

  const blob = (x, y, r, col, a) => {
    g.globalAlpha = a
    g.fillStyle = col
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill()
    g.globalAlpha = 1
  }

  if (kind === 'spruce') {
    // trojúhelníkové patra jehličí
    const greens = ['#1f4a1c', '#2b5c24', '#376e2c']
    for (let layer = 0; layer < 6; layer++) {
      const t = layer / 5
      const cy = H * 0.14 + t * (trunkTop - H * 0.14)
      const wid = 22 + t * 92
      for (let i = 0; i < 40; i++) {
        const px = W / 2 + (rand() - 0.5) * wid * (1 - Math.abs(rand()) * 0.3)
        const py = cy + (rand() - 0.5) * 34
        blob(px, py, 7 + rand() * 9, greens[(rand() * 3) | 0], 0.55 + rand() * 0.35)
      }
    }
    // světlejší přisvětlení shora-vlevo
    for (let i = 0; i < 60; i++) blob(W / 2 - 20 + (rand() - 0.5) * 90, H * 0.2 + rand() * (trunkTop - H * 0.2), 5 + rand() * 6, '#5a9440', 0.4)
  } else {
    // kulatá/vejčitá koruna
    const cx = W / 2, cy = H * 0.36, rx = 108, ry = 116
    const greenSets = [
      ['#274d1f', '#356b2a', '#4f8f36', '#68a842'],
      ['#2c5522', '#3d7530', '#57993e', '#74b545'],
      ['#22461c', '#316327', '#4a8834', '#63a03e'],
    ][seed % 3]
    // hustá výplň + osvětlení
    for (let i = 0; i < 900; i++) {
      const a = rand() * Math.PI * 2, rr = Math.sqrt(rand())
      const px = cx + Math.cos(a) * rr * rx * (0.72 + rand() * 0.28)
      const py = cy + Math.sin(a) * rr * ry * (0.72 + rand() * 0.28) - 8
      // shora světlejší, zespodu tmavší
      const light = (cy - py) / ry
      const gi = Math.max(0, Math.min(3, Math.round(1.5 + light * 2 + (rand() - 0.5))))
      blob(px, py, 8 + rand() * 12, greenSets[gi], 0.6 + rand() * 0.35)
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 3 zkřížené quady (billboard cross) — objem z každého úhlu, 6 △. */
function treeCrossGeometry() {
  const mb = new MeshBuilder()
  const white = new THREE.Color(0xffffff)
  const hw = 0.5, h = 1.0 // normalizované (0..1 výška), měřítko dá instance
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI
    const dx = Math.cos(a) * hw, dz = Math.sin(a) * hw
    const A = [-dx, 0, -dz], B = [dx, 0, dz], C = [dx, h, dz], D = [-dx, h, -dz]
    mb.quad(A, B, C, D, white, [[0, 0], [1, 0], [1, 1], [0, 1]])
  }
  return mb.geometry()
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

// ── 10 typů venkovských domů: kombinace sklonu střechy, sedlová/valbová,
//    vikýř, sokl, počet komínů. Deterministicky dle indexu budovy. ──
const HOUSE_TYPES = [
  { pitch: 1.0, roof: 'gable', dormer: false, sokl: true, chim: 1 },
  { pitch: 1.3, roof: 'gable', dormer: true, sokl: true, chim: 1 },
  { pitch: 0.85, roof: 'hipr', dormer: false, sokl: false, chim: 1 },
  { pitch: 1.1, roof: 'hipr', dormer: false, sokl: true, chim: 1 },
  { pitch: 1.45, roof: 'gable', dormer: true, sokl: false, chim: 1 },  // vysoké podkroví
  { pitch: 0.72, roof: 'gable', dormer: false, sokl: false, chim: 1 }, // nízká hospodářská
  { pitch: 1.0, roof: 'hipr', dormer: true, sokl: true, chim: 1 },
  { pitch: 1.2, roof: 'gable', dormer: false, sokl: true, chim: 2 },
  { pitch: 0.9, roof: 'gable', dormer: false, sokl: false, chim: 1 },
  { pitch: 1.05, roof: 'hipr', dormer: false, sokl: false, chim: 2 },
]

/** Vikýř na střešním svahu: tělo + sedlová stříška + okénko. */
function addDormer(mbDet, mbGlass, o, he, rr, wallCol, roofCol) {
  if (o.L < 7 || o.W < 5) return
  const u = (Math.random() - 0.5) * o.L * 0.4
  const side = Math.random() < 0.5 ? 1 : -1
  const v = side * o.W * 0.22
  const yBase = he + rr * 0.18
  const w = 1.5, hgt = 1.3, d = 1.6
  const [cx, cz] = toWorld(o, u, v)
  addOrientedBox(mbDet, cx, yBase + hgt / 2, cz, w, hgt, d, o.a, wallCol)
  // sedlová stříška vikýře (2 quady, hřeben podél u-osy)
  const rh = 0.6
  const p = (du, dv, y) => { const [x, z] = toWorld(o, u + du, v + dv); return [x, y, z] }
  const dark = roofCol.clone().multiplyScalar(0.85)
  mb2quad(mbDet, p(-w / 2 - 0.15, -d / 2 - 0.15, yBase + hgt), p(w / 2 + 0.15, -d / 2 - 0.15, yBase + hgt), p(w / 2 + 0.15, 0, yBase + hgt + rh), p(-w / 2 - 0.15, 0, yBase + hgt + rh), dark)
  mb2quad(mbDet, p(-w / 2 - 0.15, 0, yBase + hgt + rh), p(w / 2 + 0.15, 0, yBase + hgt + rh), p(w / 2 + 0.15, d / 2 + 0.15, yBase + hgt), p(-w / 2 - 0.15, d / 2 + 0.15, yBase + hgt), dark)
  // okénko na vnější straně
  const [wx, wz] = toWorld(o, u, v + side * (d / 2 + 0.03))
  addOrientedBox(mbGlass, wx, yBase + hgt * 0.55, wz, 0.75, 0.7, 0.06, o.a, new THREE.Color(0x7fb0c8))
}
function mb2quad(mb, a, b, c, d, col) { mb.quad(a, b, c, d, col) }

/** Sokl — tmavší pás kolem paty domu (typické pro české vesnice). */
function addSokl(mbDet, ccwPoly, baseY) {
  const col = new THREE.Color(0x9a938a)
  for (let i = 0; i < ccwPoly.length; i++) {
    const [x0, z0] = ccwPoly[i], [x1, z1] = ccwPoly[(i + 1) % ccwPoly.length]
    const e = outwardNormal(x0, z0, x1, z1)
    if (!e) continue
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2
    addPanel(mbDet, mx, baseY + 0.3, mz, e.tx, e.tz, e.nx, e.nz, e.L + 0.02, 0.6, 0.045, col)
  }
}

// ── zaparkované auto (1 merged geometrie; bílý lak → tint přes instanceColor) ──
function parkedCarGeometry() {
  const sp = new THREE.Shape()
  sp.moveTo(-2.0, 0.28); sp.lineTo(-2.05, 0.62); sp.lineTo(-1.7, 0.8); sp.lineTo(-1.0, 0.82)
  sp.quadraticCurveTo(-0.6, 1.2, -0.05, 1.22); sp.lineTo(0.35, 1.2)
  sp.quadraticCurveTo(0.7, 1.1, 0.95, 0.85); sp.lineTo(1.85, 0.76)
  sp.quadraticCurveTo(2.05, 0.7, 2.05, 0.5); sp.lineTo(2.0, 0.28); sp.lineTo(-2.0, 0.28)
  const body = new THREE.ExtrudeGeometry(sp, { depth: 1.6, curveSegments: 4, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 })
  body.translate(0, 0, -0.8)
  body.rotateY(-Math.PI / 2)
  const parts = [
    paintGeo(body, 0xffffff),
    paintGeo(new THREE.BoxGeometry(1.45, 0.34, 1.7).translate(0, 1.0, -0.15).toNonIndexed(), 0x22323c),
  ]
  for (const [sx, sz] of [[-0.82, 1.25], [0.82, 1.25], [-0.82, -1.25], [0.82, -1.25]]) {
    parts.push(paintGeo(new THREE.TorusGeometry(0.27, 0.115, 8, 14).rotateY(Math.PI / 2).translate(sx, 0.38, sz).toNonIndexed(), 0x17181a))
  }
  return mergeGeometries(parts)
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

export function buildMapCity(scene, textures = null) {
  const half = DATA.half
  const obstacles = []

  // ── terén (reálný výškopis EU-DEM) ──
  const SEG = 500
  const groundGeo = new THREE.PlaneGeometry(half * 2, half * 2, SEG, SEG).rotateX(-Math.PI / 2)
  const gp = groundGeo.attributes.position
  for (let i = 0; i < gp.count; i++) gp.setY(i, heightAt(gp.getX(i), gp.getZ(i)))
  groundGeo.computeVertexNormals()
  const groundMat = new THREE.MeshStandardMaterial({ map: groundTexture(half, textures), roughness: 0.95 })
  if (textures && textures.grassNorTex) {
    // Detail zblízka: barevná mapa má jen ~4 px/m (layout), ale normálová
    // mapa se dlaždicuje NEZÁVISLE (~2.6 m dlaždice) → povrch má strukturu
    // trávy/hlíny i u kola auta, bez obří barevné textury v paměti.
    groundMat.normalMap = textures.grassNorTex
    textures.grassNorTex.repeat.set(Math.round(half * 2 / 2.6), Math.round(half * 2 / 2.6))
    groundMat.normalScale = new THREE.Vector2(0.55, 0.55)
  }
  const ground = new THREE.Mesh(groundGeo, groundMat)
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
  const VW = [ // světlé pastelové fasády (zadání: bílá, žlutá, okrová…)
    0xffffff, 0xfaf5e8, 0xf7eed6, 0xf9ecc4, 0xf5e3ae, 0xefd9a0, // bílá → žlutavá → okr
    0xf5ead8, 0xefe4cc, 0xf8f2e4, 0xf3e8d0, 0xe9efdc, 0xe4ecf0, // krémové + jemná zeleň/modř
  ]
  const VR = [ // zašlé, ale VIDITELNÉ střechy: cihlově červené, hnědé, antracit
    0xc85a3e, 0xbe5238, 0xd06744, 0xb64c34, // cihlově červené (sytější, ať prosvítají)
    0x9a6848, 0x8a5e46, 0x7a5038,           // teplé hnědé
    0x504a44, 0x5c554e, 0x454038,           // tmavý antracit (ne úplně černý)
  ]
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
    const ccw = orientCCW(dedupePoly(b.poly))
    const wc = new THREE.Color(VW[(bi * 7) % VW.length])
    const rc = b.kind === 'spire' ? new THREE.Color(0x585552) : new THREE.Color(VR[(bi * 5) % VR.length])
    // domy (gable) dostávají jeden z 10 archetypů; ostatní (stodoly, haly,
    // kaplička, trafo) zůstávají podle OSM klasifikace
    const ht = b.kind === 'gable' ? HOUSE_TYPES[bi % HOUSE_TYPES.length] : null
    const roofKind = ht ? ht.roof : b.kind
    const roofH = ht ? b.roof * ht.pitch : b.roof
    addWalls(mbWall, ccw, baseY, b.walls, wc)
    addCeiling(mbWall, ccw, baseY + b.walls, wc.clone().multiplyScalar(0.55))
    addRoof(mbRoof, b.obb, baseY + b.walls, roofH, roofKind, rc)
    addFacade(mbDet, mbGlass, ccw, baseY, b.walls, b.kind, bi)
    if (ht) {
      addChimney(mbDet, b.obb, baseY + b.walls, roofH)
      if (ht.chim > 1) addChimney(mbDet, b.obb, baseY + b.walls, roofH)
      if (ht.dormer && roofKind === 'gable') addDormer(mbDet, mbGlass, b.obb, baseY + b.walls, roofH, wc, rc)
      if (ht.sokl) addSokl(mbDet, ccw, baseY)
    }
    if (b.kind === 'spire') addCross(mbDet, b.obb, baseY + b.walls, b.roof)
  })

  // Color mapa = SVĚTLÁ procedurální omítka/tašky (ne tmavá clay fotka —
  // ta × pastelová barva = hnědé domy, přesně to co bylo špatně na fotkách).
  // Reálná fotka se používá jen jako NORMAL mapa (povrchový reliéf), takže
  // fasáda zůstane světlá dle vertex barvy a přitom má realistický detail.
  const wallNor = textures ? textures.plasterNor : null
  if (wallNor) wallNor.repeat.set(1, 1)
  const wallsMesh = new THREE.Mesh(mbWall.geometry(), new THREE.MeshStandardMaterial({
    vertexColors: true, map: plasterTexture(), normalMap: wallNor,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.9, flatShading: false, side: THREE.DoubleSide,
  }))
  const roofMesh = new THREE.Mesh(mbRoof.geometry(), new THREE.MeshStandardMaterial({
    vertexColors: true, map: roofTileTexture(), normalMap: textures ? textures.roofNor : null,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughness: 0.82, flatShading: false, side: THREE.DoubleSide,
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

  // ── živé ploty kolem ~40 % domů: vjezd na straně blíž silnici (ne
  //    natvrdo bi%4), úseky co by zasahovaly do vozovky se nestaví, a
  //    zůstalé úseky dostanou kolizi (obox), aby se plotem nedalo projet ──
  const hb = new MeshBuilder()
  const hedgeCol = new THREE.Color(0x4e8f3e)
  const HEDGE_MARGIN = 1.0 // min. odstup živého plotu od okraje vozovky
  DATA.buildings.forEach((b, bi) => {
    if (b.kind !== 'gable' || (bi % 5) >= 2) return
    const o = b.obb, gap = 3.4, HL = o.L / 2 + gap, HW = o.W / 2 + gap
    const corners = [[-HL, -HW], [HL, -HW], [HL, HW], [-HL, HW]]

    // strana s nejmenší vzdáleností k silnici = vjezd (mezera v plotu)
    let entranceSide = 0, entranceDist = Infinity
    const mids = []
    for (let sIdx = 0; sIdx < 4; sIdx++) {
      const [u0, v0] = corners[sIdx], [u1, v1] = corners[(sIdx + 1) % 4]
      const [x0, z0] = toWorld(o, u0, v0), [x1, z1] = toWorld(o, u1, v1)
      const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2
      mids.push({ x0, z0, x1, z1, mx, mz })
      const d = distToNearestRoad(mx, mz)
      if (d < entranceDist) { entranceDist = d; entranceSide = sIdx }
    }

    for (let sIdx = 0; sIdx < 4; sIdx++) {
      if (sIdx === entranceSide) continue
      const { x0, z0, x1, z1 } = mids[sIdx]
      const segLen = Math.hypot(x1 - x0, z1 - z0)
      const ang = Math.atan2(z1 - z0, x1 - x0)
      // Dřívější kontrola JEN STŘEDU strany nestačila — dlouhá strana mohla
      // mít střed daleko od cesty a konce V cestě. Vzorkuje se po ~2.5 m
      // a staví se jen souvislé běhy kousků, které jsou celé mimo vozovku.
      const n = Math.max(1, Math.ceil(segLen / 2.5))
      let runStart = -1
      const emitRun = (k0, k1) => {
        const t0 = k0 / n, t1 = (k1 + 1) / n
        const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0
        const bx2 = x0 + (x1 - x0) * t1, bz2 = z0 + (z1 - z0) * t1
        const len = Math.hypot(bx2 - ax, bz2 - az)
        if (len < 1.4) return
        const cx2 = (ax + bx2) / 2, cz2 = (az + bz2) / 2
        addOrientedBox(hb, cx2, heightAt(cx2, cz2) + 0.55, cz2, len, 1.1, 0.5, ang, hedgeCol)
        obstacles.push({ type: 'obox', x: cx2, z: cz2, hw: len / 2, hd: 0.35, a: ang })
      }
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n
        const px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t
        if (distToNearestRoad(px, pz) >= HEDGE_MARGIN) {
          if (runStart < 0) runStart = k
        } else if (runStart >= 0) { emitRun(runStart, k - 1); runStart = -1 }
      }
      if (runStart >= 0) emitRun(runStart, n - 1)
    }
  })
  if (hb.triCount) {
    const hm = new THREE.Mesh(hb.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }))
    hm.castShadow = true; scene.add(hm)
  }

  // ── vegetace: stromy (les/remízky/meze/sady) + keře. Kmen/keř má malou
  //    kolizní kružnici (spatial hash drží fyziku levnou i s tisíci kusy).
  //    Tráva zůstává bez kolizí (projíždí se skrz, jen vizuál). Vše na terénu.
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

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3()
  // 5 variant billboardů (3 listnaté + 2 smrky), sdílená cross-geometrie,
  // materiál s alfa ořezem (alphaTest) — žádné řazení průhlednosti.
  const crossGeo = treeCrossGeometry()
  const variants = [
    { kind: 'decid', h: 6.5, spots: [] }, { kind: 'decid', h: 7.5, spots: [] },
    { kind: 'decid', h: 5.8, spots: [] }, { kind: 'spruce', h: 7.0, spots: [] },
    { kind: 'spruce', h: 8.5, spots: [] },
  ]
  variants.forEach((v, vi) => {
    v.mat = new THREE.MeshStandardMaterial({
      map: treeTexture(v.kind, vi + 1), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95,
    })
  })
  trees.forEach((t, i) => {
    variants[t[2] >= 0.45 ? i % 3 : 3 + (i % 2)].spots.push(t)
  })
  for (const v of variants) {
    if (!v.spots.length) continue
    const inst = new THREE.InstancedMesh(crossGeo, v.mat, v.spots.length)
    inst.castShadow = false // billboard by vrhal čtvercový stín (alfa se do stínové mapy nepromítne)
    inst.frustumCulled = false // pojistka proti mizení skupin
    v.spots.forEach(([x, z], i) => {
      const s = 0.8 + Math.random() * 0.5
      const height = v.h * s
      const width = height * (v.kind === 'spruce' ? 0.5 : 0.72)
      const rotY = Math.random() * Math.PI * 2
      const y = heightAt(x, z) - 0.15
      sc.set(width, height, width)
      q.setFromAxisAngle(up, rotY)
      m4.compose(new THREE.Vector3(x, y, z), q, sc)
      inst.setMatrixAt(i, m4)
      // menší stromky jdou přerazit — ref pro animaci pádu
      obstacles.push({
        x, z, r: 0.3 + 0.12 * s, type: 'circle',
        breakable: s < 1.05,
        ref: { inst, index: i, x, y, z, rotY, sx: width, sy: height },
      })
    })
    inst.computeBoundingSphere()
    scene.add(inst)
  }

  // keře (rozptýlené mimo budovy)
  const bushGeo = (() => {
    const a = new THREE.IcosahedronGeometry(0.65, 1); a.scale(1.1, 0.72, 1.1)
    const b = new THREE.IcosahedronGeometry(0.5, 1); b.scale(1, 0.7, 1); b.translate(0.45, 0.15, 0.1)
    return mergeSimple([paintGeo(a, 0x3c7a30), paintGeo(b, 0x4a8c3a)])
  })()
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
      // keře bez kolize — auto je přejede (zadání: "přejet nebo lehce nadskočit")
    })
    bi.frustumCulled = false
    bi.computeBoundingSphere()
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
    gi.frustumCulled = false
    gi.computeBoundingSphere()
    scene.add(gi)
  }
  const grassCount = grass.length

  // ── zaparkovaná auta u silnic (oživení vsi) ──
  const parkedSpots = []
  for (const r of DATA.roads) {
    if (!['residential', 'service'].includes(r.kind)) continue
    for (let i = 0; i < r.pts.length - 1 && parkedSpots.length < 12; i++) {
      const [x0, z0] = r.pts[i], [x1, z1] = r.pts[i + 1]
      const segLen = Math.hypot(x1 - x0, z1 - z0)
      if (segLen < 22 || Math.random() < 0.5) continue
      const t = 0.3 + Math.random() * 0.4
      const dx = (x1 - x0) / segLen, dz = (z1 - z0) / segLen
      const side = Math.random() < 0.5 ? 1 : -1
      const off = r.w / 2 + 1.0
      const px = x0 + (x1 - x0) * t + dz * side * off
      const pz = z0 + (z1 - z0) * t - dx * side * off
      if (Math.abs(px) > half - 6 || Math.abs(pz) > half - 6) continue
      const yaw = Math.atan2(dx, dz)
      parkedSpots.push({ x: px, z: pz, yaw })
    }
  }
  if (parkedSpots.length) {
    const PARKED_COLORS = [0xf2f2f2, 0xc9d6e2, 0xd8dfd2, 0xdccfc0, 0x9fb4c8, 0xb84a3a, 0x39506b, 0x6b7a5a, 0x4a4a52, 0xd9c46a]
    const pInst = new THREE.InstancedMesh(
      parkedCarGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.45, roughness: 0.45 }),
      parkedSpots.length,
    )
    pInst.castShadow = true
    pInst.frustumCulled = false
    parkedSpots.forEach((p, i) => {
      q.setFromAxisAngle(up, p.yaw)
      sc.set(1, 1, 1)
      m4.compose(new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z), q, sc)
      pInst.setMatrixAt(i, m4)
      pInst.setColorAt(i, new THREE.Color(PARKED_COLORS[i % PARKED_COLORS.length]))
      // obox: úhel osy délky vůči +x (u-vektor (cos a, sin a) = směr jízdy (sin yaw, cos yaw))
      obstacles.push({ type: 'obox', x: p.x, z: p.z, hw: 2.3, hd: 1.0, a: Math.PI / 2 - p.yaw })
    })
    pInst.computeBoundingSphere()
    scene.add(pInst)
  }

  const roadsForSpawn = DATA.roads.filter(r => ['residential', 'tertiary', 'service'].includes(r.kind) && r.pts.length >= 2)
  const obstacleHash = buildSpatialHash(obstacles, 30) // po posledním obstacles.push()
  const city = {
    half,
    heightAt,
    place: DATA.place,
    obstacles,
    obstacleHash,
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

  // hash omezí kontrolu jen na překážky v okolí auta (buňka 30 m + sousedi) —
  // bez toho by se u tisíců stromů/keřů muselo procházet celé pole každý snímek
  const nearbyIdx = city.obstacleHash ? queryNearby(city.obstacleHash, car.pos.x, car.pos.z) : city.obstacles.map((_, i) => i)
  for (const idx of nearbyIdx) {
    const o = city.obstacles[idx]
    if (o.dead) continue // přeražený stromek už nekolidí
    if (o.type === 'circle') {
      const dx = car.pos.x - o.x, dz = car.pos.z - o.z
      const dist = Math.hypot(dx, dz)
      const minDist = carRadius + o.r
      if (dist < minDist && dist > 1e-4) {
        const nx = dx / dist, nz = dz / dist, push = minDist - dist
        // událost PŘED úpravou rychlosti (nárazová rychlost do překážky)
        if (city.collisionEvents) {
          const vn = car.vel.x * nx + car.vel.z * nz
          if (vn < -0.5) city.collisionEvents.push({ o, impact: -vn, dirX: car.vel.x, dirZ: car.vel.z, car })
        }
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
