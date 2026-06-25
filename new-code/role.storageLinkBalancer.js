/**
 * role.storageLinkBalancer.js
 *
 * Fixed position: W49N25 17,28
 * Body: [CARRY, CARRY] (no MOVE)
 * Only job: Storage Link → Storage (one-way)
 */

var linkConfig = require('config.W49N25Links');

var lastWarning = {};

function logRateLimited(key, message) {
  if (!lastWarning[key] || Game.time - lastWarning[key] > 100) {
    lastWarning[key] = Game.time;
    console.log(message);
  }
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

    // Priority 1: transfer to Storage
    if (carried > 0) {
      if (storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        creep.transfer(storage, RESOURCE_ENERGY);
      }
      return;
    }

    // Priority 2: withdraw from Storage Link
    if (
      storage.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
      storageLink.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.withdraw(storageLink, RESOURCE_ENERGY);
    }
  }
};
