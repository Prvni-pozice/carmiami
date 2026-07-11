// combat.js — srážky auto-auto: kruhová kolize, výměna hybnosti podél
// normály (s restitucí), poškození podle síly nárazu.
const RESTITUTION = 0.55
const CAR_HIT_RADIUS = 1.5
const DMG_THRESHOLD = 4   // m/s relativní rychlosti, pod kterou náraz nebolí
const DMG_SCALE = 3       // HP za každý m/s nad threshold
const DMG_CAP = 40        // strop poškození z jednoho nárazu (ať hráč přežije ~3 tvrdé rány)

/**
 * @param entities pole {car, hp, wrecked} — hráč i AI
 * @param onImpact callback(A, B, dmg, impactSpeed, {x, z}) při tvrdém nárazu
 */
export function carCollisions(entities, onImpact) {
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const A = entities[i], B = entities[j]
      const a = A.car, b = B.car
      const dx = b.pos.x - a.pos.x
      const dz = b.pos.z - a.pos.z
      const dist = Math.hypot(dx, dz)
      const minDist = CAR_HIT_RADIUS * 2
      if (dist >= minDist || dist < 1e-4) continue

      const nx = dx / dist, nz = dz / dist
      const overlap = minDist - dist
      a.pos.x -= nx * overlap / 2; a.pos.z -= nz * overlap / 2
      b.pos.x += nx * overlap / 2; b.pos.z += nz * overlap / 2

      const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz
      if (rel >= 0) continue // už se vzdalují

      const impulse = -(1 + RESTITUTION) * rel / 2
      a.vel.x -= nx * impulse; a.vel.z -= nz * impulse
      b.vel.x += nx * impulse; b.vel.z += nz * impulse

      const impactSpeed = -rel
      if (impactSpeed > DMG_THRESHOLD) {
        const dmg = Math.min(DMG_CAP, (impactSpeed - DMG_THRESHOLD) * DMG_SCALE)
        onImpact(A, B, dmg, impactSpeed, {
          x: (a.pos.x + b.pos.x) / 2,
          z: (a.pos.z + b.pos.z) / 2,
        })
      }
    }
  }
}
