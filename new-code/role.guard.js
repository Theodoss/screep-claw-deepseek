const ROUTE_CORRIDOR_TOLERANCE = 2;
const IMMEDIATE_THREAT_RANGE = 3;
const LEGACY_STANDBY_X = 12;
const LEGACY_STANDBY_Y = 4;

function getMissionTarget(creep) {
  if (
    !creep.memory.attackCreep ||
    !Memory.military ||
    Memory.military.enabled !== true
  ) {
    return null;
  }

  const military = Memory.military || {};
  const configured = creep.memory.targetPos || military.targetPos;
  const roomName =
    (configured && configured.roomName) ||
    creep.memory.targetRoom ||
    military.targetRoom;

  if (!roomName) return null;

  return new RoomPosition(
    configured && Number.isInteger(configured.x) ? configured.x : 25,
    configured && Number.isInteger(configured.y) ? configured.y : 25,
    roomName
  );
}

function isOnMissionRoute(creep, hostile, missionTarget) {
  if (!hostile || !hostile.pos) return false;
  if (hostile.pos.roomName !== creep.room.name) return false;

  if (missionTarget.roomName !== creep.room.name) {
    return true;
  }

  const creepToHostile = creep.pos.getRangeTo(hostile);
  if (creepToHostile <= IMMEDIATE_THREAT_RANGE) return true;

  const creepToTarget = creep.pos.getRangeTo(missionTarget);
  const hostileToTarget = hostile.pos.getRangeTo(missionTarget);

  return (
    creepToHostile + hostileToTarget <=
    creepToTarget + ROUTE_CORRIDOR_TOLERANCE
  );
}

function getLockedTarget(creep, missionTarget) {
  const targetId = creep.memory.combatTargetId;
  if (!targetId) return null;

  const target = Game.getObjectById(targetId);
  if (
    target &&
    target.room &&
    target.room.name === creep.room.name &&
    isOnMissionRoute(creep, target, missionTarget)
  ) {
    return target;
  }

  delete creep.memory.combatTargetId;
  return null;
}

function findMissionTarget(creep, missionTarget) {
  const locked = getLockedTarget(creep, missionTarget);
  if (locked) return locked;

  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  const candidates = hostiles.filter(function (hostile) {
    return isOnMissionRoute(creep, hostile, missionTarget);
  });

  if (candidates.length === 0) return null;

  const target =
    creep.pos.findClosestByPath(candidates) ||
    creep.pos.findClosestByRange(candidates) ||
    candidates[0];

  creep.memory.combatTargetId = target.id;
  return target;
}

function tryHeal(creep) {
  if (creep.getActiveBodyparts(HEAL) === 0) return false;

  if (creep.hits < creep.hitsMax) {
    creep.heal(creep);
    return true;
  }

  const damagedAllies = creep.pos.findInRange(FIND_MY_CREEPS, 3, {
    filter: function (c) {
      return c.id !== creep.id && c.hits < c.hitsMax;
    }
  });

  if (damagedAllies.length > 0) {
    const ally = creep.pos.findClosestByRange(damagedAllies);
    if (ally) {
      if (creep.pos.getRangeTo(ally) <= 1) {
        creep.heal(ally);
      } else {
        creep.rangedHeal(ally);
      }
      return true;
    }
  }

  return false;
}

function attackMissionTarget(creep, target) {
  tryHeal(creep);

  const result = creep.attack(target);

  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, {
      reusePath: 2,
      maxRooms: 1,
      visualizePathStyle: { stroke: '#ff0000' }
    });
  }
}

const ATTACK_STRUCTURES = [
  STRUCTURE_SPAWN,
  STRUCTURE_TOWER,
  STRUCTURE_EXTENSION,
  STRUCTURE_STORAGE,
  STRUCTURE_LINK,
  STRUCTURE_LAB,
  STRUCTURE_TERMINAL,
  STRUCTURE_FACTORY,
  STRUCTURE_NUKER,
  STRUCTURE_POWER_SPAWN
];

