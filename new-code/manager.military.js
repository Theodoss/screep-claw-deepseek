const MISSION_VERSION = 2;
const MISSION_ID = 'operation1';
const ATTACK_ENABLED = true;
// 2026-06-14 06:49:30 UTC / 2026-06-14 02:49:30 America/New_York.
const ATTACK_START_AT = 1781419770000;
const CLEAR_CONFIRM_TICKS = 20;
const REPLACEMENT_ROUTE_BUFFER = 100;
const RALLY_POSITION_VERSION = 2;
const RALLY_X = 11;
const RALLY_Y = 6;
const RALLY_RANGE = 5;

const ROLE_MELEE = 'squadMelee';
const ROLE_HEALER = 'squadHealer';
const ROLE_RANGED = 'squadRanged';
const COMBAT_ROLES = [ROLE_MELEE, ROLE_HEALER, ROLE_RANGED];
const REQUIRED = {
  squadMelee: 4,
  squadHealer: 2,
  squadRanged: 2
};
const SPAWN_SEQUENCE = [
  ROLE_MELEE,
  ROLE_HEALER,
  ROLE_RANGED,
  ROLE_MELEE,
  ROLE_HEALER,
  ROLE_RANGED,
  ROLE_MELEE,
  ROLE_MELEE
];

function defaultTargetPos(previous) {
  const roomName = previous.targetRoom ||
    (previous.targetPos && previous.targetPos.roomName) ||
    'W49N26';

  return {
    x: 21,
    y: 29,
    roomName: roomName
  };
}

function updateRallyPos(mission) {
  if (mission.rallyPositionVersion === RALLY_POSITION_VERSION) return;

  const roomName = mission.homeRoom ||
    (mission.rallyPos && mission.rallyPos.roomName);
  if (!roomName) return;

  mission.rallyPos = {
    x: RALLY_X,
    y: RALLY_Y,
    roomName: roomName
  };
  mission.rallyPositionVersion = RALLY_POSITION_VERSION;
}

function configuredAttackEnabled(previous, attackEnabled) {
  if (attackEnabled !== undefined) return attackEnabled === true;

  return (
    ATTACK_ENABLED &&
    Date.now() >= ATTACK_START_AT &&
    previous.safeModeCancelled !== true
  );
}

function disableMission(mission, reason) {
  mission.enabled = false;
  mission.phase = 'disabled';
  mission.clearSince = null;
  mission.status = mission.status || {};
  mission.status.reason = reason;
}

function cancelForTargetSafeMode(mission) {
  if (!mission.enabled) return false;

  const room = Game.rooms[mission.targetRoom];
  const controller = room && room.controller;
  if (!controller || !(controller.safeMode > 0)) return false;

  mission.safeModeCancelled = true;
  mission.safeModeCancelledAt = Game.time;
  mission.safeModeRemaining = controller.safeMode;
  disableMission(mission, 'target-safe-mode');
  console.log(
    `[military] cancelled ${mission.missionId}: ` +
    `${mission.targetRoom} safe mode=${controller.safeMode}`
  );
  return true;
}

function initialize(attackEnabled) {
  const previous = Memory.military || {};
  const enabled = configuredAttackEnabled(previous, attackEnabled);

  if (previous.version !== MISSION_VERSION) {
    Memory.military = {
      version: MISSION_VERSION,
      missionId: MISSION_ID,
      enabled: false,
      phase: 'disabled',
      homeRoom: previous.homeRoom || null,
      rallyPos: previous.rallyPos || null,
      targetRoom:
        previous.targetRoom ||
        (previous.targetPos && previous.targetPos.roomName) ||
        'W49N26',
      targetPos: defaultTargetPos(previous),
      required: Object.assign({}, REQUIRED),
      nextSpawnIndex: 0,
      clearSince: null,
      safeModeCancelled: previous.safeModeCancelled === true,
      safeModeCancelledAt: previous.safeModeCancelledAt || null,
      status: {
        reason: 'mission-reset-after-failed-operation',
        counts: Object.assign({}, REQUIRED, {
          squadMelee: 0,
          squadHealer: 0,
          squadRanged: 0
        })
      }
    };
  }

  const mission = Memory.military;
  mission.enabled = enabled;
  if (!enabled) {
    const reason = mission.safeModeCancelled
      ? 'target-safe-mode'
      : ATTACK_ENABLED && Date.now() < ATTACK_START_AT
        ? 'scheduled-attack-wait'
        : 'script-disabled';
    disableMission(mission, reason);
  }
  if (!mission.required) mission.required = Object.assign({}, REQUIRED);
  if (!mission.targetPos) mission.targetPos = defaultTargetPos(mission);
  if (!mission.targetRoom) mission.targetRoom = mission.targetPos.roomName;
  updateRallyPos(mission);
  cancelForTargetSafeMode(mission);

  return mission;
}

