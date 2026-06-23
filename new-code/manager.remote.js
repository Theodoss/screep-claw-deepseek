const HOME_ROOM = 'W49N25';
const REMOTE_ROOM = 'W49N26';
const DANGER_PAUSE_TICKS = 400;   // BLIND fallback only: if we have no vision
                                  // of a paused remote, resume after this long.
                                  // When we DO have vision (a guard holding the
                                  // room), we resume immediately on confirmed
                                  // clear instead — see RESUME_CLEAR_TICKS.
const RESUME_CLEAR_TICKS = 10;    // vision-confirmed clear ticks before resuming
                                  // a danger-paused remote. Now that an active
                                  // guard clears + holds the room, there's no
                                  // need to wait out a fixed timer (DECISIONS D012).
const REMOTE_STABLE_TICKS = 100;
const TOWER_LOW_ENERGY = 400;
const REMOTE_ROAD_SITE_INTERVAL = 25;
const REMOTE_ROAD_MAX_ACTIVE_SITES = 3;

// Each remote room has its own source list.  x/y = source position,
// containerX/Y = where the container should go (adjacent non-wall tile).
// Sources and containers are discovered on first creep entry.
const REMOTE_ROOMS = {
  W49N26: [
    { id: null, x: 16, y: 26, roomName: 'W49N26', containerX: 16, containerY: 25, enabled: true },
    { id: null, x: 23, y: 25, roomName: 'W49N26', containerX: 23, containerY: 24, enabled: true }
  ],
  W48N25: [
    { id: null, x: 29, y: 23, roomName: 'W48N25', containerX: 28, containerY: 22, enabled: true },
    { id: null, x: 41, y: 3, roomName: 'W48N25', containerX: 42, containerY: 3, enabled: true }
  ],
  W48N26: [
    { id: null, x: 12, y: 38, roomName: 'W48N26', containerX: 11, containerY: 38, enabled: true },
    { id: null, x: 41, y: 39, roomName: 'W48N26', containerX: 40, containerY: 38, enabled: true }
  ]
};

function getDefaultSources(roomName) {
  return REMOTE_ROOMS[roomName] || [];
}

function fillMissing(target, key, value) {
  if (target[key] != null) return false;
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

  // Initialize every configured remote room
  for (const roomName in REMOTE_ROOMS) {
    if (
      !homeConfig.rooms[roomName] ||
      typeof homeConfig.rooms[roomName] !== 'object'
    ) {
      homeConfig.rooms[roomName] = {};
      changed = true;
    }

    const remoteConfig = homeConfig.rooms[roomName];
    changed = fillMissing(remoteConfig, 'enabled', true) || changed;
    changed = fillMissing(remoteConfig, 'status', 'active') || changed;
    changed = fillMissing(remoteConfig, 'pauseUntil', 0) || changed;
    changed = fillMissing(remoteConfig, 'controllerId', null) || changed;

    if (!Array.isArray(remoteConfig.sources)) {
      remoteConfig.sources = [];
      changed = true;
    }

    const defaults = getDefaultSources(roomName);
    for (let index = 0; index < defaults.length; index++) {
      if (
        !remoteConfig.sources[index] ||
        typeof remoteConfig.sources[index] !== 'object'
      ) {
        remoteConfig.sources[index] = {};
        changed = true;
      }
      changed = fillSourceMissing(
        remoteConfig.sources[index],
        defaults[index]
      ) || changed;

      // Migration: if config default switched from false→true, force-enable
      // in runtime memory.  fillSourceMissing won't overwrite an existing
      // false value (fillMissing checks != null).
      if (
        defaults[index] &&
        defaults[index].enabled === true &&
        remoteConfig.sources[index].enabled !== true
      ) {
        remoteConfig.sources[index].enabled = true;
        changed = true;
      }
    }
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
  // Threat detected by defense system — pause remote operations
  if (remoteConfig.threat) return true;
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

function findRoadAt(roomName, x, y) {
  const structures = getPositionLook(roomName, x, y, LOOK_STRUCTURES);

  for (let index = 0; index < structures.length; index++) {
    if (structures[index].structureType === STRUCTURE_ROAD) {
      return structures[index];
    }
  }

  return null;
}

function findRoadSiteAt(roomName, x, y) {
  const sites = getPositionLook(roomName, x, y, LOOK_CONSTRUCTION_SITES);

  for (let index = 0; index < sites.length; index++) {
    if (sites[index].structureType === STRUCTURE_ROAD) {
      return sites[index];
    }
  }

  return null;
}

function buildRemoteRoadMatrix(roomName) {
  const room = Game.rooms[roomName];
  if (!room) return false;

  const terrain = Game.map.getRoomTerrain(roomName);
  const matrix = new PathFinder.CostMatrix();

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
        matrix.set(x, y, 255);
      } else {
        matrix.set(x, y, 2);
      }
    }
  }

  const structures = room.find(FIND_STRUCTURES);
  for (let index = 0; index < structures.length; index++) {
    const structure = structures[index];
    if (structure.structureType === STRUCTURE_ROAD) {
      matrix.set(structure.pos.x, structure.pos.y, 1);
      continue;
    }
    if (
      structure.structureType === STRUCTURE_CONTAINER ||
      structure.structureType === STRUCTURE_RAMPART
    ) {
      continue;
    }
    matrix.set(structure.pos.x, structure.pos.y, 255);
  }

  const sites = room.find(FIND_CONSTRUCTION_SITES);
  for (let index = 0; index < sites.length; index++) {
    const site = sites[index];
    if (
      site.structureType === STRUCTURE_ROAD ||
      site.structureType === STRUCTURE_CONTAINER
    ) {
      continue;
    }
    matrix.set(site.pos.x, site.pos.y, 255);
  }

  return matrix;
}

