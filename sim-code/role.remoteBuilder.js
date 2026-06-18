const remote = require('manager.remote');

function getRemoteWork(remoteConfig) {
  if (!remoteConfig || !Array.isArray(remoteConfig.sources)) return null;

  for (let index = 0; index < remoteConfig.sources.length; index++) {
    const sourceConfig = remoteConfig.sources[index];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;

    const site = remote.findContainerSiteAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    if (site) {
      return {
        target: site,
        type: 'build'
      };
    }
  }

  for (let index = 0; index < remoteConfig.sources.length; index++) {
    const sourceConfig = remoteConfig.sources[index];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;

    const container = remote.findContainerAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    if (container && container.hits < container.hitsMax * 0.8) {
      return {
        target: container,
        type: 'repair'
      };
    }
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
  const candidates = [];

  for (let index = 0; index < remoteConfig.sources.length; index++) {
    const sourceConfig = remoteConfig.sources[index];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;

    const container = remote.findContainerAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    if (
      container &&
      container.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      candidates.push({
        target: container,
        type: 'withdraw'
      });
    }
  }

  const dropped = creep.room.find(FIND_DROPPED_RESOURCES);
  for (let index = 0; index < dropped.length; index++) {
    if (
      dropped[index].resourceType === RESOURCE_ENERGY &&
      dropped[index].amount > 0
    ) {
      candidates.push({
        target: dropped[index],
        type: 'pickup'
      });
    }
  }

  const tombstones = creep.room.find(FIND_TOMBSTONES);
  for (let index = 0; index < tombstones.length; index++) {
    if (
      tombstones[index].store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      candidates.push({
        target: tombstones[index],
        type: 'withdraw'
      });
    }
  }

  const ruins = creep.room.find(FIND_RUINS);
  for (let index = 0; index < ruins.length; index++) {
    if (ruins[index].store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      candidates.push({
        target: ruins[index],
        type: 'withdraw'
      });
    }
  }

  const target = closestTarget(
    creep,
    candidates.map(candidate => candidate.target)
  );
  if (!target) return null;

  return candidates.find(candidate => candidate.target === target) || null;
}

function findRemoteSource(creep, remoteConfig) {
  const sources = [];
  const sourceIds = {};

  for (let index = 0; index < remoteConfig.sources.length; index++) {
    const sourceConfig = remoteConfig.sources[index];
    if (!sourceConfig || sourceConfig.enabled !== true) continue;

    const source = sourceConfig.id
      ? Game.getObjectById(sourceConfig.id)
      : null;
    if (!source || source.energy <= 0) continue;

    sources.push(source);
    sourceIds[source.id] = true;
  }

  const visibleSources = creep.room.find(FIND_SOURCES);
  for (let index = 0; index < visibleSources.length; index++) {
    const source = visibleSources[index];
    if (source.energy <= 0 || sourceIds[source.id]) continue;
    sources.push(source);
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

  const structures = creep.room.find(FIND_STRUCTURES);
  for (let index = 0; index < structures.length; index++) {
    if (
      structures[index].structureType === STRUCTURE_CONTAINER &&
      structures[index].store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      return structures[index];
    }
  }

  return null;
}

function acquireEnergy(creep, remoteConfig) {
  if (creep.pos.roomName === creep.memory.remoteRoom) {
    const remoteEnergy = findRemoteEnergy(creep, remoteConfig);
    if (remoteEnergy) {
      delete creep.memory.needsHomeEnergy;
      creep.memory.task = remoteEnergy.type === 'pickup'
        ? 'pickup:remote-energy'
        : 'withdraw:remote-energy';
      const result = remoteEnergy.type === 'pickup'
        ? creep.pickup(remoteEnergy.target)
        : creep.withdraw(remoteEnergy.target, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(remoteEnergy.target, { reusePath: 10 });
      }
      return;
    }

    const source = findRemoteSource(creep, remoteConfig);
    if (source) {
      delete creep.memory.needsHomeEnergy;
      creep.memory.task = 'harvest:remote-source';
      const result = creep.harvest(source);
      if (result === ERR_NOT_IN_RANGE) {
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
      const homeEnergy = findHomeEnergy(creep);
      if (homeEnergy) {
        creep.memory.task = 'withdraw:home-energy-fallback';
        const result = creep.withdraw(homeEnergy, RESOURCE_ENERGY);
        if (result === OK) {
          delete creep.memory.needsHomeEnergy;
        } else if (result === ERR_NOT_IN_RANGE) {
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

  const targetRoom = creep.memory.needsHomeEnergy
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
    const homeRoom = creep.memory.homeRoom;
    const remoteRoom = creep.memory.remoteRoom;
    const remoteConfig = remote.getRemoteConfig(homeRoom, remoteRoom);

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

    const work = getRemoteWork(remoteConfig);
    if (!work) {
      retireToHomeBuilder(creep);
      return;
    }

    const result = work.type === 'build'
      ? creep.build(work.target)
      : creep.repair(work.target);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(work.target, { reusePath: 10 });
    }
  }
};
