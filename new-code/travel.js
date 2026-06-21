// Unified cross-room travel layer.
// State-locked, exit-locked, flag-assisted navigation.
// Stores travel state in creep.memory._t:
//   _t.flagIdx — which nav-N flag we're heading to
//   _t.lockedUntil — exit lock expiry game tick
//
// Usage:
//   const travel = require('travel');
//   if (!travel.run(creep, 'W47N22')) {
//     // Arrived — do your room-level action
//   }
//   // Still traveling — return (travel took control)

var EXIT_LOCK_TICKS = 5;
var ARRIVE_RANGE = 3;

function getFlagPath() {
  var flags = [];
  for (var flagName in Game.flags) {
    var match = flagName.match(/^nav-(\d+)$/);
    if (match) {
      flags.push({
        index: parseInt(match[1], 10),
        pos: Game.flags[flagName].pos,
        name: flagName
      });
    }
  }
  flags.sort(function (a, b) { return a.index - b.index; });
  return flags;
}

function nearExit(pos) {
  return pos.x <= 2 || pos.x >= 47 || pos.y <= 2 || pos.y >= 47;
}

// Pick the next waypoint.  State is persisted in travel memory.
function selectWaypoint(creep, targetRoom) {
  var flags = getFlagPath();
  var t = creep.memory._t;

  if (flags.length === 0) {
    return new RoomPosition(25, 25, targetRoom);
  }

  if (t.flagIdx === undefined) {
    t.flagIdx = 0;
  }

  while (t.flagIdx < flags.length) {
    var f = flags[t.flagIdx];
    if (creep.pos.roomName === f.pos.roomName && creep.pos.inRangeTo(f.pos, 1)) {
      t.flagIdx++;
    } else {
      break;
    }
  }

  if (t.flagIdx >= flags.length) {
    return new RoomPosition(25, 25, targetRoom);
  }

  var next = flags[t.flagIdx];
  if (creep.pos.roomName !== next.pos.roomName) {
    return new RoomPosition(25, 25, next.pos.roomName);
  }
  return next.pos;
}

module.exports = {
  run: function (creep, targetRoom) {
    var mem = creep.memory;
    if (!mem._t) mem._t = {};
    var t = mem._t;

    // ── Arrival check ──
    if (creep.pos.roomName === targetRoom) {
      var exitDist = Math.min(
        creep.pos.x,
        49 - creep.pos.x,
        creep.pos.y,
        49 - creep.pos.y
      );
      if (exitDist >= ARRIVE_RANGE) {
        delete mem._t;
        return false;
      }
    }

    // ── Exit lock: skip waypoint recalculation, but keep moving ──
    var locked = t.lockedUntil && Game.time < t.lockedUntil;

    // ── Move toward waypoint ──
    var dest;
    if (!locked) {
      dest = selectWaypoint(creep, targetRoom);
      t.lastDest = { x: dest.x, y: dest.y, roomName: dest.roomName };
    } else {
      // Locked: reuse last destination without recalculating waypoint
      var ld = t.lastDest;
      dest = ld
        ? new RoomPosition(ld.x, ld.y, ld.roomName)
        : new RoomPosition(25, 25, targetRoom);
    }

    creep.moveTo(dest, {
      reusePath: locked ? 50 : 20,
      visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
    });

    if (!locked && nearExit(creep.pos)) {
      t.lockedUntil = Game.time + EXIT_LOCK_TICKS;
    }

    return true;
  }
};
