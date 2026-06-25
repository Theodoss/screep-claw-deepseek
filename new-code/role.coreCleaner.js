/**
 * role.coreCleaner.js — Pure invader core buster
 *
 * Simple role: travel to the room with an invader core, find it, bash it.
 * No healing, no TOUGH, no ranged — just ATTACK + MOVE.
 *
 * Spawned with coreTargetRoom in memory from getCoreSpawnRequests.
 */

function attackCore(creep) {
  var cores = creep.room.find(FIND_HOSTILE_STRUCTURES, {
    filter: function (s) {
      return s.structureType === STRUCTURE_INVADER_CORE;
    }
  });
  if (cores.length === 0) return false;

  var core = creep.pos.findClosestByRange(cores) || cores[0];
  var result = creep.attack(core);

  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(core, { reusePath: 5, maxRooms: 1 });
  }

  creep.memory.task = 'bash:core:' + core.id.slice(-6);
  return true;
}

module.exports = {
  run: function (creep) {
    var targetRoom = creep.memory.coreTargetRoom;
    if (!targetRoom) {
      // No target — suicide/recycle
      creep.memory.task = 'idle:no-core-target';
      return;
    }

    // Check if core still exists (from defense memory)
    var def = Memory.remoteDefense &&
      Memory.remoteDefense[creep.memory.home || creep.memory.homeRoom];
    var haveVision = !!Game.rooms[targetRoom];
    var coreInMemory = def && def.coreRooms &&
      def.coreRooms.some(function (c) { return c.roomName === targetRoom; });

    // Only abort if we HAVE vision AND confirmed no core
    if (haveVision && !coreInMemory) {
      // Core destroyed — mission complete
      creep.memory.task = 'done:core-destroyed';
      // Head back to home room for recycling
      var homeRoom = creep.memory.home || creep.memory.homeRoom;
      if (homeRoom && creep.room.name !== homeRoom) {
        creep.moveTo(new RoomPosition(25, 25, homeRoom), { reusePath: 30 });
      }
      return;
    }

    // Travel to core room
    if (creep.room.name !== targetRoom) {
      creep.memory.task = 'travel:to-core:' + targetRoom;
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 30,
        maxRooms: 1,
        visualizePathStyle: { stroke: '#ff0000' }
      });
      return;
    }

    // In core room — attack!
    var attacked = attackCore(creep);
    if (!attacked) {
      // Core not found visually but defense memory still has it
      // Could be out of range or just spawned. Move to center.
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 10,
        maxRooms: 1
      });
      creep.memory.task = 'search:core:' + targetRoom;
    }
  }
};
