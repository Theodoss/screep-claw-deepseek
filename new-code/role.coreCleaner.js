/**
 * role.coreCleaner.js — Invader seek-and-destroy
 *
 * Priority:
 *   1. Invader core in current room → bash it
 *   2. Invader creeps in current room → kill them
 *   3. Travel to assigned coreTargetRoom
 *   4. No core target: check defense memory for active threats → join the fight
 *   5. Nothing to do → recycle at home spawn
 *
 * Pure ATTACK + MOVE body. No TOUGH/HEAL/RANGED.
 */

// ── Core attack ──

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

// ── Invader creep attack ──

function attackInvader(creep) {
  var hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
    filter: function (c) {
      return c.owner && c.owner.username === 'Invader';
    }
  });
  if (hostiles.length === 0) return false;

  // Pick closest
  var target = creep.pos.findClosestByRange(hostiles) || hostiles[0];
  var result = creep.attack(target);

  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(target, { reusePath: 5, maxRooms: 1 });
  }

  creep.memory.task = 'fight:invader:' + target.id.slice(-6);
  return true;
}

// ── Find nearest threat room from defense memory ──

function findThreatRoom(creep) {
  var homeRoom = creep.memory.home || creep.memory.homeRoom;
  if (!homeRoom) return null;

  var def = Memory.remoteDefense && Memory.remoteDefense[homeRoom];
  if (!def || !def.threatRooms || def.threatRooms.length === 0) return null;

  // Find nearest threat room
  var nearest = null;
  var nearestDist = Infinity;
  for (var i = 0; i < def.threatRooms.length; i++) {
    var tr = def.threatRooms[i];
    var dist = Game.map.getRoomLinearDistance(creep.room.name, tr.roomName);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = tr.roomName;
    }
  }

  return nearest;
}

module.exports = {
  run: function (creep) {
    var homeRoom = creep.memory.home || creep.memory.homeRoom || 'W49N25';

    // ── Step 1: In current room, core takes priority ──
    if (attackCore(creep)) return;

    // ── Step 2: In current room, fight invaders ──
    if (attackInvader(creep)) return;

    // ── Step 3: Determine where to go ──
    var targetRoom = creep.memory.coreTargetRoom;

    // Check if assigned core still exists
    if (targetRoom) {
      var def = Memory.remoteDefense && Memory.remoteDefense[homeRoom];
      var haveVision = !!Game.rooms[targetRoom];
      var coreInMemory = def && def.coreRooms &&
        def.coreRooms.some(function (c) { return c.roomName === targetRoom; });

      // Core confirmed gone (have vision AND no core in memory)
      if (haveVision && !coreInMemory) {
        delete creep.memory.coreTargetRoom;
        targetRoom = null;
      }
    }

    // ── Step 4: No core target → look for active threats ──
    if (!targetRoom) {
      targetRoom = findThreatRoom(creep);
    }

    // ── Step 5: Nothing to do → go home for recycling ──
    if (!targetRoom) {
      if (creep.room.name !== homeRoom) {
        creep.memory.task = 'travel:home-recycle';
        creep.moveTo(new RoomPosition(25, 25, homeRoom), {
          reusePath: 30,
          visualizePathStyle: { stroke: '#888888' }
        });
      } else {
        // At home, recycle
        var spawns = creep.room.find(FIND_MY_SPAWNS);
        if (spawns.length > 0) {
          var result = spawns[0].recycleCreep(creep);
          if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(spawns[0], { reusePath: 5 });
          }
          creep.memory.task = 'recycle';
        }
      }
      return;
    }

    // ── Step 6: Travel to target room ──
    if (creep.room.name !== targetRoom) {
      creep.memory.task = 'travel:to:' + targetRoom;
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 30,
        maxRooms: 1,
        visualizePathStyle: { stroke: '#ff0000' }
      });
      return;
    }

    // ── Step 7: In target room but nothing found — search center ──
    creep.moveTo(new RoomPosition(25, 25, targetRoom), {
      reusePath: 10,
      maxRooms: 1
    });
    creep.memory.task = 'search:' + targetRoom;
  }
};
