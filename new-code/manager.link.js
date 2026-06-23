/**
 * manager.link.js — W49N25 three-link dynamic balancing system
 *
 * Link IDs:
 *   upgraderLink: 6a3a1ef8a2efc749fc787c05
 *   storageLink:  6a3a1b8cd95da3a3fde03bb5
 *   doorLink:     6a365015c5a7673e2ea6a3d0
 *
 * Rules:
 *   1. DoorLink → upgraderLink (priority), fallback → storageLink
 *   2. StorageLink → upgraderLink ONLY when upgraderLink < 200
 *      AND doorLink did NOT send to upgraderLink this tick
 *   3. All transfers check null, cooldown, freeCapacity, source≠target
 */

var DEBUG = false;

var LINK_IDS = {
  upgrader: '6a3a1ef8a2efc749fc787c05',
  storage:  '6a3a1b8cd95da3a3fde03bb5',
  door:     '6a365015c5a7673e2ea6a3d0'
};

function getLinkById(id) {
  return Game.getObjectById(id) || null;
}

function transferIfPossible(from, to) {
  if (!from || !to) return ERR_INVALID_TARGET;
  if (from.id === to.id) return ERR_INVALID_TARGET;
  if (from.cooldown > 0) return ERR_TIRED;
  if (to.store.getFreeCapacity(RESOURCE_ENERGY) <= 0) return ERR_FULL;

  var amount = Math.min(
    from.store.getUsedCapacity(RESOURCE_ENERGY),
    to.store.getFreeCapacity(RESOURCE_ENERGY)
  );
  if (amount <= 0) return ERR_NOT_ENOUGH_ENERGY;

  return from.transferEnergy(to, amount);
}

function ensureRoomMemory(roomName) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};
  var mem = Memory.rooms[roomName];
  if (!mem.links) mem.links = {};
  return mem.links;
}

// ---------------------------------------------------------------------------
// Door Link logic
// ---------------------------------------------------------------------------

function runDoorLink(room, upgraderLink, storageLink, doorLink, mem) {
  if (!doorLink) return;

  var doorEnergy = doorLink.store.getUsedCapacity(RESOURCE_ENERGY);
  if (doorEnergy <= 0) return;
  if (doorLink.cooldown > 0) return;

  // 1) Try upgraderLink first
  if (upgraderLink && upgraderLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    var result = transferIfPossible(doorLink, upgraderLink);
    if (result === OK) {
      mem.doorSentTo = 'upgrader';
      mem.doorSentTick = Game.time;
      if (DEBUG) console.log('[link] door → upgrader (' + doorEnergy + ')');
      return;
    }
  }

  // 2) Fallback to storageLink
  if (storageLink && storageLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
    var result2 = transferIfPossible(doorLink, storageLink);
    if (result2 === OK) {
      mem.doorSentTo = 'storage';
      mem.doorSentTick = Game.time;
      if (DEBUG) console.log('[link] door → storage (' + doorEnergy + ')');
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Storage Link logic
// ---------------------------------------------------------------------------

function runStorageLink(room, upgraderLink, storageLink, mem) {
  if (!storageLink) return;
  if (storageLink.cooldown > 0) return;

  var storageEnergy = storageLink.store.getUsedCapacity(RESOURCE_ENERGY);
  if (storageEnergy < 400) return;

  // Only send if upgraderLink is critically low
  if (!upgraderLink) return;
  if (upgraderLink.store.getUsedCapacity(RESOURCE_ENERGY) >= 200) return;

  // Avoid same-tick double-send: if doorLink already sent to upgraderLink
  // this tick, skip storageLink→upgraderLink
  if (mem.doorSentTo === 'upgrader' && mem.doorSentTick === Game.time) {
    return;
  }

  var result = transferIfPossible(storageLink, upgraderLink);
  if (result === OK) {
    if (DEBUG) console.log('[link] storage → upgrader (' + storageEnergy + ')');
    return;
  }
}

// ---------------------------------------------------------------------------
// run — per-tick entry point
// ---------------------------------------------------------------------------

function run(room) {
  if (!room || room.name !== 'W49N25') return;

  var mem = ensureRoomMemory(room.name);

  var upgraderLink = getLinkById(LINK_IDS.upgrader);
  var storageLink  = getLinkById(LINK_IDS.storage);
  var doorLink     = getLinkById(LINK_IDS.door);

  // Reset door-sent-tick if stale (not this tick)
  if (mem.doorSentTick !== Game.time) {
    mem.doorSentTo = null;
  }

  // Door link runs first to claim priority
  runDoorLink(room, upgraderLink, storageLink, doorLink, mem);

  // Storage link runs second, respects door's priority
  runStorageLink(room, upgraderLink, storageLink, mem);
}

// ---------------------------------------------------------------------------
// debug — console inspection helpers
// ---------------------------------------------------------------------------

function inspectAll() {
  var links = {
    upgrader: getLinkById(LINK_IDS.upgrader),
    storage:  getLinkById(LINK_IDS.storage),
    door:     getLinkById(LINK_IDS.door)
  };

  for (var key in links) {
    var link = links[key];
    if (!link) {
      console.log('[link] ' + key + ': MISSING');
    } else {
      console.log('[link] ' + key + ': energy=' +
        link.store.getUsedCapacity(RESOURCE_ENERGY) + '/' +
        link.store.getCapacity(RESOURCE_ENERGY) +
        ' cooldown=' + link.cooldown);
    }
  }
}

function inspectUpgraderContainer(roomName) {
  var room = Game.rooms[roomName];
  if (!room || !room.controller) {
    console.log('[link] no vision on ' + roomName);
    return;
  }
  var economy = require('manager.economy');
  var container = economy.getControllerContainer(room);
  if (!container) {
    console.log('[link] no controller container in ' + roomName);
    return;
  }
  console.log('[link] controller container: energy=' +
    container.store.getUsedCapacity(RESOURCE_ENERGY) + '/' +
    container.store.getCapacity(RESOURCE_ENERGY));
}

module.exports = {
  run: run,
  getLinkById: getLinkById,
  LINK_IDS: LINK_IDS,
  inspectAll: inspectAll,
  inspectUpgraderContainer: inspectUpgraderContainer
};
