const remote = require('manager.remote');

var ROAD_REPAIR_START = 0.4;   // repair when hits < 40%
var ROAD_REPAIR_STOP  = 0.9;   // stop when hits > 90%

// Get highest-priority work in the remote room.
// Priority: road construction > container construction > link construction
//            > other construction sites > road repair.
// Container repair is REMOVED — now handled by remoteMiner only.
function getRemoteWork(creep, remoteConfig) {
  if (!remoteConfig || !Array.isArray(remoteConfig.sources)) return null;

  // 1. Road construction sites (highest priority)
  var roadSites = creep.room.find(FIND_CONSTRUCTION_SITES, {
    filter: function (site) {
      return site.structureType === STRUCTURE_ROAD;
    }
  });
  if (roadSites.length > 0) {
    var closestRoad = creep.pos.findClosestByPath(roadSites) ||
      creep.pos.findClosestByRange(roadSites) ||
      roadSites[0];
    return { target: closestRoad, type: 'build' };
  }

  // 2. Container construction sites
  for (var i = 0; i < remoteConfig.sources.length; i++) {
    var sourceConfig = remoteConfig.sources[i];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;
    var site = remote.findContainerSiteAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    if (site) return { target: site, type: 'build' };
  }

  // 3. Link construction sites (if any in room)
  var linkSites = creep.room.find(FIND_CONSTRUCTION_SITES, {
    filter: function (site) {
      return site.structureType === STRUCTURE_LINK;
    }
  });
  if (linkSites.length > 0) {
    var closestLink = creep.pos.findClosestByPath(linkSites) ||
      creep.pos.findClosestByRange(linkSites) ||
      linkSites[0];
    return { target: closestLink, type: 'build' };
  }

  // 4. Other construction sites
  var otherSites = creep.room.find(FIND_CONSTRUCTION_SITES);
  if (otherSites.length > 0) {
    var closestOther = creep.pos.findClosestByPath(otherSites) ||
      creep.pos.findClosestByRange(otherSites) ||
      otherSites[0];
    return { target: closestOther, type: 'build' };
  }

  // 5. Road repair (only roads, not containers/ramparts/walls)
  var roads = creep.room.find(FIND_STRUCTURES, {
    filter: function (s) {
      return s.structureType === STRUCTURE_ROAD &&
        s.hits < s.hitsMax * ROAD_REPAIR_START;
    }
  });
  if (roads.length > 0) {
    // Prioritize roads near sources and exits (closest by path)
    var closest = creep.pos.findClosestByPath(roads) ||
      creep.pos.findClosestByRange(roads) ||
      roads[0];
    return { target: closest, type: 'repair' };
  }

  return null;
}

function closestTarget(creep, targets) {
  if (targets.length === 0) return null;
  return (
    creep.pos.findClosestByPath(targets) ||
    creep.pos.findClosestByRange(targets) ||
    targets[0]
  );
}

function findRemoteEnergy(creep, remoteConfig) {
  var candidates = [];

  for (var i = 0; i < remoteConfig.sources.length; i++) {
    var sourceConfig = remoteConfig.sources[i];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;

    var container = remote.findContainerAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    if (
      container &&
      container.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      candidates.push({ target: container, type: 'withdraw' });
    }
  }

  var dropped = creep.room.find(FIND_DROPPED_RESOURCES);
  for (var j = 0; j < dropped.length; j++) {
    if (
      dropped[j].resourceType === RESOURCE_ENERGY &&
      dropped[j].amount > 0
    ) {
      candidates.push({ target: dropped[j], type: 'pickup' });
    }
  }

  var tombstones = creep.room.find(FIND_TOMBSTONES);
  for (var k = 0; k < tombstones.length; k++) {
    if (tombstones[k].store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      candidates.push({ target: tombstones[k], type: 'withdraw' });
    }
  }

  var ruins = creep.room.find(FIND_RUINS);
  for (var r = 0; r < ruins.length; r++) {
    if (ruins[r].store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      candidates.push({ target: ruins[r], type: 'withdraw' });
    }
  }

  var target = closestTarget(
    creep,
    candidates.map(function (c) { return c.target; })
  );
  if (!target) return null;

  for (var ci = 0; ci < candidates.length; ci++) {
    if (candidates[ci].target === target) return candidates[ci];
  }
  return null;
}

function findRemoteSource(creep, remoteConfig) {
  var sources = [];
  var sourceIds = {};

  for (var i = 0; i < remoteConfig.sources.length; i++) {
    var sourceConfig = remoteConfig.sources[i];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;

    var source = sourceConfig.id
      ? Game.getObjectById(sourceConfig.id)
      : null;
    if (!source || source.energy <= 0) continue;

    sources.push(source);
    sourceIds[source.id] = true;
  }

  var visibleSources = creep.room.find(FIND_SOURCES);
  for (var j = 0; j < visibleSources.length; j++) {
    var vs = visibleSources[j];
    if (vs.energy <= 0 || sourceIds[vs.id]) continue;
    sources.push(vs);
  }

  return closestTarget(creep, sources);
}

