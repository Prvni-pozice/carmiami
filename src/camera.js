// camera.js — kamera za autem s rychlým dojezdem (pomalý lerp působil jako
// lag ovládání) a look-ahead dle rychlosti. Zná terén: drží se nad ním
// a sleduje výšku auta. Při zatáčení u domu se "přisaje" před zeď, aby
// nevjela dovnitř budovy (whisker/collision test na půdorysy staveb).
import * as THREE from 'three'

const DIST = 7.8
const HEIGHT = 3.5
const LOOK_HEIGHT = 1.0
const FOLLOW_LERP = 10
const LOOK_LERP = 14
const MIN_DIST = 2.2 // kam nejblíž smí kamera dojet, ať je auto pořád vidět

function pointInPoly(x, z, poly) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1]
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside
  }
  return inside
}

export class ChaseCamera {
  constructor(camera, heightAt = null, city = null) {
    this.camera = camera
    this.heightAt = heightAt
    this.currentPos = new THREE.Vector3()
    this.currentLook = new THREE.Vector3()
    this._initialized = false
    // jen VYSOKÉ stavby blokují kameru — domy (poly) a velké boxy. Ploty,
    // živé ploty a stromy (tenké/nízké) ignorujeme, ať kamera netrhá.
    this.blockers = city
      ? city.obstacles.filter(o => o.type === 'poly' || ((o.type === 'obox' || o.type === 'box') && Math.min(o.hw, o.hd) > 2))
      : []
  }

  _targetY(car, x, z) {
    let y = car.pos.y + HEIGHT
    if (this.heightAt) y = Math.max(y, this.heightAt(x, z) + 1.4) // neprojet kopcem
    return y
  }

  _blocked(x, z) {
    for (const o of this.blockers) {
      if (o.type === 'poly') {
        if (x < o.minx - 0.3 || x > o.maxx + 0.3 || z < o.minz - 0.3 || z > o.maxz + 0.3) continue
        if (pointInPoly(x, z, o.poly)) return true
      } else {
        const a = o.a || 0 // 'box' (Miami) je osově zarovnaný, bez rotace
        const ca = Math.cos(a), sa = Math.sin(a)
        const dx = x - o.x, dz = z - o.z
        const lx = dx * ca + dz * sa, lz = -dx * sa + dz * ca
        if (Math.abs(lx) < o.hw + 0.3 && Math.abs(lz) < o.hd + 0.3) return true
      }
    }
    return false
  }

  // Jak daleko od auta smí kamera ve směru (ux,uz), než narazí na budovu.
  _freeDist(px, pz, ux, uz, wantDist) {
    for (let d = MIN_DIST; d <= wantDist; d += 0.5) {
      if (this._blocked(px + ux * d, pz + uz * d)) return d - 0.5
    }
    return wantDist
  }

  // Najdi směr kamery za autem, kde je výhled volný. Nejdřív přímo za autem;
  // když tam stojí dům, kamera obletí auto na volnou stranu (místo aby vjela
  // do zdi). Vrací {ux,uz,dist}.
  _bestCamDir(car) {
    const px = car.pos.x, pz = car.pos.z
    const fwd = car.forward
    const bx = -fwd.x, bz = -fwd.z // základní směr: za autem
    if (!this.blockers.length) return { ux: bx, uz: bz, dist: DIST }
    let best = null
    // po malých krocích od 0° (nejlépe rovnou za autem) do ±150°
    for (const deg of [0, 18, -18, 36, -36, 54, -54, 75, -75, 100, -100, 130, -130, 155, -155]) {
      const a = deg * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a)
      const ux = bx * ca - bz * sa, uz = bx * sa + bz * ca
      const free = this._freeDist(px, pz, ux, uz, DIST)
      // preferuj malý úhel: skóre = volná vzdálenost minus penalizace za odklon
      const score = free - Math.abs(deg) * 0.012
      if (!best || score > best.score) best = { ux, uz, dist: free, score }
      if (free >= DIST - 0.01 && Math.abs(deg) < 1) break // rovně za autem volno → hotovo
    }
    return best
  }

  snapTo(car) {
    const back = car.forward.clone().multiplyScalar(-DIST)
    const x = car.pos.x + back.x, z = car.pos.z + back.z
    this.currentPos.set(x, this._targetY(car, x, z), z)
    this.currentLook.copy(car.pos).setY(car.pos.y + LOOK_HEIGHT)
    this.camera.position.copy(this.currentPos)
    this.camera.lookAt(this.currentLook)
    this._initialized = true
  }

  update(dt, car) {
    if (!this._initialized) { this.snapTo(car); return }

    const fwd = car.forward
    // směr + vzdálenost kamery: rovnou za autem, nebo úlet na volnou stranu domu
    const dir = this._bestCamDir(car)
    const tx = car.pos.x + dir.ux * dir.dist, tz = car.pos.z + dir.uz * dir.dist
    const targetPos = new THREE.Vector3(tx, this._targetY(car, tx, tz), tz)
    const fwdSpeed = car.vel.dot(fwd)
    const lookAhead = fwd.clone().multiplyScalar(Math.max(0, fwdSpeed) * 0.35)
    const targetLook = car.pos.clone().add(lookAhead).setY(car.pos.y + LOOK_HEIGHT)

    // musí-li se kamera přisát/obletět (dům), doběhni rychleji, ať zeď nestihne
    // zakrýt auto
    const posLerp = dir.dist < DIST - 0.5 ? 22 : FOLLOW_LERP
    const posT = 1 - Math.exp(-posLerp * dt)
    const lookT = 1 - Math.exp(-LOOK_LERP * dt)
    this.currentPos.lerp(targetPos, posT)
    this.currentLook.lerp(targetLook, lookT)

    // tvrdá pojistka: kdyby vyhlazený pohyb přesto zavedl kameru do půdorysu
    // domu, posuň ji po přímce k autu (auto je kolizí drženo mimo zdi), dokud
    // z domu nevyjede — kamera tak NIKDY nekončí uvnitř budovy
    if (this.blockers.length && this._blocked(this.currentPos.x, this.currentPos.z)) {
      const dx = car.pos.x - this.currentPos.x, dz = car.pos.z - this.currentPos.z
      const dl = Math.hypot(dx, dz) || 1
      const ux = dx / dl, uz = dz / dl
      let t = 0.3
      while (t < dl && this._blocked(this.currentPos.x + ux * t, this.currentPos.z + uz * t)) t += 0.3
      this.currentPos.x += ux * t
      this.currentPos.z += uz * t
      this.currentPos.y = this._targetY(car, this.currentPos.x, this.currentPos.z)
    }

    this.camera.position.copy(this.currentPos)
    this.camera.lookAt(this.currentLook)
  }
}
