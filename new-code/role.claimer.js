const nav = require('nav.flag');

// Moves to target expansion room and claims the controller.
// Uses nav-0, nav-1, ... nav-N flag chain for pathfinding.
module.exports = {
  run: function (creep) {
    const targetRoom = creep.memory.targetRoom || creep.memory.remoteRoom;
    const signText = creep.memory.signText || undefined;

    if (!targetRoom) {
      console.log(`[claimer] ${creep.name} no target room`);
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
          creep.moveTo(exit, { reusePath: 20, visualizePathStyle: { stroke: '#ffaa00' } });
          return;
        }
      }
      creep.moveTo(
        new RoomPosition(25, 25, targetRoom),
        { reusePath: 20, visualizePathStyle: { stroke: '#ffaa00' } }
      );
      return;
    }

    // In target room — find and claim controller
    const controller = Game.rooms[targetRoom]
      ? Game.rooms[targetRoom].controller
      : null;

    if (!controller) {
      console.log(`[claimer] ${creep.name} no controller in ${targetRoom}`);
      return;
    }

    if (controller.my) {
      if (creep.signController(controller, signText) === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 20 });
      }
      return;
    }

    const result = creep.claimController(controller);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, { reusePath: 20 });
    } else if (result === OK) {
      console.log(`[claimer] ${creep.name} claimed ${targetRoom}!`);
    } else if (result === ERR_GCL_NOT_ENOUGH) {
      const reserveResult = creep.reserveController(controller);
      if (reserveResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 20 });
      } else if (reserveResult === OK) {
        console.log(`[claimer] ${creep.name} reserving ${targetRoom} (GCL too low)`);
      }
    }
  }
};
