// mapenv.js — denní venkovské prostředí pro mapové úrovně (Skrýšov):
// jasná obloha s teplým sluncem, měkké mraky, zelenkavá mlha. Bez oceánu.
// Vlastní soubor (nesdílí s Miami environment.js), env-mapa pro odlesky.
import * as THREE from 'three'

export const SUN_DIR = new THREE.Vector3(0.4, 0.62, 0.3).normalize()

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const SKY_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform vec3 uSunDir;
  void main() {
    vec3 dir = normalize(vDir);
    float t = clamp(dir.y, 0.0, 1.0);
    // sytější letní modrá: světlá u obzoru → sytě modrá v zenitu
    vec3 horizon = vec3(0.60, 0.76, 0.90);
    vec3 mid     = vec3(0.30, 0.56, 0.88);
    vec3 zenith  = vec3(0.12, 0.36, 0.78);
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.35, t));
    col = mix(col, zenith, smoothstep(0.3, 0.9, t));
    // slunce: jasný disk + teplá koróna
    float d = max(dot(dir, uSunDir), 0.0);
    col += smoothstep(0.9985, 0.9995, d) * vec3(1.0, 0.98, 0.9) * 2.2;   // disk
    col += pow(d, 180.0) * vec3(1.0, 0.95, 0.82) * 1.1;                  // ostrá záře
    col += pow(d, 12.0) * vec3(1.0, 0.9, 0.72) * 0.28;                   // měkká koróna
    gl_FragColor = vec4(col, 1.0);
  }
`

export class MapEnv {
  constructor(scene, half) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: { uSunDir: { value: SUN_DIR.clone() } },
      side: THREE.BackSide, depthWrite: false, fog: false,
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(Math.max(700, half * 1.6), 24, 14), this.skyMat)
    this.dome.frustumCulled = false
    scene.add(this.dome)

    const hemi = new THREE.HemisphereLight(0xbfe0ff, 0x6a7850, 0.65)
    scene.add(hemi)
    this.sun = new THREE.DirectionalLight(0xfff6e6, 2.5)
    this.sun.position.copy(SUN_DIR).multiplyScalar(200)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const S = Math.min(220, half)
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S
    this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S
    this.sun.shadow.camera.far = 600
    this.sun.shadow.bias = -0.0005
    scene.add(this.sun)

    // ŽÁDNÁ mlha: THREE.Fog s barvou blízkou obloze na VELKÉ mapě (half~467)
    // zašeďoval celou scénu do siluet (Zdeňkova diagnostika: ?nofog scénu
    // opraví). Čistý horizont dá sky dome + rozumný camera.far v main_map.
    // this.fog ponecháno kvůli Quality (odkaz), ale prakticky vypnuto (daleko).
    scene.fog = new THREE.Fog(0x9dc0e6, half * 6, half * 8)
    this.fog = scene.fog

    // kupovité letní mraky (více vrstvených chuchvalců = objem, ne placka)
    this.clouds = []
    for (let i = 0; i < 11; i++) {
      const w = 120 + Math.random() * 180
      const cloud = new THREE.Mesh(
        new THREE.PlaneGeometry(w, w * 0.52),
        new THREE.MeshBasicMaterial({ map: this._cloudTexture(), transparent: true, depthWrite: false, opacity: 0.82, color: 0xe9eef4, fog: false }),
      )
      const a = Math.random() * Math.PI * 2, r = half * 0.6 + Math.random() * half * 0.9
      cloud.position.set(Math.cos(a) * r, 120 + Math.random() * 120, Math.sin(a) * r)
      scene.add(cloud)
      this.clouds.push(cloud)
    }
  }

  _cloudTexture() {
    const c = document.createElement('canvas')
    c.width = 320; c.height = 180
    const g = c.getContext('2d')
    // kupovitý tvar: shluk kulatých "boulí" dole rovných, nahoře nakupených
    const n = 7 + (Math.random() * 5 | 0)
    const cx = 160, cy = 118
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1)
      const px = cx + (t - 0.5) * 200
      const py = cy - Math.sin(t * Math.PI) * 42 - Math.random() * 20
      const r = 34 + Math.random() * 30
      // stín zespodu
      const grad = g.createRadialGradient(px, py + r * 0.3, r * 0.2, px, py, r)
      grad.addColorStop(0, 'rgba(255,255,255,0.98)')
      grad.addColorStop(0.6, 'rgba(244,248,252,0.92)')
      grad.addColorStop(1, 'rgba(214,226,238,0)')
      g.fillStyle = grad
      g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill()
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  applyEnvMap(renderer, scene) {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = new THREE.Scene()
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat))
    const ground = new THREE.Mesh(new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x6a7a4a }))
    ground.position.y = -2
    envScene.add(ground)
    const rt = pmrem.fromScene(envScene, 0.05)
    scene.environment = rt.texture
    pmrem.dispose()
  }

  update(dt, camera) {
    this.dome.position.set(camera.position.x, 0, camera.position.z)
    for (const c of this.clouds) c.lookAt(camera.position)
  }
}
