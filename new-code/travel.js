// Room-level cross-room travel using Game.map.findRoute.
// Each tick only pathfinds to the current room's exit — never
// does cross-room pathfinding, eliminating border oscillation.
//
// Optional: nav-0, nav-1, ... nav-N flags are interpolated into
// the route as waypoint rooms.
//
// State stored in creep.memory._t:
//   _t.route      — cached room array from findRoute
//   _t.routeIdx   — current index in route
//
// Usage:
//   const travel = require('travel');
//   if (!travel.run(creep, 'W47N22')) {
//     // Arrived
//   }

function getFlagRooms() {
  var rooms = [];
  for (var flagName in Game.flags) {
    var match = flagName.match(/^nav-(\d+)$/);
    if (match) {
      rooms.push({
        index: parseInt(match[1], 10),
        roomName: Game.flags[flagName].pos.roomName
      });
    }
  }
  rooms.sort(function (a, b) { return a.index - b.index; });
  return rooms.map(function (r) { return r.roomName; });
}

function buildRoute(fromRoom, toRoom) {
  var flagRooms = getFlagRooms();

  if (flagRooms.length === 0) {
    // No flags — direct route
    var r = Game.map.findRoute(fromRoom, toRoom);
    if (r === ERR_NO_PATH) return null;
    return r.map(function (step) { return step.room; });
  }

  // Build multi-segment route through flag waypoints
  var fullRoute = [];
  var prevRoom = fromRoom;
  var allRooms = [].concat(flagRooms, [toRoom]);

  for (var i = 0; i < allRooms.length; i++) {
    var seg = Game.map.findRoute(prevRoom, allRooms[i]);
    if (seg === ERR_NO_PATH) return null;
    var segRooms = seg.map(function (step) { return step.room; });
    // Don't duplicate last room of previous segment
    if (fullRoute.length > 0 && fullRoute[fullRoute.length - 1] === segRooms[0]) {
      segRooms.shift();
    }
    fullRoute = fullRoute.concat(segRooms);
    prevRoom = allRooms[i];
  }

  return fullRoute;
}

module.exports = {
  // Returns true = still traveling.
  // Returns false = arrived.
  run: function (creep, targetRoom) {
    var mem = creep.memory;
    if (!mem._t) mem._t = {};
    var t = mem._t;

    // ── Already there? ──
    if (creep.pos.roomName === targetRoom) {
      var exitDist = Math.min(
        creep.pos.x, 49 - creep.pos.x,
        creep.pos.y, 49 - creep.pos.y
      );
      if (exitDist >= 3) {
        delete mem._t;
        return false;
      }
    }

    // ── Build or refresh route ──
    if (!t.route || t.routeIdx === undefined) {
      t.route = buildRoute(creep.pos.roomName, targetRoom);
      t.routeIdx = 0;
      if (!t.route || t.route.length === 0) {
        // No route found — fall back to room-center moveTo
        creep.moveTo(new RoomPosition(25, 25, targetRoom), {
          reusePath: 20,
          visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
        });
        return true;
      }
    }

    // ── Advance route index when we enter the next room ──
    while (
      t.routeIdx < t.route.length &&
      creep.pos.roomName === t.route[t.routeIdx]
    ) {
      t.routeIdx++;
    }

    // ── Past all rooms? Head directly to target ──
    if (t.routeIdx >= t.route.length) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 20,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
      });
      return true;
    }

    // ── Pathfind to exit of current room toward next room in route ──
    var nextRoom = t.route[t.routeIdx];
    var exitDir = Game.map.findExit(creep.pos.roomName, nextRoom);

    if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
      // Can't find exit — recalculate route
      delete t.route;
      delete t.routeIdx;
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 50
      });
      return true;
    }

    var exit = creep.pos.findClosestByPath(exitDir);
    if (exit) {
      creep.moveTo(exit, {
        reusePath: 10,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
      });
    } else {
      // Exit blocked or not reachable — head to room center
      creep.moveTo(new RoomPosition(25, 25, creep.pos.roomName), {
        reusePath: 10
      });
    }

    return true;
  }
};
