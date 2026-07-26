// car.js — model auta (clearcoat lak, tónované sklo, chrom) + jízdní
// fyzika s vektorem rychlosti a omezeným bočním gripem (kontrolovatelný smyk).
// Latence: STEER_GRIP_SPEED snížen (plné řízení dřív), vyšší STEER_RATE.
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const ENGINE_ACCEL = 27      // m/s² při plném plynu
const BRAKE_DECEL = 44       // m/s² při brzdě (jede-li dopředu)
const REVERSE_ACCEL = 14     // m/s² couvání
const MAX_SPEED = 33         // m/s (~119 km/h)
const MAX_REVERSE = 9        // m/s
const ROLL_RESIST = 3.2
const DRAG_COEF = 0.017
const WHEELBASE = 2.62       // rozvor náprav (bicycle model)
const MAX_STEER = 0.52       // max rejd předních kol (rad, ~30°)
const TIRE_GRIP = 7.5        // 1/s — plný grip pneumatik (klidná jízda)
const DRIFT_GRIP = 2.1       // grip ve smyku (kinetické tření < statické)
const DRIFT_ENTER = 3.4      // m/s boční rychlosti pro vstup do driftu
const DRIFT_EXIT = 1.5       // m/s pro chycení zpět
const RADIUS = 1.35

// scratch vektory pro orientaci na terénu (bez alokací ve smyčce)
const _up = new THREE.Vector3()
const _fwd2 = new THREE.Vector3()
const _rgt2 = new THREE.Vector3()
const _m = new THREE.Matrix4()

function paintGeo(geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  return geo
}

// ── typy aut (nízkopolygonové siluety, ať jsou rozpoznatelné) ──
// profile = boční obrys [x=délka(+příď), y=výška], uzavřený; cabin = obdélník
// prosklení [x0,x1,yb,yt]; wheelZ = [přední, zadní] osa; wheelR poloměr kola;
// wheelY výška středu kola (světlá výška); W šířka; bed = korba (pickup).
export const CAR_TYPES = {
  bmw5: {
    color: 0x2a3b52, W: 1.68, wheelZ: [1.36, -1.36], wheelR: 0.36, wheelY: 0.46,
    frontLightY: 0.66, rearLightY: 0.70, cabin: [-0.80, 0.55, 0.82, 1.30],
    profile: [[-2.16, 0.34], [2.20, 0.34], [2.24, 0.60], [2.15, 0.66], [1.30, 0.72], [1.02, 0.76], [0.52, 1.33], [-0.80, 1.35], [-1.20, 0.88], [-1.98, 0.82], [-2.18, 0.66]],
  },
  merc: {
    color: 0xc7cacd, W: 1.72, wheelZ: [1.38, -1.40], wheelR: 0.36, wheelY: 0.47,
    frontLightY: 0.68, rearLightY: 0.74, cabin: [-0.82, 0.52, 0.84, 1.34],
    profile: [[-2.22, 0.34], [2.24, 0.34], [2.28, 0.62], [2.18, 0.70], [1.34, 0.76], [1.02, 0.80], [0.50, 1.38], [-0.82, 1.40], [-1.22, 0.92], [-2.02, 0.86], [-2.24, 0.68]],
  },
  tesla: {
    color: 0xe9eced, W: 1.68, wheelZ: [1.35, -1.35], wheelR: 0.36, wheelY: 0.45,
    frontLightY: 0.60, rearLightY: 0.68, cabin: [-0.55, 0.35, 0.80, 1.22],
    profile: [[-2.10, 0.34], [2.15, 0.34], [2.18, 0.56], [1.55, 0.68], [1.05, 0.78], [0.30, 1.26], [-0.52, 1.26], [-1.78, 0.80], [-2.10, 0.64]],
  },
  ranger: {
    color: 0xb63a2e, W: 1.78, wheelZ: [1.46, -1.55], wheelR: 0.44, wheelY: 0.54,
    frontLightY: 0.92, rearLightY: 0.92, cabin: [-0.34, 0.70, 1.06, 1.52],
    bed: { x0: -2.30, x1: -0.86, y: 1.00, railH: 0.24 },
    profile: [[-2.34, 0.42], [2.30, 0.42], [2.36, 0.86], [2.12, 0.98], [1.16, 1.00], [1.00, 1.04], [0.72, 1.56], [-0.34, 1.58], [-0.60, 1.06], [-0.86, 1.00], [-2.30, 1.00], [-2.34, 0.86]],
  },
}
export const CAR_TYPE_KEYS = Object.keys(CAR_TYPES)

