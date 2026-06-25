/**
 * role.storageLinkBalancer.js
 *
 * Fixed position: W49N25 17,28
 * Body: [CARRY, CARRY] (no MOVE)
 *
 * Jobs:
 *   1. Storage Link → Storage (primary, one-way)
 *   2. Storage → nearby Tower / Spawn (secondary, when they need energy)
 */

var linkConfig = require('config.W49N25Links');

var lastWarning = {};

function logRateLimited(key, message) {
  if (!lastWarning[key] || Game.time - lastWarning[key] > 100) {
    lastWarning[key] = Game.time;
    console.log(message);
  }
}

function getNearbyTowerOrSpawn(creep) {
  var targets = creep.room.find(FIND_MY_STRUCTURES, {
    filter: function (s) {
      if (!s.store) return false;
      if (creep.pos.getRangeTo(s) > 1) return false;

      if (s.structureType === STRUCTURE_TOWER) {
        return s.store.getUsedCapacity(RESOURCE_ENERGY) < 500;
      }
      if (s.structureType === STRUCTURE_SPAWN) {
        return s.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
      }
      return false;
    }
  });

  if (targets.length === 0) return null;

  // Prioritize tower first, then spawn
  for (var i = 0; i < targets.length; i++) {
    if (targets[i].structureType === STRUCTURE_TOWER) return targets[i];
  }
  return targets[0];
}

module.exports = {
  run: function (creep) {
    var storageLink = Game.getObjectById(linkConfig.storageLinkId);
    var storage = creep.room.storage;

    if (!storageLink || !storage) {
      return;
    }

    // Verify position
    if (
      creep.room.name !== linkConfig.roomName ||
      creep.pos.x !== 17 ||
      creep.pos.y !== 28
    ) {
      logRateLimited(
        'storageLinkBalancer-position',
        '[storageLinkBalancer] ' + creep.name +
        ' is not at W49N25 17,28'
      );
      return;
    }

    var carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);

    // ── Carrying energy ──
    if (carried > 0) {
      // Priority 1: fill nearby tower (if low)
      var towerTarget = getNearbyTowerOrSpawn(creep);
      if (towerTarget) {
        creep.transfer(towerTarget, RESOURCE_ENERGY);
        return;
      }

      // Priority 2: transfer to Storage
      if (storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        creep.transfer(storage, RESOURCE_ENERGY);
      }
      return;
    }

    // ── Empty: get energy ──

    // Priority 1: serve nearby tower/spawn from Storage
    var serviceTarget = getNearbyTowerOrSpawn(creep);
    if (
      serviceTarget &&
      storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.withdraw(storage, RESOURCE_ENERGY);
      return;
    }

    // Priority 2: withdraw from Storage Link → Storage
    if (
      storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
      storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.withdraw(storageLink, RESOURCE_ENERGY);
    }
  }
};
