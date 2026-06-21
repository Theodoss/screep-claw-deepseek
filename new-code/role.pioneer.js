const travel = require('travel');

// Pioneer: travels to expansion room and builds construction sites.
// Travel is handled by travel.js (flag-assisted, exit-locked).
module.exports = {
  run: function (creep) {
    const targetRoom = creep.memory.targetRoom || creep.memory.remoteRoom;

    if (!targetRoom) {
      console.log(`[pioneer] ${creep.name} no target room`);
      return;
    }

    // ── Travel: cross-room navigation ──
    if (travel.run(creep, targetRoom)) return;

    // ── Action: in target room ──
    const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
    if (sites.length > 0) {
      const spawnSite = sites.find(function (s) { return s.structureType === STRUCTURE_SPAWN; });
      const target = spawnSite || sites[0];

      if (creep.build(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 5, visualizePathStyle: { stroke: '#44cc44' } });
      }
      return;
    }

    // No sites — harvest and upgrade
    if (creep.store.getFreeCapacity() > 0) {
      const source = creep.pos.findClosestByPath(FIND_SOURCES);
      if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, { reusePath: 20 });
        }
      }
      return;
    }

    const controller = creep.room.controller;
    if (controller) {
      if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 20 });
      }
    }
  }
};
