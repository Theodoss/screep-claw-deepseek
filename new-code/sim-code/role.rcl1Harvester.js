const sourceSlots = require('manager.rcl1SourceSlots');
const support = require('role.support');
const economy = require('manager.economy');

function selectDroppedEnergy(creep) {
  const resources = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: resource =>
      resource.resourceType === RESOURCE_ENERGY &&
      resource.amount > 0
  });
  if (resources.length === 0) return null;

  return (
    creep.pos.findClosestByPath(resources) ||
    creep.pos.findClosestByRange(resources)
  );
}

function selectSourceContainer(creep) {
  const roomMemory = Memory.rooms && Memory.rooms[creep.room.name];
  const sourceMemory = roomMemory && roomMemory.sources
    ? roomMemory.sources
    : {};
  const containers = [];

  for (const sourceId in sourceMemory) {
    const entry = sourceMemory[sourceId];
    if (!entry.containerReady || !entry.containerId) continue;

    const container = Game.getObjectById(entry.containerId);
    if (
      container &&
      container.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      containers.push(container);
    }
  }

  if (containers.length === 0) return null;
  return (
    creep.pos.findClosestByPath(containers) ||
    creep.pos.findClosestByRange(containers)
  );
}

function acquireLooseEnergy(creep) {
  const dropped = selectDroppedEnergy(creep);
  if (dropped) {
    creep.memory.task = 'pickup:dropped-energy';
    const result = creep.pickup(dropped);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(dropped, {
        visualizePathStyle: { stroke: '#ffaa00' }
      });
    }
    return true;
  }

  const container = selectSourceContainer(creep);
  if (!container) return false;

  creep.memory.task = 'withdraw:source-container';
  const result = creep.withdraw(container, RESOURCE_ENERGY);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(container, {
      visualizePathStyle: { stroke: '#ffaa00' }
    });
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
    }

    if (
      !creep.memory.working &&
      creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    ) {
      creep.memory.working = true;
    }

    const source = sourceSlots.assignRcl1Harvester(creep.room, creep);

    if (creep.memory.working) {
      if (!support.runHarvesterWork(creep)) {
        creep.memory.task = 'idle:no-work-target';
      }
      return;
    }

    if (acquireLooseEnergy(creep)) return;

    if (!source || !creep.memory.harvestPos) {
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        creep.memory.working = true;
        creep.memory.task = 'switch:deliver';
      } else {
        creep.memory.task = 'idle:no-energy-source';
      }
      return;
    }

    const harvestPos = creep.memory.harvestPos;
    if (
      creep.pos.x !== harvestPos.x ||
      creep.pos.y !== harvestPos.y ||
      creep.pos.roomName !== harvestPos.roomName
    ) {
      creep.moveTo(
        new RoomPosition(harvestPos.x, harvestPos.y, harvestPos.roomName),
        { visualizePathStyle: { stroke: '#ffaa00' } }
      );
      creep.memory.task = 'move:harvest-position';
      return;
    }

    const harvested = Math.min(
      source.energy,
      creep.getActiveBodyparts(WORK) * HARVEST_POWER
    );
    const result = creep.harvest(source);
    creep.memory.task = 'harvest:source';
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(
        new RoomPosition(harvestPos.x, harvestPos.y, harvestPos.roomName),
        { visualizePathStyle: { stroke: '#ffaa00' } }
      );
    } else if (result === ERR_INVALID_TARGET) {
      sourceSlots.clearAssignment(creep.room, creep);
    } else if (result === OK) {
      economy.recordHarvest(creep.room.name, harvested);
    } else if (
      result === ERR_NOT_ENOUGH_RESOURCES &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.memory.working = true;
      creep.memory.task = 'switch:deliver';
    }
  }
};
