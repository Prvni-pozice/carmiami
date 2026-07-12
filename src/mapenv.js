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
    float t = clamp(dir.y * 1.3 + 0.10, 0.0, 1.0);
    vec3 horizon = vec3(0.86, 0.90, 0.92);
    vec3 zenith  = vec3(0.30, 0.55, 0.86);
    vec3 col = mix(horizon, zenith, smoothstep(0.0, 1.0, t));
    float d = max(dot(dir, uSunDir), 0.0);
    col += smoothstep(0.9990, 0.9997, d) * vec3(1.0, 0.97, 0.85) * 1.2;
    col += pow(d, 30.0) * vec3(1.0, 0.9, 0.7) * 0.35;
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

    const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a6a48, 0.75)
    scene.add(hemi)
    this.sun = new THREE.DirectionalLight(0xfff2d8, 1.9)
    this.sun.position.copy(SUN_DIR).multiplyScalar(200)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const S = Math.min(220, half)
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S
    this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S
    this.sun.shadow.camera.far = 600
    this.sun.shadow.bias = -0.0005
    scene.add(this.sun)

    scene.fog = new THREE.Fog(0xc4d6e0, 160, Math.max(480, half * 1.4))
    this.fog = scene.fog

    // měkké mraky
    this.clouds = []
    const tex = this._cloudTexture()
    for (let i = 0; i < 9; i++) {
      const w = 100 + Math.random() * 150
      const cloud = new THREE.Mesh(
        new THREE.PlaneGeometry(w, w * 0.4),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 + Math.random() * 0.3, color: 0xffffff, fog: false }),
      )
      const a = Math.random() * Math.PI * 2, r = half * 0.7 + Math.random() * half * 0.7
      cloud.position.set(Math.cos(a) * r, 90 + Math.random() * 80, Math.sin(a) * r)
      scene.add(cloud)
      this.clouds.push(cloud)
    }
  }

  _cloudTexture() {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 128
    const g = c.getContext('2d')
    for (let i = 0; i < 16; i++) {
      const x = 40 + Math.random() * 176, y = 40 + Math.random() * 50, r = 22 + Math.random() * 30
      const grad = g.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, 'rgba(255,255,255,0.7)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad; g.fillRect(x - r, y - r, r * 2, r * 2)
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
