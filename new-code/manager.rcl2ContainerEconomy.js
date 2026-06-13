const bootstrap = require('manager.rcl1Bootstrap');
const economy = require('manager.economy');
const population = require('manager.population');
const support = require('role.support');

const DISCOVERY_INTERVAL = 50;
const ENERGY_STARVATION_TICKS = 50;

function ensureRoomMemory(roomName) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  const roomMemory = Memory.rooms[roomName];
  if (!roomMemory.sources || typeof roomMemory.sources !== 'object') {
    roomMemory.sources = {};
  }
  if (!roomMemory.containerEconomy) {
    roomMemory.containerEconomy = {};
  }

  return roomMemory;
}

function serializePos(pos) {
  if (!pos) return null;

  return {
    x: pos.x,
    y: pos.y,
    roomName: pos.roomName
  };
}

function samePos(left, right) {
  return (
    left &&
    right &&
    left.x === right.x &&
    left.y === right.y &&
    left.roomName === right.roomName
  );
}

function findSuggestedContainerPos(room, source, spawn) {
  const terrain = Game.map.getRoomTerrain(room.name);
  let selected = null;
  let selectedRange = Infinity;

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;

      const x = source.pos.x + dx;
      const y = source.pos.y + dy;
      if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

      const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
      const sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
      if (structures.length > 0 || sites.length > 0) continue;

      const range = spawn ? spawn.pos.getRangeTo(x, y) : source.pos.getRangeTo(x, y);
      if (range < selectedRange) {
        selected = { x: x, y: y, roomName: room.name };
        selectedRange = range;
      }
    }
  }

  return selected;
}

function discoverSources(room, roomMemory) {
  const sources = room.find(FIND_SOURCES);
  const containers = room.find(FIND_STRUCTURES, {
    filter: structure => structure.structureType === STRUCTURE_CONTAINER
  });
  const containerSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: site => site.structureType === STRUCTURE_CONTAINER
  });
  const spawns = room.find(FIND_MY_SPAWNS);
  const spawn = spawns[0] || null;
  const nextSources = {};

  for (const source of sources) {
    const previous = roomMemory.sources[source.id] || {};
    const container = containers.find(
      candidate => candidate.pos.getRangeTo(source) <= 1
    ) || null;
    const plannedSite = containerSites.find(
      candidate => candidate.pos.getRangeTo(source) <= 1
    ) || null;
    const actualPos = container ? serializePos(container.pos) : null;
    const plannedPos = plannedSite ? serializePos(plannedSite.pos) : null;
    const plannerSource = roomMemory.planner &&
      roomMemory.planner.sourcePlans
      ? roomMemory.planner.sourcePlans[source.id]
      : null;
    let suggestedPos = plannerSource && plannerSource.containerPos
      ? plannerSource.containerPos
      : previous.suggestedContainerPos || null;

    if (!container && !plannedSite) {
      suggestedPos = suggestedPos ||
        findSuggestedContainerPos(room, source, spawn);
    } else {
      suggestedPos = null;
    }

    let distanceFromSpawn = previous.distanceFromSpawn;
    if (
      container &&
      spawn &&
      (
        typeof distanceFromSpawn !== 'number' ||
        !samePos(previous.containerPos, actualPos)
      )
    ) {
      distanceFromSpawn = spawn.pos.findPathTo(
        actualPos.x,
        actualPos.y,
        { ignoreCreeps: true }
      ).length;
    }

    if (!container) distanceFromSpawn = null;

    nextSources[source.id] = {
      sourceId: source.id,
      containerId: container ? container.id : null,
      containerPos: actualPos || plannedPos,
      containerReady: !!container,
      plannedContainerPos: plannedPos,
      suggestedContainerPos: suggestedPos,
      minerName: previous.minerName || null,
      distanceFromSpawn: distanceFromSpawn
    };
  }

  roomMemory.sources = nextSources;
  roomMemory.containerEconomy.lastDiscoveryTick = Game.time;
}

