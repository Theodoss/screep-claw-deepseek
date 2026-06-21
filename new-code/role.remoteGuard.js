// Ranged+heal remote guard. Dispatched to clear NPC Invaders from remote rooms.
// Kites melee enemies, ranged-attacks, self-heals, returns home when done.

const remoteDefense = require('manager.remoteDefense');
const remote = require('manager.remote');

// Direction → [dx, dy] offsets for directional movement (no pathfinding).
const DIR_OFFSET = {
  1: [0, -1],   // TOP
  2: [1, -1],   // TOP_RIGHT
  3: [1, 0],    // RIGHT
  4: [1, 1],    // BOTTOM_RIGHT
  5: [0, 1],    // BOTTOM
  6: [-1, 1],   // BOTTOM_LEFT
  7: [-1, 0],   // LEFT
  8: [-1, -1]   // TOP_LEFT
};

function hasBodyPart(creep, partType) {
  for (let i = 0; i < creep.body.length; i++) {
    if (creep.body[i].type === partType && creep.body[i].hits > 0) {
      return true;
    }
  }
  return false;
}

function getHostilePriority(hostile) {
  // HEAL parts are the biggest threat multiplier
  if (hasBodyPart(hostile, HEAL)) return 1;
  // RANGED_ATTACK can damage at distance
  if (hasBodyPart(hostile, RANGED_ATTACK)) return 2;
  // Melee attackers
  if (hasBodyPart(hostile, ATTACK)) return 3;
  // Everything else (WORK, CARRY, CLAIM, etc.)
  return 4;
}

function selectTarget(creep) {
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length === 0) return null;

  // Sort by priority, then by proximity
  hostiles.sort(function (a, b) {
    const pa = getHostilePriority(a);
    const pb = getHostilePriority(b);
    if (pa !== pb) return pa - pb;
    return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
  });

  return hostiles[0];
}

function getClosestHostileRange(creep, hostiles) {
  let closest = 50;
  for (let i = 0; i < hostiles.length; i++) {
    const range = creep.pos.getRangeTo(hostiles[i]);
    if (range < closest) closest = range;
  }
  return closest;
}

function moveToRoom(creep, roomName) {
  if (creep.pos.roomName !== roomName) {
    creep.moveTo(new RoomPosition(25, 25, roomName), {
      reusePath: 20,
      maxRooms: 3,
      visualizePathStyle: { stroke: '#ff0000' }
    });
    return true;
  }
  return false;
}

// Try to step one tile in a direction, within the same room.
// Returns true if the move was attempted (even if blocked).
function fleeStep(creep, dir) {
  const offset = DIR_OFFSET[dir];
  if (!offset) return false;
  const fx = creep.pos.x + offset[0];
  const fy = creep.pos.y + offset[1];
  // Only move to in-bounds tiles (0–49): never cross room exits.
  if (fx < 0 || fx > 49 || fy < 0 || fy > 49) return false;
  const terrain = Game.map.getRoomTerrain(creep.pos.roomName);
  if (terrain.get(fx, fy) === TERRAIN_MASK_WALL) return false;
  creep.move(dir);
  return true;
}

function run(creep) {
  const targetRoom = creep.memory.targetRoom;
  const homeRoom = creep.memory.homeRoom;

  // Check if threat still exists
  if (targetRoom) {
    const remoteConfig = remote.getRemoteConfig(homeRoom, targetRoom);
    const threatActive = remoteDefense.isInvaderThreat(remoteConfig);

    if (threatActive) {
      // In transit to target room
      if (moveToRoom(creep, targetRoom)) {
        creep.memory.task = 'moving:' + targetRoom;
        return;
      }

      // In target room — fight
      const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
      const target = selectTarget(creep);

      if (target) {
        const range = creep.pos.getRangeTo(target);
        const targetHasMelee = hasBodyPart(target, ATTACK);

        // Kite: stay at range 3 from melee enemies.
        // Uses directional move() — no pathfinding — to avoid exit-hopping.
        if (targetHasMelee && range <= 2) {
          const dirToTarget = creep.pos.getDirectionTo(target);
          if (dirToTarget) {
            // Opposite direction (+4 around the 1–8 ring) = flee away from target.
            const fleeDir = ((dirToTarget + 3) % 8) + 1;
            // Try primary flee direction, then adjacent directions as fallback.
            if (!fleeStep(creep, fleeDir)) {
              if (!fleeStep(creep, (fleeDir % 8) + 1)) {
                fleeStep(creep, ((fleeDir + 6) % 8) + 1);
              }
            }
          }
        } else if (range > 3) {
          creep.moveTo(target, {
            reusePath: 5,
            maxRooms: 1,
            visualizePathStyle: { stroke: '#ff0000' }
          });
        }

        // Ranged attack
        if (range <= 3) {
          creep.rangedAttack(target);
          creep.memory.task = 'attack:' + target.id;
        }

        // Mass attack if multiple enemies nearby
        if (hostiles.length >= 2 && getClosestHostileRange(creep, hostiles) <= 1) {
          creep.rangedMassAttack();
        }
      } else {
        creep.memory.task = 'cleared:' + targetRoom;
      }

      // Self-heal
      if (creep.hits < creep.hitsMax) {
        creep.heal(creep);
      }

      return;
    }
  }

  // Threat cleared — garrison the remote room to block the next invasion.
  // Only return home when near death (TTL < 300) so the spawn can replace.
  if (creep.ticksToLive < 300) {
    if (moveToRoom(creep, homeRoom)) {
      creep.memory.task = 'returning:home';
      return;
    }
  }

  if (targetRoom && creep.pos.roomName !== targetRoom) {
    if (moveToRoom(creep, targetRoom)) {
      creep.memory.task = 'garrison:' + targetRoom;
      return;
    }
  }

  creep.memory.task = 'garrison:' + (targetRoom || homeRoom);

  // Self-heal if damaged (regenerate while garrisoned)
  if (creep.hits < creep.hitsMax) {
    creep.heal(creep);
  }
}

module.exports = { run: run };
