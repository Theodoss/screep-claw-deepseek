const roomCache = {};
const HOME_RANGE = 5;
const ATTACK_STAGING_X = 16;
const ATTACK_STAGING_Y = 24;
const ATTACK_STAGING_RANGE = 2;
const STAGING_SEARCH_RANGE = 8;

function getMission(creep) {
  const mission = Memory.military;
  if (
    !mission ||
    mission.enabled !== true ||
    creep.memory.missionId !== mission.missionId
  ) {
    return null;
  }
  return mission;
}

function getPosition(data) {
  if (!data) return null;
  return new RoomPosition(data.x, data.y, data.roomName);
}

function isOnExit(pos) {
  return pos.x === 0 || pos.x === 49 || pos.y === 0 || pos.y === 49;
}

function getInnerPos(pos) {
  return new RoomPosition(
    Math.min(48, Math.max(1, pos.x)),
    Math.min(48, Math.max(1, pos.y)),
    pos.roomName
  );
}

function moveOffExit(creep, pathColor) {
  if (!isOnExit(creep.pos)) return false;

  const inner = getInnerPos(creep.pos);
  creep.moveTo(inner, {
    range: 0,
    reusePath: 0,
    maxRooms: 1,
    visualizePathStyle: { stroke: pathColor || '#ffaa00' }
  });

  return true;
}

function getRoomData(room) {
  const cached = roomCache[room.name];
  if (cached && cached.tick === Game.time) return cached;

  const data = {
    tick: Game.time,
    hostiles: room.find(FIND_HOSTILE_CREEPS),
    friendlies: room.find(FIND_MY_CREEPS)
  };
  roomCache[room.name] = data;
  return data;
}

function selectCombatTarget(creep) {
  const hostiles = getRoomData(creep.room).hostiles;
  if (hostiles.length === 0) return null;
  return creep.pos.findClosestByRange(hostiles) || hostiles[0];
}

function getAttackStagingPos(mission) {
  return new RoomPosition(
    ATTACK_STAGING_X,
    ATTACK_STAGING_Y,
    mission.targetRoom
  );
}

function selectStagingAreaTarget(creep, mission) {
  if (creep.room.name !== mission.targetRoom) return null;

  const staging = getAttackStagingPos(mission);
  const hostiles = getRoomData(creep.room).hostiles.filter(
    hostile => hostile.pos.getRangeTo(staging) <= STAGING_SEARCH_RANGE
  );
  if (hostiles.length === 0) return null;
  return creep.pos.findClosestByRange(hostiles) || hostiles[0];
}

function getHomePos(creep, mission) {
  const rally = getPosition(mission && mission.rallyPos);
  if (rally) return rally;

  const homeRoom = (mission && mission.homeRoom) || creep.memory.home;
  if (!homeRoom) return null;
  return new RoomPosition(25, 25, homeRoom);
}

function moveToRoom(creep, roomName, pathColor) {
  const exitDirection = creep.room.findExitTo(roomName);
  if (exitDirection < 0) return false;

  const exit =
    creep.pos.findClosestByPath(exitDirection) ||
    creep.pos.findClosestByRange(exitDirection);
  if (!exit) return false;

  if (
    typeof creep.pos.isEqualTo === 'function' &&
    creep.pos.isEqualTo(exit)
  ) {
    creep.move(exitDirection);
    return true;
  }

  creep.moveTo(exit, {
    range: 0,
    reusePath: 3,
    maxRooms: 1,
    visualizePathStyle: { stroke: pathColor }
  });
  return true;
}

function returnHome(creep, mission) {
  const home = getHomePos(creep, mission || Memory.military);
  if (!home) return;

  if (creep.room.name !== home.roomName) {
    moveToRoom(creep, home.roomName, '#00ffff');
    return;
  }

  if (moveOffExit(creep, '#00ffff')) return;

  if (creep.pos.getRangeTo(home) > HOME_RANGE) {
    creep.moveTo(home, {
      range: HOME_RANGE,
      reusePath: 10,
      maxRooms: 1,
      visualizePathStyle: { stroke: '#00ffff' }
    });
  }
}

function shouldRetreat(creep) {
  if (!creep.memory.retreating && creep.hits < creep.hitsMax * 0.6) {
    creep.memory.retreating = true;
  } else if (
    creep.memory.retreating &&
    creep.hits > creep.hitsMax * 0.95
  ) {
    creep.memory.retreating = false;
  }
  return creep.memory.retreating === true;
}

function getMovementTarget(mission) {
  if (mission.phase === 'assembling') {
    return {
      pos: getPosition(mission.rallyPos),
      range: HOME_RANGE
    };
  }

  return {
    pos: getAttackStagingPos(mission),
    range: ATTACK_STAGING_RANGE
  };
}

function moveForMission(creep, mission) {
  const movement = getMovementTarget(mission);
  if (!movement.pos) return;
  if (creep.room.name !== movement.pos.roomName) {
    moveToRoom(creep, movement.pos.roomName, '#ff0000');
    return;
  }
  if (moveOffExit(creep, '#ff0000')) return;
  if (
    creep.pos.getRangeTo(movement.pos) <= movement.range
  ) {
    return;
  }

  creep.moveTo(movement.pos, {
    range: movement.range,
    reusePath: 5,
    maxRooms: 1,
    visualizePathStyle: { stroke: '#ff0000' }
  });
}

function beginTurn(creep) {
  const mission = getMission(creep);
  if (!mission) {
    returnHome(creep, Memory.military);
    return { active: false, mission: null, retreating: false };
  }

  if (shouldRetreat(creep)) {
    returnHome(creep, mission);
    return { active: false, mission: mission, retreating: true };
  }

  return { active: true, mission: mission, retreating: false };
}

function findWoundedFriendly(creep) {
  const friendlies = getRoomData(creep.room).friendlies.filter(
    friendly =>
      friendly.hits < friendly.hitsMax &&
      (
        friendly.memory.missionId === creep.memory.missionId ||
        friendly.name === creep.name
      )
  );
  if (friendlies.length === 0) return null;

  let selected = friendlies[0];
  for (const friendly of friendlies) {
    const ratio = friendly.hits / friendly.hitsMax;
    const selectedRatio = selected.hits / selected.hitsMax;
    if (
      ratio < selectedRatio ||
      (
        ratio === selectedRatio &&
        creep.pos.getRangeTo(friendly) <
          creep.pos.getRangeTo(selected)
      )
    ) {
      selected = friendly;
    }
  }
  return selected;
}

function findEscortTarget(creep) {
  const friendlies = getRoomData(creep.room).friendlies.filter(
    friendly =>
      friendly.name !== creep.name &&
      friendly.memory.missionId === creep.memory.missionId &&
      (
        friendly.memory.role === 'squadMelee' ||
        friendly.memory.role === 'squadRanged'
      ) &&
      !friendly.memory.retreating
  );
  if (friendlies.length === 0) return null;
  return creep.pos.findClosestByRange(friendlies);
}

function combatEnabled(creep, mission) {
  return (
    mission.phase !== 'assembling' &&
    mission.phase !== 'disabled' &&
    creep.room.name === mission.targetRoom
  );
}

module.exports = {
  ATTACK_STAGING_RANGE,
  beginTurn,
  combatEnabled,
  findEscortTarget,
  findWoundedFriendly,
  getAttackStagingPos,
  getRoomData,
  moveToRoom,
  moveOffExit,
  moveForMission,
  returnHome,
  selectCombatTarget,
  selectStagingAreaTarget
};
