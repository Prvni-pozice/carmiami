// main_map.js — herní smyčka pro mapové úrovně (Skrýšov z OSM dat).
// Reuse: Car, Controls, Particles, GameAudio, Peds, combat, Quality, Camera.
// Nové: buildMapCity + resolveCollisions (mapcity.js), MapEnv (mapenv.js),
// AICar (ai_map.js — kolize proti budovám). Neběží na indexu → nekříží se
// s Miami verzí na 5182/.
import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { Car, CAR_RADIUS } from './car.js'
import { buildMapCity, resolveCollisions, loadCityTextures } from './mapcity.js'
import { MapEnv } from './mapenv.js'
import { ChaseCamera } from './camera.js'
import { Controls } from './controls.js'
import { Particles } from './particles.js'
import { GameAudio } from './audio.js'
import { AICar } from './ai_map.js'
import { Peds } from './peds.js'
import { carCollisions } from './combat.js'
import { Quality } from './quality.js'

// Vite build cíl je es2019 (top-level await není k dispozici) — proto se
// vše, co potřebuje počkat na stažené reálné textury, zabalí do async funkce.
async function boot() {
  const canvas = document.getElementById('scene')
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: (devicePixelRatio || 1) < 1.8, powerPreference: 'high-performance',
  })
  renderer.shadowMap.enabled = true
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1400)

  const textures = await loadCityTextures() // lokální statické soubory — rychlé; při chybě null (fallback níže)
  const city = buildMapCity(scene, textures)
  const chaseCam = new ChaseCamera(camera, city.heightAt)
  const env = new MapEnv(scene, city.half)

  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.22, 0.5, 0.9))

  env.applyEnvMap(renderer, scene)
  const quality = new Quality(renderer, env.sun, env.fog, composer)
  const particles = new Particles(scene)
  const audio = new GameAudio()
  const controls = new Controls()

  // spawn hráče na silnici (ne náhodně v poli na okraji)
  const spawn = city.roadSpawn()
  const player = { car: new Car(0xd83a2e), hp: 240, maxHp: 240, wrecked: false }
  player.car.reset(spawn.x, spawn.z, spawn.yaw)
  player.car.update(0, { throttle: 0, steer: 0 }, city.heightAt) // usadit na terén
  scene.add(player.car.mesh)

  const AI_COLORS = [0x2ec4b6, 0xff5fa2, 0x7b5fe8]
  const ais = AI_COLORS.map(c => {
    const p = city.roadSpawn()
    return new AICar(scene, c, p.x, p.z, p.yaw)
  })

  const peds = new Peds(scene, city, 70)

  let score = 0, running = false, deadT = 0, smokeT = 0

  function resetGame() {
    score = 0; deadT = 0
    player.hp = player.maxHp; player.wrecked = false
    const s = city.roadSpawn()
    player.car.reset(s.x, s.z, s.yaw)
    player.car.setDamage(0)
    player.car.update(0, { throttle: 0, steer: 0 }, city.heightAt) // usadit + srovnat náklon
    for (const ai of ais) { ai.wrecked = true; ai.respawnT = 0; ai.tryRespawn() }
    chaseCam.snapTo(player.car)
  }

  const hud = document.getElementById('hud')
  const speedEl = document.getElementById('speed')
  const scoreEl = document.getElementById('score')
  const hpBar = document.getElementById('hp-bar')
  const startOverlay = document.getElementById('start-overlay')
  const deadOverlay = document.getElementById('dead-overlay')
  const finalScoreEl = document.getElementById('final-score')
  const debugEl = document.getElementById('debug')
  const showDebug = location.search.includes('debug')
  if (showDebug) debugEl.style.display = 'block'
  document.getElementById('place-name').textContent = city.place

  document.getElementById('start-btn').addEventListener('click', () => {
    audio.init(); startOverlay.classList.add('hidden'); hud.style.display = 'flex'; running = true; clock.getDelta()
  })
  document.getElementById('restart-btn').addEventListener('click', () => {
    resetGame(); deadOverlay.classList.add('hidden'); clock.getDelta()
  })

  function resize() {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    composer.setSize(innerWidth, innerHeight)
  }
  addEventListener('resize', resize)
  resize()
  chaseCam.snapTo(player.car)

  function applyDamage(entity, dmg) {
    if (entity.wrecked) return
    entity.hp -= dmg
    entity.car.setDamage(1 - Math.max(0, entity.hp) / entity.maxHp)
    if (entity.hp > 0) return
    if (entity === player) {
      player.wrecked = true; player.car.setDamage(1); player.car.mesh.rotateZ(0.14)
      deadT = 1.4; audio.boom(); audio.engineOff(); audio.setScreech(0)
    } else {
      entity.wreck(); score += 100; audio.boom()
    }
    particles.spawn(entity.car.pos.clone().add(new THREE.Vector3(0, 1, 0)), { count: 40, color: 0xff8a3c, speed: 7, up: 6, life: 0.9 })
  }

  const clock = new THREE.Clock()
  let debugT = 0

  function tick() {
    requestAnimationFrame(tick)
    const dt = Math.min(clock.getDelta(), 0.05)
    if (!running) return

    const input = controls.getInput()
    if (!player.wrecked) {
      if (input.reset) { const s = city.roadSpawn(); player.car.reset(s.x, s.z, s.yaw) }
      player.car.update(dt, input, city.heightAt)
      resolveCollisions(player.car, city, CAR_RADIUS)
    }

    for (const ai of ais) { ai.update(dt, player.car, city); ai.tryRespawn() }

    const entities = [player, ...ais]
    carCollisions(entities, (A, B, dmg, impact, at) => {
      applyDamage(A, dmg); applyDamage(B, dmg)
      particles.spawn(new THREE.Vector3(at.x, (A.car.pos.y + B.car.pos.y) / 2 + 0.8, at.z),
        { count: Math.min(30, Math.round(impact * 2.5)), color: 0xffd75e, speed: impact * 0.7, up: 2.5, life: 0.5 })
      audio.crash(Math.min(1, impact / 15))
    })
    for (const e of entities) { resolveCollisions(e.car, city, CAR_RADIUS); e.car.mesh.position.copy(e.car.pos) }

    const liveCars = entities.filter(e => !e.wrecked).map(e => e.car)
    peds.update(dt, liveCars, (ped, kmh) => {
      score += 10 + Math.round(kmh / 10)
      particles.spawn(ped.mesh.position.clone().add(new THREE.Vector3(0, 1.2, 0)), { count: 12, color: 0xfff3d6, speed: 2.5, up: 3.5, life: 0.7, gravity: 3 })
      audio.pedHit()
    })

    smokeT -= dt
    if (smokeT <= 0) {
      smokeT = 0.16
      for (const e of entities) {
        if (!e.wrecked) continue
        particles.spawn(e.car.pos.clone().add(new THREE.Vector3(0, 1.3, 0)), { count: 2, color: 0x555555, speed: 0.5, up: 1.6, life: 1.3, gravity: -1.4 })
      }
    }

    if (player.wrecked && deadT > 0) {
      deadT -= dt
      if (deadT <= 0) { finalScoreEl.textContent = `Skóre: ${score}`; deadOverlay.classList.remove('hidden') }
    }

    speedEl.firstChild.textContent = Math.round(player.car.speedKmh)
    scoreEl.textContent = score
    const hpF = Math.max(0, player.hp) / player.maxHp
    hpBar.style.width = `${hpF * 100}%`
    hpBar.classList.toggle('low', hpF < 0.35)

    if (!player.wrecked) {
      audio.setEngine(Math.min(1, player.car.speedKmh / 119))
      const slip = Math.abs(player.car.lateralSpeed)
      audio.setScreech(slip > 3 ? Math.min(1, (slip - 3) / 6) : 0)
    }

    quality.update(dt)
    if (showDebug) {
      debugT -= dt
      if (debugT <= 0) { debugT = 0.5; debugEl.textContent = `Q${quality.tier} ${Math.round(quality.fps)} fps · ${city.buildingCount} budov · ${city.treeCount} stromů` }
    }

    chaseCam.update(dt, player.car)
    env.update(dt, camera)
    particles.update(dt)
    if (quality.tier === 2) composer.render()
    else renderer.render(scene, camera)
  }
  tick()
}

boot()
