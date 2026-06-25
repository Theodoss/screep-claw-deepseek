/**
 * role.remoteHauler.js — remote energy hauler
 *
 * W48N25 / W48N26 remote haulers deliver ONLY to:
 *   Door Link (47,6), Left Container (46,6), Right Container (48,6)
 *
 * All other remote rooms use the standard delivery logic.
 */

var economy = require('manager.economy');
var remote = require('manager.remote');
var managerEconomy = require('manager.economy');
var remotePath = require('remote.path');
var linkConfig = require('config.W49N25Links');

var RESTRICTED_REMOTE_ROOMS = {};
for (var i = 0; i < linkConfig.restrictedRemoteRooms.length; i++) {
  RESTRICTED_REMOTE_ROOMS[linkConfig.restrictedRemoteRooms[i]] = true;
}

var DOOR_LINK_ID = linkConfig.doorLinkId;
var LEFT_CONTAINER_POS = { x: 46, y: 6 };
var RIGHT_CONTAINER_POS = { x: 48, y: 6 };

var lastDoorWarning = {};

function logRateLimited(key, message) {
  if (!lastDoorWarning[key] || Game.time - lastDoorWarning[key] > 100) {
    lastDoorWarning[key] = Game.time;
    console.log(message);
  }
}

function getAssignedRemoteRoom(creep) {
  return creep.memory.remoteRoom || null;
}

function isDoorGatewayRemoteHauler(creep) {
  if (!creep || creep.memory.role !== 'remoteHauler') return false;
  var remoteRoom = getAssignedRemoteRoom(creep);
  return !!(remoteRoom && RESTRICTED_REMOTE_ROOMS[remoteRoom]);
}

function closestTarget(creep, targets) {
  if (targets.length === 0) return null;
  return (
    creep.pos.findClosestByPath(targets) ||
    creep.pos.findClosestByRange(targets) ||
    targets[0]
  );
}

function getHomePathAnchor(creep) {
  var homeRoom = Game.rooms[creep.memory.homeRoom];
  if (!homeRoom) return null;

  if (RESTRICTED_REMOTE_ROOMS[creep.memory.remoteRoom]) {
    var entranceLink = Game.getObjectById(DOOR_LINK_ID);
    if (entranceLink) return entranceLink.pos;
  }

  if (homeRoom.storage) return homeRoom.storage.pos;

  var spawns = homeRoom.find(FIND_MY_SPAWNS);
  return spawns.length > 0 ? spawns[0].pos : null;
}

function followHaulPath(creep, sourceConfig, reverse) {
  if (!sourceConfig) return false;

  var homeAnchor = getHomePathAnchor(creep);
  var remoteTarget = remote.getWaitPosition(sourceConfig);
  if (!homeAnchor || !remoteTarget) return false;

  return remotePath.follow(
    creep,
    sourceConfig,
    homeAnchor,
    remoteTarget,
    reverse
  );
}

/**
 * Get door gateway dropoff structures:
 *   [doorLink, leftContainer, rightContainer]
 * Filtered to existing structures with free capacity.
 */
function getDoorGatewayDropoffs(room) {
  if (!room) return [];

  var doorLink = Game.getObjectById(DOOR_LINK_ID);
  var structures = room.lookForAt(LOOK_STRUCTURES, 46, 6);
  var leftContainer = null;
  for (var i = 0; i < structures.length; i++) {
    if (structures[i].structureType === STRUCTURE_CONTAINER) {
      leftContainer = structures[i];
      break;
    }
  }

  structures = room.lookForAt(LOOK_STRUCTURES, 48, 6);
  var rightContainer = null;
  for (var j = 0; j < structures.length; j++) {
    if (structures[j].structureType === STRUCTURE_CONTAINER) {
      rightContainer = structures[j];
      break;
    }
  }

  var candidates = [];
  if (doorLink &&
      doorLink.store &&
      doorLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    candidates.push(doorLink);
  }
  if (leftContainer &&
      leftContainer.store &&
      leftContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    candidates.push(leftContainer);
  }
  if (rightContainer &&
      rightContainer.store &&
      rightContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    candidates.push(rightContainer);
  }

  return candidates;
}

