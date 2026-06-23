const sourceSlots = require('manager.rcl1SourceSlots');
const support = require('role.support');
const population = require('manager.population');

const BASIC_BODY = [WORK, CARRY, MOVE];
const UPGRADER_REPLACEMENT_BUFFER = 10;

function countRole(creeps, role) {
  let count = 0;

  for (const creep of creeps) {
    if (creep.memory.role === role) count++;
  }

  return count;
}

function belongsToRoom(creep, roomName) {
  if (!creep || !creep.memory) return false;
  return creep.memory.home === roomName ||
    (!creep.memory.home && creep.room && creep.room.name === roomName);
}

function getHomeCreeps(room) {
  const creeps = [];

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (belongsToRoom(creep, room.name)) creeps.push(creep);
  }

  return creeps;
}

function getUpgraderState(creeps, spawn, room) {
  let count = 0;
  let healthyWork = 0;
  let dyingCount = 0;
  const controllerRange = room.controller
    ? spawn.pos.getRangeTo(room.controller)
    : 0;

  for (const creep of creeps) {
    if (creep.memory.role !== 'upgrader') continue;

    count++;
    const work = creep.getActiveBodyparts(WORK);
    const replacementLead =
      creep.body.length * CREEP_SPAWN_TIME +
      controllerRange +
      UPGRADER_REPLACEMENT_BUFFER;
    if (
      creep.ticksToLive === undefined ||
      creep.ticksToLive > replacementLead
    ) {
      healthyWork += work;
    } else {
      dyingCount++;
    }
  }

  return {
    count: count,
    healthyWork: healthyWork,
    dyingCount: dyingCount
  };
}

