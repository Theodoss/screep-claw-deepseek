const sourceSlots = require('manager.rcl1SourceSlots');
const support = require('role.support');

const BASIC_BODY = [WORK, CARRY, MOVE];

function countRole(creeps, role) {
  let count = 0;

  for (const creep of creeps) {
    if (creep.memory.role === role) count++;
  }

  return count;
}

function countRoleWork(creeps, role) {
  let count = 0;

  for (const creep of creeps) {
    if (creep.memory.role === role) {
      count += creep.getActiveBodyparts(WORK);
    }
  }

  return count;
}

function countHarvesters(creeps, allowedSourceIds) {
  if (!allowedSourceIds || allowedSourceIds.length === 0) {
    let count = 0;
    for (const creep of creeps) {
      if (
        creep.memory.role === 'rcl1Harvester' &&
        (
          creep.ticksToLive === undefined ||
          creep.ticksToLive > 50
        )
      ) {
        count++;
      }
    }
    return count;
  }

  let count = 0;

  for (const creep of creeps) {
    if (creep.memory.role !== 'rcl1Harvester') continue;
    if (
      creep.ticksToLive !== undefined &&
      creep.ticksToLive <= 50
    ) {
      continue;
    }

    const creepSourceIds = Array.isArray(creep.memory.rcl1SourceIds)
      ? creep.memory.rcl1SourceIds
      : [];
    const hasAllowedSource = allowedSourceIds.indexOf(
      creep.memory.sourceId
    ) !== -1;
    const hasAllowedRestriction = creepSourceIds.some(
      sourceId => allowedSourceIds.indexOf(sourceId) !== -1
    );

    if (hasAllowedSource || hasAllowedRestriction) count++;
  }

  return count;
}

function trySpawn(spawn, role, body, allowedSourceIds) {
  const name = `${role}-${spawn.room.name}-${spawn.name}-${Game.time}`;
  const memory = {
    role: role,
    home: spawn.room.name,
    working: false
  };

  if (allowedSourceIds && allowedSourceIds.length > 0) {
    memory.rcl1SourceIds = allowedSourceIds;
  }

  const result = spawn.spawnCreep(body, name, {
    memory: memory
  });

  if (result === OK) {
    console.log(`[spawn] ${spawn.name} spawning ${name}`);
  } else if (result !== ERR_NOT_ENOUGH_ENERGY && result !== ERR_BUSY) {
    console.log(`[spawn:error] role=${role} result=${result}`);
  }

  return result;
}

function buildGuardBody(energyCapacity) {
  const pairCost = BODYPART_COST[ATTACK] + BODYPART_COST[MOVE];
  const pairs = Math.max(
    1,
    Math.min(25, Math.floor(energyCapacity / pairCost))
  );
  const body = [];

  for (let index = 0; index < pairs; index++) {
    body.push(ATTACK, MOVE);
  }

  return body;
}

function run(room, options) {
  const settings = options || {};
  const spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return false;

  const spawn = spawns[0];
  if (spawn.spawning) return false;

  const creeps = room.find(FIND_MY_CREEPS);
  const sourceIds = settings.sourceIds;
  const maintainSupport = settings.maintainSupport !== false;
  const harvesters = countHarvesters(creeps, sourceIds);
  const builders = countRole(creeps, 'rcl1Builder');
  const upgraderWork = countRoleWork(creeps, 'rcl1Upgrader');
  const guards = countRole(creeps, 'guard');
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const totalSlots = sourceSlots.getTotalSlots(room, sourceIds);
  const normalHarvesterTarget = Math.min(totalSlots, 4);
  const defaultHarvesterTarget = harvesters < 2 && totalSlots > 0
    ? Math.max(2, normalHarvesterTarget)
    : normalHarvesterTarget;
  const harvesterTarget = settings.harvesterTarget === undefined
    ? defaultHarvesterTarget
    : settings.harvesterTarget;
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: site => site.structureType !== STRUCTURE_WALL
  });
  const builderTarget = settings.builderTarget === undefined
    ? (sites.length > 0 ? 1 : 0)
    : settings.builderTarget;
  const upgraderWorkTarget = settings.upgraderWorkTarget === undefined
    ? 1
    : settings.upgraderWorkTarget;

  // Dynamic body builder: maximize WORK, min CARRY+MOVE.
  // Upgraders and builders near containers don't need extra C/M.
  const energyCapacity = room.energyCapacityAvailable;
  const bodyBuilder = settings.bodyBuilder || null;
  const buildBody = (role, desiredWork) => {
    if (bodyBuilder) {
      return bodyBuilder(energyCapacity, role, desiredWork);
    }
    return BASIC_BODY;
  };

  if (harvesters < harvesterTarget) {
    // Harvesters always use basic body (they walk to source and back)
    trySpawn(spawn, 'rcl1Harvester', BASIC_BODY, sourceIds);
    return true;
  }

  if (!maintainSupport) return false;

  const emergencyBuilderTarget = support.hasEmergencyRepair(room)
    ? Math.max(1, builderTarget)
    : 0;

  if (builders < emergencyBuilderTarget) {
    trySpawn(
      spawn,
      'rcl1Builder',
      buildBody('rcl1Builder', 1),
      sourceIds
    );
    return true;
  }

  if (hostiles.length > 0 && guards < 2) {
    trySpawn(
      spawn,
      'guard',
      buildGuardBody(room.energyCapacityAvailable),
      sourceIds
    );
    return true;
  }

  if (builders < builderTarget) {
    trySpawn(
      spawn,
      'rcl1Builder',
      buildBody('rcl1Builder', 1),
      sourceIds
    );
    return true;
  }

  if (upgraderWork < upgraderWorkTarget) {
    trySpawn(
      spawn,
      'rcl1Upgrader',
      buildBody('rcl1Upgrader', upgraderWorkTarget - upgraderWork),
      sourceIds
    );
    return true;
  }

  return false;
}

module.exports = {
  run: run
};
