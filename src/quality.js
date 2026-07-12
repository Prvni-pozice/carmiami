// quality.js — adaptivní kvalita dle FPS (vzor Island Run). Tři stupně:
// 2 = plné rozlišení + stíny 2048, 1 = 1.5× pixel ratio + stíny 1024,
// 0 = 1× pixel ratio, bez stínů, kratší mlha. iPhone 13 Pro a lepší
// zůstane na 2; slabší zařízení sjede dolů samo.
export class Quality {
  constructor(renderer, sun, fog, composer = null) {
    this.renderer = renderer
    this.sun = sun
    this.fog = fog
    this.composer = composer
    this.tier = 2
    this.fps = 60
    this.lowT = 0
    this.highT = 0
    this.apply(this.tier)
  }

  apply(tier) {
    this.tier = tier
    const dpr = Math.min(devicePixelRatio || 1, 2)
    // composer sdílí pixel ratio s rendererem (nastaveno níže)
    if (tier === 2) {
      this.renderer.setPixelRatio(dpr)
      this._shadow(2048, true)
      if (this.fog) this.fog.far = 300
    } else if (tier === 1) {
      this.renderer.setPixelRatio(Math.min(dpr, 1.5))
      this._shadow(1024, true)
      if (this.fog) this.fog.far = 240
    } else {
      this.renderer.setPixelRatio(1)
      this._shadow(0, false)
      if (this.fog) this.fog.far = 170
    }
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio())
      this.composer.setSize(innerWidth, innerHeight)
    }
  }

  _shadow(size, on) {
    this.sun.castShadow = on
    if (on) {
      this.sun.shadow.mapSize.set(size, size)
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null }
    }
  }

  update(dt) {
    this.fps = this.fps * 0.95 + (1 / Math.max(dt, 1e-3)) * 0.05
    if (this.fps < 42 && this.tier > 0) {
      this.lowT += dt
      if (this.lowT > 2) { this.apply(this.tier - 1); this.lowT = 0; this.highT = 0 }
    } else this.lowT = 0
    if (this.fps > 56 && this.tier < 2) {
      this.highT += dt
      if (this.highT > 6) { this.apply(this.tier + 1); this.highT = 0 }
    } else this.highT = 0
  }
}
