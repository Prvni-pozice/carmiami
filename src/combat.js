// combat.js — srážky auto-auto. Auto NENÍ kruh: karoserie je ~4,3 m dlouhá,
// takže jeden kruh (r 1,5) nechal auta zajet hluboko do sebe (příď do boku).
// Modelujeme každé auto jako 2 kruhy podél délky (kapsle) a řešíme nejbližší
// překrývající se dvojici — auta se pak dotknou obrysem místo aby se prolnula.
const RESTITUTION = 0.5
const NODE_R = 1.02        // poloměr kruhu v uzlu (2 uzly = kapsle šířky ~2 m)
const NODE_OFF = 1.15      // odsazení uzlů od středu podél přídě
const DMG_THRESHOLD = 4    // m/s relativní rychlosti, pod kterou náraz nebolí
const DMG_SCALE = 3        // HP za každý m/s nad threshold
const DMG_CAP = 40         // strop poškození z jednoho nárazu

function nodes(car) {
  const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw)
  return [
    { x: car.pos.x + fx * NODE_OFF, z: car.pos.z + fz * NODE_OFF },
    { x: car.pos.x - fx * NODE_OFF, z: car.pos.z - fz * NODE_OFF },
  ]
}

/**
 * @param entities pole {car, hp, wrecked} — hráč i AI
 * @param onImpact callback(A, B, dmg, impactSpeed, {x, z}, {nx, nz}) při tvrdém nárazu
 */
export function carCollisions(entities, onImpact) {
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const A = entities[i], B = entities[j]
      const a = A.car, b = B.car
      // hrubý odstup: přeskočit vzdálené páry
      if (Math.hypot(b.pos.x - a.pos.x, b.pos.z - a.pos.z) > 6) continue

      // najdi nejhlubší překryv mezi uzly A a uzly B
      const na = nodes(a), nb = nodes(b)
      let best = null
      const minDist = NODE_R * 2
      for (const pa of na) for (const pb of nb) {
        const dx = pb.x - pa.x, dz = pb.z - pa.z
        const dist = Math.hypot(dx, dz)
        if (dist >= minDist || dist < 1e-4) continue
        const overlap = minDist - dist
        if (!best || overlap > best.overlap) best = { dx, dz, dist, overlap }
      }
      if (!best) continue

      const nx = best.dx / best.dist, nz = best.dz / best.dist
      // rozstrčit auta podél normály (celé pozice), ať se obrysy nepřekrývají
      a.pos.x -= nx * best.overlap / 2; a.pos.z -= nz * best.overlap / 2
      b.pos.x += nx * best.overlap / 2; b.pos.z += nz * best.overlap / 2

      const rel = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz
      if (rel >= 0) continue // už se vzdalují

      const impulse = -(1 + RESTITUTION) * rel / 2
      a.vel.x -= nx * impulse; a.vel.z -= nz * impulse
      b.vel.x += nx * impulse; b.vel.z += nz * impulse

      const impactSpeed = -rel
      if (impactSpeed > DMG_THRESHOLD) {
        const dmg = Math.min(DMG_CAP, (impactSpeed - DMG_THRESHOLD) * DMG_SCALE)
        onImpact(A, B, dmg, impactSpeed,
          { x: (a.pos.x + b.pos.x) / 2, z: (a.pos.z + b.pos.z) / 2 },
          { nx, nz })
      }
    }
  }
}
