const HOME_ROOM = 'W49N25';
const REMOTE_ROOM = 'W49N26';
const DANGER_PAUSE_TICKS = 1500;
const REMOTE_STABLE_TICKS = 100;
const TOWER_LOW_ENERGY = 400;

const DEFAULT_SOURCES = [
  {
    id: null,
    x: 16,
    y: 26,
    roomName: REMOTE_ROOM,
    containerX: 16,
    containerY: 25,
    enabled: true
  },
  {
    id: null,
    x: 23,
    y: 25,
    roomName: REMOTE_ROOM,
    containerX: 23,
    containerY: 24,
    enabled: true
  }
];

function fillMissing(target, key, value) {
  if (target[key] !== undefined) return false;
  target[key] = value;
  return true;
}

function fillSourceMissing(source, defaults) {
  let changed = false;

  changed = fillMissing(source, 'id', defaults.id) || changed;
  changed = fillMissing(source, 'x', defaults.x) || changed;
  changed = fillMissing(source, 'y', defaults.y) || changed;
  changed = fillMissing(source, 'roomName', defaults.roomName) || changed;
  changed = fillMissing(source, 'containerX', defaults.containerX) || changed;
  changed = fillMissing(source, 'containerY', defaults.containerY) || changed;
  changed = fillMissing(source, 'enabled', defaults.enabled) || changed;

  return changed;
}

function initMemory() {
  let changed = false;

  if (!Memory.remote || typeof Memory.remote !== 'object') {
    Memory.remote = {};
    changed = true;
  }
  if (
    !Memory.remote[HOME_ROOM] ||
    typeof Memory.remote[HOME_ROOM] !== 'object'
  ) {
    Memory.remote[HOME_ROOM] = {};
    changed = true;
  }

  const homeConfig = Memory.remote[HOME_ROOM];
  changed = fillMissing(homeConfig, 'enabled', true) || changed;
  if (!homeConfig.rooms || typeof homeConfig.rooms !== 'object') {
    homeConfig.rooms = {};
    changed = true;
  }
  if (
    !homeConfig.rooms[REMOTE_ROOM] ||
    typeof homeConfig.rooms[REMOTE_ROOM] !== 'object'
  ) {
    homeConfig.rooms[REMOTE_ROOM] = {};
    changed = true;
  }

  const remoteConfig = homeConfig.rooms[REMOTE_ROOM];
  changed = fillMissing(remoteConfig, 'enabled', true) || changed;
  changed = fillMissing(remoteConfig, 'status', 'active') || changed;
  changed = fillMissing(remoteConfig, 'pauseUntil', 0) || changed;
  changed = fillMissing(remoteConfig, 'controllerId', null) || changed;

  if (!Array.isArray(remoteConfig.sources)) {
    remoteConfig.sources = [];
    changed = true;
  }

  for (let index = 0; index < DEFAULT_SOURCES.length; index++) {
    if (
      !remoteConfig.sources[index] ||
      typeof remoteConfig.sources[index] !== 'object'
    ) {
      remoteConfig.sources[index] = {};
      changed = true;
    }
    changed = fillSourceMissing(
      remoteConfig.sources[index],
      DEFAULT_SOURCES[index]
    ) || changed;
  }

  if (changed) {
    console.log('[remote] memory initialized');
  }

  return homeConfig;
}

function getHomeConfig(homeRoomName) {
  if (!Memory.remote || !Memory.remote[homeRoomName]) return null;
  return Memory.remote[homeRoomName];
}

function getRemoteConfig(homeRoomName, remoteRoomName) {
  const homeConfig = getHomeConfig(homeRoomName);
  if (!homeConfig || !homeConfig.rooms) return null;
  return homeConfig.rooms[remoteRoomName] || null;
}

function getSourceConfig(homeRoomName, remoteRoomName, sourceIndex) {
  const remoteConfig = getRemoteConfig(homeRoomName, remoteRoomName);
  if (!remoteConfig || !Array.isArray(remoteConfig.sources)) return null;
  return remoteConfig.sources[sourceIndex] || null;
}

