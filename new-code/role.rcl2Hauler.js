const economy = require('manager.economy');
const logistics = require('logistics.local');

const TOWER_PEACE_RESERVE = 800;

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

function findPickupStorage(creep) {
  const storage = creep.room.storage;
  if (
    !storage ||
    storage.store.getUsedCapacity(RESOURCE_ENERGY) <= 0
  ) {
    return null;
  }

  return storage;
}

function selectPickup(creep) {
  const salvage = selectSalvage(creep);
  if (salvage) return salvage;

  const container = selectPickupContainer(creep);
  if (container) {
    return {
      target: container,
      type: 'withdraw'
    };
  }

  return {
    target: findPickupStorage(creep),
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

function findStorage(creep) {
  const storage = creep.room.storage;
  if (
    !storage ||
    storage.store.getFreeCapacity(RESOURCE_ENERGY) <= 0
  ) {
    return null;
  }

  return storage;
}

function findEnergyTarget(creep) {
  const state = economy.getState(creep.room);
  const controllerEmergency = economy.controllerEmergency(creep.room);
  if (controllerEmergency) {
    const controllerContainer = economy.getControllerContainer(creep.room);
    const emergencyRequest = logistics.getControllerDeliveryRequest(
      creep,
      controllerContainer,
      state,
      true
    );
    if (emergencyRequest) return emergencyRequest;
  }

  const spawnTarget = findSpawnOrExtension(creep);
  if (spawnTarget) {
    logistics.clearDeliveryAssignment(creep);
    return {
      target: spawnTarget,
      reason: spawnTarget.structureType
    };
  }

  const towerTarget = findTower(creep);
  if (towerTarget) {
    logistics.clearDeliveryAssignment(creep);
    return {
      target: towerTarget,
      reason: towerTarget.structureType
    };
  }

  if (!state.recovery && (state.upgraderWorkTarget || 0) > 0) {
    const controllerContainer = economy.getControllerContainer(creep.room);
    const controllerRequest = logistics.getControllerDeliveryRequest(
      creep,
      controllerContainer,
      state,
      false
    );
    if (controllerRequest) return controllerRequest;
  }

  logistics.clearDeliveryAssignment(creep);
  const storage = findStorage(creep);
  return storage
    ? {
        target: storage,
        reason: storage.structureType
      }
    : null;
}

function deliver(creep) {
  const request = findEnergyTarget(creep);
  if (!request) {
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

  creep.memory.task = `transfer:${request.reason}`;
  const result = request.amount === undefined
    ? creep.transfer(request.target, RESOURCE_ENERGY)
    : creep.transfer(
      request.target,
      RESOURCE_ENERGY,
      request.amount
    );
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(request.target, {
      visualizePathStyle: { stroke: '#ffffff' }
    });
  } else if (
    result === OK &&
    creep.memory.deliveryTargetId === request.target.id
  ) {
    creep.memory.deliveryIntentTick = Game.time;
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

    // Use 80% threshold like remoteHauler: switch to delivering when
    // near-full instead of walking to an empty source container.
    const used = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    const freeCap = creep.store.getFreeCapacity(RESOURCE_ENERGY);
    const totalCap = creep.store.getCapacity();

    if (
      !creep.memory.working &&
      (freeCap === 0 || (used > 0 && totalCap > 0 && freeCap / totalCap <= 0.2))
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
