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

    // ── motor (NFS styl): dvě mírně rozladěné pily (basové harmonické) + sub
    // oktáva, přes REZONANČNÍ lowpass, který se s otáčkami otevírá (growl).
    // Tremolo LFO na hlasitosti dělá "hrčení" (jednotlivé výbuchy válců).
    this.engBase = 46 // Hz při volnoběhu
    this.eoA = ctx.createOscillator(); this.eoA.type = 'sawtooth'; this.eoA.frequency.value = this.engBase
    this.eoB = ctx.createOscillator(); this.eoB.type = 'sawtooth'; this.eoB.frequency.value = this.engBase; this.eoB.detune.value = 11
    this.eoSub = ctx.createOscillator(); this.eoSub.type = 'triangle'; this.eoSub.frequency.value = this.engBase * 0.5
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 300; this.engFilter.Q.value = 7
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0
    // tremolo (hrčení válců)
    this.engLfo = ctx.createOscillator(); this.engLfo.type = 'sawtooth'; this.engLfo.frequency.value = 24
    this.engLfoGain = ctx.createGain(); this.engLfoGain.gain.value = 0.05
    this.eoA.connect(this.engFilter); this.eoB.connect(this.engFilter); this.eoSub.connect(this.engFilter)
    this.engFilter.connect(this.engGain); this.engGain.connect(this.master)
    this.engLfo.connect(this.engLfoGain); this.engLfoGain.connect(this.engGain.gain)
    this.eoA.start(); this.eoB.start(); this.eoSub.start(); this.engLfo.start()

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
    const f = this.engBase + ratio * 236 // 46 → ~282 Hz
    this.eoA.frequency.setTargetAtTime(f, t, 0.06)
    this.eoB.frequency.setTargetAtTime(f, t, 0.06)
    this.eoSub.frequency.setTargetAtTime(f * 0.5, t, 0.06)
    // filtr se s otáčkami otevírá → jasnější "řev" pod plynem
    this.engFilter.frequency.setTargetAtTime(320 + ratio * 2600, t, 0.06)
    // hrčení zrychluje s otáčkami
    this.engLfo.frequency.setTargetAtTime(20 + ratio * 70, t, 0.06)
    this.engGain.gain.setTargetAtTime(0.05 + ratio * 0.07, t, 0.06)
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

  /** srandovní skřek při zásahu chodce ("wa-hej!" — vokální kontura + vibrato) */
  pedYelp() {
    if (!this.ctx) return
    const ctx = this.ctx, t = ctx.currentTime
    const base = 300 + Math.random() * 260 // náhodná výška hlasu → různí lidé
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'
    const o2 = ctx.createOscillator(); o2.type = 'square'; o2.detune.value = 1200 // oktáva výš
    // kontura skřeku: prudce nahoru, pak spadne (leknutí)
    for (const o of [o1, o2]) {
      o.frequency.setValueAtTime(base, t)
      o.frequency.exponentialRampToValueAtTime(base * 2.1, t + 0.09)
      o.frequency.exponentialRampToValueAtTime(base * 0.72, t + 0.42)
    }
    // vibrato → "roztřesený" komický hlas
    const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 22
    const vibG = ctx.createGain(); vibG.gain.value = base * 0.06
    vib.connect(vibG); vibG.connect(o1.frequency); vibG.connect(o2.frequency)
    // formant (bandpass) → vokálnější, míň pískavé
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 3
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.03)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
    o1.connect(bp); o2.connect(bp); bp.connect(g); g.connect(this.master)
    o1.start(t); o2.start(t); vib.start(t)
    o1.stop(t + 0.47); o2.stop(t + 0.47); vib.stop(t + 0.47)
  }

  /** krátký "oof/uf" heknutí při nárazu auta */
  carOof() {
    if (!this.ctx) return
    const ctx = this.ctx, t = ctx.currentTime
    const base = 150 + Math.random() * 60
    const o = ctx.createOscillator(); o.type = 'sawtooth'
    o.frequency.setValueAtTime(base * 1.6, t)
    o.frequency.exponentialRampToValueAtTime(base * 0.7, t + 0.22)
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 2
    const g = ctx.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.26)
    o.connect(bp); bp.connect(g); g.connect(this.master)
    o.start(t); o.stop(t + 0.28)
  }

  /** zpětná kompatibilita */
  pedHit() { this.pedYelp() }

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