function isRemotePaused(homeRoomName, remoteRoomName) {
  const homeConfig = getHomeConfig(homeRoomName);
  const remoteConfig = getRemoteConfig(homeRoomName, remoteRoomName);

  if (!homeConfig || homeConfig.enabled !== true) return true;
  if (!remoteConfig || remoteConfig.enabled !== true) return true;
  if (remoteConfig.status === 'danger') return true;
  return (remoteConfig.pauseUntil || 0) > Game.time;
}

function getPositionLook(roomName, x, y, lookType) {
  if (!Game.rooms[roomName]) return [];
  const position = new RoomPosition(x, y, roomName);
  return position.lookFor(lookType);
}

function findContainerAt(roomName, x, y) {
  const structures = getPositionLook(
    roomName,
    x,
    y,
    LOOK_STRUCTURES
  );

  for (let index = 0; index < structures.length; index++) {
    if (structures[index].structureType === STRUCTURE_CONTAINER) {
      return structures[index];
    }
  }

  return null;
}

function findContainerSiteAt(roomName, x, y) {
  const sites = getPositionLook(
    roomName,
    x,
    y,
    LOOK_CONSTRUCTION_SITES
  );

  for (let index = 0; index < sites.length; index++) {
    if (sites[index].structureType === STRUCTURE_CONTAINER) {
      return sites[index];
    }
  }

  return null;
}

function ensureContainerSite(sourceConfig) {
  const room = Game.rooms[sourceConfig.roomName];
  if (!room) return false;
  if (
    findContainerAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    )
  ) {
    return false;
  }

  const sites = getPositionLook(
    sourceConfig.roomName,
    sourceConfig.containerX,
    sourceConfig.containerY,
    LOOK_CONSTRUCTION_SITES
  );
  if (sites.length > 0) return false;

  const result = room.createConstructionSite(
    sourceConfig.containerX,
    sourceConfig.containerY,
    STRUCTURE_CONTAINER
  );
  if (result === OK) {
    console.log(
      `[remote] container site created ${sourceConfig.roomName} ` +
      `${sourceConfig.containerX},${sourceConfig.containerY}`
    );
    return true;
  }

  return false;
}

function resolveSourceId(sourceConfig) {
  if (sourceConfig.id) return sourceConfig.id;
  if (!Game.rooms[sourceConfig.roomName]) return null;

  const sources = getPositionLook(
    sourceConfig.roomName,
    sourceConfig.x,
    sourceConfig.y,
    LOOK_SOURCES
  );
  if (sources.length === 0) return null;

  sourceConfig.id = sources[0].id;
  console.log(
    `[remote] source id resolved ${sourceConfig.roomName} ` +
    `${sourceConfig.x},${sourceConfig.y} ${sourceConfig.id}`
  );
  return sourceConfig.id;
}

function updateRemoteRoom(homeRoomName, remoteRoomName, remoteConfig) {
  const room = Game.rooms[remoteRoomName];
  if (!remoteConfig) return;
  if (!room) {
    if (
      remoteConfig.status === 'danger' &&
      (remoteConfig.pauseUntil || 0) <= Game.time
    ) {
      remoteConfig.status = 'active';
      console.log(`[remote] pause expired ${remoteRoomName}; retrying`);
    }
    return;
  }

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0) {
    const stateChanged = remoteConfig.status !== 'danger';
    remoteConfig.status = 'danger';
    remoteConfig.pauseUntil = Game.time + DANGER_PAUSE_TICKS;
    remoteConfig.stableSince = 0;
    if (stateChanged) {
      console.log(
        `[remote] danger detected ${remoteRoomName}; paused until ` +
        remoteConfig.pauseUntil
      );
    }
  } else if ((remoteConfig.pauseUntil || 0) <= Game.time) {
    const stateChanged = remoteConfig.status !== 'active';
    remoteConfig.status = 'active';
    if (stateChanged) {
      console.log(`[remote] resumed ${remoteRoomName}`);
    }
  }

  remoteConfig.lastVisible = Game.time;
  if (room.controller && !remoteConfig.controllerId) {
    remoteConfig.controllerId = room.controller.id;
  }

  if (!Array.isArray(remoteConfig.sources)) return;
  for (let index = 0; index < remoteConfig.sources.length; index++) {
    const sourceConfig = remoteConfig.sources[index];
    if (!sourceConfig) continue;

    resolveSourceId(sourceConfig);
    if (
      remoteConfig.enabled === true &&
      sourceConfig.enabled === true
    ) {
      ensureContainerSite(sourceConfig);
    }
  }
}