function isMissionCreep(creep, mission) {
  return (
    creep &&
    COMBAT_ROLES.indexOf(creep.memory.role) !== -1 &&
    creep.memory.missionId === mission.missionId
  );
}

function getMissionCreeps(mission) {
  const result = [];
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (isMissionCreep(creep, mission)) result.push(creep);
  }
  return result;
}

function emptyCounts() {
  return {
    squadMelee: 0,
    squadHealer: 0,
    squadRanged: 0
  };
}

function countCreeps(mission, healthyOnly) {
  const counts = emptyCounts();
  const creeps = getMissionCreeps(mission);

  for (const creep of creeps) {
    if (
      healthyOnly &&
      creep.ticksToLive !== undefined &&
      creep.ticksToLive <=
        creep.body.length * CREEP_SPAWN_TIME + REPLACEMENT_ROUTE_BUFFER
    ) {
      continue;
    }
    counts[creep.memory.role]++;
  }

  for (const spawnName in Game.spawns) {
    const spawn = Game.spawns[spawnName];
    if (!spawn.spawning || !Memory.creeps) continue;
    const memory = Memory.creeps[spawn.spawning.name];
    if (
      memory &&
      COMBAT_ROLES.indexOf(memory.role) !== -1 &&
      memory.missionId === mission.missionId
    ) {
      counts[memory.role]++;
    }
  }

  return counts;
}

function countLivingCreeps(creeps) {
  const counts = emptyCounts();
  for (const creep of creeps) counts[creep.memory.role]++;
  return counts;
}

function hasRequiredComposition(counts, required) {
  return COMBAT_ROLES.every(role => counts[role] >= required[role]);
}

function getRallyPos(mission) {
  if (!mission.rallyPos) return null;
  return new RoomPosition(
    mission.rallyPos.x,
    mission.rallyPos.y,
    mission.rallyPos.roomName
  );
}

function allAssembled(mission, creeps) {
  const rally = getRallyPos(mission);
  if (!rally) return false;

  return creeps.every(creep =>
    creep.room.name === rally.roomName &&
    creep.pos.getRangeTo(rally) <= RALLY_RANGE &&
    creep.hits * 2 >= creep.hitsMax
  );
}

function targetRoomIsClear(mission) {
  const room = Game.rooms[mission.targetRoom];
  if (!room) return false;

  return (
    room.find(FIND_HOSTILE_CREEPS).length === 0
  );
}

function update(attackEnabled) {
  const mission = initialize(attackEnabled);
  const creeps = getMissionCreeps(mission);
  const counts = countCreeps(mission, false);

  mission.status = mission.status || {};
  mission.status.counts = counts;
  mission.status.lastUpdate = Game.time;

  if (!mission.enabled) return mission;

  if (mission.phase === 'disabled') {
    mission.phase = 'assembling';
  }

  if (mission.phase === 'assembling') {
    const livingCounts = countLivingCreeps(creeps);
    if (
      hasRequiredComposition(livingCounts, mission.required) &&
      allAssembled(mission, creeps)
    ) {
      mission.phase = 'advancing';
    }
    return mission;
  }

  if (mission.phase === 'advancing') {
    const active = creeps.filter(creep => !creep.memory.retreating);
    if (
      active.length > 0 &&
      active.every(creep => creep.room.name === mission.targetRoom)
    ) {
      mission.phase = 'sweeping';
      mission.clearSince = null;
    }
    return mission;
  }

  if (mission.phase === 'staging') {
    mission.phase = 'sweeping';
    mission.clearSince = null;
    return mission;
  }

  if (mission.phase === 'sweeping') {
    if (targetRoomIsClear(mission)) {
      if (mission.clearSince === null) mission.clearSince = Game.time;
      if (Game.time - mission.clearSince >= CLEAR_CONFIRM_TICKS) {
        mission.phase = 'holding';
      }
    } else {
      mission.clearSince = null;
    }
    return mission;
  }

  if (mission.phase === 'holding' && !targetRoomIsClear(mission)) {
    mission.phase = 'sweeping';
    mission.clearSince = null;
  }

  return mission;
}

