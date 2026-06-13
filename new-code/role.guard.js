module.exports = {
  run: function (creep) {
    const target = creep.pos.findClosestByPath(FIND_HOSTILE_CREEPS);
    if (target) {
      const result = creep.attack(target);
      if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, {
          visualizePathStyle: { stroke: '#ff0000' }
        });
      }
      return;
    }

    const spawns = creep.room.find(FIND_MY_SPAWNS);
    const post = spawns[0] || creep.room.controller;
    if (post && creep.pos.getRangeTo(post) > 3) {
      creep.moveTo(post, {
        range: 3,
        visualizePathStyle: { stroke: '#ff0000' }
      });
    }
  }
};
