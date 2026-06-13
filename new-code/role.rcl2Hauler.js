const economy = require('manager.economy');

const TOWER_PEACE_RESERVE = 600;

function getRoomSourceMemory(creep) {
  if (!Memory.rooms || !Memory.rooms[creep.memory.home]) return {};
  return Memory.rooms[creep.memory.home].sources || {};
}

function getSourceContainers(creep) {
  const sourceMemory = getRoomSourceMemory(creep);
  const containers = [];

  for (const sourceId in sourceMemory) {
    const entry = sourceMemory[sourceId];
    if (!entry.containerReady || !entry.containerId) continue;

    const container = Game.getObjectById(entry.containerId);
    if (container) containers.push(container);
  }

  return containers;
}

function selectSalvage(creep) {
  const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: resource =>
      resource.resourceType === RESOURCE_ENERGY &&
      resource.amount >= Math.min(50, freeCapacity)
  });
  const tombstones = creep.room.find(FIND_TOMBSTONES, {
    filter: tombstone =>
      tombstone.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  const ruins = creep.room.find(FIND_RUINS, {
    filter: ruin => ruin.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  const targets = [];

  for (const resource of dropped) {
    targets.push({
      target: resource,
      type: 'pickup',
      score: resource.amount - creep.pos.getRangeTo(resource) * 20
    });
  }
  for (const tombstone of tombstones) {
    const amount = tombstone.store.getUsedCapacity(RESOURCE_ENERGY);
    targets.push({
      target: tombstone,
      type: 'withdraw',
      score: amount - creep.pos.getRangeTo(tombstone) * 20
    });
  }
  for (const ruin of ruins) {
    const amount = ruin.store.getUsedCapacity(RESOURCE_ENERGY);
    targets.push({
      target: ruin,
      type: 'withdraw',
      score: amount - creep.pos.getRangeTo(ruin) * 20
    });
  }

  targets.sort((left, right) => right.score - left.score);
  return targets.length > 0 && targets[0].score > 0
    ? targets[0]
    : null;
}

function selectPickupContainer(creep) {
  if (creep.memory.containerId) {
    const remembered = Game.getObjectById(creep.memory.containerId);
    if (
      remembered &&
      remembered.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      return remembered;
    }

    delete creep.memory.containerId;
  }

  const containers = getSourceContainers(creep);
  if (containers.length === 0) return null;

  let selected = containers[0];
  for (const container of containers) {
    if (
      container.store.getUsedCapacity(RESOURCE_ENERGY) >
      selected.store.getUsedCapacity(RESOURCE_ENERGY)
    ) {
      selected = container;
    }
  }

  creep.memory.containerId = selected.id;
  return selected;
}

function selectPickup(creep) {
  return selectSalvage(creep) || {
    target: selectPickupContainer(creep),
    type: 'withdraw'
  };
}

function findSpawnOrExtension(creep) {
  const targets = creep.room.find(FIND_MY_STRUCTURES, {
    filter: structure =>
      (
        structure.structureType === STRUCTURE_SPAWN ||
        structure.structureType === STRUCTURE_EXTENSION
      ) &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  });
  if (targets.length === 0) return null;

  return creep.pos.findClosestByPath(targets);
}

function findTower(creep) {
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  const targets = creep.room.find(FIND_MY_STRUCTURES, {
    filter: structure =>
      structure.structureType === STRUCTURE_TOWER &&
      structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
      (
        hostiles.length > 0 ||
        structure.store.getUsedCapacity(RESOURCE_ENERGY) <
          TOWER_PEACE_RESERVE
      )
  });
  if (targets.length === 0) return null;

  return creep.pos.findClosestByPath(targets);
}

function findControllerContainer(creep) {
  const state = economy.getState(creep.room);
  if (
    state.recovery ||
    (state.upgraderWorkTarget || 0) <= 0
  ) {
    return null;
  }

  const container = economy.getControllerContainer(creep.room);
  if (
    !container ||
    container.store.getFreeCapacity(RESOURCE_ENERGY) <= 0
  ) {
    return null;
  }

  return container;
}

function findEnergyTarget(creep) {
  if (economy.controllerEmergency(creep.room)) {
    const controllerContainer = economy.getControllerContainer(creep.room);
    if (
      controllerContainer &&
      controllerContainer.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      return controllerContainer;
    }
  }

  return (
    findSpawnOrExtension(creep) ||
    findTower(creep) ||
    findControllerContainer(creep)
  );
}

function deliver(creep) {
  const target = findEnergyTarget(creep);
  if (!target) {
    const canBufferMore =
      creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
      getSourceContainers(creep).some(
        container =>
          container.store.getUsedCapacity(RESOURCE_ENERGY) > 0
      );

    if (canBufferMore) {
      creep.memory.working = false;
      delete creep.memory.containerId;
      creep.memory.task = 'return:source-buffer';
    } else {
      creep.memory.task = 'idle:all-energy-targets-full';
    }
    return false;
  }

  creep.memory.task = `transfer:${target.structureType}`;
  const result = creep.transfer(target, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
  }
  return true;
}

module.exports = {
  run: function (creep) {
    if (
      creep.memory.working &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = false;
      delete creep.memory.containerId;
    }

    if (
      !creep.memory.working &&
      creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = true;
    }

    if (creep.memory.working) {
      deliver(creep);
      return;
    }

    const pickup = selectPickup(creep);
    if (!pickup.target) {
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        creep.memory.working = true;
        deliver(creep);
      } else {
        creep.memory.task = 'idle:no-source-energy';
      }
      return;
    }

    creep.memory.task = pickup.type === 'pickup'
      ? 'pickup:dropped-energy'
      : 'withdraw:source-container';
    const result = pickup.type === 'pickup'
      ? creep.pickup(pickup.target)
      : creep.withdraw(pickup.target, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(pickup.target, {
        visualizePathStyle: { stroke: '#ffaa00' }
      });
    }
  }
};