function countRole(creeps, role) {
  let count = 0;

  for (let index = 0; index < creeps.length; index++) {
    if (creeps[index].memory.role === role) count++;
  }

  return count;
}

function countReadyHomeSources(roomMemory) {
  let count = 0;
  const sources = roomMemory.sources || {};

  for (const sourceId in sources) {
    if (sources[sourceId].containerReady) count++;
  }

  return count;
}

function getPopulationTarget(roomMemory, role, fallback) {
  const policy = roomMemory.populationPolicy;
  if (
    policy &&
    policy.targets &&
    typeof policy.targets[role] === 'number'
  ) {
    return policy.targets[role];
  }

  return fallback;
}

function getHomeSpawn(homeRoom) {
  if (!homeRoom) return null;
  const spawns = homeRoom.find(FIND_MY_SPAWNS);
  return spawns.length > 0 ? spawns[0] : null;
}

function isHomeEconomyStable(homeRoomName) {
  const room = Game.rooms[homeRoomName];
  if (!room || !room.controller || !room.controller.my) return false;
  if (room.controller.level < 4) return false;
  if (
    typeof room.controller.ticksToDowngrade === 'number' &&
    room.controller.ticksToDowngrade < 4000
  ) {
    return false;
  }

  const spawn = getHomeSpawn(room);
  if (!spawn || spawn.spawning) return false;
  if (room.energyAvailable < room.energyCapacityAvailable) return false;

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0) return false;

  const roomMemory = Memory.rooms && Memory.rooms[homeRoomName]
    ? Memory.rooms[homeRoomName]
    : {};
  const containerEconomy = roomMemory.containerEconomy || {};
  const economy = roomMemory.economyAccounting || {};
  const populationPolicy = roomMemory.populationPolicy || {};

  if (!containerEconomy.ready || containerEconomy.energyStarved) {
    return false;
  }
  if (economy.recovery || populationPolicy.fallbackActive) return false;

  const creeps = room.find(FIND_MY_CREEPS);
  const readySourceCount = countReadyHomeSources(roomMemory);
  const harvesterTarget = getPopulationTarget(
    roomMemory,
    'rcl1Harvester',
    readySourceCount > 0 ? 0 : 2
  );
  const minerTarget = getPopulationTarget(
    roomMemory,
    'rcl2Miner',
    readySourceCount
  );
  const haulerTarget = getPopulationTarget(
    roomMemory,
    'rcl2Hauler',
    Math.max(1, readySourceCount)
  );

  if (countRole(creeps, 'rcl1Harvester') < harvesterTarget) return false;
  if (countRole(creeps, 'rcl2Miner') < minerTarget) return false;
  if (countRole(creeps, 'rcl2Hauler') < haulerTarget) return false;

  return true;
}

function getBodyCost(body) {
  let total = 0;

  for (let index = 0; index < body.length; index++) {
    total += BODYPART_COST[body[index]] || 0;
  }

  return total;
}

// Remote miner stands on container and harvests. Without CARRY, harvest()
// drops energy directly onto the container tile, which auto-collects it.
// CARRY is wasted (same principle as D003 for local miners).
function buildRemoteMinerBody(energyCapacity) {
  if (energyCapacity >= 550) {
    return [WORK, WORK, WORK, WORK, WORK, MOVE];
  }
  if (energyCapacity >= 350) {
    return [WORK, WORK, WORK, MOVE];
  }
  return null;
}

