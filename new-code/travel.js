// Unified cross-room travel layer.
// State-locked, exit-locked, flag-assisted navigation.
// Stores travel state in creep.memory._t.
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

// Choose next waypoint: flag or room center
function selectWaypoint(creep, targetRoom) {
  var flags = getFlagPath();

  for (var i = 0; i < flags.length; i++) {
    var f = flags[i];

    // Arrived at this flag? (same room + range ≤1)
    if (creep.pos.roomName === f.pos.roomName && creep.pos.inRangeTo(f.pos, 1)) {
      continue;
    }

    // This flag is next — if different room, target room center first
    if (creep.pos.roomName !== f.pos.roomName) {
      return new RoomPosition(25, 25, f.pos.roomName);
    }
    return f.pos;
  }

  // No unvisited flags — target the destination room center
  return new RoomPosition(25, 25, targetRoom);
}

module.exports = {
  // Returns true  = still traveling (caller must return, travel has control).
  // Returns false = arrived (caller can now do room-level actions).
  run: function (creep, targetRoom) {
    var mem = creep.memory;
    if (!mem._t) mem._t = {};
    var t = mem._t;

    // ── Arrival check ──
    // We're in target room AND away from exit (not mid-crossing)
    if (creep.pos.roomName === targetRoom) {
      var exitDist = Math.min(
        creep.pos.x,
        49 - creep.pos.x,
        creep.pos.y,
        49 - creep.pos.y
      );
      if (exitDist >= ARRIVE_RANGE) {
        delete mem._t;
        return false; // arrived
      }
    }

    // ── Exit lock: just crossed a boundary, don't recalculate ──
    if (t.lockedUntil && Game.time < t.lockedUntil) {
      return true; // hold course, no new moveTo
    }

    // ── Select and move toward waypoint ──
    var dest = selectWaypoint(creep, targetRoom);
    creep.moveTo(dest, {
      reusePath: 20,
      visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
    });

    // Lock if near exit to avoid recalculating mid-crossing
    if (nearExit(creep.pos)) {
      t.lockedUntil = Game.time + EXIT_LOCK_TICKS;
    }

    return true; // traveling
  }
};