function updateEnergyHealth(room, economyMemory) {
  const current = room.energyAvailable;

  if (
    typeof economyMemory.lastEnergyAvailable !== 'number' ||
    current > economyMemory.lastEnergyAvailable ||
    current >= room.energyCapacityAvailable
  ) {
    economyMemory.lastEnergyIncreaseTick = Game.time;
  }

  economyMemory.lastEnergyAvailable = current;

  return (
    current < room.energyCapacityAvailable &&
    typeof economyMemory.lastEnergyIncreaseTick === 'number' &&
    Game.time - economyMemory.lastEnergyIncreaseTick >= ENERGY_STARVATION_TICKS
  );
}

function collect(room) {
  const roomMemory = ensureRoomMemory(room.name);
  const economyMemory = roomMemory.containerEconomy;

  if (
    typeof economyMemory.lastDiscoveryTick !== 'number' ||
    Game.time - economyMemory.lastDiscoveryTick >= DISCOVERY_INTERVAL
  ) {
    discoverSources(room, roomMemory);
  }

  const sourceEntries = Object.keys(roomMemory.sources).map(
    sourceId => roomMemory.sources[sourceId]
  );
  const readySources = sourceEntries.filter(entry => entry.containerReady);
  const uncoveredSources = sourceEntries.filter(entry => !entry.containerReady);
  const controllerLevel = room.controller ? room.controller.level : 0;
  const memoryValid = sourceEntries.length > 0;
  const ready = controllerLevel >= 2 && readySources.length > 0 && memoryValid;
  let mode = 'rcl1-bootstrap';

  if (ready) {
    mode = readySources.length === sourceEntries.length
      ? 'rcl2-container-full'
      : 'rcl2-container-partial';
  }

  const energyStarved = updateEnergyHealth(room, economyMemory);
  economyMemory.mode = mode;
  economyMemory.ready = ready;
  economyMemory.energyStarved = energyStarved;

  return {
    ready: ready,
    mode: mode,
    memoryValid: memoryValid,
    readySources: readySources,
    uncoveredSources: uncoveredSources,
    energyStarved: energyStarved
  };
}

function buildMinerBody(energyCapacity) {
  // Miner 站在 container 上採集。無 CARRY 時 harvest 會把能量
  // 直接掉在地上，同格的 container 自動撿起 → 不需要 CARRY。
  // 最大化 WORK 提高開採效率。
  const maxWork = Math.max(
    1,
    Math.min(5, Math.floor((energyCapacity - BODYPART_COST[MOVE]) /
      BODYPART_COST[WORK]))
  );
  const body = [];
  for (let i = 0; i < maxWork; i++) body.push(WORK);
  body.push(MOVE);
  return body;
}

function buildWorkerBody(energyCapacity, role, desiredWork) {
  const body = [];

  if (role === 'rcl1Upgrader') {
    const affordableWork = Math.max(
      1,
      Math.floor(
        (energyCapacity - BODYPART_COST[CARRY] - BODYPART_COST[MOVE]) /
        BODYPART_COST[WORK]
      )
    );
    const workParts = Math.min(48, affordableWork, desiredWork || 1);
    for (let index = 0; index < workParts; index++) body.push(WORK);
    body.push(CARRY, MOVE);
    return body;
  }

  const setCost =
    BODYPART_COST[WORK] +
    BODYPART_COST[CARRY] +
    BODYPART_COST[MOVE];
  const sets = Math.max(
    1,
    Math.min(16, Math.floor(energyCapacity / setCost))
  );
  for (let index = 0; index < sets; index++) {
    body.push(WORK, CARRY, MOVE);
  }
  return body;
}

function buildGuardBody(energyCapacity) {
  // Defense: ATTACK+MOVE pairs.
  const pairCost = 130;
  const pairs = Math.max(
    1,
    Math.min(25, Math.floor(energyCapacity / pairCost))
  );
  const body = [];
  for (let i = 0; i < pairs; i++) body.push(ATTACK, MOVE);
  return body;
}

