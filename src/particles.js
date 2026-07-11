// particles.js — jednoduchý particle systém (jiskry při nárazu, kouř vraků,
// obláček při zásahu chodce). Jeden THREE.Points buffer, CPU update.
import * as THREE from 'three'

const MAX = 400

export class Particles {
  constructor(scene) {
    this.geo = new THREE.BufferGeometry()
    this.positions = new Float32Array(MAX * 3)
    this.colors = new Float32Array(MAX * 3)
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3))
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3))
    this.mat = new THREE.PointsMaterial({
      size: 0.32, vertexColors: true, transparent: true, opacity: 0.95, sizeAttenuation: true,
    })
    const points = new THREE.Points(this.geo, this.mat)
    points.frustumCulled = false
    scene.add(points)
    this.list = []
  }

  /**
   * @param pos THREE.Vector3
   * @param opts {count, color, speed (vodorovný rozptyl), up, life, gravity}
   *   gravity < 0 → částice stoupají (kouř)
   */
  spawn(pos, { count = 10, color = 0xffcc66, speed = 4, up = 3, life = 0.6, gravity = 9 } = {}) {
    const c = new THREE.Color(color)
    for (let i = 0; i < count; i++) {
      if (this.list.length >= MAX) this.list.shift()
      const a = Math.random() * Math.PI * 2
      const s = speed * (0.3 + Math.random() * 0.7)
      this.list.push({
        x: pos.x, y: pos.y, z: pos.z,
        vx: Math.cos(a) * s, vy: up * (0.4 + Math.random() * 0.9), vz: Math.sin(a) * s,
        life: life * (0.5 + Math.random() * 0.5), maxLife: life,
        r: c.r, g: c.g, b: c.b, gravity,
      })
    }
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]
      p.life -= dt
      if (p.life <= 0) { this.list.splice(i, 1); continue }
      p.vy -= p.gravity * dt
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt
      if (p.y < 0.05 && p.gravity > 0) { p.y = 0.05; p.vy *= -0.3 }
    }
    let n = 0
    for (const p of this.list) {
      this.positions[n * 3] = p.x; this.positions[n * 3 + 1] = p.y; this.positions[n * 3 + 2] = p.z
      const f = Math.max(0, p.life / p.maxLife)
      this.colors[n * 3] = p.r * f; this.colors[n * 3 + 1] = p.g * f; this.colors[n * 3 + 2] = p.b * f
      n++
    }
    this.geo.setDrawRange(0, n)
    this.geo.attributes.position.needsUpdate = true
    this.geo.attributes.color.needsUpdate = true
  }
}
