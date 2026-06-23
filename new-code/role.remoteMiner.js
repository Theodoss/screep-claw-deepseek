const remote = require('manager.remote');

// Container repair thresholds (miner-only; builders don't touch these).
var CONTAINER_REPAIR_START = 200000;
var CONTAINER_REPAIR_STOP  = 240000;

function getAssignedSource(creep, sourceConfig) {
  var source = sourceConfig.id
    ? Game.getObjectById(sourceConfig.id)
    : null;

  if (!source && Game.rooms[sourceConfig.roomName]) {
    remote.resolveSourceId(sourceConfig);
    source = sourceConfig.id
      ? Game.getObjectById(sourceConfig.id)
      : null;
  }
  if (source && creep.memory.sourceId !== source.id) {
    creep.memory.sourceId = source.id;
  }

  return source;
}

module.exports = {
  run: function (creep) {
    var homeRoom = creep.memory.homeRoom;
    var remoteRoom = creep.memory.remoteRoom;
    var sourceConfig = remote.getSourceConfig(
      homeRoom, remoteRoom, creep.memory.sourceIndex
    );

    if (!sourceConfig || sourceConfig.enabled !== true) {
      remote.retreat(creep, homeRoom);
      return;
    }
    if (remote.isRemotePaused(homeRoom, remoteRoom)) {
      remote.retreat(creep, homeRoom);
      return;
    }

    var containerPosition = new RoomPosition(
      sourceConfig.containerX,
      sourceConfig.containerY,
      sourceConfig.roomName
    );

    // Move onto container tile
    if (
      creep.pos.roomName !== containerPosition.roomName ||
      creep.pos.x !== containerPosition.x ||
      creep.pos.y !== containerPosition.y
    ) {
      creep.moveTo(containerPosition, {
        reusePath: 20,
        visualizePathStyle: { stroke: '#ffaa00' }
      });
      return;
    }

    var source = getAssignedSource(creep, sourceConfig);
    if (!source) return;

    remote.ensureContainerSite(sourceConfig);
    var container = remote.findContainerAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    var site = remote.findContainerSiteAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    var carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);

    // 1. Build container site if exists
    if (site && carried > 0) {
      creep.build(site);
      return;
    }

    // 2. Transfer energy to container if not full
    if (
      container &&
      carried > 0 &&
      container.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.transfer(container, RESOURCE_ENERGY);
      return;
    }

    // 3. Harvest (primary job)
    var harvestResult = creep.harvest(source);

    // 4. Repair container as idle work (only when harvest yields nothing)
    //    Miner stays on container tile, only repairs its own container.
    if (
      container &&
      container.hits < CONTAINER_REPAIR_START &&
      carried > 0 &&
      (source.energy === 0 || harvestResult === ERR_NOT_ENOUGH_RESOURCES || harvestResult === ERR_FULL)
    ) {
      creep.repair(container);
    }
  }
};