function findDoorDeliveryTarget(creep) {
  // Check existing locked target
  if (creep.memory.doorDropoffId) {
    var locked = Game.getObjectById(creep.memory.doorDropoffId);
    if (locked && locked.store &&
        locked.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
      // Verify it's still a valid door dropoff
      var pos = locked.pos;
      var isValid =
        (locked.id === DOOR_LINK_ID) ||
        (pos.x === 46 && pos.y === 6) ||
        (pos.x === 48 && pos.y === 6);
      if (isValid) return locked;
    }
    delete creep.memory.doorDropoffId;
  }

  // Select new target
  var dropoffs = getDoorGatewayDropoffs(creep.room);

  if (dropoffs.length === 0) {
    // Check if all exist but are full
    var doorLink = Game.getObjectById(DOOR_LINK_ID);
    var anyExist = !!doorLink;
    if (!anyExist) {
      var s = creep.room.lookForAt(LOOK_STRUCTURES, 46, 6);
      for (var i = 0; i < s.length; i++) {
        if (s[i].structureType === STRUCTURE_CONTAINER) { anyExist = true; break; }
      }
    }
    if (!anyExist) {
      s = creep.room.lookForAt(LOOK_STRUCTURES, 48, 6);
      for (var j = 0; j < s.length; j++) {
        if (s[j].structureType === STRUCTURE_CONTAINER) { anyExist = true; break; }
      }
    }

    if (!anyExist) {
      // Emergency: all three missing → fallback storage
      logRateLimited(
        'door-gateway-all-missing',
        '[doorGateway] all three dropoffs missing — fallback storage'
      );
      return findStandardDeliveryTarget(creep);
    }

    // All exist but are full → wait
    return null;
  }

  // Pick best target: closest by path, tie-break by free capacity
  var best = creep.pos.findClosestByPath(dropoffs);
  if (!best) {
    // Sort by range then free capacity
    dropoffs.sort(function (a, b) {
      var ra = creep.pos.getRangeTo(a);
      var rb = creep.pos.getRangeTo(b);
      if (ra !== rb) return ra - rb;
      return b.store.getFreeCapacity(RESOURCE_ENERGY) -
             a.store.getFreeCapacity(RESOURCE_ENERGY);
    });
    best = dropoffs[0];
  }

  creep.memory.doorDropoffId = best.id;
  return best;
}

function findStandardDeliveryTarget(creep) {
  var myStructures = creep.room.find(FIND_MY_STRUCTURES);
  var spawnTargets = [];
  var extTargets = [];
  var towerTargets = [];

  for (var index = 0; index < myStructures.length; index++) {
    var structure = myStructures[index];
    if (!structure.store) continue;
    if (structure.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) continue;

    if (structure.structureType === STRUCTURE_SPAWN) {
      spawnTargets.push(structure);
    } else if (structure.structureType === STRUCTURE_EXTENSION) {
      extTargets.push(structure);
    } else if (
      structure.structureType === STRUCTURE_TOWER &&
      structure.store.getUsedCapacity(RESOURCE_ENERGY) <
        remote.TOWER_LOW_ENERGY
    ) {
      towerTargets.push(structure);
    }
  }

  if (spawnTargets.length > 0) return closestTarget(creep, spawnTargets);
  if (extTargets.length > 0) return closestTarget(creep, extTargets);
  if (towerTargets.length > 0) return closestTarget(creep, towerTargets);

  var controllerContainer = economy.getControllerContainer(creep.room);
  if (controllerContainer &&
      controllerContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    return controllerContainer;
  }

  if (creep.room.storage &&
      creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    return creep.room.storage;
  }

  return null;
}

function waitAtHome(creep) {
  // Door gateway haulers: wait near door area but not on reserved tiles
  if (isDoorGatewayRemoteHauler(creep)) {
    // Pick a wait position that doesn't block the dropoffs or reserved tiles
    var waitX = 45;
    var waitY = 8;
    var reservedTiles = require('reserved.tiles');
    if (reservedTiles.isReservedForOther(
          creep.room.name, waitX, waitY, 'remoteHauler')) {
      waitX = 44;
      waitY = 5;
    }
    if (creep.pos.x !== waitX || creep.pos.y !== waitY) {
      creep.moveTo(waitX, waitY, { reusePath: 10 });
    }
    return;
  }

  var spawns = creep.room.find(FIND_MY_SPAWNS);
  var target = creep.room.storage || spawns[0] || null;
  if (target && creep.pos.getRangeTo(target) > 3) {
    creep.moveTo(target, { reusePath: 10 });
  }
}

