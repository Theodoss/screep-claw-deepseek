// Room-level cross-room travel using Game.map.findRoute.
//
// Navigation uses exit-directed intra-room moveTo: finds the exit
// edge to the next route room and moves to a walkable tile on that
// edge within the current room ONLY.  This prevents the built-in
// cross-room pathfinder from optimizing globally (e.g. avoiding
// an expensive swamp room by going back and taking another exit).
//
// Optional: nav-0, nav-1, ... nav-N flags are interpolated into
// the route as waypoint rooms.
//
// State stored in creep.memory._t:
//   _t.route       — cached room array from findRoute
//   _t.routeIdx    — current index in route
//   _t.lastRoom    — previous tick's room (anti-oscillation)
//   _t.prevPrevRoom — two ticks ago room
//   _t.lockUntil   — anti-oscillation lock expiry tick
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
    var r = Game.map.findRoute(fromRoom, toRoom);
    if (r === ERR_NO_PATH) return null;
    return r.map(function (step) { return step.room; });
  }

  var fullRoute = [];
  var prevRoom = fromRoom;
  var allRooms = [].concat(flagRooms, [toRoom]);

  for (var i = 0; i < allRooms.length; i++) {
    var seg = Game.map.findRoute(prevRoom, allRooms[i]);
    if (seg === ERR_NO_PATH) return null;
    var segRooms = seg.map(function (step) { return step.room; });
    if (fullRoute.length > 0 && fullRoute[fullRoute.length - 1] === segRooms[0]) {
      segRooms.shift();
    }
    fullRoute = fullRoute.concat(segRooms);
    prevRoom = allRooms[i];
  }

  return fullRoute;
}

// Find a walkable tile on the exit edge of currentRoom toward nextRoom.
// Returns a RoomPosition within currentRoom, or null if no walkable edge.
function findExitTile(currentRoom, nextRoom) {
  var exitDir = Game.map.findExit(currentRoom, nextRoom);
  if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) return null;

  var terrain = Game.map.getRoomTerrain(currentRoom);

  if (exitDir === FIND_EXIT_TOP) {
    for (var x = 25; x >= 1; x--) {
      if (terrain.get(x, 1) !== TERRAIN_MASK_WALL) return new RoomPosition(x, 1, currentRoom);
    }
    for (var x = 26; x <= 48; x++) {
      if (terrain.get(x, 1) !== TERRAIN_MASK_WALL) return new RoomPosition(x, 1, currentRoom);
    }
  } else if (exitDir === FIND_EXIT_BOTTOM) {
    for (var x = 25; x >= 1; x--) {
      if (terrain.get(x, 48) !== TERRAIN_MASK_WALL) return new RoomPosition(x, 48, currentRoom);
    }
    for (var x = 26; x <= 48; x++) {
      if (terrain.get(x, 48) !== TERRAIN_MASK_WALL) return new RoomPosition(x, 48, currentRoom);
    }
  } else if (exitDir === FIND_EXIT_LEFT) {
    for (var y = 25; y >= 1; y--) {
      if (terrain.get(1, y) !== TERRAIN_MASK_WALL) return new RoomPosition(1, y, currentRoom);
    }
    for (var y = 26; y <= 48; y++) {
      if (terrain.get(1, y) !== TERRAIN_MASK_WALL) return new RoomPosition(1, y, currentRoom);
    }
  } else if (exitDir === FIND_EXIT_RIGHT) {
    for (var y = 25; y >= 1; y--) {
      if (terrain.get(48, y) !== TERRAIN_MASK_WALL) return new RoomPosition(48, y, currentRoom);
    }
    for (var y = 26; y <= 48; y++) {
      if (terrain.get(48, y) !== TERRAIN_MASK_WALL) return new RoomPosition(48, y, currentRoom);
    }
  }

  // All edge tiles are walls — fall back to room center
  return new RoomPosition(25, 25, currentRoom);
}

// Move toward a specific exit edge within the current room.
// Uses intra-room moveTo only (target is in same room) so the
// pathfinder cannot optimize across multiple rooms.
// Falls back to cross-room moveTo if findExitTile fails.
function moveToExit(creep, currentRoom, nextRoom, opts) {
  var exitPos = findExitTile(currentRoom, nextRoom);
  if (exitPos) {
    creep.moveTo(exitPos, opts);
  } else {
    // Fallback: direct cross-room moveTo keeps the creep moving
    // even when the exit edge cannot be determined.
    creep.moveTo(new RoomPosition(25, 25, nextRoom), opts);
  }
}

module.exports = {
  run: function (creep, targetRoom) {
    var mem = creep.memory;
    if (!mem._t) mem._t = {};
    var t = mem._t;

    // ── Arrived? ──
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

    // ── Border defense: push away from edge ──
    if (creep.pos.x === 0 || creep.pos.x === 49 || creep.pos.y === 0 || creep.pos.y === 49) {
      creep.moveTo(new RoomPosition(25, 25, creep.pos.roomName), {
        reusePath: 5,
        swampCost: 5,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
      });
      return true;
    }

    // ── Anti-oscillation: detect A→B→A and lock ──
    if (t.lastRoom && t.lastRoom !== creep.pos.roomName) {
      if (t.prevPrevRoom && creep.pos.roomName === t.prevPrevRoom) {
        // A → B → A oscillation
        t.lockUntil = Game.time + 3;
      }
      t.prevPrevRoom = t.lastRoom;
    }
    t.lastRoom = creep.pos.roomName;

    // ── Oscillation lock: force exit toward next route room ──
    if (t.lockUntil && Game.time < t.lockUntil) {
      var lockTarget = (t.route && t.routeIdx < t.route.length)
        ? t.route[t.routeIdx]
        : targetRoom;
      moveToExit(creep, creep.pos.roomName, lockTarget, {
        reusePath: 50,
        swampCost: 5,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
      });
      return true;
    }

    // ── Build or refresh route ──
    if (!t.route || t.routeIdx === undefined) {
      t.route = buildRoute(creep.pos.roomName, targetRoom);
      t.routeIdx = 0;
      if (!t.route || t.route.length === 0) {
        // No route found — last resort: direct cross-room moveTo
        creep.moveTo(new RoomPosition(25, 25, targetRoom), {
          reusePath: 20,
          swampCost: 5,
          visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
        });
        return true;
      }
    }

    // ── Advance route index ──
    while (
      t.routeIdx < t.route.length &&
      creep.pos.roomName === t.route[t.routeIdx]
    ) {
      t.routeIdx++;
    }

    // ── Past all rooms → head to target center (cross-room ok, we're close) ──
    if (t.routeIdx >= t.route.length) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 20,
        swampCost: 5,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
      });
      return true;
    }

    // ── Verify route is still valid (creep in a room on the route) ──
    var onRoute = false;
    for (var ri = t.routeIdx; ri < t.route.length; ri++) {
      if (creep.pos.roomName === t.route[ri]) {
        t.routeIdx = ri;
        onRoute = true;
        break;
      }
    }
    if (!onRoute) {
      // Creep is off-route (stale _t from old code or unexpected room).
      // Rebuild from scratch.
      delete t.route;
      delete t.routeIdx;
      return true;
    }

    // ── Exit-directed navigation: move to exit edge in current room ──
    // target is an edge tile WITHIN the current room, so the pathfinder
    // cannot "optimise" by going back through other rooms — it must
    // walk through the current room's terrain (swamp or not).
    var nextRoom = t.route[t.routeIdx];
    moveToExit(creep, creep.pos.roomName, nextRoom, {
      reusePath: 50,
      swampCost: 5,
      visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
    });
    return true;
  }
};
