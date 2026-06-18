const economy = require('manager.economy');
const remote = require('manager.remote');

function closestTarget(creep, targets) {
  if (targets.length === 0) return null;
  return (
    creep.pos.findClosestByPath(targets) ||
    creep.pos.findClosestByRange(targets) ||
    targets[0]
  );
}

function findHomeDeliveryTarget(creep) {
  const myStructures = creep.room.find(FIND_MY_STRUCTURES);
  const spawnTargets = [];
  const towerTargets = [];
  const controllerContainer = economy.getControllerContainer(creep.room);

  for (let index = 0; index < myStructures.length; index++) {
    const structure = myStructures[index];
    if (!structure.store) continue;
    if (structure.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) continue;

    if (
      structure.structureType === STRUCTURE_SPAWN ||
      structure.structureType === STRUCTURE_EXTENSION
    ) {
      spawnTargets.push(structure);
    } else if (
      structure.structureType === STRUCTURE_TOWER &&
      structure.store.getUsedCapacity(RESOURCE_ENERGY) <
        remote.TOWER_LOW_ENERGY
    ) {
      towerTargets.push(structure);
    }
  }

  if (spawnTargets.length > 0) {
    return closestTarget(creep, spawnTargets);
  }
  if (towerTargets.length > 0) {
    return closestTarget(creep, towerTargets);
  }
  if (
    creep.room.storage &&
    creep.room.storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  ) {
    return creep.room.storage;
  }

  const structures = creep.room.find(FIND_STRUCTURES);
  const containerTargets = [];
  for (let index = 0; index < structures.length; index++) {
    const structure = structures[index];
    if (structure.structureType !== STRUCTURE_CONTAINER) continue;
    if (!structure.store) continue;
    if (structure.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) continue;
    if (controllerContainer && structure.id === controllerContainer.id) {
      continue;
    }
    containerTargets.push(structure);
  }
  if (containerTargets.length > 0) {
    return closestTarget(creep, containerTargets);
  }
  if (
    controllerContainer &&
    controllerContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  ) {
    return controllerContainer;
  }

  return null;
}

function waitAtHome(creep) {
  const spawns = creep.room.find(FIND_MY_SPAWNS);
  const target = creep.room.storage || spawns[0] || null;
  if (target && creep.pos.getRangeTo(target) > 3) {
    creep.moveTo(target, { reusePath: 10 });
  }
}

function deliver(creep) {
  if (creep.pos.roomName !== creep.memory.homeRoom) {
    creep.moveTo(
      new RoomPosition(25, 25, creep.memory.homeRoom),
      { reusePath: 20 }
    );
    return;
  }

  const target = findHomeDeliveryTarget(creep);
  if (!target) {
    waitAtHome(creep);
    return;
  }

  const result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 10 });
  }
}

function selectNearbySalvage(creep, sourceConfig) {
  const dropped = creep.room.find(FIND_DROPPED_RESOURCES);
  let selected = null;

  for (let index = 0; index < dropped.length; index++) {
    const resource = dropped[index];
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
      selected = {
        target: resource,
        type: 'pickup'
      };
    }
  }
  if (selected) return selected;

  const tombstones = creep.room.find(FIND_TOMBSTONES);
  for (let index = 0; index < tombstones.length; index++) {
    const tombstone = tombstones[index];
    if (
      tombstone.pos.getRangeTo(
        sourceConfig.containerX,
        sourceConfig.containerY
      ) <= 2 &&
      tombstone.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      return {
        target: tombstone,
        type: 'withdraw'
      };
    }
  }

  const ruins = creep.room.find(FIND_RUINS);
  for (let index = 0; index < ruins.length; index++) {
    const ruin = ruins[index];
    if (
      ruin.pos.getRangeTo(
        sourceConfig.containerX,
        sourceConfig.containerY
      ) <= 2 &&
      ruin.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      return {
        target: ruin,
        type: 'withdraw'
      };
    }
  }

  return null;
}

function collect(creep, sourceConfig) {
  const containerPosition = new RoomPosition(
    sourceConfig.containerX,
    sourceConfig.containerY,
    sourceConfig.roomName
  );

  if (creep.pos.roomName !== sourceConfig.roomName) {
    creep.moveTo(containerPosition, {
      range: 1,
      reusePath: 20
    });
    return;
  }

  if (
    creep.pos.x === sourceConfig.containerX &&
    creep.pos.y === sourceConfig.containerY
  ) {
    creep.moveTo(remote.getWaitPosition(sourceConfig), {
      reusePath: 5
    });
    return;
  }

  if (creep.pos.getRangeTo(containerPosition) > 1) {
    creep.moveTo(containerPosition, {
      range: 1,
      reusePath: 20
    });
    return;
  }

  const container = remote.findContainerAt(
    sourceConfig.roomName,
    sourceConfig.containerX,
    sourceConfig.containerY
  );
  if (
    container &&
    container.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  ) {
    creep.withdraw(container, RESOURCE_ENERGY);
    return;
  }

  const salvage = selectNearbySalvage(creep, sourceConfig);
  if (salvage) {
    const result = salvage.type === 'pickup'
      ? creep.pickup(salvage.target)
      : creep.withdraw(salvage.target, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(salvage.target, { reusePath: 5 });
    }
    return;
  }

  const waitPosition = remote.getWaitPosition(sourceConfig);
  if (creep.pos.getRangeTo(waitPosition) > 0) {
    creep.moveTo(waitPosition, { reusePath: 5 });
  }
}

module.exports = {
  run: function (creep) {
    const homeRoom = creep.memory.homeRoom;
    const remoteRoom = creep.memory.remoteRoom;
    const sourceConfig = remote.getSourceConfig(
      homeRoom,
      remoteRoom,
      creep.memory.sourceIndex
    );

    if (!sourceConfig || sourceConfig.enabled !== true) {
      remote.retreat(creep, homeRoom);
      return;
    }
    if (remote.isRemotePaused(homeRoom, remoteRoom)) {
      remote.retreat(creep, homeRoom);
      return;
    }

    if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
      creep.memory.delivering = true;
    }
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      creep.memory.delivering = false;
    }

    if (creep.memory.delivering) {
      deliver(creep);
      return;
    }

    collect(creep, sourceConfig);
  }
};
