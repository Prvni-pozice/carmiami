// camera.js — kamera za autem s rychlým dojezdem (pomalý lerp působil jako
// lag ovládání) a look-ahead dle rychlosti. Zná terén: drží se nad ním
// a sleduje výšku auta.
import * as THREE from 'three'

const DIST = 7.8
const HEIGHT = 3.5
const LOOK_HEIGHT = 1.0
const FOLLOW_LERP = 10
const LOOK_LERP = 14

export class ChaseCamera {
  constructor(camera, heightAt = null) {
    this.camera = camera
    this.heightAt = heightAt
    this.currentPos = new THREE.Vector3()
    this.currentLook = new THREE.Vector3()
    this._initialized = false
  }

  _targetY(car, x, z) {
    let y = car.pos.y + HEIGHT
    if (this.heightAt) y = Math.max(y, this.heightAt(x, z) + 1.4) // neprojet kopcem
    return y
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

    const back = car.forward.clone().multiplyScalar(-DIST)
    const tx = car.pos.x + back.x, tz = car.pos.z + back.z
    const targetPos = new THREE.Vector3(tx, this._targetY(car, tx, tz), tz)
    const fwdSpeed = car.vel.dot(car.forward)
    const lookAhead = car.forward.clone().multiplyScalar(Math.max(0, fwdSpeed) * 0.35)
    const targetLook = car.pos.clone().add(lookAhead).setY(car.pos.y + LOOK_HEIGHT)

    const posT = 1 - Math.exp(-FOLLOW_LERP * dt)
    const lookT = 1 - Math.exp(-LOOK_LERP * dt)
    this.currentPos.lerp(targetPos, posT)
    this.currentLook.lerp(targetLook, lookT)

    this.camera.position.copy(this.currentPos)
    this.camera.lookAt(this.currentLook)
  }
}
