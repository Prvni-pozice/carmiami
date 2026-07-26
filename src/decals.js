// decals.js — trvalé ošklivé fleky (nárazová špína) na zdech domů a plotech.
// Pool kruhových quadů s grungy texturou; nejstarší se recykluje. Quad se
// natočí čelem ke stěně (podle normály) a přisadí se těsně před ni.
import * as THREE from 'three'

const POOL = 40

function stainTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  // tmavý nepravidelný cákanec se stříkanci a stékanci
  const cx = 64, cy = 62
  const grad = g.createRadialGradient(cx, cy, 4, cx, cy, 58)
  grad.addColorStop(0, 'rgba(24,16,12,0.92)')
  grad.addColorStop(0.5, 'rgba(38,26,20,0.62)')
  grad.addColorStop(1, 'rgba(38,26,20,0)')
  g.fillStyle = grad
  g.beginPath(); g.arc(cx, cy, 58, 0, Math.PI * 2); g.fill()
  // pár tmavších skvrn kolem
  for (let i = 0; i < 10; i++) {
    const a = Math.random() * Math.PI * 2, r = 18 + Math.random() * 34
    const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r
    const rr = 4 + Math.random() * 12
    g.fillStyle = `rgba(20,13,10,${0.3 + Math.random() * 0.4})`
    g.beginPath(); g.arc(px, py, rr, 0, Math.PI * 2); g.fill()
  }
  // stékance dolů
  for (let i = 0; i < 5; i++) {
    const px = cx + (Math.random() - 0.5) * 60
    g.fillStyle = `rgba(22,14,10,${0.25 + Math.random() * 0.3})`
    g.fillRect(px, cy, 2 + Math.random() * 3, 20 + Math.random() * 34)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

export class Decals {
  constructor(scene) {
    const mat = new THREE.MeshBasicMaterial({
      map: stainTexture(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, opacity: 0.95,
    })
    this.geo = new THREE.PlaneGeometry(1, 1)
    this.pool = []
    this.next = 0
    for (let i = 0; i < POOL; i++) {
      const m = new THREE.Mesh(this.geo, mat)
      m.visible = false
      m.renderOrder = 2
      scene.add(m)
      this.pool.push(m)
    }
  }

  /** Přidej flek na stěnu v bodě (x,y,z) s vnější normálou (nx,nz). */
  add(x, y, z, nx, nz, size = 2.2) {
    const nl = Math.hypot(nx, nz) || 1
    nx /= nl; nz /= nl
    const m = this.pool[this.next]
    this.next = (this.next + 1) % POOL
    m.position.set(x + nx * 0.06, y, z + nz * 0.06)
    m.rotation.set(0, Math.atan2(nx, nz), 0) // quad (+Z) → čelem ven
    const s = size * (0.8 + Math.random() * 0.5)
    m.scale.set(s, s, 1)
    m.visible = true
  }
}
