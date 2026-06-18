const remote = require('manager.remote');

function getAssignedSource(creep, sourceConfig) {
  let source = sourceConfig.id
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
    const homeRoom = creep.memory.homeRoom;
    const remoteRoom = creep.memory.remoteRoom;
    const sourceConfig = remote.getSourceConfig(
      homeRoom,
      remoteRoom,
      creep.memory.sourceIndex
    );

    if (!sourceConfig || sourceConfig.enabled !== true) {
      remote.retreat(creep, homeRoom);
      return;
    }
    if (remote.isRemotePaused(homeRoom, remoteRoom)) {
      remote.retreat(creep, homeRoom);
      return;
    }

    const containerPosition = new RoomPosition(
      sourceConfig.containerX,
      sourceConfig.containerY,
      sourceConfig.roomName
    );
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

    const source = getAssignedSource(creep, sourceConfig);
    if (!source) return;

    remote.ensureContainerSite(sourceConfig);
    const container = remote.findContainerAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    const site = remote.findContainerSiteAt(
      sourceConfig.roomName,
      sourceConfig.containerX,
      sourceConfig.containerY
    );
    const carried = creep.store.getUsedCapacity(RESOURCE_ENERGY);

    if (site && carried > 0) {
      creep.build(site);
      return;
    }

    if (
      container &&
      carried > 0 &&
      container.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.transfer(container, RESOURCE_ENERGY);
    }

    const result = creep.harvest(source);
    if (
      container &&
      container.hits < container.hitsMax &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0 &&
      (
        source.energy === 0 ||
        result === ERR_NOT_ENOUGH_RESOURCES ||
        result === ERR_FULL
      )
    ) {
      creep.repair(container);
    }
  }
};