function buildHaulerBody(energyCapacity) {
  const body = [];
  const sets = Math.max(1, Math.min(3, Math.floor(energyCapacity / 150)));

  for (let index = 0; index < sets; index++) {
    body.push(CARRY, CARRY, MOVE);
  }

  return body;
}

function trySpawnMiner(spawn, room, sourceEntry, body) {
  const shortId = sourceEntry.sourceId.slice(-6);
  const name = `rcl2Miner-${room.name}-${shortId}-${Game.time}`;
  const result = spawn.spawnCreep(body, name, {
    memory: {
      role: 'rcl2Miner',
      home: room.name,
      sourceId: sourceEntry.sourceId,
      containerId: sourceEntry.containerId,
      containerPos: sourceEntry.containerPos
    }
  });

  if (result === OK) {
    sourceEntry.minerName = name;
    console.log(`[spawn] ${spawn.name} spawning ${name}`);
  } else if (result !== ERR_NOT_ENOUGH_ENERGY && result !== ERR_BUSY) {
    console.log(`[spawn:error] role=rcl2Miner result=${result}`);
  }

  return result;
}

function trySpawnHauler(spawn, room, body) {
  const name = `rcl2Hauler-${room.name}-${spawn.name}-${Game.time}`;
  const result = spawn.spawnCreep(body, name, {
    memory: {
      role: 'rcl2Hauler',
      home: room.name,
      working: false
    }
  });

  if (result === OK) {
    console.log(`[spawn] ${spawn.name} spawning ${name}`);
  } else if (result !== ERR_NOT_ENOUGH_ENERGY && result !== ERR_BUSY) {
    console.log(`[spawn:error] role=rcl2Hauler result=${result}`);
  }

  return result;
}

function getCreepsByRole(creeps, role) {
  return creeps.filter(creep => creep.memory.role === role);
}

function updateMinerNames(state, miners) {
  for (const sourceEntry of state.readySources) {
    const sourceMiners = miners.filter(
      creep => creep.memory.sourceId === sourceEntry.sourceId
    );
    let selected = null;

    for (const miner of sourceMiners) {
      if (
        !selected ||
        (miner.ticksToLive || 0) > (selected.ticksToLive || 0)
      ) {
        selected = miner;
      }
    }

    sourceEntry.minerName = selected ? selected.name : null;
  }
}

function findMinerNeedingSpawn(state, miners, minerBody) {
  for (const sourceEntry of state.readySources) {
    const distance = typeof sourceEntry.distanceFromSpawn === 'number'
      ? sourceEntry.distanceFromSpawn
      : 0;
    const replacementLead =
      minerBody.length * CREEP_SPAWN_TIME + distance + 10;
    const sourceMiners = miners.filter(
      creep => creep.memory.sourceId === sourceEntry.sourceId
    );
    if (sourceMiners.length >= 2) continue;
    const hasHealthyMiner = sourceMiners.some(
      creep =>
        creep.ticksToLive === undefined ||
        creep.ticksToLive > replacementLead
    );

    if (!hasHealthyMiner) return sourceEntry;
  }

  return null;
}

function needsHaulerReplacement(
  state,
  haulers,
  haulerBody,
  requiredHaulers
) {
  const longestRoute = state.readySources.reduce(
    (longest, sourceEntry) => Math.max(
      longest,
      typeof sourceEntry.distanceFromSpawn === 'number'
        ? sourceEntry.distanceFromSpawn
        : 0
    ),
    0
  );
  const replacementLead =
    haulerBody.length * CREEP_SPAWN_TIME + longestRoute + 10;
  const healthyHaulers = haulers.filter(
    creep =>
      creep.ticksToLive === undefined ||
      creep.ticksToLive > replacementLead
  );

  return healthyHaulers.length < requiredHaulers;
}

