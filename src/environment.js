// environment.js — Miami atmosféra: sunset sky dome (shader), oceán s vlnkami
// a sun-glare pruhem, teplé osvětlení, růžová mlha. Sky dome sleduje kameru.
import * as THREE from 'three'

export const SUN_DIR = new THREE.Vector3(1, 0.30, 0.18).normalize()

const SKY_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`
const SKY_FRAG = /* glsl */`
  varying vec3 vDir;
  uniform vec3 uSunDir;
  void main() {
    vec3 dir = normalize(vDir);
    float t = clamp(dir.y * 1.4 + 0.12, 0.0, 1.0);
    vec3 horizon = vec3(1.00, 0.62, 0.42);  // oranžová
    vec3 mid     = vec3(0.89, 0.41, 0.56);  // růžová
    vec3 zenith  = vec3(0.21, 0.19, 0.43);  // fialovo-modrá
    vec3 col = mix(horizon, mid, smoothstep(0.0, 0.45, t));
    col = mix(col, zenith, smoothstep(0.35, 1.0, t));
    float d = max(dot(dir, uSunDir), 0.0);
    col += smoothstep(0.9985, 0.9995, d) * vec3(1.0, 0.9, 0.72) * 1.3; // disk
    col += pow(d, 22.0) * vec3(1.0, 0.55, 0.30) * 0.55;               // záře
    gl_FragColor = vec4(col, 1.0);
  }
`

const WATER_VERT = /* glsl */`
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const WATER_FRAG = /* glsl */`
  varying vec3 vWorld;
  uniform float uTime;
  uniform float uShoreX;
  void main() {
    float dist = max(vWorld.x - uShoreX, 0.0);
    vec3 shallow = vec3(0.16, 0.55, 0.60);
    vec3 deep    = vec3(0.05, 0.24, 0.38);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 140.0, dist));
    float r = sin(vWorld.z * 0.55 + uTime * 1.6) * sin(vWorld.x * 0.30 - uTime * 1.1);
    col += vec3(0.05, 0.06, 0.06) * r;
    // sluneční pruh na hladině (slunce nad oceánem, směr +X)
    float streak = exp(-abs(vWorld.z * 0.014)) * exp(-dist * 0.004);
    col += vec3(1.0, 0.55, 0.28) * streak * (0.35 + 0.08 * sin(uTime * 2.2 + vWorld.x * 0.5));
    gl_FragColor = vec4(col, 1.0);
  }
`

export class Environment {
  constructor(scene, cityHalf) {
    // sky dome
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: { uSunDir: { value: SUN_DIR.clone() } },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    })
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(520, 24, 14), this.skyMat)
    this.dome.frustumCulled = false
    scene.add(this.dome)

    // oceán východně od města
    this.waterMat = new THREE.ShaderMaterial({
      vertexShader: WATER_VERT,
      fragmentShader: WATER_FRAG,
      uniforms: { uTime: { value: 0 }, uShoreX: { value: cityHalf } },
      fog: false,
    })
    const water = new THREE.Mesh(new THREE.PlaneGeometry(560, 760), this.waterMat)
    water.rotation.x = -Math.PI / 2
    water.position.set(cityHalf + 278, -0.25, 0)
    scene.add(water)

    // osvětlení — nízké teplé slunce od oceánu
    const hemi = new THREE.HemisphereLight(0xffc4a8, 0x3d3a45, 0.6)
    scene.add(hemi)
    this.sun = new THREE.DirectionalLight(0xffc890, 1.9)
    this.sun.position.copy(SUN_DIR).multiplyScalar(160)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    const S = 135
    this.sun.shadow.camera.left = -S; this.sun.shadow.camera.right = S
    this.sun.shadow.camera.top = S; this.sun.shadow.camera.bottom = -S
    this.sun.shadow.camera.far = 400
    this.sun.shadow.bias = -0.0006
    scene.add(this.sun)

    scene.fog = new THREE.Fog(0xe89a7a, 70, 300)
    this.fog = scene.fog

    // ── ploché sunset mraky (billboard sprity) ──
    this.clouds = []
    const cloudTex = this._cloudTexture()
    for (let i = 0; i < 7; i++) {
      const w = 90 + Math.random() * 120
      const cloud = new THREE.Mesh(
        new THREE.PlaneGeometry(w, w * 0.32),
        new THREE.MeshBasicMaterial({
          map: cloudTex, transparent: true, depthWrite: false,
          opacity: 0.5 + Math.random() * 0.3, color: 0xffcbb5, fog: false,
        }),
      )
      const a = Math.random() * Math.PI * 2
      const r = 260 + Math.random() * 140
      cloud.position.set(Math.cos(a) * r, 60 + Math.random() * 70, Math.sin(a) * r)
      scene.add(cloud)
      this.clouds.push(cloud)
    }
  }

  _cloudTexture() {
    const c = document.createElement('canvas')
    c.width = 256; c.height = 96
    const g = c.getContext('2d')
    for (let i = 0; i < 14; i++) {
      const x = 30 + Math.random() * 196, y = 30 + Math.random() * 40
      const r = 18 + Math.random() * 26
      const grad = g.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, 'rgba(255,255,255,0.55)')
      grad.addColorStop(1, 'rgba(255,255,255,0)')
      g.fillStyle = grad
      g.fillRect(x - r, y - r, r * 2, r * 2)
    }
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  /**
   * Environment mapa ze sunset oblohy → odlesky na lacích/sklech/chromu
   * (NFS look). Volat jednou po vytvoření rendereru (jen v prohlížeči).
   */
  applyEnvMap(renderer, scene) {
    const pmrem = new THREE.PMREMGenerator(renderer)
    const envScene = new THREE.Scene()
    envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), this.skyMat))
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(90, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x5a4a42 }),
    )
    ground.position.y = -2
    envScene.add(ground)
    const rt = pmrem.fromScene(envScene, 0.04)
    scene.environment = rt.texture
    pmrem.dispose()
  }

  update(dt, camera) {
    this.waterMat.uniforms.uTime.value += dt
    // dome drží střed pod kamerou (bez parallaxy oblohy)
    this.dome.position.set(camera.position.x, 0, camera.position.z)
    for (const c of this.clouds) c.lookAt(camera.position)
  }
}