function countActiveConstructionSites(roomNames) {
  let count = 0;

  for (let index = 0; index < roomNames.length; index++) {
    const room = Game.rooms[roomNames[index]];
    if (!room) continue;
    count += room.find(FIND_CONSTRUCTION_SITES).length;
  }

  return count;
}

function getRemoteRoadOrigin(homeRoomName) {
  const room = Game.rooms[homeRoomName];
  if (!room) return null;

  if (room.storage) return room.storage.pos;

  const spawn = getHomeSpawn(room);
  return spawn ? spawn.pos : null;
}

function ensureRemoteRoad(sourceConfig, homeRoomName) {
  const origin = getRemoteRoadOrigin(homeRoomName);
  const targetRoom = Game.rooms[sourceConfig.roomName];
  const homeRoom = Game.rooms[homeRoomName];

  if (!origin || !homeRoom || !targetRoom) return false;
  if (
    countActiveConstructionSites([homeRoomName, sourceConfig.roomName]) >=
    REMOTE_ROAD_MAX_ACTIVE_SITES
  ) {
    return false;
  }

  const target = new RoomPosition(
    sourceConfig.containerX,
    sourceConfig.containerY,
    sourceConfig.roomName
  );
  const result = PathFinder.search(
    origin,
    { pos: target, range: 1 },
    {
      maxRooms: 2,
      maxOps: 4000,
      plainCost: 2,
      swampCost: 10,
      roomCallback: function (roomName) {
        if (!Game.rooms[roomName]) return false;
        return buildRemoteRoadMatrix(roomName);
      }
    }
  );
  if (result.incomplete || result.path.length === 0) return false;

  for (let index = 0; index < result.path.length; index++) {
    const step = result.path[index];
    if (
      step.x === origin.x &&
      step.y === origin.y &&
      step.roomName === origin.roomName
    ) {
      continue;
    }
    if (
      step.x === sourceConfig.containerX &&
      step.y === sourceConfig.containerY &&
      step.roomName === sourceConfig.roomName
    ) {
      continue;
    }
    if (findRoadAt(step.roomName, step.x, step.y)) continue;
    if (findRoadSiteAt(step.roomName, step.x, step.y)) continue;
    if (findContainerAt(step.roomName, step.x, step.y)) continue;
    if (findContainerSiteAt(step.roomName, step.x, step.y)) continue;

    const room = Game.rooms[step.roomName];
    if (!room) continue;

    const createResult = room.createConstructionSite(
      step.x,
      step.y,
      STRUCTURE_ROAD
    );
    if (createResult === OK) {
      console.log(
        '[remote] road site created ' + step.roomName + ' ' + step.x + ',' + step.y
      );
      return true;
    }
    if (createResult !== ERR_FULL) {
      return false;
    }
  }

  return false;
}

