// controls.js — klávesnice (šipky/WASD) i mobil (4 tlačítka: plyn/brzda/vlevo/vpravo).
export function isTouchDevice() {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

export class Controls {
  constructor() {
    this.touch = isTouchDevice()
    this.keys = new Set()
    this.touchState = { gas: false, brake: false, left: false, right: false }
    this.resetPressed = false

    this._setupKeyboard()
    if (this.touch) this._setupTouch()
  }

  _setupKeyboard() {
    document.addEventListener('keydown', e => {
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyR'].includes(e.code)) {
        e.preventDefault()
      }
      this.keys.add(e.code)
      if (e.code === 'KeyR') this.resetPressed = true
    })
    document.addEventListener('keyup', e => this.keys.delete(e.code))
  }

  _setupTouch() {
    document.getElementById('touch-controls').classList.add('active')
    const bind = (id, key) => {
      const el = document.getElementById(id)
      const on = e => { e.preventDefault(); this.touchState[key] = true; el.classList.add('pressed') }
      const off = e => { e.preventDefault(); this.touchState[key] = false; el.classList.remove('pressed') }
      el.addEventListener('touchstart', on, { passive: false })
      el.addEventListener('touchend', off, { passive: false })
      el.addEventListener('touchcancel', off, { passive: false })
    }
    bind('gas-btn', 'gas')
    bind('brake-btn', 'brake')
    bind('steer-left', 'left')
    bind('steer-right', 'right')
  }

  /** {throttle: -1..1, steer: -1..1 (+doprava), reset: bool} */
  getInput() {
    let throttle = 0, steer = 0
    const gas = this.touch ? this.touchState.gas : (this.keys.has('KeyW') || this.keys.has('ArrowUp'))
    const brake = this.touch ? this.touchState.brake : (this.keys.has('KeyS') || this.keys.has('ArrowDown'))
    const left = this.touch ? this.touchState.left : (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))
    const right = this.touch ? this.touchState.right : (this.keys.has('KeyD') || this.keys.has('ArrowRight'))
    if (gas) throttle += 1
    if (brake) throttle -= 1
    if (right) steer += 1
    if (left) steer -= 1
    const reset = this.resetPressed
    this.resetPressed = false
    return { throttle, steer, reset }
  }
}
