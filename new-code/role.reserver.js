const remote = require('manager.remote');

module.exports = {
  run: function (creep) {
    const homeRoom = creep.memory.homeRoom;
    const remoteRoom = creep.memory.remoteRoom;
    const remoteConfig = remote.getRemoteConfig(homeRoom, remoteRoom);

    if (!remoteConfig) {
      remote.retreat(creep, homeRoom);
      return;
    }
    if (remote.isRemotePaused(homeRoom, remoteRoom)) {
      remote.retreat(creep, homeRoom);
      return;
    }

    let controller = remoteConfig.controllerId
      ? Game.getObjectById(remoteConfig.controllerId)
      : null;

    if (!controller && Game.rooms[remoteRoom]) {
      controller = Game.rooms[remoteRoom].controller;
      if (controller) remoteConfig.controllerId = controller.id;
    }

    if (!controller) {
      creep.moveTo(
        new RoomPosition(25, 25, remoteRoom),
        { reusePath: 20 }
      );
      return;
    }

    // If invaders have reserved the controller, attack it to clear their ticks.
    // Each CLAIM part removes 300 invader ticks/tick via attackController.
    const invaderOwned = controller.reservation &&
                         controller.reservation.username === 'Invader';

    const action = invaderOwned
      ? creep.attackController(controller)
      : creep.reserveController(controller);

    if (action === ERR_NOT_IN_RANGE) {
      creep.moveTo(controller, { reusePath: 20 });
    }
  }
};
