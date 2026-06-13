// Guard / Attack Creep — reads Memory.military for attack targets.
// 
// Targeting (set via console):
//   Memory.military = { targetRoom: 'W49N26', sourceCamp: true }
//
// Behavior:
//   1. If in target room: attack hostiles, then camp at sources, then attack structures
//   2. If not in target room: move to target room exit
//   3. Default: defend home room

const ATTACK_RANGE = 1;

function moveToRoom(creep, roomName) {
  const exitDir = creep.room.findExitTo(roomName);
  if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) return false;

  const exitPos = creep.pos.findClosestByPath(exitDir);
  if (!exitPos) return false;

  creep.moveTo(exitPos, { visualizePathStyle: { stroke: '#ff0000' } });
  creep.memory.task = 'move:to-target-room';
  return true;
}

function findHostileSource(creep) {
  const sources = creep.room.find(FIND_SOURCES);
  if (sources.length === 0) return null;

  // Pick the source closest to enemy spawn (most likely defended)
  const enemySpawns = creep.room.find(FIND_HOSTILE_SPAWNS);
  if (enemySpawns.length > 0) {
    return sources.sort((a, b) =>
      a.pos.getRangeTo(enemySpawns[0]) - b.pos.getRangeTo(enemySpawns[0])
    )[0];
  }

  return creep.pos.findClosestByPath(sources) || sources[0];
}

function campSource(creep, source) {
  // Stand next to the source to block / kill enemy harvesters
  const pos = creep.pos;
  if (pos.getRangeTo(source) > 1) {
    creep.moveTo(source, { range: 1, visualizePathStyle: { stroke: '#ff0000' } });
    creep.memory.task = 'camp:move-to-source';
    return;
  }
  creep.memory.task = 'camp:hold-source';
}

function findAndAttackHostile(creep) {
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length === 0) return false;

  const target = creep.pos.findClosestByPath(hostiles) || hostiles[0];
  const result = creep.attack(target);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: '#ff0000' } });
  }
  creep.memory.task = 'attack:' + (target.name || 'hostile');
  return true;
}

function attackStructures(creep) {
  // Priority: spawn > extension > tower
  const spawns = creep.room.find(FIND_HOSTILE_SPAWNS);
  const structures = creep.room.find(FIND_HOSTILE_STRUCTURES, {
    filter: s =>
      s.structureType === STRUCTURE_SPAWN ||
      s.structureType === STRUCTURE_EXTENSION ||
      s.structureType === STRUCTURE_TOWER
  });

  const target = spawns[0] || structures[0];
  if (!target) return false;

  const result = creep.attack(target);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: '#ff0000' } });
  }
  creep.memory.task = 'attack:' + target.structureType;
  return true;
}

module.exports = {
  run: function (creep) {
    const military = Memory.military;
    const targetRoom = military && military.targetRoom;
    const sourceCamp = military && military.sourceCamp;

    // ── Offensive mode: attacking another room ──
    if (targetRoom && creep.room.name !== targetRoom) {
      const targetPos = military.targetPos;
      if (targetPos && targetPos.roomName === targetRoom) {
        creep.moveTo(
          new RoomPosition(targetPos.x, targetPos.y, targetPos.roomName),
          { visualizePathStyle: { stroke: '#ff0000' } }
        );
        creep.memory.task = 'move:to-target-pos';
      } else {
        moveToRoom(creep, targetRoom);
      }
      return;
    }

    // ── We are in the target room ──
    if (targetRoom && creep.room.name === targetRoom) {
      // Priority 1: kill enemy creeps
      if (findAndAttackHostile(creep)) return;

      // Priority 2: camp at source to block harvesters
      if (sourceCamp) {
        const source = findHostileSource(creep);
        if (source) {
          campSource(creep, source);
          return;
        }
      }

      // Priority 3: attack structures
      if (attackStructures(creep)) return;

      // Fallback: move toward center of room
      const center = new RoomPosition(25, 25, targetRoom);
      creep.moveTo(center, { visualizePathStyle: { stroke: '#ff0000' } });
      creep.memory.task = 'move:room-center';
      return;
    }

    // ── Defensive mode: protect home room ──
    if (findAndAttackHostile(creep)) return;

    const spawns = creep.room.find(FIND_MY_SPAWNS);
    const post = spawns[0] || creep.room.controller;
    if (post && creep.pos.getRangeTo(post) > 3) {
      creep.moveTo(post, {
        range: 3,
        visualizePathStyle: { stroke: '#ff0000' }
      });
      creep.memory.task = 'guard:post';
    } else {
      creep.memory.task = 'guard:hold';
    }
  }
};