function shapeFromPts(pts) {
  const s = new THREE.Shape()
  s.moveTo(pts[0][0], pts[0][1])
  for (let i = 1; i < pts.length; i++) s.lineTo(pts[i][0], pts[i][1])
  s.closePath()
  return s
}

export class Car {
  constructor(color = null, type = 'bmw5') {
    this.type = type
    this.spec = CAR_TYPES[type] || CAR_TYPES.bmw5
    this.baseColor = new THREE.Color(color != null ? color : this.spec.color)
    this.mesh = this._buildMesh(this.baseColor.getHex(), this.spec)
    this.pos = new THREE.Vector3(0, 0, 0)
    this.yaw = 0
    this.vel = new THREE.Vector3(0, 0, 0)
    this._fwdSpeed = 0
    this._drifting = false
    this.mesh.position.copy(this.pos)
  }

  _buildMesh(color, spec) {
    const g = new THREE.Group()
    const W = spec.W
    const xs = spec.profile.map(p => p[0])
    const zFront = Math.max(...xs), zRear = Math.min(...xs)

    // ── karoserie: vytlačený boční profil typu (x=délka +příď, y=výška) ──
    const bodyGeo = new THREE.ExtrudeGeometry(shapeFromPts(spec.profile), {
      depth: W, curveSegments: 6,
      bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.05, bevelSegments: 2,
    })
    bodyGeo.translate(0, 0, -W / 2)
    bodyGeo.rotateY(-Math.PI / 2) // profil-x (délka) → world +z
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color, metalness: 0.7, roughness: 0.3,
      clearcoat: 1.0, clearcoatRoughness: 0.12,
    })
    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMat)
    // originál vrcholů karoserie — pro promáčknutí (dent) a jeho zpětné vrácení
    this._bodyOrig = bodyGeo.attributes.position.array.slice()
    g.add(this.bodyMesh)

    // ── prosklení (greenhouse): tmavý pás v oblasti kabiny, zapuštěný v šířce ──
    const [cx0, cx1, cyb, cyt] = spec.cabin
    const gw = W - 0.14
    const glassGeo = new THREE.BoxGeometry(gw, cyt - cyb, cx1 - cx0)
    glassGeo.translate(0, (cyb + cyt) / 2, (cx0 + cx1) / 2)
    g.add(new THREE.Mesh(glassGeo, new THREE.MeshPhysicalMaterial({
      color: 0x16303f, metalness: 0.25, roughness: 0.08, transparent: true, opacity: 0.74,
    })))

    // ── korba pickupu (jen ranger): boční bortnice + čelo + zadní čelo ──
    if (spec.bed) {
      const b = spec.bed, railMat = this.bodyMat
      const bedLen = b.x1 - b.x0, bedCx = (b.x0 + b.x1) / 2
      const rail = (sx) => {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.1, b.railH, bedLen), railMat)
        r.position.set(sx * (W / 2 - 0.05), b.y + b.railH / 2, bedCx); return r
      }
      g.add(rail(-1), rail(1))
      const front = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, b.railH, 0.1), railMat)
      front.position.set(0, b.y + b.railH / 2, b.x1); g.add(front)
      const tail = new THREE.Mesh(new THREE.BoxGeometry(W - 0.1, b.railH, 0.1), railMat)
      tail.position.set(0, b.y + b.railH / 2, b.x0); g.add(tail)
    }

    // ── chromové nárazníky (kapsle naležato), délka dle šířky auta ──
    const bumperGeo = mergeGeometries([
      new THREE.CapsuleGeometry(0.12, W - 0.2, 3, 8).rotateZ(Math.PI / 2).translate(0, 0.40, zFront - 0.02),
      new THREE.CapsuleGeometry(0.12, W - 0.2, 3, 8).rotateZ(Math.PI / 2).translate(0, 0.40, zRear + 0.02),
    ])
    g.add(new THREE.Mesh(bumperGeo, new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.95, roughness: 0.2 })))

    // ── světla (kapsle) — výška dle typu ──
    const lx = W / 2 - 0.28
    g.add(new THREE.Mesh(
      mergeGeometries([
        new THREE.CapsuleGeometry(0.09, 0.16, 2, 6).rotateZ(Math.PI / 2).translate(-lx, spec.frontLightY, zFront - 0.03),
        new THREE.CapsuleGeometry(0.09, 0.16, 2, 6).rotateZ(Math.PI / 2).translate(lx, spec.frontLightY, zFront - 0.03),
      ]),
      new THREE.MeshStandardMaterial({ color: 0xfff4cc, emissive: 0xffe9a8, emissiveIntensity: 1.2 }),
    ))
    g.add(new THREE.Mesh(
      mergeGeometries([
        new THREE.CapsuleGeometry(0.07, 0.22, 2, 6).rotateZ(Math.PI / 2).translate(-lx, spec.rearLightY, zRear + 0.03),
        new THREE.CapsuleGeometry(0.07, 0.22, 2, 6).rotateZ(Math.PI / 2).translate(lx, spec.rearLightY, zRear + 0.03),
      ]),
      new THREE.MeshStandardMaterial({ color: 0x5e0f0f, emissive: 0xd82418, emissiveIntensity: 1.1 }),
    ))

    // ── kola: závěs (steer pivot) → kolo (spin). Poloměr/rozvor dle typu. ──
    const wr = spec.wheelR
    const wheelGeo = mergeGeometries([
      paintGeo(new THREE.TorusGeometry(wr, wr * 0.44, 8, 16), 0x141416),
      paintGeo(new THREE.CylinderGeometry(wr * 0.6, wr * 0.6, 0.26, 12).rotateX(Math.PI / 2), 0xc4c9ce),
      paintGeo(new THREE.CylinderGeometry(0.075, 0.075, 0.28, 6).rotateX(Math.PI / 2), 0x8a8f94),
    ])
    wheelGeo.rotateY(Math.PI / 2)
    this._wheelEffR = wr * 1.44 // efektivní poloměr (kolo + pneu) pro rychlost rolování
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.5 })
    this.wheels = []      // samotná kola (spin)
    this.wheelPivots = [] // závěsy (steer) — index 0,1 = přední
    const [fz, rz] = spec.wheelZ
    for (const [sx, sz] of [[-1, fz], [1, fz], [-1, rz], [1, rz]]) {
      const pivot = new THREE.Group()
      pivot.position.set(sx * (W / 2 - 0.02), spec.wheelY, sz)
      const w = new THREE.Mesh(wheelGeo, wheelMat)
      pivot.add(w)
      g.add(pivot)
      this.wheels.push(w)
      this.wheelPivots.push(pivot)
    }

    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true } })
    return g
  }

  /** Směr přídě. Při yaw=0 auto míří +Z; kladný yaw točí doleva. */
  get forward() {
    return new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw))
  }

  get right() {
    return new THREE.Vector3(-Math.cos(this.yaw), 0, Math.sin(this.yaw))
  }

  reset(x = 0, z = 0, yaw = 0) {
    this.pos.set(x, 0, z)
    this.yaw = yaw
    this.vel.set(0, 0, 0)
    this._fwdSpeed = 0
    this._drifting = false
    // vyrovnat karoserii zpět do původního tvaru (oprava po vraku)
    if (this._bodyOrig) {
      const pos = this.bodyMesh.geometry.attributes.position
      pos.array.set(this._bodyOrig)
      pos.needsUpdate = true
      this.bodyMesh.geometry.computeVertexNormals()
    }
  }

  /**
   * Promáčkne karoserii na straně nárazu. (tx,tz) = směr jízdy do překážky
   * (normalizovaný); panel čelem k němu se vboří dovnitř. `strength` ~ nárazová
   * rychlost (m/s). Kumuluje se přes nárazy, ale vrchol se odchýlí max ~0,45 m
   * od originálu, ať se auto nescvrkne.
   */
  dent(tx, tz, strength) {
    const amt = Math.min(0.32, strength * 0.028)
    if (amt < 0.02 || !this.bodyMesh) return
    const geo = this.bodyMesh.geometry
    const pos = geo.attributes.position
    const orig = this._bodyOrig
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw)
    // směr jízdy do lokálu karoserie (inverzní rotace o yaw kolem Y)
    const ltx = tx * c - tz * s, ltz = tx * s + tz * c
    const MAX = 0.45
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i)
      // projekce polohy vrcholu na směr nárazu (>0 = na zasažené straně)
      const proj = vx * ltx + vz * ltz
      if (proj <= 0) continue
      const w = Math.min(1, proj / 2.2) ** 1.5
      if (w <= 0) continue
      // zvlnění pro nepravidelné (přirozené) pomačkání
      const ripple = 0.7 + 0.3 * Math.cos(vy * 9 + vx * 7)
      const d = amt * w * ripple
      let nx = vx - ltx * d, nz = vz - ltz * d, ny = vy - d * 0.22 * w
      // clamp odchylky od originálu (auto se nesmí scvrknout)
      const ox = orig[i * 3], oy = orig[i * 3 + 1], oz = orig[i * 3 + 2]
      const dx = nx - ox, dy = ny - oy, dz = nz - oz
      const dl = Math.hypot(dx, dy, dz)
      if (dl > MAX) { const k = MAX / dl; nx = ox + dx * k; ny = oy + dy * k; nz = oz + dz * k }
      pos.setXYZ(i, nx, ny, nz)
    }
    pos.needsUpdate = true
    geo.computeVertexNormals()
  }

  /**
   * @param input {throttle: -1..1, steer: -1..1 (+doprava)}
   * @param heightAt volitelná fce (x,z)→y — terén: svah zpomaluje/zrychluje,
   *   auto kopíruje výšku a naklání se podle normály.
   */
  update(dt, input, heightAt = null) {
    // ── bicycle model: zatáčejí PŘEDNÍ kola (yaw rate = v/L · tan δ) ──
    // Auto tak přirozeně rotuje kolem zadní nápravy místo vlastního středu:
    // poloměr zatáčky určuje rejd předních kol a roste s rozvorem; couvání
    // řídí opačně samo od sebe (záporné v). Rejd se s rychlostí zmenšuje
    // (stabilita) a yaw rate má strop proti přetočení.
    const steerAngle = -input.steer * MAX_STEER / (1 + Math.abs(this._fwdSpeed) * 0.028)
    let yawRate = (this._fwdSpeed / WHEELBASE) * Math.tan(steerAngle)
    if (this._drifting) yawRate *= 1.25 // víc otočivosti ve smyku = protiřízení funguje
    const yawCap = this._drifting ? 2.8 : 2.4
    yawRate = Math.max(-yawCap, Math.min(yawCap, yawRate))
    // vyprošťovací dotáčení: bicycle model se v nule netočí — s plynem u zdi
    // přidáme pomalou rotaci na místě (mizí s rychlostí)
    if (input.throttle !== 0) {
      const lowT = Math.max(0, 1 - Math.abs(this._fwdSpeed) / 3)
      const revSign = input.throttle < 0 ? -1 : 1
      yawRate += -input.steer * 0.9 * lowT * revSign
    }
    this.yaw += yawRate * dt
    this._steerAngle = steerAngle

    const fwd = this.forward
    const rgt = this.right
    let fwdSpeed = this.vel.dot(fwd)
    let latSpeed = this.vel.dot(rgt)

    // gradient terénu (pro svah i naklonění karoserie)
    let gx = 0, gz = 0
    if (heightAt) {
      const e = 1.4
      gx = (heightAt(this.pos.x + e, this.pos.z) - heightAt(this.pos.x - e, this.pos.z)) / (2 * e)
      gz = (heightAt(this.pos.x, this.pos.z + e) - heightAt(this.pos.x, this.pos.z - e)) / (2 * e)
      fwdSpeed -= 9.0 * (gx * fwd.x + gz * fwd.z) * dt // do kopce brzdí, z kopce táhne
    }

    let accel = 0
    if (input.throttle > 0) {
      accel = ENGINE_ACCEL * input.throttle
    } else if (input.throttle < 0) {
      accel = fwdSpeed > 0.3 ? BRAKE_DECEL * input.throttle : REVERSE_ACCEL * input.throttle
    }
    fwdSpeed += accel * dt
    fwdSpeed = Math.max(-MAX_REVERSE, Math.min(MAX_SPEED, fwdSpeed))

    // ── drift (NFS styl): přenos váhy — ostré zatočení v rychlosti snižuje
    // boční grip, skluz přeroste práh → smyk; pod DRIFT_EXIT se auto chytí.
    const absLat = Math.abs(latSpeed)
    if (!this._drifting && absLat > DRIFT_ENTER && Math.abs(fwdSpeed) > 8) this._drifting = true
    else if (this._drifting && absLat < DRIFT_EXIT) this._drifting = false
    const loadLoss = Math.min(1, (Math.abs(input.steer) * Math.abs(fwdSpeed)) / 26)
    const gripNow = this._drifting ? DRIFT_GRIP : TIRE_GRIP * (1 - 0.6 * loadLoss)
    latSpeed *= Math.exp(-gripNow * dt)
    if (this._drifting) fwdSpeed *= Math.exp(-0.4 * dt) // smyk drhne — ubírá tempo

    this.vel.copy(fwd).multiplyScalar(fwdSpeed).addScaledVector(rgt, latSpeed)
    const speed = this.vel.length()
    if (speed > 1e-4) {
      const resist = ROLL_RESIST + DRAG_COEF * speed * speed
      const drop = Math.min(speed, resist * dt)
      this.vel.multiplyScalar((speed - drop) / speed)
    }

    this._fwdSpeed = this.vel.dot(fwd)
    this.pos.addScaledVector(this.vel, dt)

    // spin (rolování) jen na kole; natočení (steer) jen na závěsu — oddělené
    // osy, žádné skládání dvou rotací na jednom objektu.
    for (const w of this.wheels) w.rotation.x -= this._fwdSpeed * dt / this._wheelEffR
    this.wheelPivots[0].rotation.y = this._steerAngle
    this.wheelPivots[1].rotation.y = this._steerAngle

    if (heightAt) {
      this.pos.y = heightAt(this.pos.x, this.pos.z)
      _up.set(-gx, 1, -gz).normalize()
      _fwd2.copy(fwd).addScaledVector(_up, -fwd.dot(_up)).normalize()
      _rgt2.crossVectors(_up, _fwd2)
      _m.makeBasis(_rgt2, _up, _fwd2)
      this.mesh.quaternion.setFromRotationMatrix(_m)
    } else {
      this.pos.y = 0
      this.mesh.rotation.y = this.yaw
    }
    this.mesh.position.copy(this.pos)
  }

  get speedKmh() {
    return this.vel.length() * 3.6
  }

  get lateralSpeed() {
    return this.vel.dot(this.right)
  }

  /** f: 0 (nové) .. 1 (vrak) */
  setDamage(f) {
    this.bodyMat.color.copy(this.baseColor).lerp(new THREE.Color(0x1b1b1d), Math.min(1, f) * 0.85)
    this.bodyMat.clearcoat = 1 - Math.min(1, f) * 0.8
  }
}

export { RADIUS as CAR_RADIUS }