function deliverDoorGateway(creep, sourceConfig) {
  if (creep.pos.roomName !== creep.memory.homeRoom) {
    if (followHaulPath(creep, sourceConfig, true)) return;

    creep.moveTo(
      new RoomPosition(25, 25, creep.memory.homeRoom),
      { reusePath: 20 }
    );
    return;
  }

  var target = findDoorDeliveryTarget(creep);
  if (!target) {
    // All three full — wait
    waitAtHome(creep);
    return;
  }

  var carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  var result = creep.transfer(target, RESOURCE_ENERGY);

  if (result === OK) {
    managerEconomy.recordHarvest(creep.memory.homeRoom, carried);
    // Check if fully empty after this transfer
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      delete creep.memory.doorDropoffId;
    }
    // If target is now full, clear it for re-selection next tick
    if (target.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) {
      delete creep.memory.doorDropoffId;
    }
  } else if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { range: 1, reusePath: 10 });
  } else if (result === ERR_FULL) {
    delete creep.memory.doorDropoffId;
  }
}

function deliverStandard(creep, sourceConfig) {
  if (creep.pos.roomName !== creep.memory.homeRoom) {
    if (followHaulPath(creep, sourceConfig, true)) return;

    creep.moveTo(
      new RoomPosition(25, 25, creep.memory.homeRoom),
      { reusePath: 20 }
    );
    return;
  }

  var target = findStandardDeliveryTarget(creep);
  if (!target) {
    waitAtHome(creep);
    return;
  }

  var carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);
  var result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === OK) {
    managerEconomy.recordHarvest(creep.memory.homeRoom, carried);
  } else if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 10 });
  }
}

function deliver(creep, sourceConfig) {
  if (isDoorGatewayRemoteHauler(creep)) {
    deliverDoorGateway(creep, sourceConfig);
  } else {
    deliverStandard(creep, sourceConfig);
  }
}

// ── Helper: check if own source has an effective remoteMiner ──
function hasOwnMiner(creep) {
  var homeRoom = creep.memory.homeRoom;
  var remoteRoom = creep.memory.remoteRoom;
  var mySourceIndex = creep.memory.sourceIndex;

  for (var name in Game.creeps) {
    var c = Game.creeps[name];
    if (c.memory.role !== 'remoteMiner') continue;
    if (c.memory.homeRoom !== homeRoom && c.memory.home !== homeRoom) continue;
    if (c.memory.remoteRoom !== remoteRoom && c.memory.remote !== remoteRoom) continue;
    if (c.memory.sourceIndex !== mySourceIndex && c.memory.sourceId !== mySourceIndex) continue;
    if (c.ticksToLive > 0) return true;
  }
  return false;
}

// ── Helper: own container overflow (range 1, immediate pickup, no threshold) ──
function findOwnOverflow(creep, containerX, containerY, containerRoom) {
  var pos = new RoomPosition(containerX, containerY, containerRoom);
  var dropped = pos.findInRange(FIND_DROPPED_RESOURCES, 1);
  for (var i = 0; i < dropped.length; i++) {
    if (dropped[i].resourceType === RESOURCE_ENERGY && dropped[i].amount > 0) {
      return dropped[i];
    }
  }
  return null;
}

// ── Helper: general salvage scan (300 threshold, cooldown-managed) ──
function findGeneralSalvage(creep) {
  var freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  if (freeCapacity < 300) return null;

  // Dropped resources (only energy)
  var dropped = creep.room.find(FIND_DROPPED_RESOURCES);
  var best = null;
  var bestAmount = 0;
  for (var i = 0; i < dropped.length; i++) {
    var r = dropped[i];
    if (r.resourceType !== RESOURCE_ENERGY) continue;
    var available = Math.min(r.amount, freeCapacity);
    if (available >= 300 && available > bestAmount) {
      best = { target: r, type: 'pickup', available: available };
      bestAmount = available;
    }
  }
  if (best) return best;

  // Tombstones
  var tombstones = creep.room.find(FIND_TOMBSTONES);
  for (var j = 0; j < tombstones.length; j++) {
    var t = tombstones[j];
    var tEnergy = t.store.getUsedCapacity(RESOURCE_ENERGY);
    var tAvail = Math.min(tEnergy, freeCapacity);
    if (tAvail >= 300 && tAvail > bestAmount) {
      best = { target: t, type: 'withdraw', available: tAvail };
      bestAmount = tAvail;
    }
  }

  // Ruins
  var ruins = creep.room.find(FIND_RUINS);
  for (var k = 0; k < ruins.length; k++) {
    var ru = ruins[k];
    var ruEnergy = ru.store.getUsedCapacity(RESOURCE_ENERGY);
    var ruAvail = Math.min(ruEnergy, freeCapacity);
    if (ruAvail >= 300 && ruAvail > bestAmount) {
      best = { target: ru, type: 'withdraw', available: ruAvail };
      bestAmount = ruAvail;
    }
  }

  return best;
}