function buildRemoteHaulerBody(energyCapacity) {
  if (energyCapacity >= 1300) {
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 800) {
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 600) {
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 400) {
    return [
      CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE
    ];
  }
  return null;
}

function buildRemoteBuilderBody(energyCapacity) {
  if (energyCapacity >= 400) {
    return [WORK, WORK, CARRY, CARRY, MOVE, MOVE];
  }
  if (energyCapacity >= 200) {
    return [WORK, CARRY, MOVE];
  }
  return null;
}

function buildReserverBody(energyCapacity) {
  if (energyCapacity < 650) return null;
  return [CLAIM, MOVE];
}

function getAssignedCreeps(
  role,
  homeRoomName,
  remoteRoomName,
  sourceIndex
) {
  const assigned = [];

  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (creep.memory.role !== role) continue;
    if (creep.memory.homeRoom !== homeRoomName) continue;
    if (creep.memory.remoteRoom !== remoteRoomName) continue;
    if (
      sourceIndex !== undefined &&
      creep.memory.sourceIndex !== sourceIndex
    ) {
      continue;
    }
    assigned.push(creep);
  }

  return assigned;
}

function hasHealthyAssignedCreep(creeps, replacementLead) {
  for (let index = 0; index < creeps.length; index++) {
    if (
      creeps[index].ticksToLive === undefined ||
      creeps[index].ticksToLive > replacementLead
    ) {
      return true;
    }
  }

  return false;
}

function createSourceRequest(
  role,
  homeRoomName,
  remoteRoomName,
  sourceIndex,
  sourceConfig,
  body
) {
  return {
    role: role,
    name: `${role}_${remoteRoomName}_${sourceIndex}_${Game.time}`,
    body: body,
    memory: {
      role: role,
      home: homeRoomName,
      homeRoom: homeRoomName,
      remoteRoom: remoteRoomName,
      sourceIndex: sourceIndex,
      sourceId: sourceConfig.id || null
    }
  };
}

