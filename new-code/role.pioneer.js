const nav = require('nav.flag');

// Pioneer: travels to expansion room and builds construction sites.
// Uses nav-0, nav-1, ... nav-N flag chain for pathfinding.
module.exports = {
  run: function (creep) {
    const targetRoom = creep.memory.targetRoom || creep.memory.remoteRoom;

    if (!targetRoom) {
      console.log(`[pioneer] ${creep.name} no target room`);
      return;
    }

    // Navigate to target room
    if (creep.pos.roomName !== targetRoom) {
      // 1. Try flag-based navigation first
      if (nav.moveToTarget(creep, targetRoom)) return;

      // 2. Fallback: room-exit pathfinding
      const exitDir = Game.map.findExit(creep.pos.roomName, targetRoom);
      if (exitDir !== ERR_NO_PATH && exitDir !== ERR_INVALID_ARGS) {
        const exit = creep.pos.findClosestByPath(exitDir);
        if (exit) {
          creep.moveTo(exit, { reusePath: 20, visualizePathStyle: { stroke: '#44cc44' } });
          return;
        }
      }
      creep.moveTo(
        new RoomPosition(25, 25, targetRoom),
        { reusePath: 20, visualizePathStyle: { stroke: '#44cc44' } }
      );
      return;
    }

    // In target room — find and build construction sites
    const sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES);
    if (sites.length > 0) {
      const spawnSite = sites.find(function (s) { return s.structureType === STRUCTURE_SPAWN; });
      const target = spawnSite || sites[0];

      if (creep.build(target) === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { reusePath: 5, visualizePathStyle: { stroke: '#44cc44' } });
      }
      return;
    }

    // No construction sites — harvest energy and upgrade controller
    if (creep.store.getFreeCapacity() > 0) {
      const source = creep.pos.findClosestByPath(FIND_SOURCES);
      if (source) {
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
          creep.moveTo(source, { reusePath: 20 });
        }
      }
      return;
    }

    // Full energy, no sites — upgrade controller to push RCL
    const controller = creep.room.controller;
    if (controller) {
      if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 20 });
      }
    }
  }
};
