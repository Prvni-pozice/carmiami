// peds.js — chodci: štíhlejší postavy (nohy, trup, paže, hlava — jedna merged
// geometrie s vertex colors = 1 draw call/chodec). Spawnují se na volných
// místech města (city.randomFreePos), utíkají před auty, zásah = komiksový
// odlet + respawn jinde.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const WALK_SPEED = 1.3
const FLEE_SPEED = 4.6
const FLEE_RADIUS = 10
const HIT_DIST = 1.55
const HIT_MIN_SPEED = 2.5
const GRAV = 14
const DOWN_TIME = 2.6

const SKIN_TONES = [0xe8b88a, 0xc98e63, 0x8a5a3a, 0xf0c9a0]
const PANTS = [0x2b3a55, 0x3a3a3e, 0x6b5a48, 0x274036]

function paintGeo(geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

let sharedMat = null

function buildPedMesh() {
  const shirt = new THREE.Color().setHSL(Math.random(), 0.5, 0.52).getHex()
  const skin = SKIN_TONES[Math.floor(Math.random() * SKIN_TONES.length)]
  const pants = PANTS[Math.floor(Math.random() * PANTS.length)]
  const geo = mergeGeometries([
    paintGeo(new THREE.BoxGeometry(0.15, 0.75, 0.17).translate(-0.1, 0.375, 0), pants),
    paintGeo(new THREE.BoxGeometry(0.15, 0.75, 0.17).translate(0.1, 0.375, 0), pants),
    paintGeo(new THREE.BoxGeometry(0.42, 0.6, 0.22).translate(0, 1.05, 0), shirt),
    paintGeo(new THREE.BoxGeometry(0.11, 0.55, 0.14).translate(-0.27, 1.05, 0), shirt),
    paintGeo(new THREE.BoxGeometry(0.11, 0.55, 0.14).translate(0.27, 1.05, 0), shirt),
    paintGeo(new THREE.BoxGeometry(0.24, 0.26, 0.22).translate(0, 1.52, 0), skin),
  ])
  if (!sharedMat) sharedMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })
  const mesh = new THREE.Mesh(geo, sharedMat)
  mesh.castShadow = true
  return mesh
}

export class Peds {
  constructor(scene, city, count = 24) {
    this.scene = scene
    this.city = city
    this.list = []
    for (let i = 0; i < count; i++) this.list.push(this._spawn())
  }

  _spawn() {
    const mesh = buildPedMesh()
    const { x, z } = this.city.randomFreePos(1.5)
    mesh.position.set(x, this.city.heightAt ? this.city.heightAt(x, z) : 0, z)
    this.scene.add(mesh)
    return {
      mesh, x, z,
      dir: Math.random() * Math.PI * 2,
      state: 'walk',
      vx: 0, vy: 0, vz: 0, spin: 0,
      t: 0, walkT: Math.random() * 10,
      retargetT: 2 + Math.random() * 4,
    }
  }

  update(dt, cars, onHit) {
    for (const p of this.list) {
      if (p.state === 'walk' || p.state === 'flee') {
        let near = null, nd = Infinity
        for (const c of cars) {
          const d = Math.hypot(c.pos.x - p.x, c.pos.z - p.z)
          if (d < nd) { nd = d; near = c }
        }

        if (near && nd < HIT_DIST && near.vel.length() > HIT_MIN_SPEED) {
          p.state = 'fly'
          p.vx = near.vel.x * 0.8
          p.vz = near.vel.z * 0.8
          p.vy = 5.5 + near.vel.length() * 0.15
          p.spin = (Math.random() * 2 - 1) * 8
          onHit(p, near.vel.length() * 3.6)
          continue
        }

        let speed = WALK_SPEED
        if (near && nd < FLEE_RADIUS && near.vel.length() > 2) {
          p.state = 'flee'
          p.dir = Math.atan2(p.x - near.pos.x, p.z - near.pos.z)
          speed = FLEE_SPEED
        } else {
          p.state = 'walk'
          p.retargetT -= dt
          if (p.retargetT <= 0) {
            p.dir = Math.random() * Math.PI * 2
            p.retargetT = 2 + Math.random() * 4
          }
        }

        p.x += Math.sin(p.dir) * speed * dt
        p.z += Math.cos(p.dir) * speed * dt
        const m = this.city.half - 1.5
        if (Math.abs(p.x) > m || Math.abs(p.z) > m) {
          p.x = Math.max(-m, Math.min(m, p.x))
          p.z = Math.max(-m, Math.min(m, p.z))
          p.dir += Math.PI * (0.7 + Math.random() * 0.6)
        }

        p.walkT += dt * speed
        const gy = this.city.heightAt ? this.city.heightAt(p.x, p.z) : 0
        p.mesh.position.set(p.x, gy + Math.abs(Math.sin(p.walkT * 4)) * 0.05, p.z)
        p.mesh.rotation.y = p.dir
      } else if (p.state === 'fly') {
        p.vy -= GRAV * dt
        p.x += p.vx * dt
        p.z += p.vz * dt
        const gy = this.city.heightAt ? this.city.heightAt(p.x, p.z) : 0
        const y = p.mesh.position.y + p.vy * dt
        p.mesh.position.set(p.x, Math.max(gy, y), p.z)
        p.mesh.rotation.x += p.spin * dt
        if (y <= gy && p.vy < 0) {
          p.state = 'down'
          p.t = DOWN_TIME
          p.mesh.rotation.x = -Math.PI / 2
          p.mesh.position.y = gy + 0.22
        }
      } else {
        p.t -= dt
        if (p.t <= 0) {
          const { x, z } = this.city.randomFreePos(1.5)
          p.x = x; p.z = z
          p.state = 'walk'
          p.mesh.rotation.set(0, 0, 0)
          p.mesh.position.set(x, this.city.heightAt ? this.city.heightAt(x, z) : 0, z)
        }
      }
    }
  }
}
