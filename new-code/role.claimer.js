const travel = require('travel');

// Moves to target expansion room and claims the controller.
// Travel is handled by travel.js (flag-assisted, exit-locked).
module.exports = {
  run: function (creep) {
    const targetRoom = creep.memory.targetRoom || creep.memory.remoteRoom;
    const signText = creep.memory.signText || undefined;

    if (!targetRoom) {
      console.log(`[claimer] ${creep.name} no target room`);
      return;
    }

    // ── Travel: cross-room navigation ──
    if (travel.run(creep, targetRoom)) return;

    // ── Action: in target room ──
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
