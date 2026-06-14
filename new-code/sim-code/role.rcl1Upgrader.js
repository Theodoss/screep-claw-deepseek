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

    const controllerContainer = economy.getControllerContainer(creep.room);
    if (controllerContainer && !economyState.recovery) {
      if (
        controllerContainer.store.getUsedCapacity(RESOURCE_ENERGY) === 0
      ) {
        creep.memory.task = 'idle:controller-container-empty';
        return;
      }

      creep.memory.task = 'withdraw:controller-container';
      const result = creep.withdraw(
        controllerContainer,
        RESOURCE_ENERGY
      );
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(controllerContainer, {
          visualizePathStyle: { stroke: '#ffaa00' }
        });
      }
      return;
    }

    if (
      economyState.recovery ||
      !creep.room.controller ||
      creep.room.controller.level < 2
    ) {
      creep.memory.task = 'harvest:recovery-fallback';
      acquireFallbackEnergy(creep);
    } else {
      creep.memory.task = 'idle:no-controller-container';
    }
  }
};
