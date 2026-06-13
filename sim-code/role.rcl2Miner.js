const economy = require('manager.economy');

module.exports = {
  run: function (creep) {
    const source = creep.memory.sourceId
      ? Game.getObjectById(creep.memory.sourceId)
      : null;
    const pos = creep.memory.containerPos;

    if (!source || !pos) return;

    // 走到 container 定位
    if (creep.pos.x !== pos.x || creep.pos.y !== pos.y || creep.pos.roomName !== pos.roomName) {
      creep.moveTo(pos.x, pos.y, {
        visualizePathStyle: { stroke: '#ffaa00' }
      });
      return;
    }

    // 無 CARRY 採集機制已在目前遊戲環境驗證。
    const harvested = Math.min(
      source.energy,
      creep.getActiveBodyparts(WORK) * HARVEST_POWER
    );
    const result = creep.harvest(source);
    if (result === OK) {
      economy.recordHarvest(creep.room.name, harvested);
    }
  }
};
