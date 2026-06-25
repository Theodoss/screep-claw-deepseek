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

function selectNearbySalvage(creep, sourceConfig) {
  var dropped = creep.room.find(FIND_DROPPED_RESOURCES);
  var selected = null;

  for (var index = 0; index < dropped.length; index++) {
    var resource = dropped[index];
    if (resource.resourceType !== RESOURCE_ENERGY) continue;
    if (
      resource.pos.getRangeTo(
        sourceConfig.containerX,
        sourceConfig.containerY
      ) > 2
    ) {
      continue;
    }
    if (!selected || resource.amount > selected.target.amount) {
      selected = { target: resource, type: 'pickup' };
    }
  }
  if (selected) return selected;

  var tombstones = creep.room.find(FIND_TOMBSTONES);
  for (var index = 0; index < tombstones.length; index++) {
    var tombstone = tombstones[index];
    if (
      tombstone.pos.getRangeTo(
        sourceConfig.containerX,
        sourceConfig.containerY
      ) <= 2 &&
      tombstone.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      return { target: tombstone, type: 'withdraw' };
    }
  }

  var ruins = creep.room.find(FIND_RUINS);
  for (var index = 0; index < ruins.length; index++) {
    var ruin = ruins[index];
    if (
      ruin.pos.getRangeTo(
        sourceConfig.containerX,
        sourceConfig.containerY
      ) <= 2 &&
      ruin.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      return { target: ruin, type: 'withdraw' };
    }
  }

  return null;
}

function getOtherSourceContainers(creep) {
  var homeRoom = creep.memory.homeRoom;
  var remoteRoom = creep.memory.remoteRoom;
  var mySourceIndex = creep.memory.sourceIndex;
  var result = [];

  var homeConfig = Memory.remote && Memory.remote[homeRoom];
  if (!homeConfig || !homeConfig.rooms) return result;
  var remoteConfig = homeConfig.rooms[remoteRoom];
  if (!remoteConfig || !remoteConfig.sources) return result;

  for (var i = 0; i < remoteConfig.sources.length; i++) {
    if (i === mySourceIndex) continue;
    var src = remoteConfig.sources[i];
    if (!src || src.enabled === false) continue;
    if (typeof src.containerX !== 'number') continue;

    var container = remote.findContainerAt(remoteRoom, src.containerX, src.containerY);
    if (container) {
      result.push({
        container: container,
        sourceIndex: i,
        sourceConfig: src
      });
    }
  }
  return result;
}

function collect(creep, sourceConfig) {
  var containerX = sourceConfig.containerX;
  var containerY = sourceConfig.containerY;
  var containerRoom = sourceConfig.roomName;
  var containerPosition = new RoomPosition(
    containerX,
    containerY,
    containerRoom
  );

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

  // ── Cross-room travel ──
  if (creep.pos.roomName !== containerRoom) {
    if (followHaulPath(creep, sourceConfig, false)) return;
    creep.moveTo(containerPosition, moveOpts);
    return;
  }

  // ── On container tile → move off ──
  if (
    creep.pos.x === containerX &&
    creep.pos.y === containerY
  ) {
    creep.moveTo(remote.getWaitPosition(sourceConfig), {
      reusePath: 5
    });
    return;
  }

  // ── Not in range → approach ──
  if (creep.pos.getRangeTo(containerPosition) > 1) {
    if (followHaulPath(creep, sourceConfig, false)) return;
    creep.moveTo(containerPosition, moveOpts);
    return;
  }

  // ── At range 1 of assigned container ──

  // Priority 1: Salvage (dropped, tombstone, ruin) within 2 tiles
  var salvage = selectNearbySalvage(creep, sourceConfig);
  if (salvage) {
    var sResult = salvage.type === 'pickup'
      ? creep.pickup(salvage.target)
      : creep.withdraw(salvage.target, RESOURCE_ENERGY);
    if (sResult === ERR_NOT_IN_RANGE) {
      creep.moveTo(salvage.target, { reusePath: 5 });
    }
    return;
  }

  // Priority 2: Assigned container
  var container = remote.findContainerAt(
    sourceConfig.roomName,
    sourceConfig.containerX,
    sourceConfig.containerY
  );

  var assignedEnergy = container
    ? container.store.getUsedCapacity(RESOURCE_ENERGY)
    : 0;
  var assignedCap = container
    ? container.store.getCapacity(RESOURCE_ENERGY)
    : 0;

  // If assigned container has enough energy (> 50% capacity or > 0 when small)
  if (assignedEnergy > 0) {
    // Only switch if assigned container is below 50% and another has more
    if (assignedCap > 0 && assignedEnergy < assignedCap * 0.5) {
      var others = getOtherSourceContainers(creep);
      var bestOther = null;
      var bestEnergy = 0;
      for (var oi = 0; oi < others.length; oi++) {
        var oe = others[oi].container.store.getUsedCapacity(RESOURCE_ENERGY);
        if (oe > bestEnergy) {
          bestEnergy = oe;
          bestOther = others[oi];
        }
      }

      if (bestOther && bestEnergy > assignedEnergy && bestEnergy > 0) {
        // Switch to other source
        creep.memory.sourceIndex = bestOther.sourceIndex;
        creep.moveTo(bestOther.container, { range: 1, reusePath: 5 });
        return;
      }
    }

    // Use assigned container
    creep.withdraw(container, RESOURCE_ENERGY);
    return;
  }

  // Priority 3: Assigned empty, check others
  var othersEmpty = getOtherSourceContainers(creep);
  var bestFallback = null;
  var bestFallbackEnergy = 0;
  for (var fi = 0; fi < othersEmpty.length; fi++) {
    var fe = othersEmpty[fi].container.store.getUsedCapacity(RESOURCE_ENERGY);
    if (fe > bestFallbackEnergy) {
      bestFallbackEnergy = fe;
      bestFallback = othersEmpty[fi];
    }
  }

  if (bestFallback && bestFallbackEnergy > 0) {
    creep.memory.sourceIndex = bestFallback.sourceIndex;
    creep.moveTo(bestFallback.container, { range: 1, reusePath: 5 });
    return;
  }

  // Nothing available → wait
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