function getHarvesterState(creeps, allowedSourceIds) {
  let totalCount = 0;
  let healthyEligibleCount = 0;
  const restricted = allowedSourceIds && allowedSourceIds.length > 0;

  for (const creep of creeps) {
    if (creep.memory.role !== 'rcl1Harvester') continue;
    totalCount++;
    if (
      creep.ticksToLive !== undefined &&
      creep.ticksToLive <= 50
    ) {
      continue;
    }
    if (!restricted) {
      healthyEligibleCount++;
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

    if (
      !restricted ||
      hasAllowedSource ||
      hasAllowedRestriction
    ) {
      healthyEligibleCount++;
    }
  }

  return {
    healthyEligibleCount: healthyEligibleCount,
    totalCount: totalCount
  };
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

  const creeps = getHomeCreeps(room);
  const sourceIds = settings.sourceIds;
  const maintainSupport = settings.maintainSupport !== false;
  const harvesters = getHarvesterState(creeps, sourceIds);
  const builders = countRole(creeps, 'rcl1Builder');
  const upgraders = getUpgraderState(creeps, spawn, room);
  const guards = countRole(creeps, 'guard');
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const totalSlots = sourceSlots.getTotalSlots(room, sourceIds);
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: site => site.structureType !== STRUCTURE_WALL
  });
  const emergencyRepair = support.hasEmergencyRepair(room);
  const defaultUpgradeWork = settings.upgraderWorkTarget === undefined
    ? 1
    : settings.upgraderWorkTarget;
  const roomMemory = Memory.rooms && Memory.rooms[room.name]
    ? Memory.rooms[room.name]
    : {};
  const containerEconomyReady = !!(
    roomMemory.containerEconomy &&
    roomMemory.containerEconomy.ready
  );
  const populationPlan = settings.populationPlan || population.getPlan(
    room.controller ? room.controller.level : 1,
    {
      roomName: room.name,
      bootstrapEconomy:
        !!room.controller &&
        room.controller.level >= 2 &&
        !containerEconomyReady,
      constructionCount: sites.length,
      remainingBuildWork: sites.reduce(
        function (sum, site) {
          return sum + Math.max(0, site.progressTotal - site.progress);
        },
        0
      ),
      controllerEmergency: !!(
        room.controller &&
        typeof room.controller.ticksToDowngrade === 'number' &&
        room.controller.ticksToDowngrade < 4000
      ),
      emergencyRepair: emergencyRepair,
      hostilesCount: hostiles.length,
      noCreeps: creeps.length === 0,
      selfHarvestMissing:
        (!room.controller || room.controller.level <= 1) &&
        harvesters.healthyEligibleCount === 0,
      sourceSlots: totalSlots,
      upgraderWorkTarget: defaultUpgradeWork
    }
  );
  const harvesterPolicy = population.getRole(
    populationPlan,
    'rcl1Harvester'
  );
  const builderPolicy = population.getRole(
    populationPlan,
    'rcl1Builder'
  );
  const upgraderPolicy = population.getRole(
    populationPlan,
    'upgrader'
  );
  const guardPolicy = population.getRole(populationPlan, 'guard');
  population.saveRoomState(room.name, populationPlan);

  const requestedHarvesterTarget = settings.harvesterTarget === undefined
    ? harvesterPolicy.target
    : settings.harvesterTarget;
  const harvesterLimit = harvesterPolicy.limit;
  const harvesterTarget = Math.min(
    harvesterLimit,
    requestedHarvesterTarget
  );
  const requestedBuilderTarget = settings.builderTarget === undefined
    ? builderPolicy.target
    : settings.builderTarget;
  const builderTarget = Math.min(
    builderPolicy.limit,
    requestedBuilderTarget
  );
  const requestedUpgraderWork = settings.upgraderWorkTarget === undefined
    ? populationPlan.upgraderWorkTarget
    : settings.upgraderWorkTarget;
  const upgraderWorkTarget = Math.min(
    populationPlan.upgraderWorkTarget,
    requestedUpgraderWork
  );

  // Dynamic body builder: maximize WORK, min CARRY+MOVE.
  // Upgraders and builders near containers don't need extra C/M.
  // Use room.energyAvailable (spawn + extensions actual energy) instead of
  // room.energyCapacityAvailable so the body fits within current budget.
  // When energy is low we spawn smaller bodies; when extensions are full
  // we automatically scale up to bigger bodies.
  const energyCapacity = room.energyAvailable;
  const bodyBuilder = settings.bodyBuilder || null;
  const buildBody = (role, desiredWork) => {
    if (bodyBuilder) {
      return bodyBuilder(energyCapacity, role, desiredWork);
    }
    return BASIC_BODY;
  };

  if (
    harvesters.healthyEligibleCount < harvesterTarget &&
    harvesters.totalCount < harvesterLimit
  ) {
    // Harvesters always use basic body (they walk to source and back)
    trySpawn(spawn, 'rcl1Harvester', BASIC_BODY, sourceIds);
    return true;
  }

  if (!maintainSupport) return false;

  // When energy is below 50% of capacity, skip support spawns
  // (builder/upgrader) so extensions can refill.  This prevents
  // spawning basic [W,C,M] bodies during RCL transitions when
  // high-cost hauler/miner replacements have just drained energy.
  // Once extensions refill past 50%, we get bigger bodies.
  if (room.energyAvailable < room.energyCapacityAvailable * 0.5) {
    return false;
  }

  const emergencyBuilderTarget = emergencyRepair
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

  // Defense: spawn guard only when towers can't handle it.
  // Hostiles > 3 AND tower energy below 1/3 capacity.
  var towers = room.find(FIND_MY_STRUCTURES, {
    filter: function (s) { return s.structureType === STRUCTURE_TOWER; }
  });
  var towerEnergy = 0;
  var towerCapacity = 0;
  for (var ti = 0; ti < towers.length; ti++) {
    towerEnergy += towers[ti].store.getUsedCapacity(RESOURCE_ENERGY);
    towerCapacity += towers[ti].store.getCapacity(RESOURCE_ENERGY);
  }
  var towerDepleted = towers.length > 0 && towerEnergy < towerCapacity / 3;
  var needGuard = hostiles.length > 3 && towerDepleted;

  if (needGuard && guards < guardPolicy.target) {
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

  // Use (count - dyingCount) so we replace dying upgraders before
  // they expire, avoiding a work gap.  Raw count includes dying
  // creeps and would block replacement when count >= limit+1.
  // Also allow spawning above the count limit when existing upgraders
  // are severely underpowered (e.g. basic-body upgraders filling all
  // slots but providing <25% of target work).  This recovers from
  // energy-dip downgrades where tiny bodies block upgrades to large ones.
  if (
    (
      (upgraders.count - upgraders.dyingCount) < upgraderPolicy.limit ||
      upgraders.healthyWork < upgraderWorkTarget * 0.25
    ) &&
    upgraders.healthyWork < upgraderWorkTarget
  ) {
    trySpawn(
      spawn,
      'upgrader',
      buildBody(
        'upgrader',
        upgraderWorkTarget - upgraders.healthyWork
      ),
      sourceIds
    );
    return true;
  }

  return false;
}

module.exports = {
  run: run
};