function findStructureTarget(creep) {
  var all = creep.room.find(FIND_HOSTILE_STRUCTURES, {
    filter: function (s) {
      return ATTACK_STRUCTURES.indexOf(s.structureType) !== -1;
    }
  });

  if (all.length === 0) return null;

  all.sort(function (a, b) {
    return ATTACK_STRUCTURES.indexOf(a.structureType) -
      ATTACK_STRUCTURES.indexOf(b.structureType);
  });

  return creep.pos.findClosestByPath(all) || all[0];
}

function runAttackMission(creep, missionTarget) {
  if (tryHeal(creep)) return;

  var hostile = findMissionTarget(creep, missionTarget);
  if (hostile) {
    attackMissionTarget(creep, hostile);
    return;
  }

  var structure = findStructureTarget(creep);
  if (structure) {
    attackMissionTarget(creep, structure);
    return;
  }

  delete creep.memory.combatTargetId;

  if (
    creep.room.name !== missionTarget.roomName ||
    creep.pos.getRangeTo(missionTarget) > 1
  ) {
    creep.moveTo(missionTarget, {
      range: 1,
      reusePath: 5,
      visualizePathStyle: { stroke: '#ff0000' }
    });
  }
}

function runDefense(creep) {
  if (tryHeal(creep)) return;

  var target = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
  if (target) {
    if (tryHeal(creep)) return;
    var result = creep.attack(target);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, {
        reusePath: 2,
        visualizePathStyle: { stroke: '#ff0000' }
      });
    }
    return;
  }

  var structure = findStructureTarget(creep);
  if (structure) {
    var sresult = creep.attack(structure);
    if (sresult === ERR_NOT_IN_RANGE) {
      creep.moveTo(structure, {
        reusePath: 2,
        maxRooms: 1,
        visualizePathStyle: { stroke: '#ff0000' }
      });
    }
    return;
  }

  var spawns = creep.room.find(FIND_MY_SPAWNS);
  var post = spawns[0] || creep.room.controller;
  if (post && creep.pos.getRangeTo(post) > 3) {
    creep.moveTo(post, {
      range: 3,
      reusePath: 10,
      visualizePathStyle: { stroke: '#ff0000' }
    });
  }
}

function retireAttackCreep(creep) {
  const homeRoom = creep.memory.home;
  if (!homeRoom) return;

  creep.memory.task = 'standby:legacy-attack';

  if (creep.room.name !== homeRoom) {
    const exitDirection = creep.room.findExitTo(homeRoom);
    if (exitDirection < 0) return;

    const exit =
      creep.pos.findClosestByPath(exitDirection) ||
      creep.pos.findClosestByRange(exitDirection);
    if (!exit) return;

    if (creep.pos.isEqualTo(exit)) {
      creep.move(exitDirection);
      return;
    }

    creep.moveTo(exit, {
      range: 0,
      reusePath: 3,
      maxRooms: 1,
      visualizePathStyle: { stroke: '#00ffff' }
    });
    return;
  }

  const standby = new RoomPosition(
    LEGACY_STANDBY_X,
    LEGACY_STANDBY_Y,
    homeRoom
  );
  if (creep.pos.getRangeTo(standby) <= 2) return;

  creep.moveTo(standby, {
    range: 2,
    reusePath: 5,
    visualizePathStyle: { stroke: '#00ffff' }
  });
}

module.exports = {
  run: function (creep) {
    if (creep.memory.forceMission && creep.memory.targetRoom) {
      const targetPos = new RoomPosition(25, 25, creep.memory.targetRoom);
      runAttackMission(creep, targetPos);
      return;
    }

    if (
      creep.memory.attackCreep &&
      (
        !Memory.military ||
        Memory.military.enabled !== true ||
        Memory.military.version >= 2
      )
    ) {
      delete creep.memory.combatTargetId;
      retireAttackCreep(creep);
      return;
    }

    const missionTarget = getMissionTarget(creep);
    if (missionTarget) {
      runAttackMission(creep, missionTarget);
      return;
    }

    runDefense(creep);
  }
};
