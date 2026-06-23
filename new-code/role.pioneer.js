const travel = require('travel');

// Pioneer: travels to expansion room and builds construction sites.
// Working state machine:
//   working=true  → build/upgrade, switch to false when empty
//   working=false → harvest, switch to true when full
// Travel handled by travel.js.
module.exports = {
  run: function (creep) {
    var targetRoom = creep.memory.targetRoom || creep.memory.remoteRoom;

    if (!targetRoom) {
      console.log('[pioneer] ' + creep.name + ' no target room');
      return;
    }

    // ── Travel ──
    if (travel.run(creep, targetRoom)) return;

    // ── State transitions ──
    if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
      creep.memory.working = true;
    }

    // ── Working: build or upgrade ──
    if (creep.memory.working) {
      var controller = creep.room.controller;

      // Controller emergency: downgrade imminent → upgrade first
      if (controller &&
          typeof controller.ticksToDowngrade === 'number' &&
          controller.ticksToDowngrade < 3000) {
        var upgradeResult = creep.upgradeController(controller);
        if (upgradeResult === OK) return;
        if (upgradeResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(controller, { reusePath: 20 });
          return;
        }
        if (upgradeResult === ERR_NOT_ENOUGH_RESOURCES) {
          creep.memory.working = false;
          return;
        }
        return;
      }

      var sites = creep.room.find(FIND_MY_CONSTRUCTION_SITES);

      if (sites.length > 0) {
        // Priority: spawn site first
        var spawnSite = null;
        for (var i = 0; i < sites.length; i++) {
          if (sites[i].structureType === STRUCTURE_SPAWN) {
            spawnSite = sites[i];
            break;
          }
        }
        var target = spawnSite || creep.pos.findClosestByPath(sites);

        var buildResult = creep.build(target);
        if (buildResult === OK) return;
        if (buildResult === ERR_NOT_IN_RANGE) {
          creep.moveTo(target, { reusePath: 5, visualizePathStyle: { stroke: '#44cc44' } });
          return;
        }
        if (buildResult === ERR_NOT_ENOUGH_RESOURCES || buildResult === ERR_INVALID_TARGET) {
          creep.memory.working = false;
          return;
        }
        // ERR_RCL_NOT_ENOUGH or other → fall through to upgrade
      }

      // No construction sites → upgrade controller
      if (controller) {
        var upgradeResult2 = creep.upgradeController(controller);
        if (upgradeResult2 === OK) return;
        if (upgradeResult2 === ERR_NOT_IN_RANGE) {
          creep.moveTo(controller, { reusePath: 20 });
          return;
        }
        if (upgradeResult2 === ERR_NOT_ENOUGH_RESOURCES) {
          creep.memory.working = false;
          return;
        }
      }
      return;
    }

    // ── Not working: harvest ──
    var source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
    if (!source) {
      // Fallback: any source
      source = creep.pos.findClosestByPath(FIND_SOURCES);
    }

    if (source) {
      var harvestResult = creep.harvest(source);
      if (harvestResult === OK) return;
      if (harvestResult === ERR_NOT_IN_RANGE) {
        creep.moveTo(source, { reusePath: 20 });
        return;
      }
      if (harvestResult === ERR_NOT_ENOUGH_RESOURCES) {
        // Source depleted — try another source next tick
        return;
      }
    }
  }
};
