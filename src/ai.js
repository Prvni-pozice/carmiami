// ai.js — AI soupeř: pronásleduje hráče (s predikcí pohybu) a taranuje ho.
// Používá stejnou fyziku Car jako hráč, jen počítá vlastní vstup
// {throttle, steer}. Detekce zaseknutí → chvíli couvá s opačným rejdem.
import { Car, CAR_RADIUS } from './car.js'
import { resolveCollisions } from './city.js'

function wrapAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

const RESPAWN_DELAY = 6

export class AICar {
  constructor(scene, color, x, z, yaw = 0) {
    this.car = new Car(color)
    this.car.reset(x, z, yaw)
    scene.add(this.car.mesh)
    this.spawn = { x, z, yaw }
    this.maxHp = 70
    this.hp = this.maxHp
    this.wrecked = false
    this.respawnT = 0
    this.stuckT = 0
    this.reverseT = 0
  }

  update(dt, playerCar, arena) {
    if (this.wrecked) {
      this.respawnT -= dt
      return
    }
    const c = this.car

    // cíl = predikovaná pozice hráče (mírný předstih po směru jeho jízdy)
    const tx = playerCar.pos.x + playerCar.vel.x * 0.4
    const tz = playerCar.pos.z + playerCar.vel.z * 0.4
    const dx = tx - c.pos.x
    const dz = tz - c.pos.z
    const desiredYaw = Math.atan2(dx, dz) // forward = (sin yaw, cos yaw)
    const diff = wrapAngle(desiredYaw - c.yaw)

    // kladný diff = cíl vlevo → steer záporný (viz znaménko v Car.update)
    let steer = -Math.max(-1, Math.min(1, diff * 1.6))
    let throttle = Math.abs(diff) < 1.3 ? 1 : 0.55

    // zaseknutí o zeď/plot/strom → vycouvat; při opakovaném zákysu couvat
    // déle a střídat směr rejdu (jinak AI pinponguje na místě)
    if (this.reverseT > 0) {
      this.reverseT -= dt
      throttle = -1
      steer = (this.unstickFlip ? 1 : -1) * Math.sign(steer || 1)
    } else {
      if (c.vel.length() < 0.8) this.stuckT += dt
      else { this.stuckT = 0; this.stuckCount = 0 }
      if (this.stuckT > 1.2) {
        this.stuckCount = (this.stuckCount || 0) + 1
        this.reverseT = Math.min(2.2, 0.9 + this.stuckCount * 0.4)
        this.unstickFlip = !this.unstickFlip
        this.stuckT = 0
      }
    }

    c.update(dt, { throttle, steer }, arena.heightAt || null)
    resolveCollisions(c, arena, CAR_RADIUS)
  }

  wreck() {
    this.wrecked = true
    this.respawnT = RESPAWN_DELAY
    this.hp = 0
    this.car.setDamage(1)
    // lokální náklon — NIKDY přes .rotation.z (přepis euler složky umí
    // auto převrátit/zabořit, závisí na směru jízdy v okamžiku zničení)
    this.car.mesh.rotateZ(0.14)
  }

  tryRespawn() {
    if (!this.wrecked || this.respawnT > 0) return false
    this.wrecked = false
    this.hp = this.maxHp
    this.car.reset(this.spawn.x, this.spawn.z, this.spawn.yaw)
    this.car.setDamage(0) // orientaci srovná první update() (staví quaternion od nuly)
    this.stuckT = 0
    this.reverseT = 0
    return true
  }
}
