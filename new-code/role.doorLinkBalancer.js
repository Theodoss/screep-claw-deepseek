/**
 * role.doorLinkBalancer.js
 *
 * Fixed position: W49N25 47,7
 * Body: [CARRY, CARRY, MOVE]
 * Only job: Left/Right Container → Door Link (one-way)
 * Never withdraws from Door Link. Never does Container→Container.
 */

var linkConfig = require('config.W49N25Links');
var travel = require('travel');

var lastWarning = {};

function logRateLimited(key, message) {
  if (!lastWarning[key] || Game.time - lastWarning[key] > 100) {
    lastWarning[key] = Game.time;
    console.log(message);
  }
}

function getContainerByIdOrPos(id, x, y, roomName) {
  if (id) {
    var container = Game.getObjectById(id);
    if (container) return container;
  }
  // Fallback: look at position
  var structures = Game.rooms[roomName]
    ? Game.rooms[roomName].lookForAt(LOOK_STRUCTURES, x, y)
    : [];
  for (var i = 0; i < structures.length; i++) {
    if (structures[i].structureType === STRUCTURE_CONTAINER) {
      return structures[i];
    }
  }
  return null;
}

function selectDoorSourceContainer(leftContainer, rightContainer) {
  var leftEnergy = leftContainer
    ? leftContainer.store.getUsedCapacity(RESOURCE_ENERGY)
    : 0;
  var rightEnergy = rightContainer
    ? rightContainer.store.getUsedCapacity(RESOURCE_ENERGY)
    : 0;

  if (leftEnergy <= 0 && rightEnergy <= 0) {
    return null;
  }

  if (leftEnergy >= rightEnergy) {
    return leftContainer;
  }
  return rightContainer;
}

module.exports = {
  run: function (creep) {
    var doorLink = Game.getObjectById(linkConfig.doorLinkId);
    if (!doorLink) {
      logRateLimited(
        'doorLinkBalancer-no-link',
        '[doorLinkBalancer] Door Link missing'
      );
      return;
    }

    // Travel to fixed position if not there
    if (
      creep.room.name !== linkConfig.roomName ||
      creep.pos.x !== 47 ||
      creep.pos.y !== 7
    ) {
      // Use travel to get to fixed position
      if (creep.room.name !== linkConfig.roomName) {
        creep.moveTo(
          new RoomPosition(47, 7, linkConfig.roomName),
          { reusePath: 20 }
        );
      } else if (creep.pos.x !== 47 || creep.pos.y !== 7) {
        creep.moveTo(
          new RoomPosition(47, 7, linkConfig.roomName),
          { reusePath: 5 }
        );
      }
      return;
    }

    // Get door buffer containers from memory cache
    var roomMem = Memory.rooms && Memory.rooms[linkConfig.roomName];
    if (!roomMem) roomMem = Memory.rooms[linkConfig.roomName] = {};
    if (!roomMem.infrastructure) roomMem.infrastructure = {};
    if (!roomMem.infrastructure.doorBuffers) {
      roomMem.infrastructure.doorBuffers = {};
    }
    var cached = roomMem.infrastructure.doorBuffers;

    var leftContainer = getContainerByIdOrPos(
      cached.leftContainerId,
      46, 6,
      linkConfig.roomName
    );
    var rightContainer = getContainerByIdOrPos(
      cached.rightContainerId,
      48, 6,
      linkConfig.roomName
    );

    // Update cache
    if (leftContainer) cached.leftContainerId = leftContainer.id;
    if (rightContainer) cached.rightContainerId = rightContainer.id;

    var carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);

    // Priority 1: transfer to Door Link
    if (carried > 0) {
      if (doorLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        creep.transfer(doorLink, RESOURCE_ENERGY);
      }
      // If Door Link is full, wait in place
      return;
    }

    // Priority 2: withdraw from fuller container
    if (
      doorLink.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      var sourceContainer = selectDoorSourceContainer(
        leftContainer,
        rightContainer
      );
      if (sourceContainer) {
        creep.withdraw(sourceContainer, RESOURCE_ENERGY);
      }
    }
  }
};
