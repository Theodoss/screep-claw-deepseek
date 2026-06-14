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
      const nearby = combat.getRoomData(creep.room).hostiles.filter(
        hostile => creep.pos.getRangeTo(hostile) <= 3
      );
      if (nearby.length >= 2) {
        creep.rangedMassAttack();
      } else {
        const result = creep.rangedAttack(target);
        if (result === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, {
            range: 3,
            reusePath: 2,
            maxRooms: 1,
            visualizePathStyle: { stroke: '#ff8800' }
          });
        }
      }
      return;
    }

    combat.moveForMission(creep, mission);
  }
};