function findHomeEnergy(creep) {
  if (
    creep.room.storage &&
    creep.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  ) {
    return creep.room.storage;
  }

  var structures = creep.room.find(FIND_STRUCTURES);
  for (var i = 0; i < structures.length; i++) {
    if (
      structures[i].structureType === STRUCTURE_CONTAINER &&
      structures[i].store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      return structures[i];
    }
  }

  return null;
}

function acquireEnergy(creep, remoteConfig) {
  if (creep.pos.roomName === creep.memory.remoteRoom) {
    var remoteEnergy = findRemoteEnergy(creep, remoteConfig);
    if (remoteEnergy) {
      delete creep.memory.needsHomeEnergy;
      creep.memory.task = remoteEnergy.type === 'pickup'
        ? 'pickup:remote-energy'
        : 'withdraw:remote-energy';
      var result = remoteEnergy.type === 'pickup'
        ? creep.pickup(remoteEnergy.target)
        : creep.withdraw(remoteEnergy.target, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(remoteEnergy.target, { reusePath: 10 });
      }
      return;
    }

    var source = findRemoteSource(creep, remoteConfig);
    if (source) {
      delete creep.memory.needsHomeEnergy;
      creep.memory.task = 'harvest:remote-source';
      var hr = creep.harvest(source);
      if (hr === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 10 });
      }
      return;
    }

    creep.memory.needsHomeEnergy = true;
    creep.memory.task = 'return:home-energy-fallback';
    creep.moveTo(
      new RoomPosition(25, 25, creep.memory.homeRoom),
      { reusePath: 20 }
    );
    return;
  }

  if (creep.pos.roomName === creep.memory.homeRoom) {
    if (creep.memory.needsHomeEnergy) {
      var homeEnergy = findHomeEnergy(creep);
      if (homeEnergy) {
        creep.memory.task = 'withdraw:home-energy-fallback';
        var wr = creep.withdraw(homeEnergy, RESOURCE_ENERGY);
        if (wr === OK) {
          delete creep.memory.needsHomeEnergy;
        } else if (wr === ERR_NOT_IN_RANGE) {
          creep.moveTo(homeEnergy, { reusePath: 10 });
        }
      } else {
        creep.memory.task = 'idle:no-home-energy';
      }
      return;
    }

    creep.memory.task = 'travel:remote-energy';
    creep.moveTo(
      new RoomPosition(25, 25, creep.memory.remoteRoom),
      { reusePath: 20 }
    );
    return;
  }

  var targetRoom = creep.memory.needsHomeEnergy
    ? creep.memory.homeRoom
    : creep.memory.remoteRoom;
  creep.memory.task = creep.memory.needsHomeEnergy
    ? 'travel:home-energy-fallback'
    : 'travel:remote-energy';
  creep.moveTo(
    new RoomPosition(25, 25, targetRoom),
    { reusePath: 20 }
  );
}

function retireToHomeBuilder(creep) {
  if (creep.pos.roomName !== creep.memory.homeRoom) {
    creep.moveTo(
      new RoomPosition(25, 25, creep.memory.homeRoom),
      { reusePath: 20 }
    );
    return;
  }

  creep.memory.role = 'rcl1Builder';
  creep.memory.home = creep.memory.homeRoom;
  creep.memory.working =
    creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
}

module.exports = {
  run: function (creep) {
    var homeRoom = creep.memory.homeRoom;
    var remoteRoom = creep.memory.remoteRoom;
    var remoteConfig = remote.getRemoteConfig(homeRoom, remoteRoom);

    if (!remoteConfig) {
      remote.retreat(creep, homeRoom);
      return;
    }
    if (remote.isRemotePaused(homeRoom, remoteRoom)) {
      remote.retreat(creep, homeRoom);
      return;
    }

    if (
      creep.memory.working &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = false;
    }
    if (
      !creep.memory.working &&
      creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = true;
    }

    if (!creep.memory.working) {
      acquireEnergy(creep, remoteConfig);
      return;
    }

    if (creep.pos.roomName !== remoteRoom) {
      creep.moveTo(
        new RoomPosition(25, 25, remoteRoom),
        { reusePath: 20 }
      );
      return;
    }

    var work = getRemoteWork(creep, remoteConfig);
    if (!work) {
      retireToHomeBuilder(creep);
      return;
    }

    var result = work.type === 'build'
      ? creep.build(work.target)
      : creep.repair(work.target);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(work.target, { reusePath: 10 });
    }
  }
};
