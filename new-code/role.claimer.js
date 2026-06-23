const travel = require('travel');

// Claimer: travels to target room and claims/reserves the controller.
// Handles all controller states: unowned, hostile-owned, hostile-reserved.
module.exports = {
  run: function (creep) {
    var targetRoom = creep.memory.targetRoom || creep.memory.remoteRoom;
    var signText = creep.memory.signText || null;

    if (!targetRoom) {
      console.log('[claimer] ' + creep.name + ' no target room');
      return;
    }

    // ── Travel ──
    if (travel.run(creep, targetRoom)) return;

    // ── Arrived: use creep.room.controller (travel confirmed we're here) ──
    var controller = creep.room.controller;
    if (!controller) {
      console.log('[claimer] ' + creep.name + ' no controller in ' + creep.room.name);
      return;
    }

    // ── Already mine → sign if text provided ──
    if (controller.my) {
      if (signText) {
        var signResult = creep.signController(controller, signText);
        console.log('[claimer] ' + creep.name + ' sign ' + signResult);
        if (signResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(controller, { reusePath: 20 });
        }
      }
      return;
    }

    // ── Hostile owner → attack ──
    if (controller.owner && !controller.my) {
      var attackResult = creep.attackController(controller);
      console.log('[claimer] ' + creep.name + ' attackController ' + attackResult);
      if (attackResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 20 });
      }
      return;
    }

    // ── Hostile reservation → attack ──
    if (controller.reservation &&
        controller.reservation.username !== creep.owner.username) {
      var atkResult = creep.attackController(controller);
      console.log('[claimer] ' + creep.name + ' attackController(reserved) ' + atkResult);
      if (atkResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 20 });
      }
      return;
    }

    // ── Unowned / our reservation → claim or reserve ──
    var result = creep.claimController(controller);
    console.log('[claimer] ' + creep.name + ' claim ' + result);

    if (result === OK) {
      console.log('[claimer] ' + creep.name + ' CLAIMED ' + targetRoom + '!');
      return;
    }

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, { reusePath: 20 });
      return;
    }

    if (result === ERR_GCL_NOT_ENOUGH) {
      var resResult = creep.reserveController(controller);
      console.log('[claimer] ' + creep.name + ' reserve ' + resResult);
      if (resResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller, { reusePath: 20 });
      } else if (resResult === OK) {
        console.log('[claimer] ' + creep.name + ' reserving ' + targetRoom + ' (GCL too low)');
      }
      return;
    }

    // Other errors: log and wait
    console.log('[claimer] ' + creep.name + ' unexpected result: ' + result);
  }
};