function buildRepeatedBody(energyCapacity, set, setCost, fallback) {
  const fallbackCost = fallback.reduce(
    (total, part) => total + BODYPART_COST[part],
    0
  );
  if (energyCapacity < fallbackCost) return [];

  const count = Math.max(
    1,
    Math.min(
      Math.floor(50 / set.length),
      Math.floor(energyCapacity / setCost)
    )
  );
  if (energyCapacity < setCost) return fallback.slice();

  const tough = [];
  const action = [];
  const move = [];

  for (let index = 0; index < count; index++) {
    for (const part of set) {
      if (part === TOUGH) tough.push(part);
      else if (part === MOVE) move.push(part);
      else action.push(part);
    }
  }

  return tough.concat(action, move);
}

function buildMeleeBody(energyCapacity) {
  return buildRepeatedBody(
    energyCapacity,
    [TOUGH, ATTACK, MOVE, MOVE],
    BODYPART_COST[TOUGH] +
      BODYPART_COST[ATTACK] +
      BODYPART_COST[MOVE] * 2,
    [ATTACK, MOVE]
  );
}

function buildHealerBody(energyCapacity) {
  return buildRepeatedBody(
    energyCapacity,
    [TOUGH, HEAL, MOVE, MOVE],
    BODYPART_COST[TOUGH] +
      BODYPART_COST[HEAL] +
      BODYPART_COST[MOVE] * 2,
    [HEAL, MOVE]
  );
}

function buildRangedBody(energyCapacity) {
  return buildRepeatedBody(
    energyCapacity,
    [TOUGH, RANGED_ATTACK, MOVE, MOVE],
    BODYPART_COST[TOUGH] +
      BODYPART_COST[RANGED_ATTACK] +
      BODYPART_COST[MOVE] * 2,
    [RANGED_ATTACK, MOVE]
  );
}

function getBody(role, energyCapacity) {
  if (role === ROLE_HEALER) return buildHealerBody(energyCapacity);
  if (role === ROLE_RANGED) return buildRangedBody(energyCapacity);
  return buildMeleeBody(energyCapacity);
}

function chooseSpawnRole(mission, totalCounts, healthyCounts) {
  const start = mission.nextSpawnIndex || 0;

  for (let offset = 0; offset < SPAWN_SEQUENCE.length; offset++) {
    const index = (start + offset) % SPAWN_SEQUENCE.length;
    const role = SPAWN_SEQUENCE[index];
    const required = mission.required[role];
    if (
      healthyCounts[role] < required &&
      totalCounts[role] < required + 1
    ) {
      mission.nextSpawnIndex = (index + 1) % SPAWN_SEQUENCE.length;
      return role;
    }
  }

  return null;
}

function trySpawn(room, attackEnabled) {
  const mission = initialize(attackEnabled);
  if (!mission.enabled || !room.controller || !room.controller.my) {
    return false;
  }

  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return false;

  if (!mission.homeRoom) {
    mission.homeRoom = room.name;
  }
  if (mission.homeRoom !== room.name) return false;
  updateRallyPos(mission);

  const spawn = spawns.find(candidate => !candidate.spawning);
  if (!spawn) return false;

  if (!mission.rallyPos) {
    mission.rallyPos = {
      x: RALLY_X,
      y: RALLY_Y,
      roomName: room.name
    };
  }

  const totalCounts = countCreeps(mission, false);
  const healthyCounts = countCreeps(mission, true);
  const role = chooseSpawnRole(mission, totalCounts, healthyCounts);
  if (!role) return false;

  const body = getBody(role, room.energyCapacityAvailable);
  if (body.length === 0) return false;
  const name = `${role}-${mission.missionId}-${Game.time}`;
  const result = spawn.spawnCreep(body, name, {
    memory: {
      role: role,
      home: room.name,
      missionId: mission.missionId,
      retreating: false
    }
  });

  if (result === OK) {
    console.log(`[military] spawning ${name} for ${mission.missionId}`);
    return true;
  }
  if (result !== ERR_NOT_ENOUGH_ENERGY && result !== ERR_BUSY) {
    console.log(`[military:error] role=${role} result=${result}`);
  }

  return false;
}

module.exports = {
  ATTACK_START_AT,
  COMBAT_ROLES,
  MISSION_ID,
  MISSION_VERSION,
  REQUIRED,
  ROLE_HEALER,
  ROLE_MELEE,
  ROLE_RANGED,
  buildHealerBody,
  buildMeleeBody,
  buildRangedBody,
  initialize,
  trySpawn,
  update
};
