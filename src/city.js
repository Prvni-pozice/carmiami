// city.js — malé Miami s terénem: zvlněné kopce (analytická heightmapa —
// ulice jedou z kopce/do kopce), pastelové budovy TŘÍ tvarů (stupňovité
// art-deco věže, válcové věže, pootočené bloky) — nic není striktně
// ortogonální. Parky, klimatizace na střechách, neony, palmy, lampy,
// pláž + oceán na východě. Exportuje heightAt() a resolveCollisions().
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export const HALF = 120
const STREETS = [-80, -40, 0, 40, 80]
const ROAD_HALF = 6
const SIDEWALK = 2.5
const BEACH_X = 92

// sytější Miami art-deco paleta + kontrastní akcenty (pásy na fasádách)
const PASTELS = [0x40d5c8, 0xff8f6b, 0xf9a8c9, 0xffe084, 0xc3a8f0, 0xf7f3ea, 0x8fd6f0, 0xa8e6b0]
const ACCENTS = [0xff5fa2, 0x2ec4b6, 0xffffff, 0xff8f6b, 0xffe084, 0x40d5c8, 0xff5fa2, 0xf7f3ea]

// ── terén ──
function sstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** Výška terénu. Klesá k 0 u pláže (x→95), aby oceán zůstal na místě. */
export function heightAt(x, z) {
  const shore = 1 - sstep(55, 95, x)
  let h = 3.4 * Math.sin(x * 0.026 + 1.3) * Math.cos(z * 0.022 + 0.7)
        + 2.1 * Math.sin(x * 0.045 - 0.5) * Math.sin(z * 0.038 + 2.1)
        + 0.9 * Math.cos(x * 0.083 + 0.4) * Math.sin(z * 0.091 - 1.2)
  return h * shore
}