function remoteNeedsBuilder(remoteRoomName, remoteConfig) {
  if (!Game.rooms[remoteRoomName]) return false;

  for (let index = 0; index < remoteConfig.sources.length; index++) {
    const sourceConfig = remoteConfig.sources[index];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;

    const site = findContainerSiteAt(
      remoteRoomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    if (site) return true;

    const container = findContainerAt(
      remoteRoomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    if (container && container.hits < container.hitsMax * 0.8) {
      return true;
    }
  }

  return false;
}

function remoteInfrastructureStable(
  homeRoomName,
  remoteRoomName,
  remoteConfig
) {
  if (!Game.rooms[remoteRoomName]) return false;

  const miners = getAssignedCreeps(
    'remoteMiner',
    homeRoomName,
    remoteRoomName
  );
  const haulers = getAssignedCreeps(
    'remoteHauler',
    homeRoomName,
    remoteRoomName
  );
  if (miners.length === 0 || haulers.length === 0) return false;

  for (let index = 0; index < remoteConfig.sources.length; index++) {
    const sourceConfig = remoteConfig.sources[index];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;
    if (
      findContainerAt(
        remoteRoomName,
        sourceConfig.containerX,
        sourceConfig.containerY
      )
    ) {
      return true;
    }
  }

  return false;
}

function remoteHasContainer(remoteRoomName, remoteConfig) {
  if (!remoteConfig || !Array.isArray(remoteConfig.sources)) return false;

  for (let index = 0; index < remoteConfig.sources.length; index++) {
    const sourceConfig = remoteConfig.sources[index];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;
    if (
      findContainerAt(
        remoteRoomName,
        sourceConfig.containerX,
        sourceConfig.containerY
      )
    ) {
      return true;
    }
  }

  return false;
}

function getSpawnRequests(homeRoomName) {
  const requests = [];
  const homeConfig = getHomeConfig(homeRoomName);
  const homeRoom = Game.rooms[homeRoomName];

  if (!homeConfig || homeConfig.enabled !== true) return requests;
  if (!isHomeEconomyStable(homeRoomName)) return requests;

  const energyCapacity = homeRoom.energyCapacityAvailable;
  const minerBody = buildRemoteMinerBody(energyCapacity);
  const haulerBody = buildRemoteHaulerBody(energyCapacity);
  const builderBody = buildRemoteBuilderBody(energyCapacity);
  const reserverBody = buildReserverBody(energyCapacity);

  for (const remoteRoomName in homeConfig.rooms) {
    const remoteConfig = homeConfig.rooms[remoteRoomName];
    if (!remoteConfig || remoteConfig.enabled !== true) continue;
    if (isRemotePaused(homeRoomName, remoteRoomName)) {
      remoteConfig.stableSince = 0;
      continue;
    }

    for (let index = 0; index < remoteConfig.sources.length; index++) {
      const sourceConfig = remoteConfig.sources[index];
      if (!sourceConfig || sourceConfig.enabled !== true || !minerBody) {
        continue;
      }

      const assigned = getAssignedCreeps(
        'remoteMiner',
        homeRoomName,
        remoteRoomName,
        index
      );
      const replacementLead = minerBody.length * CREEP_SPAWN_TIME + 100;
      if (!hasHealthyAssignedCreep(assigned, replacementLead)) {
        requests.push(createSourceRequest(
          'remoteMiner',
          homeRoomName,
          remoteRoomName,
          index,
          sourceConfig,
          minerBody
        ));
      }
    }

    for (let index = 0; index < remoteConfig.sources.length; index++) {
      const sourceConfig = remoteConfig.sources[index];
      if (!sourceConfig || sourceConfig.enabled !== true || !haulerBody) {
        continue;
      }
      if (!findContainerAt(
        remoteRoomName,
        sourceConfig.containerX,
        sourceConfig.containerY
      )) {
        continue;
      }

      const assigned = getAssignedCreeps(
        'remoteHauler',
        homeRoomName,
        remoteRoomName,
        index
      );
      const replacementLead = haulerBody.length * CREEP_SPAWN_TIME + 150;
      const healthyCount = assigned.filter(
        c => c.ticksToLive === undefined || c.ticksToLive > replacementLead
      ).length;
      if (healthyCount < 2) {
        requests.push(createSourceRequest(
          'remoteHauler',
          homeRoomName,
          remoteRoomName,
          index,
          sourceConfig,
          haulerBody
        ));
      }
    }

    const miners = getAssignedCreeps(
      'remoteMiner',
      homeRoomName,
      remoteRoomName
    );
    const haulers = getAssignedCreeps(
      'remoteHauler',
      homeRoomName,
      remoteRoomName
    );
    const builders = getAssignedCreeps(
      'remoteBuilder',
      homeRoomName,
      remoteRoomName
    );

    if (
      builderBody &&
      miners.length > 0 &&
      haulers.length > 0 &&
      builders.length === 0 &&
      remoteNeedsBuilder(remoteRoomName, remoteConfig)
    ) {
      requests.push({
        role: 'remoteBuilder',
        name: `remoteBuilder_${remoteRoomName}_${Game.time}`,
        body: builderBody,
        memory: {
          role: 'remoteBuilder',
          home: homeRoomName,
          homeRoom: homeRoomName,
          remoteRoom: remoteRoomName
        }
      });
    }

    const stable = remoteInfrastructureStable(
      homeRoomName,
      remoteRoomName,
      remoteConfig
    );
    if (stable) {
      if (!remoteConfig.stableSince) {
        remoteConfig.stableSince = Game.time;
      }
    } else {
      remoteConfig.stableSince = 0;
    }

    const remoteRoom = Game.rooms[remoteRoomName];
    const controller = remoteRoom ? remoteRoom.controller : null;
    const reservationLow = !!(
      controller &&
      (
        !controller.reservation ||
        controller.reservation.ticksToEnd < 2000
      )
    );
    const reservers = getAssignedCreeps(
      'reserver',
      homeRoomName,
      remoteRoomName
    );
    const reserverReplacementLead = reserverBody
      ? reserverBody.length * CREEP_SPAWN_TIME + 150
      : 0;
    // Spawn a new reserver when there's no healthy one.
    // reservationLow gates the INITIAL spawn only; once a reserver
    // exists we replace by TTL to avoid reservation gaps.
    if (
      reserverBody &&
      stable &&
      controller &&
      !hasHealthyAssignedCreep(reservers, reserverReplacementLead) &&
      (reservationLow || reservers.length > 0)
    ) {
      requests.push({
        role: 'reserver',
        name: `reserver_${remoteRoomName}_${Game.time}`,
        body: reserverBody,
        memory: {
          role: 'reserver',
          home: homeRoomName,
          homeRoom: homeRoomName,
          remoteRoom: remoteRoomName
        }
      });
    }
  }

  return requests;
}

function getWaitPosition(sourceConfig) {
  const candidates = [
    [1, 0],
    [-1, 0],
    [0, -1],
    [0, 1]
  ];
  const terrain = Game.map.getRoomTerrain(sourceConfig.roomName);

  for (let index = 0; index < candidates.length; index++) {
    const x = sourceConfig.containerX + candidates[index][0];
    const y = sourceConfig.containerY + candidates[index][1];
    if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;
    if (x === sourceConfig.x && y === sourceConfig.y) continue;
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;
    return new RoomPosition(x, y, sourceConfig.roomName);
  }

  return new RoomPosition(
    sourceConfig.containerX,
    sourceConfig.containerY,
    sourceConfig.roomName
  );
}

function retreat(creep, homeRoomName) {
  const target = new RoomPosition(25, 25, homeRoomName);
  if (
    creep.pos.roomName !== homeRoomName ||
    creep.pos.getRangeTo(target) > 5
  ) {
    creep.moveTo(target, {
      reusePath: 20,
      visualizePathStyle: { stroke: '#ff5555' }
    });
  }
}

function run() {
  const homeConfig = initMemory();

  for (const remoteRoomName in homeConfig.rooms) {
    updateRemoteRoom(
      HOME_ROOM,
      remoteRoomName,
      homeConfig.rooms[remoteRoomName]
    );
  }

  const requests = getSpawnRequests(HOME_ROOM);
  if (requests.length === 0) return;

  const homeRoom = Game.rooms[HOME_ROOM];
  const spawn = getHomeSpawn(homeRoom);
  if (!spawn || spawn.spawning) return;

  const request = requests[0];
  const bodyCost = getBodyCost(request.body);
  if (homeRoom.energyAvailable < bodyCost) return;

  const result = spawn.spawnCreep(request.body, request.name, {
    memory: request.memory
  });
  if (result === OK) {
    console.log(`[remote] spawned ${request.name}`);
  } else if (result !== ERR_BUSY && result !== ERR_NOT_ENOUGH_ENERGY) {
    console.log(
      `[remote:error] spawn ${request.role} result=${result}`
    );
  }
}

module.exports = {
  HOME_ROOM: HOME_ROOM,
  REMOTE_ROOM: REMOTE_ROOM,
  TOWER_LOW_ENERGY: TOWER_LOW_ENERGY,
  ensureContainerSite: ensureContainerSite,
  findContainerAt: findContainerAt,
  findContainerSiteAt: findContainerSiteAt,
  getRemoteConfig: getRemoteConfig,
  getSourceConfig: getSourceConfig,
  getSpawnRequests: getSpawnRequests,
  getWaitPosition: getWaitPosition,
  initMemory: initMemory,
  isHomeEconomyStable: isHomeEconomyStable,
  isRemotePaused: isRemotePaused,
  resolveSourceId: resolveSourceId,
  retreat: retreat,
  run: run,
  updateRemoteRoom: updateRemoteRoom,
  remoteHasContainer: remoteHasContainer
};
