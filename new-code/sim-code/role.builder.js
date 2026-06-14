const support = require('role.support');

function getSource(creep) {
  if (creep.memory.sourceId) {
    const source = Game.getObjectById(creep.memory.sourceId);
    if (source) return source;

    delete creep.memory.sourceId;
  }

  const sources = creep.room.find(FIND_SOURCES);
  if (sources.length === 0) return null;

  const source = creep.pos.findClosestByPath(sources) || sources[0];
  creep.memory.sourceId = source.id;
  return source;
}

module.exports = {
  run: function (creep) {
    if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      creep.memory.working = false;
    }

    if (!creep.memory.working && creep.store.getFreeCapacity() === 0) {
      creep.memory.working = true;
    }

    if (creep.memory.working) {
      support.runPriorityWork(creep);
      return;
    }

    const source = getSource(creep);
    if (!source) {
      if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
        creep.memory.working = true;
        module.exports.run(creep);
      }
      return;
    }

    if (source.energy === 0 && creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
      creep.memory.working = true;
      module.exports.run(creep);
      return;
    }

    const result = creep.harvest(source);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
    } else if (
      result === ERR_NOT_ENOUGH_RESOURCES &&
      creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0
    ) {
      creep.memory.working = true;
      module.exports.run(creep);
    }
  }
};
