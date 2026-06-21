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

// Pick the next waypoint.  State is persisted in travel memory so we don't
// bounce back to earlier flags once we've passed them.
function selectWaypoint(creep, targetRoom) {
  var flags = getFlagPath();
  var t = creep.memory._t;

  // No flags at all — go straight to destination
  if (flags.length === 0) {
    return new RoomPosition(25, 25, targetRoom);
  }

  // Initialize or advance flag index
  if (t.flagIdx === undefined) {
    t.flagIdx = 0;
  }

  // Check if we've reached the current flag while staying within bounds
  while (t.flagIdx < flags.length) {
    var f = flags[t.flagIdx];
    if (creep.pos.roomName === f.pos.roomName && creep.pos.inRangeTo(f.pos, 1)) {
      t.flagIdx++; // reached — advance to next flag
    } else {
      break; // this flag is not yet reached
    }
  }

  // Past all flags — head to destination room center
  if (t.flagIdx >= flags.length) {
    return new RoomPosition(25, 25, targetRoom);
  }

  // Navigate toward the current unvisited flag
  var next = flags[t.flagIdx];
  // If flag is in a different room, navigate to that room's center first
  if (creep.pos.roomName !== next.pos.roomName) {
    return new RoomPosition(25, 25, next.pos.roomName);
  }
  return next.pos;
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
