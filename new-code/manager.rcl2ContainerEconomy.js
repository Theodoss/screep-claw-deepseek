const bootstrap = require('manager.rcl1Bootstrap');
const bodyPolicy = require('body.policy');
const economy = require('manager.economy');
const population = require('manager.population');
const support = require('role.support');
const colonyStates = require('config.colonyStates');
const colonies = require('config.colonies');

const DISCOVERY_INTERVAL = 50;
const ENERGY_STARVATION_TICKS = 50;
const HAULER_BACKLOG_TICKS = 50;
const HAULER_LOW_IDLE_TICKS = 100;
const SOURCE_BACKLOG_ENERGY = 1000;
const SOURCE_LOW_ENERGY = 100;
const HAULER_TARGET_CAP = 3;

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
  const storage = room.storage || null;
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

  const sourceContainerIds = {};
  for (const sourceId in nextSources) {
    const containerId = nextSources[sourceId].containerId;
    if (containerId) sourceContainerIds[containerId] = true;
  }
  const controllerContainer = room.controller
    ? containers.find(candidate =>
      !sourceContainerIds[candidate.id] &&
      candidate.pos.getRangeTo(room.controller) <= 3
    ) || null
    : null;

  for (const sourceId in nextSources) {
    const entry = nextSources[sourceId];
    if (!entry.containerId) continue;
    const container = Game.getObjectById(entry.containerId);
    if (!container) continue;

    entry.distanceFromStorage = storage
      ? container.pos.findPathTo(storage.pos, {
        ignoreCreeps: true
      }).length
      : null;
    entry.distanceFromControllerContainer = controllerContainer
      ? container.pos.findPathTo(controllerContainer.pos, {
        ignoreCreeps: true
      }).length
      : null;
    const deliveryDistances = [
      entry.distanceFromSpawn,
      entry.distanceFromControllerContainer
    ].filter(distance => typeof distance === 'number');
    entry.haulingDistance = storage
      ? entry.distanceFromStorage
      : deliveryDistances.length > 0
        ? Math.max.apply(null, deliveryDistances)
        : entry.distanceFromSpawn;
  }

  roomMemory.sources = nextSources;
  roomMemory.containerEconomy.lastDiscoveryTick = Game.time;
}