function paintGeo(geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

// ── ground textura ──
function groundTexture(parks, spans) {
  const N = 2048
  const px = N / (HALF * 2)
  const X = m => (m + HALF) * px
  const c = document.createElement('canvas')
  c.width = c.height = N
  const g = c.getContext('2d')

  g.fillStyle = '#b3a894'; g.fillRect(0, 0, N, N)
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(${160 + Math.random() * 30 | 0},${150 + Math.random() * 25 | 0},${135 + Math.random() * 20 | 0},0.5)`
    g.fillRect(Math.random() * N, Math.random() * N, 300 * Math.random(), 300 * Math.random())
  }
  // parky — zelené bloky
  for (const [ix, iz] of parks) {
    const [x0, x1] = spans[ix], [z0, z1] = spans[iz]
    g.fillStyle = '#7fae6a'
    g.fillRect(X(x0) - 4, X(z0) - 4, (x1 - x0) * px + 8, (z1 - z0) * px + 8)
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(${80 + Math.random() * 40 | 0},${130 + Math.random() * 40 | 0},${70 + Math.random() * 30 | 0},0.5)`
      g.beginPath()
      g.ellipse(X(x0 + Math.random() * (x1 - x0)), X(z0 + Math.random() * (z1 - z0)),
        30 * Math.random() + 8, 30 * Math.random() + 8, 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  // pláž
  g.fillStyle = '#e8d5a8'; g.fillRect(X(BEACH_X), 0, N - X(BEACH_X), N)
  g.fillStyle = '#f0e0b8'; g.fillRect(X(BEACH_X + 12), 0, N - X(BEACH_X + 12), N)
  const wet = g.createLinearGradient(X(112), 0, X(HALF), 0)
  wet.addColorStop(0, 'rgba(217,194,144,0)')
  wet.addColorStop(1, 'rgba(190,168,120,0.9)')
  g.fillStyle = wet; g.fillRect(X(112), 0, N - X(112), N)

  const roadW = ROAD_HALF * 2 * px
  const sideW = (ROAD_HALF + SIDEWALK) * 2 * px
  for (const s of STREETS) {
    g.fillStyle = '#a8a29a'
    g.fillRect(X(s) - sideW / 2, 0, sideW, N)
    g.fillRect(0, X(s) - sideW / 2, N, sideW)
  }
  // obrubníky
  g.strokeStyle = '#6a655c'; g.lineWidth = 2
  for (const s of STREETS) {
    for (const off of [-roadW / 2, roadW / 2]) {
      g.beginPath(); g.moveTo(X(s) + off, 0); g.lineTo(X(s) + off, N); g.stroke()
      g.beginPath(); g.moveTo(0, X(s) + off); g.lineTo(N, X(s) + off); g.stroke()
    }
  }
  for (const s of STREETS) {
    g.fillStyle = '#35353b'
    g.fillRect(X(s) - roadW / 2, 0, roadW, N)
    g.fillRect(0, X(s) - roadW / 2, N, roadW)
  }
  // vyjeté pruhy + skvrny na asfaltu
  g.fillStyle = 'rgba(80,80,86,0.35)'
  for (const s of STREETS) {
    for (const off of [-2.9, 2.9]) {
      g.fillRect(X(s) + off * px - 0.7 * px, 0, 1.4 * px, N)
      g.fillRect(0, X(s) + off * px - 0.7 * px, N, 1.4 * px)
    }
  }
  for (const s of STREETS) {
    for (let i = 0; i < 45; i++) {
      g.fillStyle = `rgba(0,0,0,${0.05 + Math.random() * 0.09})`
      g.beginPath()
      const along = Math.random() * N
      const across = (Math.random() - 0.5) * roadW * 0.8
      const rw = (2 + Math.random() * 6) * px, rh = (1 + Math.random() * 3) * px
      if (Math.random() < 0.5) g.ellipse(X(s) + across, along, rh, rw, 0, 0, Math.PI * 2)
      else g.ellipse(along, X(s) + across, rw, rh, 0, 0, Math.PI * 2)
      g.fill()
    }
  }
  // středové čáry
  g.strokeStyle = '#e8c840'; g.lineWidth = 0.35 * px; g.setLineDash([3.5 * px, 3 * px])
  for (const s of STREETS) {
    g.beginPath(); g.moveTo(X(s), 0); g.lineTo(X(s), N); g.stroke()
    g.beginPath(); g.moveTo(0, X(s)); g.lineTo(N, X(s)); g.stroke()
  }
  g.setLineDash([])
  // přechody
  g.fillStyle = 'rgba(232,230,225,0.85)'
  for (const sx of STREETS) for (const sz of STREETS) {
    for (let i = -2; i <= 2; i++) {
      const w = 0.55 * px, gap = 1.05 * px
      g.fillRect(X(sx) + i * gap - w / 2, X(sz) - (ROAD_HALF + 2.4) * px, w, 2 * px)
      g.fillRect(X(sx) - (ROAD_HALF + 2.4) * px, X(sz) + i * gap - w / 2, 2 * px, w)
    }
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 8
  return tex
}

// ── fasáda: 2 osy × 2 patra, akcentní pásy, náhodně rozsvícená okna ──
function facadeTexture(baseHex, accentHex, arched) {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const g = c.getContext('2d')
  const base = new THREE.Color(baseHex)
  const accent = new THREE.Color(accentHex)
  g.fillStyle = `rgb(${base.r * 255 | 0},${base.g * 255 | 0},${base.b * 255 | 0})`
  g.fillRect(0, 0, 256, 256)
  // art-deco akcentní pásy na úrovni pater
  g.fillStyle = `rgba(${accent.r * 255 | 0},${accent.g * 255 | 0},${accent.b * 255 | 0},0.9)`
  for (const fy of [0, 1]) {
    g.fillRect(0, fy * 128 + 4, 256, 5)
    g.fillRect(0, fy * 128 + 12, 256, 2)
  }
  for (const fy of [0, 1]) {
    g.fillStyle = 'rgba(0,0,0,0.08)'
    g.fillRect(0, fy * 128 + 120, 256, 8)
    for (const fx of [0, 1]) {
      const ox = fx * 128, oy = fy * 128
      g.fillStyle = 'rgba(255,255,255,0.35)'
      g.fillRect(ox + 26, oy + 20, 76, 88)
      const grad = g.createLinearGradient(0, oy + 24, 0, oy + 104)
      grad.addColorStop(0, '#ffd9a8')
      grad.addColorStop(0.35, '#c97f8e')
      grad.addColorStop(1, '#1e3a5f')
      g.fillStyle = grad
      if (arched) {
        g.beginPath()
        g.moveTo(ox + 30, oy + 104); g.lineTo(ox + 30, oy + 52)
        g.arc(ox + 64, oy + 52, 34, Math.PI, 0)
        g.lineTo(ox + 98, oy + 104); g.closePath(); g.fill()
      } else {
        g.fillRect(ox + 30, oy + 24, 68, 80)
      }
      if (Math.random() < 0.3) { // rozsvícené okno
        g.fillStyle = `rgba(255,214,140,${0.35 + Math.random() * 0.4})`
        g.fillRect(ox + 30, oy + 24, 68, 80)
      }
      g.strokeStyle = 'rgba(30,40,60,0.55)'; g.lineWidth = 2
      g.beginPath(); g.moveTo(ox + 64, oy + 24); g.lineTo(ox + 64, oy + 104); g.stroke()
    }
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

// pruhovaná textura pro markýzy
function stripeTexture(hex1, hex2) {
  const c = document.createElement('canvas')
  c.width = 128; c.height = 32
  const g = c.getContext('2d')
  const c1 = new THREE.Color(hex1), c2 = new THREE.Color(hex2)
  for (let i = 0; i < 8; i++) {
    const col = i % 2 ? c2 : c1
    g.fillStyle = `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`
    g.fillRect(i * 16, 0, 16, 32)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  return tex
}

// billboard s nápisem
function adTexture(text, hex1, hex2) {
  const c = document.createElement('canvas')
  c.width = 512; c.height = 256
  const g = c.getContext('2d')
  const c1 = new THREE.Color(hex1), c2 = new THREE.Color(hex2)
  const grad = g.createLinearGradient(0, 0, 512, 256)
  grad.addColorStop(0, `rgb(${c1.r * 255 | 0},${c1.g * 255 | 0},${c1.b * 255 | 0})`)
  grad.addColorStop(1, `rgb(${c2.r * 255 | 0},${c2.g * 255 | 0},${c2.b * 255 | 0})`)
  g.fillStyle = grad
  g.fillRect(0, 0, 512, 256)
  g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 10
  g.strokeRect(12, 12, 488, 232)
  g.fillStyle = '#fff'
  g.font = 'bold 72px sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = 12
  g.fillText(text, 256, 128)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

// zjednodušený profil auta pro zaparkovaná auta (1 geometrie, vertex colors)
function parkedCarGeometry() {
  const s = new THREE.Shape()
  s.moveTo(-2.0, 0.28); s.lineTo(-2.05, 0.62); s.lineTo(-1.7, 0.8); s.lineTo(-1.0, 0.82)
  s.quadraticCurveTo(-0.6, 1.2, -0.05, 1.22); s.lineTo(0.35, 1.2)
  s.quadraticCurveTo(0.7, 1.1, 0.95, 0.85); s.lineTo(1.85, 0.76)
  s.quadraticCurveTo(2.05, 0.7, 2.05, 0.5); s.lineTo(2.0, 0.28); s.lineTo(-2.0, 0.28)
  const body = new THREE.ExtrudeGeometry(s, { depth: 1.6, curveSegments: 4, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2 })
  body.translate(0, 0, -0.8)
  body.rotateY(-Math.PI / 2)
  // ExtrudeGeometry je non-indexed — ostatní části srovnat přes toNonIndexed()
  const parts = [
    paintGeo(body, 0xffffff), // bílá → tintovatelná přes instanceColor
    paintGeo(new THREE.BoxGeometry(1.5, 0.34, 1.7).translate(0, 1.0, -0.15).toNonIndexed(), 0x20303c),
  ]
  for (const [sx, sz] of [[-0.85, 1.25], [0.85, 1.25], [-0.85, -1.25], [0.85, -1.25]]) {
    parts.push(paintGeo(new THREE.TorusGeometry(0.28, 0.12, 8, 14).rotateY(Math.PI / 2).translate(sx, 0.4, sz).toNonIndexed(), 0x141416))
  }
  return mergeGeometries(parts)
}

// plážový slunečník (tyč + vrchlík)
function umbrellaGeometry() {
  return mergeGeometries([
    paintGeo(new THREE.CylinderGeometry(0.035, 0.045, 1.7, 6).translate(0, 0.85, 0), 0xdad5cc),
    paintGeo(new THREE.ConeGeometry(1.25, 0.55, 18).translate(0, 1.75, 0), 0xffffff),
  ])
}

// ── mobiliář (vše merged geometrie → InstancedMesh) ──
function trafficLightGeometry() {
  return mergeGeometries([
    paintGeo(new THREE.CylinderGeometry(0.09, 0.11, 5.6, 8).translate(0, 2.8, 0), 0x3a3a40),
    paintGeo(new THREE.BoxGeometry(2.3, 0.12, 0.12).translate(1.05, 5.45, 0), 0x3a3a40),
    paintGeo(new THREE.BoxGeometry(0.34, 0.95, 0.3).translate(2.0, 4.95, 0), 0x22262a),
  ])
}
function signGeometry() {
  return mergeGeometries([
    paintGeo(new THREE.CylinderGeometry(0.045, 0.05, 2.6, 6).translate(0, 1.3, 0), 0x8a8f94),
    paintGeo(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 12).rotateX(Math.PI / 2).translate(0, 2.35, 0), 0xf0ece4),
  ])
}
function benchGeometry() {
  return mergeGeometries([
    paintGeo(new THREE.BoxGeometry(1.6, 0.07, 0.42).translate(0, 0.45, 0), 0x9a7550),
    paintGeo(new THREE.BoxGeometry(1.6, 0.4, 0.07).translate(0, 0.72, -0.2), 0x9a7550),
    paintGeo(new THREE.BoxGeometry(0.07, 0.45, 0.4).translate(-0.7, 0.22, 0), 0x3a3a3e),
    paintGeo(new THREE.BoxGeometry(0.07, 0.45, 0.4).translate(0.7, 0.22, 0), 0x3a3a3e),
  ])
}
function trashGeometry() {
  return mergeGeometries([
    paintGeo(new THREE.CylinderGeometry(0.24, 0.2, 0.72, 10).translate(0, 0.36, 0), 0x2f4a3c),
    paintGeo(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 10).translate(0, 0.74, 0), 0x243a30),
  ])
}
function hydrantGeometry() {
  return mergeGeometries([
    paintGeo(new THREE.CapsuleGeometry(0.13, 0.34, 3, 8).translate(0, 0.34, 0), 0xd8384a),
    paintGeo(new THREE.CylinderGeometry(0.07, 0.07, 0.34, 6).rotateZ(Math.PI / 2).translate(0, 0.38, 0), 0xd8384a),
  ])
}
function bushGeometry() {
  const blob = h => {
    const g = new THREE.IcosahedronGeometry(0.55, 2)
    g.scale(1, 0.72, 1)
    return paintGeo(g, h)
  }
  const a = blob(0x3e7d3a); a.translate(0, 0.38, 0)
  const b = blob(0x4c9142); b.scale(0.7, 0.7, 0.7); b.translate(0.4, 0.32, 0.15)
  return mergeGeometries([a, b])
}
function balconyGeometry() {
  return mergeGeometries([
    paintGeo(new THREE.BoxGeometry(2.0, 0.12, 0.85).translate(0, 0, 0.42), 0xf5f0e8),
    paintGeo(new THREE.BoxGeometry(2.0, 0.5, 0.06).translate(0, 0.3, 0.85), 0xf5f0e8),
    paintGeo(new THREE.BoxGeometry(0.06, 0.5, 0.8).translate(-0.98, 0.3, 0.45), 0xf5f0e8),
    paintGeo(new THREE.BoxGeometry(0.06, 0.5, 0.8).translate(0.98, 0.3, 0.45), 0xf5f0e8),
  ])
}

function palmGeometry() {
  const parts = []
  let ox = 0
  const SEG = 5, H = 5.2
  for (let i = 0; i < SEG; i++) {
    const h = H / SEG
    const geo = new THREE.CylinderGeometry(0.14 - i * 0.012, 0.17 - i * 0.012, h, 10)
    ox += (i / SEG) * 0.22
    geo.translate(ox, h / 2 + i * h, 0)
    geo.rotateY(Math.random())
    parts.push(paintGeo(geo, i % 2 ? 0x8a6a4a : 0x7d5f42))
  }
  for (let i = 0; i < 10; i++) {
    const leaf = new THREE.PlaneGeometry(0.5, 2.6, 2, 8)
    const pos = leaf.attributes.position
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v)
      const t = (y + 1.3) / 2.6
      pos.setZ(v, -1.1 * t * t)
      pos.setX(v, pos.getX(v) * (1 - t * 0.7))
    }
    leaf.rotateX(-1.15)
    leaf.translate(0, 0, 1.0)
    leaf.rotateY((i / 10) * Math.PI * 2 + Math.random() * 0.4)
    leaf.translate(ox, H, 0)
    parts.push(paintGeo(leaf, i % 2 ? 0x3e7d3a : 0x4c9142))
  }
  return mergeGeometries(parts)
}

function lampGeometry() {
  const pole = new THREE.CylinderGeometry(0.07, 0.09, 4.4, 6)
  pole.translate(0, 2.2, 0)
  const arm = new THREE.BoxGeometry(1.3, 0.08, 0.08)
  arm.translate(0.6, 4.35, 0)
  return mergeGeometries([paintGeo(pole, 0x4a4a50), paintGeo(arm, 0x4a4a50)])
}

// sdílená kontrola volné pozice (pro keře i city.randomFreePos)
function city_randomFree(obstacles, margin) {
  for (let i = 0; i < 60; i++) {
    const x = (Math.random() * 2 - 1) * (HALF - margin - 2)
    const z = (Math.random() * 2 - 1) * (HALF - margin - 2)
    let free = true
    for (const o of obstacles) {
      if (o.type === 'box') {
        if (Math.abs(x - o.x) < o.hw + margin && Math.abs(z - o.z) < o.hd + margin) { free = false; break }
      } else if (Math.hypot(x - o.x, z - o.z) < o.r + margin) { free = false; break }
    }
    if (free) return { x, z }
  }
  return { x: 0, z: -20 }
}

export function buildCity(scene) {
  const obstacles = []
  const m4 = new THREE.Matrix4()

  // bloky
  const edges = STREETS.map(s => [s - ROAD_HALF - SIDEWALK, s + ROAD_HALF + SIDEWALK]).flat()
  const bounds = [-HALF + 4, ...edges, HALF - 4]
  const spans = []
  for (let i = 0; i < bounds.length - 1; i += 2) spans.push([bounds[i], bounds[i + 1]])

  // 2 parky (ne u pláže)
  const parks = []
  while (parks.length < 2) {
    const ix = Math.floor(Math.random() * spans.length)
    const iz = Math.floor(Math.random() * spans.length)
    const cx = (spans[ix][0] + spans[ix][1]) / 2
    if (cx > BEACH_X - 20) continue
    if (parks.some(([a, b]) => a === ix && b === iz)) continue
    parks.push([ix, iz])
  }

  // ground s terénem
  const groundGeo = new THREE.PlaneGeometry(HALF * 2, HALF * 2, 200, 200)
  groundGeo.rotateX(-Math.PI / 2)
  const gpos = groundGeo.attributes.position
  for (let i = 0; i < gpos.count; i++) {
    gpos.setY(i, heightAt(gpos.getX(i), gpos.getZ(i)))
  }
  groundGeo.computeVertexNormals()
  const ground = new THREE.Mesh(
    groundGeo,
    new THREE.MeshStandardMaterial({ map: groundTexture(parks, spans), roughness: 0.94 }),
  )
  ground.receiveShadow = true
  scene.add(ground)

  // ── budovy ──
  const facades = PASTELS.map((p, i) => facadeTexture(p, ACCENTS[i], i % 3 === 0))
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x9a9088, roughness: 0.9 })
  const neonParts = { pink: [], teal: [] }
  const roofClutter = []
  const tallBuildings = []              // pro billboardy
  const awningParts = [[], []]          // 2 barevné varianty markýz
  const glassParts = []                 // výlohy v přízemí
  const doorParts = []                  // barevné dveře
  const balconySpots = []               // {x,y,z,rot} instancované balkony

  function wallMatFor(fi, w, h) {
    const tex = facades[fi].clone()
    tex.needsUpdate = true
    tex.repeat.set(Math.max(1, Math.round(w / 7.2)), Math.max(1, Math.round(h / 6.8)))
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 })
  }

  for (let ix = 0; ix < spans.length; ix++) {
    for (let iz = 0; iz < spans.length; iz++) {
      if (parks.some(([a, b]) => a === ix && b === iz)) continue
      const [x0, x1] = spans[ix], [z0, z1] = spans[iz]
      const cx = (x0 + x1) / 2
      if (cx > BEACH_X - 8) continue
      const lots = Math.random() < 0.45 ? 1 : 2
      for (let l = 0; l < lots; l++) {
        const lw = (x1 - x0) - 5
        const ld = ((z1 - z0) / lots) - 5
        if (lw < 8 || ld < 8) continue
        const w = lw * (0.65 + Math.random() * 0.3)
        const d = ld * (0.65 + Math.random() * 0.3)
        const h = 9 + Math.random() * 30
        const bx = cx + (Math.random() - 0.5) * (lw - w)
        const bz = z0 + 2.5 + ld * l + ld / 2 + (Math.random() - 0.5) * (ld - d)
        const hb = heightAt(bx, bz)
        const fi = Math.floor(Math.random() * facades.length)
        const style = Math.random()

        if (style < 0.22 && Math.min(w, d) > 9) {
          // válcová věž
          const r = Math.min(w, d) / 2
          const geo = new THREE.CylinderGeometry(r, r, h + 4, 28)
          const side = wallMatFor(fi, 2 * Math.PI * r, h)
          const mesh = new THREE.Mesh(geo, [side, roofMat, roofMat])
          mesh.position.set(bx, hb + (h + 4) / 2 - 4, bz)
          mesh.castShadow = true; mesh.receiveShadow = true
          scene.add(mesh)
          obstacles.push({ x: bx, z: bz, r, type: 'circle' })
          if (h > 22 && Math.random() < 0.6) {
            const ring = new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.22, 20, 1, true)
            ring.translate(bx, hb + h - 2.5, bz)
            neonParts[Math.random() < 0.5 ? 'pink' : 'teal'].push(ring)
          }
          roofClutter.push(paintGeo(
            new THREE.BoxGeometry(1.6, 1.0, 2.0).translate(bx + (Math.random() - 0.5) * r, hb + h + 0.5, bz + (Math.random() - 0.5) * r), 0x8f8a84))
        } else if (style < 0.62) {
          // stupňovitá art-deco věž (2–3 stupně)
          const tiers = h > 22 ? 3 : 2
          const fractions = tiers === 3 ? [0.55, 0.3, 0.15] : [0.65, 0.35]
          const shrink = tiers === 3 ? [1, 0.72, 0.5] : [1, 0.66]
          let yBase = hb - 4
          let firstH = 0
          for (let t = 0; t < tiers; t++) {
            const th = (h + 4) * fractions[t]
            const tw = w * shrink[t], td = d * shrink[t]
            const mesh = new THREE.Mesh(
              new THREE.BoxGeometry(tw, th, td),
              [wallMatFor(fi, tw, th), wallMatFor(fi, tw, th), roofMat, roofMat, wallMatFor(fi, td, th), wallMatFor(fi, td, th)],
            )
            mesh.position.set(bx, yBase + th / 2, bz)
            mesh.castShadow = true; mesh.receiveShadow = true
            scene.add(mesh)
            roofClutter.push(paintGeo(
              new THREE.BoxGeometry(tw + 0.55, 0.22, td + 0.55).translate(bx, yBase + th + 0.05, bz), 0xa39a90))
            if (t === 0) firstH = th
            yBase += th
          }
          obstacles.push({ x: bx, z: bz, hw: w / 2, hd: d / 2, type: 'box' })
          if (h > 26) tallBuildings.push({ x: bx, z: bz, top: hb + h })
          // markýzy nad výlohami v přízemí
          if (Math.random() < 0.6) {
            for (const side of [-1, 1]) {
              awningParts[Math.floor(Math.random() * 2)].push(
                new THREE.BoxGeometry(w * 0.5, 0.06, 1.05)
                  .rotateX(side * 0.42)
                  .translate(bx, hb + 3.0, bz + side * (d / 2 + 0.42)),
              )
            }
          }
          // výlohy s dveřmi v přízemí
          for (const side of [-1, 1]) {
            glassParts.push(new THREE.BoxGeometry(w * 0.68, 2.2, 0.14)
              .translate(bx - w * 0.08, hb + 1.25, bz + side * (d / 2 + 0.08)))
            doorParts.push(paintGeo(
              new THREE.BoxGeometry(1.05, 2.3, 0.16)
                .translate(bx + w * 0.32, hb + 1.15, bz + side * (d / 2 + 0.1)),
              ACCENTS[Math.floor(Math.random() * ACCENTS.length)]))
          }
          // balkony (sloupec na náhodné straně)
          if (h > 14 && Math.random() < 0.7) {
            const side = Math.random() < 0.5 ? -1 : 1
            const offX = (Math.random() - 0.5) * w * 0.35
            const floors = Math.min(6, Math.floor(firstH / 3.4))
            for (let f = 1; f < floors; f++) {
              balconySpots.push({
                x: bx + offX, y: hb + f * 3.4 + 0.5,
                z: bz + side * (d / 2 + 0.02),
                rot: side > 0 ? 0 : Math.PI,
              })
            }
          }
          if (h > 24 && Math.random() < 0.65) {
            const y = hb + firstH - 4.5
            const t2 = 0.22
            neonParts[Math.random() < 0.5 ? 'pink' : 'teal'].push(
              new THREE.BoxGeometry(w + 0.15, t2, t2).translate(bx, y, bz - d / 2 - 0.1),
              new THREE.BoxGeometry(w + 0.15, t2, t2).translate(bx, y, bz + d / 2 + 0.1),
              new THREE.BoxGeometry(t2, t2, d + 0.15).translate(bx - w / 2 - 0.1, y, bz),
              new THREE.BoxGeometry(t2, t2, d + 0.15).translate(bx + w / 2 + 0.1, y, bz),
            )
          }
          roofClutter.push(paintGeo(
            new THREE.BoxGeometry(1.4, 0.9, 1.8).translate(bx, hb + h + 0.45, bz), 0x8f8a84))
        } else {
          // pootočený blok (±8°) — rozbíjí ortogonalitu
          const a = (Math.random() - 0.5) * 0.28
          const geo = new THREE.BoxGeometry(w, h + 4, d)
          geo.rotateY(a)
          geo.translate(bx, hb + (h + 4) / 2 - 4, bz)
          const wall = wallMatFor(fi, w, h)
          const mesh = new THREE.Mesh(geo, [wall, wall, roofMat, roofMat, wall, wall])
          mesh.castShadow = true; mesh.receiveShadow = true
          scene.add(mesh)
          const hwEff = (w / 2) * Math.abs(Math.cos(a)) + (d / 2) * Math.abs(Math.sin(a))
          const hdEff = (w / 2) * Math.abs(Math.sin(a)) + (d / 2) * Math.abs(Math.cos(a))
          obstacles.push({ x: bx, z: bz, hw: hwEff, hd: hdEff, type: 'box' })
          if (Math.random() < 0.5) {
            roofClutter.push(paintGeo(
              new THREE.BoxGeometry(1.5, 1.0, 2.0).rotateY(a).translate(bx, hb + h + 0.5, bz), 0x8f8a84))
          }
        }
      }
    }
  }

  if (roofClutter.length) {
    const mesh = new THREE.Mesh(
      mergeGeometries(roofClutter),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
    )
    mesh.castShadow = true
    scene.add(mesh)
  }

  for (const [key, colorHex, emiss] of [['pink', 0xff4fa3, 0xff2f92], ['teal', 0x2ee6d6, 0x18d6c4]]) {
    if (!neonParts[key].length) continue
    const geo = mergeGeometries(neonParts[key])
    const mat = new THREE.MeshStandardMaterial({
      color: colorHex, emissive: emiss, emissiveIntensity: 2.2, roughness: 0.4, side: THREE.DoubleSide,
    })
    scene.add(new THREE.Mesh(geo, mat))
  }

  // markýzy (pruhované, 2 barevné varianty)
  const awningColors = [[0xd8384a, 0xf5f0e8], [0x1fa8a0, 0xf5f0e8]]
  awningParts.forEach((parts, i) => {
    if (!parts.length) return
    const mesh = new THREE.Mesh(
      mergeGeometries(parts),
      new THREE.MeshStandardMaterial({ map: stripeTexture(awningColors[i][0], awningColors[i][1]), roughness: 0.8, side: THREE.DoubleSide }),
    )
    mesh.castShadow = true
    scene.add(mesh)
  })

  // ── billboardy na střechách ──
  const ADS = ['MIAMI!', 'OCEAN DRIVE', 'NEON CLUB', 'SUNSET MOTEL', 'COCKTAILS']
  const adGrads = [[0xff5fa2, 0x7b2f8e], [0x2ee6d6, 0x1a4a8e], [0xffb347, 0xd8384a], [0x8fd6f0, 0x2f4a8e], [0xffe084, 0xff8f6b]]
  tallBuildings.sort(() => Math.random() - 0.5)
  tallBuildings.slice(0, 5).forEach((b, i) => {
    const group = new THREE.Group()
    const poles = new THREE.Mesh(
      mergeGeometries([
        new THREE.BoxGeometry(0.16, 3.2, 0.16).translate(-2.6, 1.6, 0),
        new THREE.BoxGeometry(0.16, 3.2, 0.16).translate(2.6, 1.6, 0),
      ]),
      new THREE.MeshStandardMaterial({ color: 0x4a4a50, roughness: 0.7 }),
    )
    const panel = new THREE.Mesh(
      new THREE.PlaneGeometry(7, 3.4),
      new THREE.MeshStandardMaterial({
        map: adTexture(ADS[i], adGrads[i][0], adGrads[i][1]),
        emissive: 0xffffff, emissiveMap: adTexture(ADS[i], adGrads[i][0], adGrads[i][1]),
        emissiveIntensity: 0.55, side: THREE.DoubleSide, roughness: 0.6,
      }),
    )
    panel.position.y = 3.4
    group.add(poles, panel)
    group.position.set(b.x, b.top, b.z)
    group.rotation.y = Math.random() * Math.PI
    scene.add(group)
  })

  // výlohy (sklo) + dveře
  if (glassParts.length) {
    scene.add(new THREE.Mesh(
      mergeGeometries(glassParts),
      new THREE.MeshPhysicalMaterial({ color: 0x1a3644, metalness: 0.2, roughness: 0.08, transparent: true, opacity: 0.68 }),
    ))
  }
  if (doorParts.length) {
    scene.add(new THREE.Mesh(
      mergeGeometries(doorParts),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
    ))
  }
  // balkony
  if (balconySpots.length) {
    const balc = new THREE.InstancedMesh(
      balconyGeometry(),
      new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }),
      balconySpots.length,
    )
    balc.castShadow = true
    balconySpots.forEach((b, i) => {
      m4.makeRotationY(b.rot).setPosition(b.x, b.y, b.z)
      balc.setMatrixAt(i, m4)
    })
    balc.computeBoundingSphere()
  scene.add(balc)
  }

  // ── mobiliář ulic: semafory, značky, lavičky, koše, hydranty, keře ──
  const mids = [-60, -20, 20, 60]
  function sidewalkSpot() {
    const st = STREETS[Math.floor(Math.random() * STREETS.length)]
    const t = mids[Math.floor(Math.random() * mids.length)] + (Math.random() - 0.5) * 14
    const side = Math.random() < 0.5 ? -1 : 1
    return Math.random() < 0.5
      ? { x: st + side * (ROAD_HALF + 1.1), z: t, rot: side < 0 ? Math.PI / 2 : -Math.PI / 2 }
      : { x: t, z: st + side * (ROAD_HALF + 1.1), rot: side < 0 ? 0 : Math.PI }
  }
  function placeInstanced(geo, mat, spots, obstacleR = 0, breakable = false) {
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length)
    mesh.castShadow = true
    mesh.frustumCulled = false
    spots.forEach((sp, i) => {
      const y = heightAt(sp.x, sp.z)
      m4.makeRotationY(sp.rot || 0).setPosition(sp.x, y, sp.z)
      mesh.setMatrixAt(i, m4)
      if (obstacleR > 0) obstacles.push({
        x: sp.x, z: sp.z, r: obstacleR, type: 'circle',
        breakable,
        ref: breakable ? { inst: mesh, index: i, x: sp.x, y, z: sp.z, rotY: sp.rot || 0, sx: 1, sy: 1 } : undefined,
      })
    })
    mesh.computeBoundingSphere()
    scene.add(mesh)
    return mesh
  }
  const metalMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.4, roughness: 0.55 })
  const woodMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })

  // semafory: 2 protilehlé rohy každé křižovatky, rameno nad vozovku
  const tlSpots = []
  for (const sx of STREETS) for (const sz of STREETS) {
    tlSpots.push({ x: sx - ROAD_HALF - 0.9, z: sz - ROAD_HALF - 0.9, rot: 0 })
    tlSpots.push({ x: sx + ROAD_HALF + 0.9, z: sz + ROAD_HALF + 0.9, rot: Math.PI })
  }
  const obstBeforeTL = obstacles.length
  const tlMesh = placeInstanced(trafficLightGeometry(), metalMat, tlSpots, 0.2, true)
  // svítící světla semaforů (zelená/oranžová/červená náhodně)
  const dotGeo = new THREE.SphereGeometry(0.075, 8, 6)
  const dots = new THREE.InstancedMesh(
    dotGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.0 }),
    tlSpots.length * 3,
  )
  const DOT_COLORS = [0xff3b30, 0xffb340, 0x3dd465]
  tlSpots.forEach((sp, i) => {
    for (let d = 0; d < 3; d++) {
      const lx = 2.0 * Math.cos(sp.rot), lz = -2.0 * Math.sin(sp.rot)
      m4.makeRotationY(0).setPosition(
        sp.x + lx + 0.17 * Math.sin(sp.rot),
        heightAt(sp.x, sp.z) + 5.22 - d * 0.27,
        sp.z + lz + 0.17 * Math.cos(sp.rot),
      )
      dots.setMatrixAt(i * 3 + d, m4)
      const lit = Math.floor(Math.random() * 3)
      dots.setColorAt(i * 3 + d, new THREE.Color(d === lit ? DOT_COLORS[d] : 0x1a1d20))
    }
  })
  dots.computeBoundingSphere()
  scene.add(dots)
  // propojit světla se semafory: při pádu sloupu se schovají (scale 0)
  tlSpots.forEach((sp, i) => {
    const ob = obstacles[obstBeforeTL + i]
    if (ob && ob.ref) { ob.ref.dots = dots; ob.ref.dotBase = i * 3; ob.ref.dotCount = 3 }
  })
  void tlMesh

  placeInstanced(signGeometry(), metalMat, Array.from({ length: 24 }, sidewalkSpot), 0.15, true)
  placeInstanced(benchGeometry(), woodMat, Array.from({ length: 20 }, sidewalkSpot), 0.4, true)
  placeInstanced(trashGeometry(), woodMat, Array.from({ length: 20 }, sidewalkSpot), 0.25, true)
  placeInstanced(hydrantGeometry(), woodMat, Array.from({ length: 16 }, sidewalkSpot), 0.18, true)
  // keře — volně po městě (bez kolize, dá se jimi projet)
  const bushSpots = []
  for (let i = 0; i < 70; i++) {
    const pos = city_randomFree(obstacles, 1.2)
    if (pos.x < BEACH_X) bushSpots.push({ x: pos.x, z: pos.z, rot: Math.random() * Math.PI })
  }
  placeInstanced(bushGeometry(), woodMat, bushSpots)

  // ── palmy (pláž + boulevardy + parky) ──
  const palmSpots = []
  for (let z = -HALF + 10; z < HALF - 8; z += 9) {
    palmSpots.push([BEACH_X + 3 + Math.random() * 2, z + Math.random() * 4])
    if (Math.random() < 0.7) palmSpots.push([BEACH_X + 12 + Math.random() * 3, z + 6 + Math.random() * 4])
  }
  for (const s of STREETS) {
    for (let i = 0; i < 6; i++) {
      const t = STREETS[Math.floor(Math.random() * STREETS.length)]
      palmSpots.push([s + ROAD_HALF + 1.4, t + 10 + Math.random() * 12])
    }
  }
  for (const [ix, iz] of parks) {
    const [x0, x1] = spans[ix], [z0, z1] = spans[iz]
    for (let i = 0; i < 10; i++) {
      palmSpots.push([x0 + 3 + Math.random() * (x1 - x0 - 6), z0 + 3 + Math.random() * (z1 - z0 - 6)])
    }
  }
  const palmGeo = palmGeometry()
  const palmMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })
  const palms = new THREE.InstancedMesh(palmGeo, palmMat, palmSpots.length)
  palms.castShadow = true
  palmSpots.forEach(([x, z], i) => {
    const s = 0.85 + Math.random() * 0.45
    const rotY = Math.random() * Math.PI * 2
    const y = heightAt(x, z) - 0.05
    m4.makeRotationY(rotY).scale(new THREE.Vector3(s, s, s)).setPosition(x, y, z)
    palms.setMatrixAt(i, m4)
    // menší palmy jdou přerazit (stejně jako stromky ve Skrýšově)
    obstacles.push({
      x, z, r: 0.45, type: 'circle',
      breakable: true, // všechny palmy zničitelné (do velikosti stromu)
      ref: { inst: palms, index: i, x, y, z, rotY, sx: s, sy: s },
    })
  })
  palms.frustumCulled = false
  palms.computeBoundingSphere()
  scene.add(palms)

  // ── lampy ──
  const lampSpots = []
  for (const sx of STREETS) for (const sz of STREETS) {
    lampSpots.push([sx + ROAD_HALF + 1.2, sz + ROAD_HALF + 1.2, Math.PI * 1.25])
  }
  const lamps = new THREE.InstancedMesh(
    lampGeometry(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.4 }),
    lampSpots.length,
  )
  const bulbs = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.16, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0xffe0b0, emissive: 0xffc070, emissiveIntensity: 2.6 }),
    lampSpots.length,
  )
  lampSpots.forEach(([x, z, rot], i) => {
    const hy = heightAt(x, z)
    m4.makeRotationY(rot).setPosition(x, hy, z)
    lamps.setMatrixAt(i, m4)
    // rameno míří v local +X → world (cos rot, 0, -sin rot)
    m4.makeRotationY(0).setPosition(x + Math.cos(rot) * 1.15, hy + 4.32, z - Math.sin(rot) * 1.15)
    bulbs.setMatrixAt(i, m4)
    // přerazitelná lampa (sloup padne, žárovka zhasne přes dots)
    obstacles.push({
      x, z, r: 0.25, type: 'circle', breakable: true,
      ref: { inst: lamps, index: i, x, y: hy, z, rotY: rot, sx: 1, sy: 1, dots: bulbs, dotBase: i, dotCount: 1 },
    })
  })
  lamps.frustumCulled = false
  lamps.computeBoundingSphere()
  bulbs.computeBoundingSphere()
  scene.add(lamps, bulbs)

  // ── zaparkovaná auta podél ulic ──
  const parkedGeo = parkedCarGeometry()
  const parkedMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.4 })
  const PARKED_COLORS = [0xf2f2f2, 0x2ec4b6, 0xffb3c7, 0x3a6ed8, 0xffe084, 0x8b74e0, 0xff8f6b, 0x9adfae, 0x52525a, 0xd8586b]
  const parkedSpots = []
  for (let i = 0; i < 16; i++) {
    const s = STREETS[Math.floor(Math.random() * STREETS.length)]
    const t = mids[Math.floor(Math.random() * mids.length)] + (Math.random() - 0.5) * 10
    const side = Math.random() < 0.5 ? -1 : 1
    if (Math.random() < 0.5) {
      // svislá ulice (x = s), auto míří podél z
      const x = s + side * (ROAD_HALF - 1.1)
      if (x > BEACH_X) continue
      parkedSpots.push({ x, z: t, rot: side < 0 ? 0 : Math.PI, hw: 0.95, hd: 2.2 })
    } else {
      // vodorovná ulice (z = s), auto míří podél x
      const z = s + side * (ROAD_HALF - 1.1)
      const x = t
      if (x > BEACH_X) continue
      parkedSpots.push({ x, z, rot: side < 0 ? Math.PI / 2 : -Math.PI / 2, hw: 2.2, hd: 0.95 })
    }
  }
  const parked = new THREE.InstancedMesh(parkedGeo, parkedMat, parkedSpots.length)
  parked.castShadow = true
  parkedSpots.forEach((p, i) => {
    m4.makeRotationY(p.rot).setPosition(p.x, heightAt(p.x, p.z), p.z)
    parked.setMatrixAt(i, m4)
    parked.setColorAt(i, new THREE.Color(PARKED_COLORS[i % PARKED_COLORS.length]))
    obstacles.push({ x: p.x, z: p.z, hw: p.hw, hd: p.hd, type: 'box' })
  })
  parked.computeBoundingSphere()
  scene.add(parked)

  // ── plážové slunečníky a ručníky ──
  const UMB_COLORS = [0xd8384a, 0xffb347, 0x2ec4b6, 0xff5fa2, 0xffe084, 0x8fd6f0]
  const umbSpots = []
  for (let i = 0; i < 18; i++) {
    umbSpots.push([100 + Math.random() * 13, -HALF + 12 + Math.random() * (HALF * 2 - 24)])
  }
  const umbrellas = new THREE.InstancedMesh(
    umbrellaGeometry(),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, side: THREE.DoubleSide }),
    umbSpots.length,
  )
  umbrellas.castShadow = true
  const towelParts = []
  umbSpots.forEach(([x, z], i) => {
    const rotY = Math.random() * Math.PI, y = heightAt(x, z)
    m4.makeRotationY(rotY).setPosition(x, y, z)
    umbrellas.setMatrixAt(i, m4)
    umbrellas.setColorAt(i, new THREE.Color(UMB_COLORS[i % UMB_COLORS.length]))
    obstacles.push({
      x, z, r: 0.3, type: 'circle', breakable: true,
      ref: { inst: umbrellas, index: i, x, y, z, rotY, sx: 1, sy: 1 },
    })
    towelParts.push(paintGeo(
      new THREE.PlaneGeometry(0.95, 1.9)
        .rotateX(-Math.PI / 2)
        .rotateY(Math.random() * Math.PI)
        .translate(x + 1.2 + Math.random(), heightAt(x, z) + 0.03, z + (Math.random() - 0.5) * 2),
      UMB_COLORS[(i + 3) % UMB_COLORS.length]))
  })
  umbrellas.frustumCulled = false
  umbrellas.computeBoundingSphere()
  scene.add(umbrellas)
  scene.add(new THREE.Mesh(
    mergeGeometries(towelParts),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
  ))

  const city = {
    half: HALF,
    heightAt,
    obstacles,
    randomFreePos(margin = 3) {
      for (let i = 0; i < 120; i++) {
        const x = (Math.random() * 2 - 1) * (HALF - margin - 2)
        const z = (Math.random() * 2 - 1) * (HALF - margin - 2)
        let free = true
        for (const o of obstacles) {
          if (o.type === 'box') {
            if (Math.abs(x - o.x) < o.hw + margin && Math.abs(z - o.z) < o.hd + margin) { free = false; break }
          } else if (Math.hypot(x - o.x, z - o.z) < o.r + margin) { free = false; break }
        }
        if (free) return { x, z }
      }
      return { x: 0, z: -20 }
    },
  }
  return city
}

