const combat = require('military.combat');

module.exports = {
  run: function (creep) {
    const turn = combat.beginTurn(creep);
    if (!turn.active) return;

    const mission = turn.mission;
    const target = creep.room.name === mission.targetRoom
      ? mission.phase === 'holding'
        ? combat.selectStagingAreaTarget(creep, mission)
        : combat.selectCombatTarget(creep)
      : null;

    if (target) {
      const result = creep.attack(target);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {
          range: 1,
          reusePath: 2,
          maxRooms: 1,
          visualizePathStyle: { stroke: '#ff0000' }
        });
      }
      return;
    }

    combat.moveForMission(creep, mission);
  }
};
