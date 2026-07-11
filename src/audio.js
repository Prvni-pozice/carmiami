// audio.js — WebAudio syntéza (stejný přístup jako Island Run): motor,
// pískání pneumatik, náraz, komiksové "boing" při zásahu chodce, výbuch.
// Bez externích souborů. init() se volá až po prvním user gestu (start).
export class GameAudio {
  constructor() {
    this.ctx = null
  }

  init() {
    if (this.ctx) return
    const AC = window.AudioContext || window.webkitAudioContext
    if (!AC) return
    const ctx = this.ctx = new AC()

    this.master = ctx.createGain()
    this.master.gain.value = 0.5
    this.master.connect(ctx.destination)

    // motor: pila + oktáva níž čtverec přes lowpass, výška dle rychlosti
    this.engOsc = ctx.createOscillator(); this.engOsc.type = 'sawtooth'; this.engOsc.frequency.value = 70
    this.engOsc2 = ctx.createOscillator(); this.engOsc2.type = 'square'; this.engOsc2.frequency.value = 35
    const engFilter = ctx.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 420
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0
    this.engOsc.connect(engFilter); this.engOsc2.connect(engFilter)
    engFilter.connect(this.engGain); this.engGain.connect(this.master)
    this.engOsc.start(); this.engOsc2.start()

    // pískání pneumatik: smyčka šumu přes bandpass
    this.scrSrc = ctx.createBufferSource()
    this.scrSrc.buffer = this._noise(1)
    this.scrSrc.loop = true
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 4
    this.scrGain = ctx.createGain(); this.scrGain.gain.value = 0
    this.scrSrc.connect(bp); bp.connect(this.scrGain); this.scrGain.connect(this.master)
    this.scrSrc.start()
  }

  _noise(sec) {
    const n = Math.floor(this.ctx.sampleRate * sec)
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1
    return buf
  }

  /** ratio 0..1 dle rychlosti */
  setEngine(ratio) {
    if (!this.ctx) return
    const t = this.ctx.currentTime
    this.engOsc.frequency.setTargetAtTime(60 + ratio * 190, t, 0.05)
    this.engOsc2.frequency.setTargetAtTime(30 + ratio * 95, t, 0.05)
    this.engGain.gain.setTargetAtTime(0.035 + ratio * 0.055, t, 0.05)
  }

  engineOff() {
    if (this.ctx) this.engGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25)
  }

  /** amount 0..1 dle bočního skluzu */
  setScreech(amount) {
    if (this.ctx) this.scrGain.gain.setTargetAtTime(amount * 0.11, this.ctx.currentTime, 0.06)
  }

  /** intensity ~0..1.5 dle síly nárazu */
  crash(intensity = 1) {
    if (!this.ctx) return
    const ctx = this.ctx, t = ctx.currentTime
    const src = ctx.createBufferSource(); src.buffer = this._noise(0.3)
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.45 * intensity, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25)
    src.connect(lp); lp.connect(g); g.connect(this.master)
    src.start()
    const o = ctx.createOscillator(); o.type = 'sine'
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.2)
    const og = ctx.createGain()
    og.gain.setValueAtTime(0.35 * intensity, t)
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
    o.connect(og); og.connect(this.master)
    o.start(t); o.stop(t + 0.25)
  }

  /** komiksové boing při zásahu chodce */
  pedHit() {
    if (!this.ctx) return
    const ctx = this.ctx, t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'square'
    o.frequency.setValueAtTime(280, t)
    o.frequency.exponentialRampToValueAtTime(720, t + 0.1)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.16, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14)
    o.connect(g); g.connect(this.master)
    o.start(t); o.stop(t + 0.15)
  }

  /** zničení auta */
  boom() {
    if (!this.ctx) return
    this.crash(1.5)
    const ctx = this.ctx, t = ctx.currentTime
    const o = ctx.createOscillator(); o.type = 'triangle'
    o.frequency.setValueAtTime(60, t); o.frequency.exponentialRampToValueAtTime(25, t + 0.5)
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.5, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
    o.connect(g); g.connect(this.master)
    o.start(t); o.stop(t + 0.6)
  }
}
