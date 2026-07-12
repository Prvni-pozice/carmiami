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

export class Car {
  constructor(color = 0xd83a2e) {
    this.baseColor = new THREE.Color(color)
    this.mesh = this._buildMesh(color)
    this.pos = new THREE.Vector3(0, 0, 0)
    this.yaw = 0
    this.vel = new THREE.Vector3(0, 0, 0)
    this._fwdSpeed = 0
    this._drifting = false
    this.mesh.position.copy(this.pos)
  }

  _buildMesh(color) {
    const g = new THREE.Group()

    // ── karoserie: vytlačený 2D boční profil se zaoblenými hranami ──
    // Profil v rovině (x = délka, +x příď; y = výška), extrude = šířka.
    const s = new THREE.Shape()
    s.moveTo(-2.10, 0.30)                          // zadní spodek
    s.lineTo(-2.16, 0.66)                          // záď
    s.quadraticCurveTo(-2.10, 0.82, -1.85, 0.84)   // hrana kufru
    s.lineTo(-1.15, 0.86)                          // kufr
    s.quadraticCurveTo(-0.95, 0.88, -0.72, 1.08)   // nástup zadního skla
    s.quadraticCurveTo(-0.50, 1.27, -0.05, 1.29)   // zadní sklo → střecha
    s.lineTo(0.30, 1.28)                           // střecha
    s.quadraticCurveTo(0.62, 1.24, 0.95, 0.95)     // čelní sklo
    s.quadraticCurveTo(1.10, 0.88, 1.35, 0.86)     // báze kapoty
    s.lineTo(1.90, 0.80)                           // kapota (mírný spád)
    s.quadraticCurveTo(2.14, 0.76, 2.18, 0.58)     // nos
    s.lineTo(2.14, 0.30)                           // předek dole
    s.lineTo(-2.10, 0.30)                          // podvozek

    const W = 1.68
    const bodyGeo = new THREE.ExtrudeGeometry(s, {
      depth: W, curveSegments: 12,
      bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.06, bevelSegments: 4,
    })
    bodyGeo.translate(0, 0, -W / 2)
    bodyGeo.rotateY(-Math.PI / 2) // profil-x (délka) → world +z
    this.bodyMat = new THREE.MeshPhysicalMaterial({
      color, metalness: 0.7, roughness: 0.28,
      clearcoat: 1.0, clearcoatRoughness: 0.1,
    })
    g.add(new THREE.Mesh(bodyGeo, this.bodyMat))

    // ── kabina: vytlačený pás skla, mírně zapuštěný ──
    const gs = new THREE.Shape()
    gs.moveTo(-0.92, 0.90)
    gs.quadraticCurveTo(-0.68, 0.92, -0.60, 1.10)
    gs.quadraticCurveTo(-0.42, 1.315, -0.02, 1.325)
    gs.lineTo(0.28, 1.315)
    gs.quadraticCurveTo(0.58, 1.27, 0.90, 0.97)
    gs.lineTo(0.90, 0.90)
    gs.lineTo(-0.92, 0.90)
    const glassGeo = new THREE.ExtrudeGeometry(gs, {
      depth: 1.52, curveSegments: 10,
      bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.025, bevelSegments: 2,
    })
    glassGeo.translate(0, 0, -1.52 / 2)
    glassGeo.rotateY(-Math.PI / 2)
    const glass = new THREE.Mesh(
      glassGeo,
      new THREE.MeshPhysicalMaterial({
        color: 0x1e3d52, metalness: 0.2, roughness: 0.06,
        transparent: true, opacity: 0.72,
      }),
    )
    g.add(glass)

    // ── kulaté chromové nárazníky (kapsle naležato) ──
    const bumperGeo = mergeGeometries([
      new THREE.CapsuleGeometry(0.13, 1.55, 3, 10).rotateZ(Math.PI / 2).translate(0, 0.40, 2.16),
      new THREE.CapsuleGeometry(0.13, 1.55, 3, 10).rotateZ(Math.PI / 2).translate(0, 0.40, -2.14),
    ])
    g.add(new THREE.Mesh(
      bumperGeo,
      new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 0.95, roughness: 0.2 }),
    ))

    // ── světla (kapsle) ──
    const head = new THREE.Mesh(
      mergeGeometries([
        new THREE.CapsuleGeometry(0.09, 0.16, 2, 8).rotateZ(Math.PI / 2).translate(-0.58, 0.62, 2.16),
        new THREE.CapsuleGeometry(0.09, 0.16, 2, 8).rotateZ(Math.PI / 2).translate(0.58, 0.62, 2.16),
      ]),
      new THREE.MeshStandardMaterial({ color: 0xfff4cc, emissive: 0xffe9a8, emissiveIntensity: 1.2 }),
    )
    const tail = new THREE.Mesh(
      mergeGeometries([
        new THREE.CapsuleGeometry(0.07, 0.22, 2, 8).rotateZ(Math.PI / 2).translate(-0.58, 0.64, -2.15),
        new THREE.CapsuleGeometry(0.07, 0.22, 2, 8).rotateZ(Math.PI / 2).translate(0.58, 0.64, -2.15),
      ]),
      new THREE.MeshStandardMaterial({ color: 0x5e0f0f, emissive: 0xd82418, emissiveIntensity: 1.1 }),
    )
    g.add(head, tail)

    // ── kola: kulatá pneumatika (torus) + disk — větší, méně "hračkové" ──
    // Kolo = závěs (steer pivot, natáčí se doleva/doprava) obsahující
    // samotné kolo (spin, otáčí se dokola). Dřív se steer i spin nastavovaly
    // na STEJNÉM Object3D přes Euler rotation.x/rotation.y zvlášť — funkčně
    // to "nešmajdalo" náhodně, ale při každé změně natočení Three.js
    // interně rekonstruovalo celou orientaci z X i Y najednou, takže kolo
    // vizuálně poskakovalo/kymácelo se s každou změnou řízení. Hierarchie
    // (pivot → kolo) je fyzikálně čistá a jednoznačná bez ohledu na pořadí
    // os: pivot nese natočení, kolo v něm jen roluje.
    const wheelGeo = mergeGeometries([
      paintGeo(new THREE.TorusGeometry(0.36, 0.16, 12, 24), 0x141416),
      paintGeo(new THREE.CylinderGeometry(0.22, 0.22, 0.26, 14).rotateX(Math.PI / 2), 0xc4c9ce),
      paintGeo(new THREE.CylinderGeometry(0.075, 0.075, 0.28, 8).rotateX(Math.PI / 2), 0x8a8f94), // střed
    ])
    wheelGeo.rotateY(Math.PI / 2) // sdílená osa (torus+disky, dřív Z) → lokální X = osa rolování
    const wheelMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.55, roughness: 0.5 })
    this.wheels = []      // samotná kola (spin)
    this.wheelPivots = [] // závěsy (steer) — index 0,1 = přední
    for (const [sx, sz] of [[-1, 1.30], [1, 1.30], [-1, -1.30], [1, -1.30]]) {
      const pivot = new THREE.Group()
      pivot.position.set(sx * 0.88, 0.475, sz)
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
    for (const w of this.wheels) w.rotation.x -= this._fwdSpeed * dt / 0.52 // efektivní poloměr kola (R+tloušťka pneu)
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