// ── Helper: get other source containers from remote config ──
function findOtherContainer(creep) {
  var homeRoom = creep.memory.homeRoom;
  var remoteRoom = creep.memory.remoteRoom;
  var mySourceIndex = creep.memory.sourceIndex;

  var homeConfig = Memory.remote && Memory.remote[homeRoom];
  if (!homeConfig || !homeConfig.rooms) return null;
  var remoteConfig = homeConfig.rooms[remoteRoom];
  if (!remoteConfig || !remoteConfig.sources) return null;

  var bestContainer = null;
  var bestEnergy = 0;
  for (var i = 0; i < remoteConfig.sources.length; i++) {
    if (i === mySourceIndex) continue;
    var src = remoteConfig.sources[i];
    if (!src || src.enabled === false) continue;
    if (typeof src.containerX !== 'number') continue;

    var container = remote.findContainerAt(remoteRoom, src.containerX, src.containerY);
    if (!container) continue;
    var energy = container.store.getUsedCapacity(RESOURCE_ENERGY);
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestContainer = container;
    }
  }
  return bestEnergy > 0 ? bestContainer : null;
}

// ── Helper: get own container (cached ID or lookup) ──
function getOwnContainer(creep, sourceConfig) {
  if (sourceConfig._containerId) {
    var cached = Game.getObjectById(sourceConfig._containerId);
    if (cached) return cached;
  }
  var container = remote.findContainerAt(
    sourceConfig.roomName,
    sourceConfig.containerX,
    sourceConfig.containerY
  );
  if (container) {
    sourceConfig._containerId = container.id;
  }
  return container;
}

// ── Collect target management ──
function clearCollectTarget(creep) {
  delete creep.memory.collectTargetId;
  delete creep.memory.collectTargetType;
  delete creep.memory.collectTargetLockedAt;
  delete creep.memory.collectFallback;
}

function validateCollectTarget(creep) {
  if (!creep.memory.collectTargetId) return null;
  var target = Game.getObjectById(creep.memory.collectTargetId);
  if (!target) return null;

  var targetType = creep.memory.collectTargetType;
  var freeCap = creep.store.getFreeCapacity(RESOURCE_ENERGY);

  if (targetType === 'ownOverflow') {
    if (target.amount <= 0 || target.resourceType !== RESOURCE_ENERGY) return null;
    return { target: target, type: 'pickup' };
  }
  if (targetType === 'ownContainer') {
    if (!target.store || target.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return null;
    return { target: target, type: 'withdraw' };
  }
  if (targetType === 'salvage') {
    if (target.amount !== undefined) {
      if (target.amount <= 0 || Math.min(target.amount, freeCap) < 300) return null;
      return { target: target, type: 'pickup' };
    }
    if (target.store && target.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      return { target: target, type: 'withdraw' };
    }
    return null;
  }
  if (targetType === 'fallbackContainer') {
    if (!target.store || target.store.getUsedCapacity(RESOURCE_ENERGY) <= 0) return null;
    return { target: target, type: 'withdraw' };
  }
  return null;
}

function executeCollectAction(creep, action) {
  var result;
  if (action.type === 'pickup') {
    result = creep.pickup(action.target);
  } else {
    result = creep.withdraw(action.target, RESOURCE_ENERGY);
  }

  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(action.target, { range: 1, reusePath: 5 });
    return true;
  }

  if (result === OK) {
    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
      clearCollectTarget(creep);
      creep.memory.delivering = true;
    }
    return true;
  }

  if (result === ERR_NOT_ENOUGH_RESOURCES || result === ERR_FULL) {
    clearCollectTarget(creep);
    return true;
  }

  return true;
}

