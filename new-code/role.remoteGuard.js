// Ranged+heal remote guard. Dispatched to clear NPC Invaders from remote rooms.
// Kites melee enemies, ranged-attacks, self-heals, returns home when done.

const remoteDefense = require('manager.remoteDefense');
const remote = require('manager.remote');

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
      visualizePathStyle: { stroke: '#ff0000' }
    });
    return true;
  }
  return false;
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

        // Kite: stay at range 3 from melee enemies
        if (targetHasMelee && range <= 2) {
          const dx = creep.pos.x - target.pos.x;
          const dy = creep.pos.y - target.pos.y;
          const fleeX = creep.pos.x + (dx > 0 ? 1 : dx < 0 ? -1 : 0);
          const fleeY = creep.pos.y + (dy > 0 ? 1 : dy < 0 ? -1 : 0);
          creep.moveTo(fleeX, fleeY, {
            reusePath: 0,
            visualizePathStyle: { stroke: '#ff4444' }
          });
        } else if (range > 3) {
          creep.moveTo(target, {
            reusePath: 5,
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

  // Threat cleared or no threat — return home and standby
  if (moveToRoom(creep, homeRoom)) {
    creep.memory.task = 'returning:home';
    return;
  }

  creep.memory.task = 'standby:home';

  // Self-heal if damaged (regenerate before standing by)
  if (creep.hits < creep.hitsMax) {
    creep.heal(creep);
  }
}

module.exports = { run: run };