function planRemoteRoads(homeRoomName, remoteRoomName, remoteConfig) {
  if (Game.time % REMOTE_ROAD_SITE_INTERVAL !== 0) return false;
  if (isRemotePaused(homeRoomName, remoteRoomName)) return false;
  if (!remoteConfig || !Array.isArray(remoteConfig.sources)) return false;
  if (!Game.rooms[remoteRoomName] || !Game.rooms[homeRoomName]) return false;

  for (let index = 0; index < remoteConfig.sources.length; index++) {
    const sourceConfig = remoteConfig.sources[index];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;
    if (!findContainerAt(
      remoteRoomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    )) {
      continue;
    }

    const haulers = getAssignedCreeps(
      'remoteHauler',
      homeRoomName,
      remoteRoomName,
      index
    );
    if (haulers.length === 0) continue;

    if (ensureRemoteRoad(sourceConfig, homeRoomName)) {
      return true;
    }
  }

  return false;
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

  let sources = getPositionLook(
    sourceConfig.roomName,
    sourceConfig.x,
    sourceConfig.y,
    LOOK_SOURCES
  );

  // If source not found at exact coords, scan around the container position.
  // Sources are always within range 1 of their container.
  if (sources.length === 0) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const searchX = sourceConfig.containerX + dx;
        const searchY = sourceConfig.containerY + dy;
        if (searchX <= 0 || searchX >= 49 || searchY <= 0 || searchY >= 49) continue;
        sources = getPositionLook(
          sourceConfig.roomName,
          searchX,
          searchY,
          LOOK_SOURCES
        );
        if (sources.length > 0) {
          // Found the real source — fix the coordinates
          sourceConfig.x = searchX;
          sourceConfig.y = searchY;
          console.log(
            `[remote] source coords corrected ${sourceConfig.roomName} ` +
            `${searchX},${searchY}`
          );
          break;
        }
      }
      if (sources.length > 0) break;
    }
  }

  if (sources.length === 0) return null;

  sourceConfig.id = sources[0].id;
  console.log(
    `[remote] source id resolved ${sourceConfig.roomName} ` +
    `${sourceConfig.x},${sourceConfig.y} ${sourceConfig.id}`
  );
  return sourceConfig.id;
}