// ── Main collect function ──
function collect(creep, sourceConfig) {
  var containerX = sourceConfig.containerX;
  var containerY = sourceConfig.containerY;
  var containerRoom = sourceConfig.roomName;
  var containerPosition = new RoomPosition(containerX, containerY, containerRoom);

  // ── Already full → deliver ──
  if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
    clearCollectTarget(creep);
    creep.memory.delivering = true;
    return;
  }

  // ── Locked target ──
  if (creep.memory.collectTargetId) {
    var locked = validateCollectTarget(creep);
    if (locked) {
      executeCollectAction(creep, locked);
      return;
    }
    clearCollectTarget(creep);
  }

  // ── Cross-room travel ──
  var moveOpts = {
    range: 1,
    reusePath: 20,
    costCallback: function (roomName, costMatrix) {
      if (roomName === containerRoom) {
        costMatrix.set(containerX, containerY, 255);
      }
      return costMatrix;
    }
  };

  if (creep.pos.roomName !== containerRoom) {
    if (followHaulPath(creep, sourceConfig, false)) return;
    creep.moveTo(containerPosition, moveOpts);
    return;
  }

  // ── On container tile → move off ──
  if (creep.pos.x === containerX && creep.pos.y === containerY) {
    creep.moveTo(remote.getWaitPosition(sourceConfig), { reusePath: 5 });
    return;
  }

  // ── Not in range → approach ──
  if (creep.pos.getRangeTo(containerPosition) > 1) {
    if (followHaulPath(creep, sourceConfig, false)) return;
    creep.moveTo(containerPosition, moveOpts);
    return;
  }

  // ═══════════════════════════════════════════
  // At range 1 of own container — make decision
  // ═══════════════════════════════════════════

  // Priority 1: own container overflow (range 1, no threshold)
  var overflow = findOwnOverflow(creep, containerX, containerY, containerRoom);
  if (overflow) {
    creep.memory.collectTargetId = overflow.id;
    creep.memory.collectTargetType = 'ownOverflow';
    creep.memory.collectTargetLockedAt = Game.time;
    executeCollectAction(creep, { target: overflow, type: 'pickup' });
    return;
  }

  // Priority 2: own container
  var ownContainer = getOwnContainer(creep, sourceConfig);
  if (ownContainer && ownContainer.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    creep.memory.collectTargetId = ownContainer.id;
    creep.memory.collectTargetType = 'ownContainer';
    creep.memory.collectTargetLockedAt = Game.time;
    executeCollectAction(creep, { target: ownContainer, type: 'withdraw' });
    return;
  }

  // Priority 3: general salvage (cooldown + 300 threshold)
  if (
    creep.memory.nextSalvageScan === undefined ||
    Game.time >= (creep.memory.nextSalvageScan || 0)
  ) {
    var salvage = findGeneralSalvage(creep);
    creep.memory.nextSalvageScan = Game.time + 10;

    if (salvage) {
      creep.memory.collectTargetId = salvage.target.id;
      creep.memory.collectTargetType = 'salvage';
      creep.memory.collectTargetLockedAt = Game.time;
      executeCollectAction(creep, salvage);
      return;
    }
  }

  // Priority 4: own miner status check
  var ownMiner = hasOwnMiner(creep);

  if (ownMiner) {
    // Miner exists — trust production line, wait at own position
    creep.memory.nextContainerCheck = Game.time + 5;
    var waitPos = remote.getWaitPosition(sourceConfig);
    if (creep.pos.getRangeTo(waitPos) > 0) {
      creep.moveTo(waitPos, { reusePath: 5 });
    }
    return;
  }

  // Priority 5: no own miner — fallback to other container
  var fallback = findOtherContainer(creep);
  if (fallback) {
    creep.memory.collectTargetId = fallback.id;
    creep.memory.collectTargetType = 'fallbackContainer';
    creep.memory.collectTargetLockedAt = Game.time;
    creep.memory.collectFallback = true;
    executeCollectAction(creep, { target: fallback, type: 'withdraw' });
    return;
  }

  // Nothing available — wait
  var waitPosition = remote.getWaitPosition(sourceConfig);
  if (creep.pos.getRangeTo(waitPosition) > 0) {
    creep.moveTo(waitPosition, { reusePath: 5 });
  }
}

module.exports = {
  run: function (creep) {
    var homeRoom = creep.memory.homeRoom;
    var remoteRoom = creep.memory.remoteRoom;
    var sourceConfig = remote.getSourceConfig(
      homeRoom,
      remoteRoom,
      creep.memory.sourceIndex
    );

    if (!sourceConfig || sourceConfig.enabled !== true) {
      remote.retreat(creep, homeRoom);
      return;
    }
    if (remote.isRemotePaused(homeRoom, remoteRoom)) {
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        deliver(creep, sourceConfig);
        return;
      }
      remote.retreat(creep, homeRoom);
      return;
    }

    var used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    var free = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    var cap = creep.store.getCapacity(RESOURCE_ENERGY);

    if (free === 0 || (used > 0 && cap > 0 && free / cap <= 0.2)) {
      creep.memory.delivering = true;
    }
    if (used === 0 || (creep.memory.delivering && cap > 0 && used / cap < 0.1)) {
      creep.memory.delivering = false;
    }

    if (creep.memory.delivering) {
      deliver(creep, sourceConfig);
      return;
    }

    collect(creep, sourceConfig);
  }
};