function updateSourceEnergyPressure(state, haulers, roomMemory) {
  let totalEnergy = 0;
  let highNow = false;
  let allLow = state.readySources.length > 0;

  for (const entry of state.readySources) {
    const container = entry.containerId
      ? Game.getObjectById(entry.containerId)
      : null;
    const energy = container
      ? container.store.getUsedCapacity(RESOURCE_ENERGY)
      : 0;
    totalEnergy += energy;
    if (energy > SOURCE_BACKLOG_ENERGY) highNow = true;
    if (energy >= SOURCE_LOW_ENERGY) allLow = false;
  }

  const previousTick = roomMemory.sourceEnergySampleTick;
  const previousEnergy = roomMemory.sourceEnergySample;
  if (
    typeof previousTick === 'number' &&
    typeof previousEnergy === 'number' &&
    Game.time > previousTick
  ) {
    roomMemory.sourceNetEnergyRate =
      (totalEnergy - previousEnergy) / (Game.time - previousTick);
  }
  if (
    typeof previousTick !== 'number' ||
    Game.time - previousTick >= 25
  ) {
    roomMemory.sourceEnergySampleTick = Game.time;
    roomMemory.sourceEnergySample = totalEnergy;
  }

  const economyMemory = Memory.rooms &&
    Memory.rooms[state.roomName] &&
    Memory.rooms[state.roomName].economyAccounting;
  const netBacklog = (
    (roomMemory.sourceNetEnergyRate || 0) > 2 ||
    (
      economyMemory &&
      (economyMemory.shortNetEnergyRate || 0) > 2
    )
  ) && totalEnergy > state.readySources.length * 500;
  const idleHauler = haulers.some(creep =>
    creep.memory.task === 'idle:no-source-energy' ||
    creep.memory.task === 'idle:all-energy-targets-full'
  );

  roomMemory.haulerBacklogTicks = highNow || netBacklog
    ? (roomMemory.haulerBacklogTicks || 0) + 1
    : 0;
  roomMemory.haulerLowIdleTicks = allLow && idleHauler
    ? (roomMemory.haulerLowIdleTicks || 0) + 1
    : 0;

  if (roomMemory.haulerBacklogTicks >= HAULER_BACKLOG_TICKS) {
    roomMemory.haulerBacklogBonus = 1;
  } else if (
    roomMemory.haulerLowIdleTicks >= HAULER_LOW_IDLE_TICKS
  ) {
    roomMemory.haulerBacklogBonus = 0;
  }

  roomMemory.sourceContainerEnergy = totalEnergy;
  return roomMemory.haulerBacklogBonus || 0;
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
    roomName: room.name,
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

  if (role === 'upgrader') {
    return bodyPolicy.buildStaticUpgraderBody(
      energyCapacity,
      desiredWork
    );
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
  // Defense: ATTACK+MOVE pairs + one HEAL+MOVE for self-heal.
  const healPairCost = BODYPART_COST[HEAL] + BODYPART_COST[MOVE];
  const attackPairCost = BODYPART_COST[ATTACK] + BODYPART_COST[MOVE];
  const budgetAfterHeal = energyCapacity - healPairCost;
  const attackPairs = Math.max(
    0,
    Math.min(25, Math.floor(budgetAfterHeal / attackPairCost))
  );
  const body = [];
  for (let i = 0; i < attackPairs; i++) body.push(ATTACK, MOVE);
  body.push(HEAL, MOVE);
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
  haulerPlan
) {
  const longestRoute = state.readySources.reduce(
    (longest, sourceEntry) => Math.max(
      longest,
      typeof sourceEntry.haulingDistance === 'number'
        ? sourceEntry.haulingDistance
        : typeof sourceEntry.distanceFromSpawn === 'number'
          ? sourceEntry.distanceFromSpawn
        : 0
    ),
    0
  );
  const replacementLead =
    haulerPlan.body.length * CREEP_SPAWN_TIME + longestRoute + 10;
  const healthyHaulers = haulers.filter(
    creep =>
      creep.ticksToLive === undefined ||
      creep.ticksToLive > replacementLead
  );
  const healthyCarryParts = healthyHaulers.reduce(
    (total, creep) => total + creep.getActiveBodyparts(CARRY),
    0
  );

  return healthyCarryParts < haulerPlan.targetCarryParts;
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
  const creeps = getHomeCreeps(room);
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

  const controllerContainer = economy.getControllerContainer(room);
  const extensions = room.find(FIND_MY_STRUCTURES, {
    filter: function (s) { return s.structureType === STRUCTURE_EXTENSION; }
  });

  updateMinerNames(state, miners);

  const minerBody = buildMinerBody(room.energyCapacityAvailable);
  const missingMiner = findSourceWithoutMiner(state, miners);
  const minersHealthy = !missingMiner;
  const controllerLevel = room.controller ? room.controller.level : 2;
  const sourceCount =
    state.readySources.length + state.uncoveredSources.length;

  // Count active remote rooms and sources for population plan
  const remoteHome = Memory.remote && Memory.remote[room.name];
  const remoteRoomsConfig = remoteHome && remoteHome.rooms ? remoteHome.rooms : {};
  let remoteRoomCount = 0;
  let remoteSourceCount = 0;
  for (const rn in remoteRoomsConfig) {
    const rc = remoteRoomsConfig[rn];
    if (!rc || rc.enabled === false) continue;
    remoteRoomCount++;
    if (Array.isArray(rc.sources)) {
      remoteSourceCount += rc.sources.filter(function (s) {
        return s && s.enabled !== false && s.x !== null && s.y !== null;
      }).length;
    }
  }
  const remoteProgramActive = remoteRoomCount > 0;

  const capacityPlan = population.getPlan(
    controllerLevel,
    {
      readySourceCount: state.readySources.length,
      sourceCount: sourceCount,
      uncoveredSourceCount: state.uncoveredSources.length,
      remoteRoomCount: remoteRoomCount,
      remoteSourceCount: remoteSourceCount,
      remoteProgramActive: remoteProgramActive
    }
  );
  const requiredHaulers = population.getRole(
    capacityPlan,
    'rcl2Hauler'
  ).target;
  const roomMemory = ensureRoomMemory(room.name);
  const backlogBonus = updateSourceEnergyPressure(
    state,
    haulers,
    roomMemory.containerEconomy
  );
  const capacityHaulerPlan = bodyPolicy.getHaulerPlan(
    room.energyCapacityAvailable,
    state.readySources,
    requiredHaulers,
    backlogBonus
  );

  // Early RCL2 buildout: cap hauler count while extensions/controller-container
  // are still being built.  Don't spawn 3-4 haulers when there's nothing to deliver to.
  var rcl2ExtensionLimit =
    typeof CONTROLLER_STRUCTURES !== 'undefined' &&
    CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION]
    ? CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][2] || 0
    : 5;
  var earlyRcl2Buildout = controllerLevel <= 2 && (
    extensions.length < rcl2ExtensionLimit ||
    !controllerContainer
  );
  var haulerTargetCap = earlyRcl2Buildout
    ? Math.max(1, state.readySources.length)
    : HAULER_TARGET_CAP;

  var dynamicHaulerTarget = Math.min(
    haulerTargetCap,
    capacityHaulerPlan.targetCount
  );

  // Room-specific population caps
  if (room.name === 'W47N22') {
    dynamicHaulerTarget = Math.min(dynamicHaulerTarget, 2);
  }
  const haulerPlan = bodyPolicy.getHaulerPlan(
    room.energyCapacityAvailable,
    state.readySources,
    dynamicHaulerTarget
  );
  const haulersHealthy = !needsHaulerReplacement(
    state,
    haulers,
    haulerPlan
  );
  roomMemory.containerEconomy.haulerPlan = {
    bodyCost: haulerPlan.bodyCost,
    bodyCarryParts: haulerPlan.bodyCarryParts,
    requiredCarryParts: haulerPlan.requiredCarryParts,
    targetCarryParts: haulerPlan.targetCarryParts,
    targetCount: dynamicHaulerTarget,
    throughputCount: haulerPlan.throughputCount,
    backlogBonus: backlogBonus,
    targetCap: haulerTargetCap,
    earlyRcl2Buildout: earlyRcl2Buildout
  };
  // 計算全防區（母房 + 可見 remote）的剩餘建築工作量（D014）
  const zoneRemainingBuildWork = (function() {
    var total = constructionSites.reduce(function(sum, site) {
      return sum + Math.max(0, site.progressTotal - site.progress);
    }, 0);
    var remoteRooms = colonies.getRemoteRooms(room.name);
    var remoteRoomNames = Object.keys(remoteRooms);
    for (var rri = 0; rri < remoteRoomNames.length; rri++) {
      var remoteRoom = Game.rooms[remoteRoomNames[rri]];
      if (!remoteRoom) continue;
      var remoteSites = remoteRoom.find(FIND_CONSTRUCTION_SITES);
      for (var rsi = 0; rsi < remoteSites.length; rsi++) {
        total += Math.max(0, remoteSites[rsi].progressTotal - remoteSites[rsi].progress);
      }
    }
    return total;
  })();

  const economyState = economy.update(room, {
    constructionCount: constructionSites.length,
    remainingBuildWork: zoneRemainingBuildWork,
    energyStarved: state.energyStarved,
    haulersHealthy: haulersHealthy,
    hostilesCount: hostiles.length,
    minersHealthy: minersHealthy,
    repairBacklog: emergencyRepair || generalRepair
  });
  var requestedUpgradeWork = economyState.upgraderWorkTarget || 0;
  if (!controllerContainer && !economyState.controllerEmergency) {
    requestedUpgradeWork = controllerLevel <= 2
      ? 1
      : 0;
  }

  // Colony state / expansion mission: limit upgrade to funnel energy elsewhere.
  // ALWAYS keep 1 minimal upgrader to prevent downgrade.
  // Exception: controller emergency (downgrade imminent) → keep normal upgrade.
  if (
    colonyStates.isUpgradeSuspended(room.name) ||
    (Memory.expansionMission &&
     Memory.expansionMission.active &&
     Memory.expansionMission.phase !== 'done' &&
     room.name === Memory.expansionMission.home)
  ) {
    if (!economyState.controllerEmergency) {
      // Floor at 1: at least one minimal upgrader to prevent downgrade
      requestedUpgradeWork = Math.min(requestedUpgradeWork, 1);
      if (requestedUpgradeWork < 1) requestedUpgradeWork = 1;
    }
  }

  const populationPlan = population.getPlan(
    controllerLevel,
    {
      roomName: room.name,
      constructionCount: constructionSites.length,
      remainingBuildWork: zoneRemainingBuildWork,
      controllerEmergency: !!economyState.controllerEmergency,
      emergencyRepair: emergencyRepair,
      energyStarved: state.energyStarved,
      generalRepair: generalRepair,
      haulersHealthy: haulersHealthy,
      haulerTarget: dynamicHaulerTarget,
      hostilesCount: hostiles.length,
      minersHealthy: minersHealthy,
      noCreeps: creeps.length === 0,
      readySourceCount: state.readySources.length,
      remoteRoomCount: remoteRoomCount,
      remoteSourceCount: remoteSourceCount,
      remoteProgramActive: remoteProgramActive,
      selfHarvestMissing:
        haulers.length === 0 && rcl1Harvesters.length === 0,
      sourceCount: sourceCount,
      towersCanMaintain: towersMaintain,
      uncoveredSourceCount: state.uncoveredSources.length,
      upgraderWorkTarget: requestedUpgradeWork,
      storedEnergy: economyState.storedEnergy,
      energyCapacityAvailable: room.energyCapacityAvailable
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
  const requiredHaulerCount = haulerPolicy.target;
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

  if (missingMiner && miners.length < minerLimit) {
    const emergencyMinerBody = buildMinerBody(room.energyAvailable);
    trySpawnMiner(spawn, room, missingMiner, emergencyMinerBody);
    return;
  }

  if (
    haulers.length < requiredHaulerCount &&
    haulers.length < haulerLimit
  ) {
    const emergencyHaulerPlan = bodyPolicy.getHaulerPlan(
      room.energyAvailable,
      state.readySources,
      requiredHaulerCount
    );
    trySpawnHauler(spawn, room, emergencyHaulerPlan.body);
    return;
  }

  if (
    haulers.length < haulerLimit &&
    needsHaulerReplacement(
      state,
      haulers,
      haulerPlan
    )
  ) {
    trySpawnHauler(spawn, room, haulerPlan.body);
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

  // Defense: spawn guard only when towers can't handle the threat.
  // Conditions: hostiles > 3 AND tower energy below 1/3 capacity.
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
  // Spawn guard when: (hostiles > 3 AND towers depleted) OR (any hostiles AND no towers at all)
  var needGuard = (hostiles.length > 3 && towerDepleted) || (hostiles.length > 0 && towers.length === 0);

  if (needGuard && guards.length < guardPolicy.target) {
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

  // Upgrader body budget: scales with stored-energy abundance.
  // More stored energy → more room for big WORK bodies → faster upgrade.
  // energyAvailable still acts as hard ceiling per-spawn so extensions
  // must actually contain the energy.  Remote economy spawning (miners,
  // haulers, guards) runs earlier in the tick → big upgrader only spawns
  // when other needs are met.
  // storedEnergy > 150k → 70% cap  (max ~1610e,  14 WORK at RCL6)
  // storedEnergy >  75k → 60% cap  (max ~1380e,  11 WORK at RCL6)
  // otherwise           → 50% cap  (original safe floor, proven stable)
  // Floor of 300 ensures a minimum [W,C×2,M×2] body is possible.
  const upgraderBodyBuilder = function (energyCap, role, desiredWork) {
    // Match both 'upgrader' and legacy 'rcl1Upgrader' (used by bootstrap at RCL≤2).
    // Without this the body builder falls through to buildWorkerBody → BASIC_BODY.
    if (role === 'upgrader' || role === 'rcl1Upgrader') {
      var capRatio = 0.50; // safe default (original behaviour)
      var stored = economyState.storedEnergy;
      if (typeof stored === 'number') {
        if (stored > 150000) capRatio = 0.70;
        else if (stored > 75000) capRatio = 0.60;
      }
      var cappedEnergy = Math.floor(room.energyCapacityAvailable * capRatio);
      if (cappedEnergy < 300) cappedEnergy = 300;
      if (room.energyAvailable < cappedEnergy) cappedEnergy = room.energyAvailable;
      return bodyPolicy.buildStaticUpgraderBody(
        cappedEnergy,
        desiredWork
      );
    }
    return buildWorkerBody(energyCap, role, desiredWork);
  };

  // When no controller container exists (e.g. front-base W47N22), fall back
  // to RCL1-style harvesters that also upgrade.  This gives upgrade progress
  // without needing a dedicated upgrader role or controller container.
  var effectiveHarvesterTarget = fallbackTarget;
  if (!controllerContainer && effectiveHarvesterTarget < 1) {
    effectiveHarvesterTarget = 1;
  }

  // zoneBuilder spawn（D014）：取代 rcl1Builder + remoteBuilder
  // 永遠至少 1 隻（負責巡邏修路），有大量工地時按 builderPolicy.target 數量
  if (!spawn.spawning) {
    var zoneBuilders = creeps.filter(function(c) {
      return c.memory.role === 'zoneBuilder' || c.memory.role === 'rcl1Builder';
    });
    var zoneBuilderTarget = Math.max(1, builderPolicy.target);
    if (zoneBuilders.length < zoneBuilderTarget) {
      var zbBody = buildWorkerBody(room.energyAvailable, 'rcl1Builder', 1);
      var zbName = 'zoneBuilder-' + room.name + '-' + Game.time;
      var zbResult = spawn.spawnCreep(zbBody, zbName, {
        memory: {
          role: 'zoneBuilder',
          homeRoom: room.name,
          home: room.name,
          working: false
        }
      });
      if (zbResult === OK) {
        console.log('[spawn] ' + spawn.name + ' spawning ' + zbName);
        return;
      }
    }
  }

  bootstrap.run(room, {
    harvesterTarget: effectiveHarvesterTarget,
    sourceIds: fallbackSourceIds,
    maintainSupport: true,
    builderTarget: 0,
    upgraderWorkTarget: upgraderWorkTarget,
    bodyBuilder: upgraderBodyBuilder,
    populationPlan: populationPlan
  });
}

module.exports = {
  collect: collect,
  run: run,
  updateSourceEnergyPressure: updateSourceEnergyPressure
};
