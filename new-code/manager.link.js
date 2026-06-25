/**
 * manager.link.js — W49N25 Link transfer manager
 *
 * Single-direction energy flow:
 *   Door Link (full) → Upgrader Link (<10%) or Storage Link (<10%)
 *
 * Door Link only transfers when truly full and cooldown is 0.
 * Upgrader Link priority over Storage Link.
 * No pressure thresholds, no emergency drain, no 400-energy rules.
 */

var linkConfig = require('config.W49N25Links');

var lastWarning = {};

function logRateLimited(key, message) {
  if (!Memory.linkWarnings) Memory.linkWarnings = {};
  if (!Memory.linkWarnings[key] ||
      Game.time - Memory.linkWarnings[key] > 200) {
    Memory.linkWarnings[key] = Game.time;
    console.log(message);
  }
}

function getEnergyRatio(structure) {
  if (!structure || !structure.store) return null;
  var capacity = structure.store.getCapacity(RESOURCE_ENERGY);
  if (!capacity || capacity <= 0) return null;
  var used = structure.store.getUsedCapacity(RESOURCE_ENERGY);
  return used / capacity;
}

function isLinkBelowRatio(link, ratio) {
  var currentRatio = getEnergyRatio(link);
  return currentRatio !== null && currentRatio < ratio;
}

function isEnergyStoreFull(structure) {
  if (!structure || !structure.store) return false;
  return structure.store.getFreeCapacity(RESOURCE_ENERGY) === 0;
}

function getLinkById(id) {
  return Game.getObjectById(id) || null;
}

function runDoorLink(room) {
  if (!room || room.name !== linkConfig.roomName) return;

  var doorLink = getLinkById(linkConfig.doorLinkId);
  var upgraderLink = getLinkById(linkConfig.upgraderLinkId);
  var storageLink = getLinkById(linkConfig.storageLinkId);

  if (!doorLink) {
    logRateLimited(
      'W49N25-door-link-missing',
      '[link] W49N25 Door Link is missing'
    );
    return;
  }

  if (doorLink.cooldown > 0) return;

  if (!isEnergyStoreFull(doorLink)) return;

  var target = null;

  // Priority: Upgrader Link < 10%
  if (
    upgraderLink &&
    isLinkBelowRatio(upgraderLink, linkConfig.receiverThresholdRatio) &&
    upgraderLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  ) {
    target = upgraderLink;
  } else if (
    storageLink &&
    isLinkBelowRatio(storageLink, linkConfig.receiverThresholdRatio) &&
    storageLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0
  ) {
    target = storageLink;
  }

  if (!target) return;

  var result = doorLink.transferEnergy(target);

  if (result !== OK && result !== ERR_TIRED && result !== ERR_FULL) {
    logRateLimited(
      'W49N25-door-link-' + result,
      '[link] W49N25 Door Link transfer failed: ' + result
    );
  }
}

module.exports = {
  run: runDoorLink,
  getLinkById: getLinkById,
  LINK_IDS: {
    upgrader: linkConfig.upgraderLinkId,
    storage: linkConfig.storageLinkId,
    door: linkConfig.doorLinkId
  }
};