/**
 * 2D kolize auta (kruh) s hranicí města a překážkami.
 * Odebírá se jen složka rychlosti DO překážky (podél zdi se klouže) —
 * čelní náraz zastaví, škrtnutí o zeď jen lehce brzdí a auto se dá
 * plynem + řízením normálně vyprostit (žádné "přetlačování").
 */
// Jeden vzorkovací bod auta vs. všechny překážky (car.pos je dočasně posunutý
// na tento bod; push posune celé auto po vrácení offsetu). `fired` brání
// trojnásobnému nárazovému eventu (3 body podél délky / snímek).
function resolveObstaclesAtPoint(car, city, r, fired, out) {
  for (const o of city.obstacles) {
    if (o.dead) continue // přeražený objekt už nekolidí
    if (o.type === 'circle') {
      const dx = car.pos.x - o.x, dz = car.pos.z - o.z
      const dist = Math.hypot(dx, dz)
      const minDist = r + o.r
      if (dist < minDist && dist > 1e-4) {
        const nx = dx / dist, nz = dz / dist
        if (city.collisionEvents && !fired.has(o)) {
          const vn = car.vel.x * nx + car.vel.z * nz
          if (vn < -0.5) { city.collisionEvents.push({ o, impact: -vn, dirX: car.vel.x, dirZ: car.vel.z, car }); fired.add(o) }
        }
        const push = minDist - dist
        car.pos.x += nx * push
        car.pos.z += nz * push
        out.nx += nx; out.nz += nz; out.hit = true
      }
    } else {
      const closestX = Math.max(o.x - o.hw, Math.min(car.pos.x, o.x + o.hw))
      const closestZ = Math.max(o.z - o.hd, Math.min(car.pos.z, o.z + o.hd))
      const dx = car.pos.x - closestX, dz = car.pos.z - closestZ
      const dist = Math.hypot(dx, dz)
      if (dist < r) {
        let nx = 0, nz = 1
        if (dist > 1e-4) { nx = dx / dist; nz = dz / dist }
        const push = r - dist
        car.pos.x += nx * push
        car.pos.z += nz * push
        out.nx += nx; out.nz += nz; out.hit = true
      }
    }
  }
}

