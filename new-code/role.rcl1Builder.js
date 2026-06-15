const support = require('role.support');
const sourceSlots = require('manager.rcl1SourceSlots');
const economy = require('manager.economy');

function scoreEnergyTarget(creep, target, amount) {
  return amount - creep.pos.getRangeTo(target) * 20;
}

function selectSalvageTarget(creep) {
  const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);
  const targets = [];
  const dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: resource =>
      resource.resourceType === RESOURCE_ENERGY &&
      resource.amount >= Math.min(25, freeCapacity)
  });
  const tombstones = creep.room.find(FIND_TOMBSTONES, {
    filter: tombstone =>
      tombstone.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  const ruins = creep.room.find(FIND_RUINS, {
    filter: ruin => ruin.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });

  for (const resource of dropped) {
    targets.push({
      target: resource,
      type: 'pickup',
      score: scoreEnergyTarget(creep, resource, resource.amount)
    });
  }
  for (const tombstone of tombstones) {
    const amount = tombstone.store.getUsedCapacity(RESOURCE_ENERGY);
    targets.push({
      target: tombstone,
      type: 'withdraw',
      score: scoreEnergyTarget(creep, tombstone, amount)
    });
  }
  for (const ruin of ruins) {
    const amount = ruin.store.getUsedCapacity(RESOURCE_ENERGY);
    targets.push({
      target: ruin,
      type: 'withdraw',
      score: scoreEnergyTarget(creep, ruin, amount)
    });
  }

  targets.sort((left, right) => right.score - left.score);
  return targets.length > 0 && targets[0].score > 0
    ? targets[0]
    : null;
}

function selectContainer(creep) {
  const controllerContainer = economy.getControllerContainer(creep.room);
  const containers = creep.room.find(FIND_STRUCTURES, {
    filter: structure =>
      structure.structureType === STRUCTURE_CONTAINER &&
      (!controllerContainer || structure.id !== controllerContainer.id) &&
      structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0
  });
  if (containers.length === 0) return null;

  return creep.pos.findClosestByPath(containers);
}

function getSource(creep) {
  return sourceSlots.selectSourceForSupport(creep.room, creep);
}

function acquireEnergy(creep) {
  const salvage = selectSalvageTarget(creep);
  if (salvage) {
    const result = salvage.type === 'pickup'
      ? creep.pickup(salvage.target)
      : creep.withdraw(salvage.target, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(salvage.target, {
        visualizePathStyle: { stroke: '#ffaa00' }
      });
    }
    return;
  }

  const container = selectContainer(creep);
  if (container) {
    const result = creep.withdraw(container, RESOURCE_ENERGY);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(container, {
        visualizePathStyle: { stroke: '#ffaa00' }
      });
    }
    return;
  }

  const source = getSource(creep);
  if (!source) return;

  const harvested = Math.min(
    source.energy,
    creep.getActiveBodyparts(WORK) * HARVEST_POWER
  );
  const result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
  } else if (result === OK) {
    economy.recordHarvest(creep.room.name, harvested);
  }
}

module.exports = {
  run: function (creep) {
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

    // If we're carrying meaningful energy and no easy sources are
    // available (containers dry, no salvage), switch to working early
    // instead of waiting to fill 100%.  Otherwise the builder wastes
    // ticks trying to top off from nearly-empty containers while
    // upgradeable energy goes unused.
    if (
      !creep.memory.working &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 50
    ) {
      const salvage = selectSalvageTarget(creep);
      if (!salvage || !salvage.target) {
        const container = selectContainer(creep);
        if (!container) {
          creep.memory.working = true;
        }
      }
    }

    if (creep.memory.working) {
      support.runBuilderWork(creep);
      return;
    }

    acquireEnergy(creep);
  }
};
