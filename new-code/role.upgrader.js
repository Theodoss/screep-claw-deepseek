/**
 * role.upgrader.js — controller upgrader
 *
 * Energy priority:
 *   1. Upgrader Link (if adjacent)
 *   2. Upgrader Container
 *   3. Existing fallbacks (spawn/ext/storage/source containers)
 *
 * If creep has energy at start of tick, upgrade first then withdraw.
 */

var support = require('role.support');
var sourceSlots = require('manager.rcl1SourceSlots');
var economy = require('manager.economy');
var colonyStates = require('config.colonyStates');
var linkManager = require('manager.link');
var linkConfig = require('config.W49N25Links');

function getFallbackSource(creep) {
  return sourceSlots.selectSourceForSupport(creep.room, creep);
}

function acquireFallbackEnergy(creep) {
  var source = getFallbackSource(creep);
  if (!source) return;

  var harvested = Math.min(
    source.energy,
    creep.getActiveBodyparts(WORK) * HARVEST_POWER
  );
  var result = creep.harvest(source);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
  } else if (result === OK) {
    economy.recordHarvest(creep.room.name, harvested);
  }
}

function getLocalLink(link, roomName) {
  if (!link || !link.pos || link.pos.roomName !== roomName) return null;
  return link;
}

module.exports = {
  run: function (creep) {
    var homeRoomName = creep.memory.home || creep.memory.homeRoom;
    if (homeRoomName && creep.room.name !== homeRoomName) {
      creep.memory.task = 'travel:home-room';
      creep.moveTo(new RoomPosition(25, 25, homeRoomName), {
        reusePath: 20,
        visualizePathStyle: { stroke: '#ffaa00' }
      });
      return;
    }

    // ── Colony state / expansion guard ──
    var mission = Memory.expansionMission;
    var redirectEnergy =
      colonyStates.isUpgradeSuspended(creep.room.name) ||
      (mission &&
       mission.active &&
       mission.phase !== 'done' &&
       mission.home === creep.room.name);
    if (redirectEnergy) {
      var controllerEmergency =
        creep.room.controller &&
        typeof creep.room.controller.ticksToDowngrade === 'number' &&
        creep.room.controller.ticksToDowngrade < 4000;
      if (!controllerEmergency) {
        if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
          var target = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: function (s) {
              return (
                s.structureType === STRUCTURE_SPAWN ||
                s.structureType === STRUCTURE_EXTENSION
              ) && s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
          });
          if (target) {
            if (creep.transfer(target, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
              creep.moveTo(target);
            }
            return;
          }
        }
        return;
      }
    }

    // ── working state management ──
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

    var economyState = economy.getState(creep.room);
    var energyAtStart = creep.store.getUsedCapacity(RESOURCE_ENERGY);

    if (creep.memory.working) {
      // If has energy, upgrade first before any withdraw logic
      var controller = creep.room.controller;
      var canUpgrade = controller &&
        creep.pos.inRangeTo(controller, 3) &&
        energyAtStart > 0;

      if (canUpgrade) {
        creep.upgradeController(controller);
        creep.memory.task = 'upgrade:controller';
      }

      // Link → container fill (existing behavior)
      if (!economyState.recovery) {
        var fillLink = getLocalLink(
          linkManager.getLinkById(linkManager.LINK_IDS.upgrader),
          creep.room.name
        );
        var fillContainer = economy.getControllerContainer(creep.room);
        if (
          fillLink && fillContainer &&
          fillLink.store.getUsedCapacity(RESOURCE_ENERGY) >= 100 &&
          fillContainer.store.getUsedCapacity(RESOURCE_ENERGY) <
            fillContainer.store.getCapacity(RESOURCE_ENERGY) * 0.5 &&
          creep.pos.getRangeTo(fillContainer) <= 1 &&
          creep.pos.getRangeTo(fillLink) <= 3
        ) {
          if (creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
            creep.withdraw(fillLink, RESOURCE_ENERGY);
          }
          if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
            creep.memory.task = 'fill:controller-container';
            creep.transfer(fillContainer, RESOURCE_ENERGY);
          }
          return;
        }
      }

      if (canUpgrade) {
        // Already upgraded this tick, still try to fill container
        return;
      }

      if (economyState.recovery) {
        support.runRecoveryWork(creep);
      } else {
        support.runUpgraderWork(creep);
      }
      return;
    }

    // ── Not working: get energy ──

    // Priority 1: Upgrader Link (if adjacent in W49N25)
    if (!economyState.recovery && creep.room.name === linkConfig.roomName) {
      var upgraderLink = Game.getObjectById(linkConfig.upgraderLinkId);
      if (
        upgraderLink &&
        upgraderLink.pos.roomName === creep.room.name &&
        creep.pos.isNearTo(upgraderLink) &&
        upgraderLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
        creep.store.getFreeCapacity(RESOURCE_ENERGY) > 0
      ) {
        creep.memory.task = 'withdraw:upgrader-link';
        creep.withdraw(upgraderLink, RESOURCE_ENERGY);
        return;
      }
    }

    // Priority 2: Upgrader Link (any range — walk to it in W49N25)
    if (!economyState.recovery && creep.room.name === linkConfig.roomName) {
      var upgraderLink2 = Game.getObjectById(linkConfig.upgraderLinkId);
      if (
        upgraderLink2 &&
        upgraderLink2.store.getUsedCapacity(RESOURCE_ENERGY) > 0
      ) {
        creep.memory.task = 'withdraw:upgrader-link';
        var linkResult = creep.withdraw(upgraderLink2, RESOURCE_ENERGY);
        if (linkResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(upgraderLink2, {
            visualizePathStyle: { stroke: '#ffaa00' }
          });
          return;
        }
        if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
          return;
        }
      }
    }

    // Priority 3: Legacy link access (other rooms using old LINK_IDS)
    var legacyLink = getLocalLink(
      linkManager.getLinkById(linkManager.LINK_IDS.upgrader),
      creep.room.name
    );
    if (
      !economyState.recovery &&
      legacyLink &&
      legacyLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.memory.task = 'withdraw:upgrader-link';
      var legacyResult = creep.withdraw(legacyLink, RESOURCE_ENERGY);
      if (legacyResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(legacyLink, {
          visualizePathStyle: { stroke: '#ffaa00' }
        });
        return;
      }
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        return;
      }
    }

    // Priority 4: Upgrade containers (RCL≥3 only — RCL1-2 use spawn/ext below)
    var upgradeContainers = economy.getUpgradeContainers(creep.room);
    if (!economyState.recovery && creep.room.controller && creep.room.controller.level >= 3 && upgradeContainers.length > 0) {
      var selected = upgradeContainers[0];
      for (var i = 1; i < upgradeContainers.length; i++) {
        if (
          upgradeContainers[i].store.getUsedCapacity(RESOURCE_ENERGY) >
          selected.store.getUsedCapacity(RESOURCE_ENERGY)
        ) {
          selected = upgradeContainers[i];
        }
      }

      if (selected.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        creep.memory.task = 'withdraw:upgrade-container';
        var result = creep.withdraw(selected, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(selected, {
            visualizePathStyle: { stroke: '#ffaa00' }
          });
          return;
        }
        if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
          return;
        }
      }
    }

    // Fallbacks: recovery harvest, early RCL2, spawn/ext, source containers, storage
    if (
      economyState.recovery ||
      !creep.room.controller ||
      creep.room.controller.level < 2
    ) {
      creep.memory.task = 'harvest:recovery-fallback';
      acquireFallbackEnergy(creep);
      return;
    }

    if (
      creep.room.controller &&
      creep.room.controller.level <= 2 &&
      upgradeContainers.length === 0
    ) {
      var sourceContainersEarly = creep.room.find(FIND_STRUCTURES, {
        filter: function (s) {
          return s.structureType === STRUCTURE_CONTAINER &&
            s.store.getUsedCapacity(RESOURCE_ENERGY) > 0;
        }
      });

      if (sourceContainersEarly.length > 0) {
        var earlySource = creep.pos.findClosestByPath(sourceContainersEarly);
        if (earlySource) {
          creep.memory.task = 'withdraw:early-source-container';
          var earlyResult = creep.withdraw(earlySource, RESOURCE_ENERGY);
          if (earlyResult === ERR_NOT_IN_RANGE) {
            creep.moveTo(earlySource, {
              visualizePathStyle: { stroke: '#ffaa00' }
            });
          }
          return;
        }
      }

      creep.memory.task = 'harvest:early-upgrader-fallback';
      acquireFallbackEnergy(creep);
      return;
    }

    // Spawn/extensions
    var spawnExt = creep.pos.findClosestByPath(
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
      var seResult = creep.withdraw(spawnExt, RESOURCE_ENERGY);
      if (seResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(spawnExt, {
          visualizePathStyle: { stroke: '#ffaa00' }
        });
        return;
      }
      if (seResult === OK || seResult === ERR_FULL) {
        return;
      }
    }

    // Source containers
    var sourceContainers = creep.room.find(FIND_STRUCTURES, {
      filter: function (s) {
        return s.structureType === STRUCTURE_CONTAINER &&
          s.store.getUsedCapacity(RESOURCE_ENERGY) > 200;
      }
    });
    if (sourceContainers.length > 0) {
      var closestSource = creep.pos.findClosestByPath(sourceContainers);
      if (closestSource) {
        creep.memory.task = 'withdraw:source-container-fallback';
        var scResult = creep.withdraw(closestSource, RESOURCE_ENERGY);
        if (scResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(closestSource, {
            visualizePathStyle: { stroke: '#ffaa00' }
          });
        }
        return;
      }
    }

    // Storage
    var storage = creep.room.storage;
    if (storage && storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      creep.memory.task = 'withdraw:storage-fallback';
      var stResult = creep.withdraw(storage, RESOURCE_ENERGY);
      if (stResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(storage, {
          visualizePathStyle: { stroke: '#ffaa00' }
        });
      }
      return;
    }

    creep.memory.task = 'idle:no-energy-source';
  }
};
