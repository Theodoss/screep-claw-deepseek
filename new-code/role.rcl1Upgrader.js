const support = require('role.support');
const sourceSlots = require('manager.rcl1SourceSlots');
const economy = require('manager.economy');

function getFallbackSource(creep) {
  return sourceSlots.selectSourceForSupport(creep.room, creep);
}

function acquireFallbackEnergy(creep) {
  const source = getFallbackSource(creep);
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

    const economyState = economy.getState(creep.room);
    if (creep.memory.working) {
      if (economyState.recovery) {
        support.runRecoveryWork(creep);
      } else {
        support.runUpgraderWork(creep);
      }
      return;
    }

    // Preferred: any upgrade container (within 4 tiles of controller)
    const upgradeContainers = economy.getUpgradeContainers(creep.room);
    if (
      !economyState.recovery &&
      upgradeContainers.length > 0
    ) {
      // Pick the fullest upgrade container
      let selected = upgradeContainers[0];
      for (let i = 1; i < upgradeContainers.length; i++) {
        if (
          upgradeContainers[i].store.getUsedCapacity(RESOURCE_ENERGY) >
          selected.store.getUsedCapacity(RESOURCE_ENERGY)
        ) {
          selected = upgradeContainers[i];
        }
      }

      if (selected.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        creep.memory.task = 'withdraw:upgrade-container';
        const result = creep.withdraw(selected, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(selected, {
            visualizePathStyle: { stroke: '#ffaa00' }
          });
        }
        return;
      }
    }

    // Recovery or low RCL: harvest directly from source
    if (
      economyState.recovery ||
      !creep.room.controller ||
      creep.room.controller.level < 2
    ) {
      creep.memory.task = 'harvest:recovery-fallback';
      acquireFallbackEnergy(creep);
      return;
    }

    // Spawn/extensions before storage: they are closer to the controller
    // and faster to reach.  Walking to a distant storage while extensions
    // have energy wastes upgrader uptime.
    const spawnExt = creep.pos.findClosestByPath(
      FIND_MY_STRUCTURES,
      {
        filter: function (structure) {
          return (
            structure.structureType === STRUCTURE_SPAWN ||
            structure.structureType === STRUCTURE_EXTENSION
          ) &&
          structure.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
        }
      }
    );
    if (spawnExt) {
      creep.memory.task = 'withdraw:spawn-fallback';
      const result = creep.withdraw(spawnExt, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(spawnExt, {
          visualizePathStyle: { stroke: '#ffaa00' }
        });
      }
      return;
    }

    // Storage fallback (usually farther, deeper energy reserve)
    const storage = creep.room.storage;
    if (
      storage &&
      storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.memory.task = 'withdraw:storage-fallback';
      const result = creep.withdraw(storage, RESOURCE_ENERGY);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, {
          visualizePathStyle: { stroke: '#ffaa00' }
        });
      }
      return;
    }

    creep.memory.task = 'idle:no-energy-source';
  }
};