function findSourceWithoutMiner(state, miners) {
  for (const sourceEntry of state.readySources) {
    const hasMiner = miners.some(
      creep => creep.memory.sourceId === sourceEntry.sourceId
    );
    if (!hasMiner) return sourceEntry;
  }

  return null;
}

function run(room, state) {
  const spawns = room.find(FIND_MY_SPAWNS);
  const creeps = room.find(FIND_MY_CREEPS);
  const rcl1Harvesters = getCreepsByRole(creeps, 'rcl1Harvester');
  const miners = getCreepsByRole(creeps, 'rcl2Miner');
  const haulers = getCreepsByRole(creeps, 'rcl2Hauler');
  const guards = getCreepsByRole(creeps, 'guard');
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: site => site.structureType !== STRUCTURE_WALL
  });
  const emergencyRepair = support.hasEmergencyRepair(room);
  const generalRepair = support.hasGeneralRepair(room);
  const towersMaintain = generalRepair
    ? support.towersCanMaintain(room)
    : true;

  updateMinerNames(state, miners);

  const minerBody = buildMinerBody(room.energyCapacityAvailable);
  const haulerBody = buildHaulerBody(room.energyCapacityAvailable);
  const missingMiner = findSourceWithoutMiner(state, miners);
  const minersHealthy = !missingMiner;
  const controllerLevel = room.controller ? room.controller.level : 2;
  const sourceCount =
    state.readySources.length + state.uncoveredSources.length;
  const capacityPlan = population.getPlan(
    controllerLevel,
    {
      readySourceCount: state.readySources.length,
      sourceCount: sourceCount,
      uncoveredSourceCount: state.uncoveredSources.length
    }
  );
  const requiredHaulers = population.getRole(
    capacityPlan,
    'rcl2Hauler'
  ).target;
  const haulersHealthy = haulers.length >= requiredHaulers;
  const economyState = economy.update(room, {
    constructionCount: constructionSites.length,
    energyStarved: state.energyStarved,
    haulersHealthy: haulersHealthy,
    hostilesCount: hostiles.length,
    minersHealthy: minersHealthy,
    repairBacklog: emergencyRepair || generalRepair
  });
  const controllerContainer = economy.getControllerContainer(room);
  const requestedUpgradeWork = controllerContainer
    ? economyState.upgraderWorkTarget || 0
    : 0;
  const populationPlan = population.getPlan(
    controllerLevel,
    {
      constructionCount: constructionSites.length,
      controllerEmergency: !!economyState.controllerEmergency,
      emergencyRepair: emergencyRepair,
      energyStarved: state.energyStarved,
      generalRepair: generalRepair,
      haulersHealthy: haulersHealthy,
      hostilesCount: hostiles.length,
      minersHealthy: minersHealthy,
      noCreeps: creeps.length === 0,
      readySourceCount: state.readySources.length,
      selfHarvestMissing:
        haulers.length === 0 && rcl1Harvesters.length === 0,
      sourceCount: sourceCount,
      towersCanMaintain: towersMaintain,
      uncoveredSourceCount: state.uncoveredSources.length,
      upgraderWorkTarget: requestedUpgradeWork
    }
  );
  const fallbackHarvester = population.getRole(
    populationPlan,
    'rcl1Harvester'
  );
  const minerPolicy = population.getRole(populationPlan, 'rcl2Miner');
  const haulerPolicy = population.getRole(populationPlan, 'rcl2Hauler');
  const builderPolicy = population.getRole(populationPlan, 'rcl1Builder');
  const guardPolicy = population.getRole(populationPlan, 'guard');
  const minerLimit = minerPolicy.limit;
  const haulerLimit = haulerPolicy.limit;
  population.saveRoomState(room.name, populationPlan);

  state.economy = economyState;
  state.population = populationPlan;
  state.recovery = economyState.recovery;
  state.mode = economyState.recovery ? 'rcl2-recovery' : state.mode;
  if (Memory.rooms[room.name] && Memory.rooms[room.name].containerEconomy) {
    Memory.rooms[room.name].containerEconomy.mode = state.mode;
  }

  if (spawns.length === 0) return;

  const spawn = spawns[0];
  if (spawn.spawning) return;

  if (
    creeps.length === 0 ||
    (haulers.length === 0 && rcl1Harvesters.length === 0)
  ) {
    const spawnedFallback = bootstrap.run(room, {
      harvesterTarget: fallbackHarvester.target,
      sourceIds: state.uncoveredSources.map(entry => entry.sourceId),
      maintainSupport: false,
      populationPlan: populationPlan
    });
    if (spawnedFallback) return;
  }

  let spawnBlocked = false;

  if (missingMiner && miners.length < minerLimit) {
    const emergencyMinerBody = buildMinerBody(room.energyAvailable);
    const result = trySpawnMiner(spawn, room, missingMiner, emergencyMinerBody);
    if (result === OK) return;
    spawnBlocked = true;
  }

  if (
    haulers.length < requiredHaulers &&
    haulers.length < haulerLimit
  ) {
    const emergencyHaulerBody = buildHaulerBody(room.energyAvailable);
    const result = trySpawnHauler(spawn, room, emergencyHaulerBody);
    if (result === OK) return;
    spawnBlocked = true;
  }

  if (spawnBlocked) {
    bootstrap.run(room, {
      harvesterTarget: 1,
      sourceIds: state.uncoveredSources.map(entry => entry.sourceId),
      maintainSupport: false
    });
    return;
  }

  if (
    haulers.length < haulerLimit &&
    needsHaulerReplacement(
      state,
      haulers,
      haulerBody,
      requiredHaulers
    )
  ) {
    trySpawnHauler(spawn, room, haulerBody);
    return;
  }

  const replacementMiner = findMinerNeedingSpawn(
    state,
    miners,
    minerBody
  );
  if (replacementMiner && miners.length < minerLimit) {
    trySpawnMiner(spawn, room, replacementMiner, minerBody);
    return;
  }

  const fallbackTarget = fallbackHarvester.target;
  const fallbackSourceIds = state.uncoveredSources.map(entry => entry.sourceId);
  const upgraderWorkTarget = populationPlan.upgraderWorkTarget;

  if (emergencyRepair) {
    const spawnedMaintainer = bootstrap.run(room, {
      harvesterTarget: fallbackTarget,
      sourceIds: fallbackSourceIds,
      maintainSupport: true,
      builderTarget: 1,
      upgraderWorkTarget: 0,
      bodyBuilder: buildWorkerBody,
      populationPlan: populationPlan
    });
    if (spawnedMaintainer) return;
  }

  // Defense: hostiles present → spawn guard before support creeps
  if (
    hostiles.length > 0 &&
    guards.length < guardPolicy.target
  ) {
    const guardBody = buildGuardBody(room.energyCapacityAvailable);
    // Guard spawns like other creeps but with 'guard' role
    const name = `guard-${room.name}-${spawn.name}-${Game.time}`;
    const result = spawn.spawnCreep(guardBody, name, {
      memory: { role: 'guard', home: room.name }
    });
    if (result === OK) {
      console.log(`[spawn] ${spawn.name} spawning ${name} (hostile!)`);
    } else if (result !== ERR_NOT_ENOUGH_ENERGY && result !== ERR_BUSY) {
      console.log(`[spawn:error] role=guard result=${result}`);
    }
    // Regardless of result, don't spawn support when hostiles present
    // If we can't afford a guard, spawn nothing — put energy towards defense
    return;
  }

  bootstrap.run(room, {
    harvesterTarget: fallbackTarget,
    sourceIds: fallbackSourceIds,
    maintainSupport: true,
    builderTarget: builderPolicy.target,
    upgraderWorkTarget: upgraderWorkTarget,
    bodyBuilder: buildWorkerBody,
    populationPlan: populationPlan
  });
}

module.exports = {
  collect: collect,
  run: run
};