// Is there a live remoteGuard belonging to this colony? Only then is it safe
// to skip the danger-pause wait on a confirmed-clear remote — the guard is
// there to protect returning miners/haulers. Per-home so it scales as we add
// colonies (DECISIONS D012 expansion follow-up).
function hasRemoteGuardForHome(homeRoomName) {
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (
      creep.memory.role === 'remoteGuard' &&
      (creep.memory.homeRoom === homeRoomName ||
        creep.memory.home === homeRoomName)
    ) {
      return true;
    }
  }
  return false;
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
    remoteConfig.clearStreak = 0;
    if (stateChanged) {
      console.log(
        `[remote] danger detected ${remoteRoomName}; paused until ` +
        remoteConfig.pauseUntil
      );
    }
  } else if (remoteConfig.status === 'danger') {
    // Room is IN VIEW and clear. Fast-resume ONLY if a guard exists for this
    // colony — the guard clears + holds the room and protects returning
    // miners/haulers, so there's no need to wait out the fixed blackout. With
    // NO guard, fall back to the fixed pauseUntil timer (don't optimistically
    // resume into a room nothing is protecting).
    remoteConfig.clearStreak = (remoteConfig.clearStreak || 0) + 1;
    const guardAvailable = hasRemoteGuardForHome(homeRoomName);
    const fastResume =
      guardAvailable && remoteConfig.clearStreak >= RESUME_CLEAR_TICKS;
    const timerResume = (remoteConfig.pauseUntil || 0) <= Game.time;
    if (fastResume || timerResume) {
      remoteConfig.status = 'active';
      remoteConfig.clearStreak = 0;
      console.log(
        `[remote] resumed ${remoteRoomName}` +
        (fastResume ? ' (guard-confirmed clear)' : ' (pause expired)')
      );
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

  // When stored energy is abundant (>50k), transient extension dips
  // should not pause remote spawning. A 150-energy gap on a 376k
  // reserve is noise, not a stability concern.
  const remoteRoomMemory = Memory.rooms && Memory.rooms[homeRoomName]
    ? Memory.rooms[homeRoomName]
    : {};
  const remoteEconMemory = remoteRoomMemory.economyAccounting || {};
  const storedEnergy = remoteEconMemory.storedEnergy || 0;
  // Allow remote spawning when storedEnergy >= 20k so the colony
  // can recover from dips without deadlocking.  Previously 50k blocked
  // remote hauler replacement when reserves were only ~23k, causing
  // energy to pile up in remote containers with no way home.
  if (storedEnergy < 20000 && room.energyAvailable < room.energyCapacityAvailable) {
    return false;
  }

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length > 0) return false;

  const roomMemory = remoteRoomMemory;
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

function getReserverLeadTicks(homeRoomName, remoteRoomName, body) {
  var roomDistance = Game.map.getRoomLinearDistance(
    homeRoomName,
    remoteRoomName
  );
  // Approximate tiles: cross each room (~50 tiles) + intra-room travel
  var tileDistance = (roomDistance + 1) * 50;
  // Travel speed: ~0.75 tiles/tick (roads + plains, some swamp)
  var travelTicks = Math.ceil(tileDistance / 0.75);
  var spawnTicks = body.length * CREEP_SPAWN_TIME;
  return spawnTicks + travelTicks;
}

// Remote miner stands on container and harvests. Without CARRY, harvest()
// drops energy directly onto the container tile, which auto-collects it.
// CARRY is wasted (same principle as D003 for local miners).
function buildRemoteMinerBody(energyCapacity) {
  // Must include CARRY for container repair.  WORK cap = 5 (full harvest).
  if (energyCapacity >= 700) {
    return [WORK, WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE, MOVE];
  }
  if (energyCapacity >= 550) {
    return [WORK, WORK, WORK, WORK, CARRY, MOVE, MOVE];
  }
  if (energyCapacity >= 350) {
    return [WORK, WORK, CARRY, MOVE];
  }
  return null;
}

function buildRemoteHaulerBody(energyCapacity) {
  // 2 CARRY : 1 MOVE ratio.  Roads keep speed up; extra MOVE is waste.
  // Caps: max 24 CARRY, max 12 MOVE.
  if (energyCapacity >= 1800) {
    // 24 CARRY + 12 MOVE = 1200 cap, 1800 cost, 36 parts, 108 ticks
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 1500) {
    // 20 CARRY + 10 MOVE = 1000 cap, 1500 cost, 30 parts
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE, MOVE,
      MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 1200) {
    // 16 CARRY + 8 MOVE = 800 cap, 1200 cost, 24 parts
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 800) {
    // 10 CARRY + 5 MOVE = 500 cap, 750 cost, 15 parts
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 600) {
    // 8 CARRY + 4 MOVE = 400 cap, 600 cost, 12 parts
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 400) {
    // 6 CARRY + 3 MOVE = 300 cap, 450 cost, 9 parts
    return [
      CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 300) {
    // 4 CARRY + 2 MOVE = 200 cap, 300 cost, 6 parts
    return [
      CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE
    ];
  }
  if (energyCapacity >= 150) {
    // 2 CARRY + 1 MOVE = 100 cap, 150 cost, 3 parts
    return [
      CARRY, CARRY,
      MOVE
    ];
  }
  return null;
}

function buildRemoteBuilderBody(energyCapacity) {
  // More WORK = faster road repair.  Roads crumbling kills remote economy.
  if (energyCapacity >= 1200) {
    // 8×WORK + 4×CARRY + 4×MOVE = 800 cost, 40 work/tick
    return [
      WORK, WORK, WORK, WORK, WORK, WORK, WORK, WORK,
      CARRY, CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 800) {
    // 6×WORK + 3×CARRY + 3×MOVE = 600 cost, 30 work/tick
    return [
      WORK, WORK, WORK, WORK, WORK, WORK,
      CARRY, CARRY, CARRY,
      MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 500) {
    // 4×WORK + 2×CARRY + 2×MOVE = 400 cost, 20 work/tick
    return [
      WORK, WORK, WORK, WORK,
      CARRY, CARRY,
      MOVE, MOVE
    ];
  }
  if (energyCapacity >= 200) {
    return [WORK, CARRY, MOVE];
  }
  return null;
}

// ⚠️ deepseek/agent 請勿回退成單一 [CLAIM, MOVE]（fb99728 曾回退過，見 D013）。
// 每個 CLAIM +1 reservation/tick；2×CLAIM 倍增 → 更快重建/守住 5000 上限、
// 涵蓋 CLAIM creep ~600 tick 壽命 + 路程的補位空窗，避免 reservation 歸零招來
// invader（reservation 是 D012 的第一道防線）。
function buildReserverBody(energyCapacity) {
  if (energyCapacity >= 1300) return [CLAIM, CLAIM, MOVE, MOVE];
  if (energyCapacity >= 650) return [CLAIM, MOVE];
  return null;
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

function countCreepsInRole(role, targetRoomName) {
  let count = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (
      c.memory.role === role &&
      (c.memory.targetRoom === targetRoomName || c.memory.remoteRoom === targetRoomName)
    ) {
      count++;
    }
  }
  return count;
}

function countClaimers(targetRoomName) {
  let count = 0;
  for (const name in Game.creeps) {
    const c = Game.creeps[name];
    if (
      c.memory.role === 'claimer' &&
      (c.memory.targetRoom === targetRoomName || c.memory.remoteRoom === targetRoomName)
    ) {
      count++;
    }
  }
  return count;
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

  // ── Expansion mission (Memory.expansionMission) ──
  var mission = Memory.expansionMission;
  if (mission && mission.active && mission.phase !== 'done') {
    var target = mission.targetRoom;
    var missionRoom = Game.rooms[target];
    var controllerMine = missionRoom && missionRoom.controller && missionRoom.controller.my;

    // Phase transition: claim → build
    if (mission.phase === 'claim' && controllerMine) {
      mission.phase = 'build';
      console.log('[expansion] ' + target + ' claimed! Phase → build');
    }
    // Phase transition: build → done
    if (
      mission.phase === 'build' &&
      missionRoom &&
      missionRoom.find(FIND_MY_SPAWNS).length > 0
    ) {
      mission.phase = 'done';
      mission.active = false;
      console.log('[expansion] ' + target + ' spawn built! Mission complete.');
    }

    if (mission.phase === 'claim' && homeRoom.energyAvailable >= 1700) {
      // GCL gate: need enough GCL to claim another room
      var ownedCount = 0;
      for (var rn in Game.rooms) {
        if (Game.rooms[rn].controller && Game.rooms[rn].controller.my) ownedCount++;
      }
      if (Game.gcl.level < ownedCount + 1) {
        if (Game.time % 100 === 0) {
          console.log('[expansion] GCL 不足，無法 claim ' + target + '，略過 claimer');
        }
      } else if (countClaimers(target) === 0) {
        // 2×CLAIM + 10×MOVE — 1700 energy, swamp full-speed
        var claimerBody = [
          CLAIM, CLAIM,
          MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
        ];
        requests.push({
          role: 'claimer',
          name: 'claimer_' + target + '_' + Game.time,
          body: claimerBody,
          memory: {
            role: 'claimer',
            home: homeRoomName,
            targetRoom: target,
            remoteRoom: target,
            signText: mission.signText || 'Theodos colony'
          }
        });
        console.log('[expansion] claimer queued for ' + target);
      }
    }

    // Spawn pioneers as soon as claimer is en-route (not just after claim succeeds).
    // This way pioneers arrive around the same time as the claimer.
    var shouldSpawnPioneers =
      mission.phase === 'build' ||
      (mission.phase === 'claim' && countClaimers(target) > 0);

    if (shouldSpawnPioneers) {
      var builderCount = mission.builderCount || 0;
      var currentPioneers = countCreepsInRole('pioneer', target);
      // 2×WORK + 1×CARRY + 15×MOVE — 1100 energy (swamp full-speed)
      var pioneerBody = [
        WORK, WORK,
        CARRY,
        MOVE, MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE, MOVE
      ];
      if (currentPioneers < builderCount && homeRoom.energyAvailable >= 1100) {
        requests.push({
          role: 'pioneer',
          name: 'pioneer_' + target + '_' + Game.time,
          body: pioneerBody,
          memory: {
            role: 'pioneer',
            home: homeRoomName,
            targetRoom: target,
            remoteRoom: target
          }
        });
        console.log(
          '[expansion] pioneer queued for ' + target +
          ' (' + (currentPioneers + 1) + '/' + builderCount + ')'
        );
      }
    }
  }

  for (const remoteRoomName in homeConfig.rooms) {
    const remoteConfig = homeConfig.rooms[remoteRoomName];
    if (!remoteConfig || remoteConfig.enabled !== true) continue;
    if (isRemotePaused(homeRoomName, remoteRoomName)) {
      remoteConfig.stableSince = 0;
      continue;
    }

    for (let index = 0; index < remoteConfig.sources.length; index++) {
      const sourceConfig = remoteConfig.sources[index];
      // Skip sources without known positions (not yet scouted)
      if (
        !sourceConfig ||
        sourceConfig.enabled !== true ||
        sourceConfig.x === null ||
        sourceConfig.y === null ||
        !minerBody
      ) {
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
      // Skip sources without known positions (not yet scouted)
      if (
        !sourceConfig ||
        sourceConfig.enabled !== true ||
        sourceConfig.x === null ||
        sourceConfig.y === null ||
        !haulerBody
      ) {
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
      if (healthyCount < 1) {
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
    const reserverLead = reserverBody
      ? getReserverLeadTicks(homeRoomName, remoteRoomName, reserverBody)
      : 0;
    // Reservation is our FIRST line of invader defense: NPC invaders only
    // spawn at exits to neutral rooms, so a continuously-reserved remote
    // never spawns them (DECISIONS D012). React early with a wide margin so
    // reservation never lapses to 0 between reserver deaths + travel time.
    const reserveThreshold = Math.max(1500, reserverLead + 400);
    const reservationLow = !!(
      controller &&
      (
        !controller.reservation ||
        controller.reservation.ticksToEnd < reserveThreshold
      )
    );
    const reservers = getAssignedCreeps(
      'reserver',
      homeRoomName,
      remoteRoomName
    );
    // Healthy if alive long enough to travel + stay a while
    const reserverReplacementLead = reserverLead + 300;
    // Maintain reservation whenever we're actively mining here (a miner is
    // assigned) — not only when the full container economy is "stable". A
    // transient infra dip must not let reservation lapse and invite invaders.
    const reserveMiners = getAssignedCreeps(
      'remoteMiner',
      homeRoomName,
      remoteRoomName
    );
    const maintainReservation = stable || reserveMiners.length > 0;
    if (
      reserverBody &&
      maintainReservation &&
      controller &&
      reservationLow &&
      !hasHealthyAssignedCreep(reservers, reserverReplacementLead)
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
    planRemoteRoads(
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
  ensureRemoteRoad: ensureRemoteRoad,
  findContainerAt: findContainerAt,
  findContainerSiteAt: findContainerSiteAt,
  findRoadAt: findRoadAt,
  findRoadSiteAt: findRoadSiteAt,
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
