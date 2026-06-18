const combat = require('military.combat');

module.exports = {
  run: function (creep) {
    const turn = combat.beginTurn(creep);

    if (turn.retreating) {
      creep.heal(creep);
      return;
    }
    if (!turn.active) return;

    const wounded = combat.findWoundedFriendly(creep);
    if (wounded) {
      if (creep.pos.getRangeTo(wounded) <= 1) {
        creep.heal(wounded);
      } else {
        creep.rangedHeal(wounded);
        creep.moveTo(wounded, {
          range: 1,
          reusePath: 2,
          maxRooms: 1,
          visualizePathStyle: { stroke: '#00ff00' }
        });
        return;
      }
    } else if (creep.hits < creep.hitsMax) {
      creep.heal(creep);
    }

    if (combat.combatEnabled(creep, turn.mission)) {
      const escort = combat.findEscortTarget(creep);
      if (escort && creep.pos.getRangeTo(escort) > 1) {
        creep.moveTo(escort, {
          range: 1,
          reusePath: 2,
          maxRooms: 1,
          visualizePathStyle: { stroke: '#00ff00' }
        });
        return;
      }
    }

    combat.moveForMission(creep, turn.mission);
  }
};