export function resolveCollisions(car, city, carRadius) {
  const half = city.half
  let hit = false
  let nAccX = 0, nAccZ = 0 // akumulovaná normála kontaktů

  if (car.pos.x > half - carRadius) { car.pos.x = half - carRadius; nAccX -= 1; hit = true }
  if (car.pos.x < -half + carRadius) { car.pos.x = -half + carRadius; nAccX += 1; hit = true }
  if (car.pos.z > half - carRadius) { car.pos.z = half - carRadius; nAccZ -= 1; hit = true }
  if (car.pos.z < -half + carRadius) { car.pos.z = -half + carRadius; nAccZ += 1; hit = true }

  // auto NENÍ bod (viz mapcity.js) — 3 vzorky podél délky, menší poloměr
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw)
  const sampleR = carRadius * 0.82
  const out = { nx: 0, nz: 0, hit: false }
  const fired = new Set()
  for (const off of [carRadius, 0, -carRadius]) {
    const spx = fx * off, spz = fz * off
    car.pos.x += spx; car.pos.z += spz
    resolveObstaclesAtPoint(car, city, sampleR, fired, out)
    car.pos.x -= spx; car.pos.z -= spz
  }
  if (out.hit) { hit = true; nAccX += out.nx; nAccZ += out.nz }

  if (hit) {
    const nl = Math.hypot(nAccX, nAccZ)
    if (nl > 1e-4) {
      const nx = nAccX / nl, nz = nAccZ / nl
      const vn = car.vel.x * nx + car.vel.z * nz
      if (vn < 0) {
        // odstranit složku do zdi (+ mírný odraz), tangenciální zachovat
        car.vel.x -= nx * vn * 1.15
        car.vel.z -= nz * vn * 1.15
        car.vel.multiplyScalar(0.96) // lehké tření o zeď
      }
    }
    // odstrčení změnilo x/z — dorovnat výšku na terén
    if (city.heightAt) car.pos.y = city.heightAt(car.pos.x, car.pos.z)
  }
  return hit
}
