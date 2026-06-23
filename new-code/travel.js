// Room-level cross-room travel using Game.map.findRoute.
//
// PRIMARY PATH: Game.map.findRoute() → PathFinder.search() →
//   Room.serializePath() → creep.moveByPath().
// FALLBACK:    creep.moveTo(roomCenter) for border-push / path-fail /
//   past-all-route-rooms.
//
// Path is recomputed only on invalidation (room change, stuck, flags
// change, target change, moveByPath error).  PathFinder is restricted
// to the current room + next route room so it CANNOT optimise
// globally (no more "swamp too expensive → go back" oscillation).
//
// Optional: nav-0, nav-1, ... nav-N flags are interpolated into
// the route as waypoint rooms.
//
// State stored in creep.memory._t:
//   _t.route         — cached room array from findRoute
//   _t.routeIdx      — current index in route
//   _t.path          — serialized path string (Room.serializePath)
//   _t.pathAge       — ticks since path was computed
//   _t.stuck         — consecutive ticks at same tile
//   _t.lastPos       — {x,y,roomName} of last tick's position
//   _t.lastResult    — last moveByPath / moveTo result code
//   _t.lastRoom      — previous tick's room (anti-oscillation)
//   _t.prevPrevRoom  — two ticks ago room
//   _t.lockUntil     — anti-oscillation lock expiry tick
//
// Usage:
//   const travel = require('travel');
//   if (!travel.run(creep, 'W47N22')) {
//     // Arrived
//   }

var PATH_STUCK_LIMIT = 3;

// Per-room swamp cost overrides for known swamp-heavy rooms.
// Lower values make PathFinder less likely to give up on the room.
var SWAMP_COST_OVERRIDE = {
  'W48N22': 3
};

// ── Nav flag fingerprint (detects flag changes) ──
function getNavFingerprint() {
  var names = [];
  for (var flagName in Game.flags) {
    var match = flagName.match(/^nav-(\d+)$/);
    if (match) {
      names.push(flagName + ':' + Game.flags[flagName].pos.roomName);
    }
  }
  names.sort();
  return names.join('|');
}

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

// ── PathFinder CostMatrix builder ──
// allowedRooms: object set of room names the PathFinder may enter.
//   Rooms not in this set get a fully-blocked CostMatrix.
function buildCostMatrix(roomName, allowedRooms) {
  if (allowedRooms && !allowedRooms[roomName]) {
    var blocked = new PathFinder.CostMatrix();
    for (var y = 0; y < 50; y++) {
      for (var x = 0; x < 50; x++) {
        blocked.set(x, y, 0xFF);
      }
    }
    return blocked;
  }

  var costs = new PathFinder.CostMatrix();
  var terrain = Game.map.getRoomTerrain(roomName);

  for (var y = 0; y < 50; y++) {
    for (var x = 0; x < 50; x++) {
      var tile = terrain.get(x, y);
      if (tile === TERRAIN_MASK_WALL) {
        costs.set(x, y, 0xFF);
      } else if (tile === TERRAIN_MASK_SWAMP) {
        costs.set(x, y, SWAMP_COST_OVERRIDE[roomName] || 5);
      } else {
        costs.set(x, y, 2);
      }
    }
  }

  // Visibility bonuses / penalties
  var room = Game.rooms[roomName];
  if (room) {
    var structures = room.find(FIND_STRUCTURES);
    for (var i = 0; i < structures.length; i++) {
      var s = structures[i];
      if (s.structureType === STRUCTURE_ROAD) {
        if (costs.get(s.pos.x, s.pos.y) < 0xFF) {
          costs.set(s.pos.x, s.pos.y, 1);
        }
      } else if (
        !s.my &&
        (s.structureType === STRUCTURE_WALL ||
         s.structureType === STRUCTURE_RAMPART ||
         s.structureType === STRUCTURE_SPAWN ||
         s.structureType === STRUCTURE_EXTENSION ||
         s.structureType === STRUCTURE_TOWER)
      ) {
        costs.set(s.pos.x, s.pos.y, 0xFF);
      }
    }

    // Block hostile construction sites
    var sites = room.find(FIND_CONSTRUCTION_SITES);
    for (var j = 0; j < sites.length; j++) {
      if (!sites[j].my) {
        costs.set(sites[j].pos.x, sites[j].pos.y, 0xFF);
      }
    }
  }

  return costs;
}

// ── Compute PathFinder path to the NEXT room only ──
// Restricts PathFinder to current room + nextRoom.
// This guarantees the creep must go through this specific room
// (PathFinder cannot "optimise" by routing through other rooms).
// Returns a serialized path string, or null on failure.
function computeStepPath(creep, nextRoom) {
  var currentRoom = creep.pos.roomName;
  var allowedRooms = {};
  allowedRooms[currentRoom] = true;
  allowedRooms[nextRoom] = true;

  var goalPos = new RoomPosition(25, 25, nextRoom);

  var result = PathFinder.search(
    creep.pos,
    { pos: goalPos, range: 1 },
    {
      roomCallback: function (roomName) {
        return buildCostMatrix(roomName, allowedRooms);
      },
      maxRooms: 2,
      plainCost: 2,
      swampCost: 5,
      maxOps: 20000
    }
  );

  if (result.incomplete || !result.path || result.path.length === 0) {
    return null;
  }

  // Serialize: any visible room works
  var room = Game.rooms[currentRoom];
  if (room && room.serializePath) {
    return room.serializePath(result.path);
  }

  return null;
}

// ── Fallback: exit-directed moveTo (same room only, no cross-room pathfinder) ──
// Uses Game.map.findExit to find the exit direction, then picks a walkable
// edge tile in the current room and moves there.  This avoids the cross-room
// moveTo that triggers global pathfinder oscillation.
function moveToFallback(creep, nextRoom) {
  var exitDir = Game.map.findExit(creep.pos.roomName, nextRoom);
  if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
    // Last resort: direct cross-room moveTo
    creep.moveTo(new RoomPosition(25, 25, nextRoom), {
      reusePath: 50, swampCost: 5,
      visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
    });
    return;
  }

  var terrain = Game.map.getRoomTerrain(creep.pos.roomName);
  var targetX, targetY;

  if (exitDir === FIND_EXIT_TOP)       { targetY = 1;  targetX = 25; }
  else if (exitDir === FIND_EXIT_BOTTOM) { targetY = 48; targetX = 25; }
  else if (exitDir === FIND_EXIT_LEFT)   { targetX = 1;  targetY = 25; }
  else if (exitDir === FIND_EXIT_RIGHT)  { targetX = 48; targetY = 25; }
  else { return; }

  // Try to find a walkable tile near the exit center
  var found = false;
  for (var offset = 0; offset < 24; offset++) {
    var candidates = [];
    if (exitDir === FIND_EXIT_TOP || exitDir === FIND_EXIT_BOTTOM) {
      candidates.push({ x: targetX + offset, y: targetY });
      candidates.push({ x: targetX - offset, y: targetY });
    } else {
      candidates.push({ x: targetX, y: targetY + offset });
      candidates.push({ x: targetX, y: targetY - offset });
    }
    for (var ci = 0; ci < candidates.length; ci++) {
      var cx = candidates[ci].x, cy = candidates[ci].y;
      if (cx >= 1 && cx <= 48 && cy >= 1 && cy <= 48 &&
          terrain.get(cx, cy) !== TERRAIN_MASK_WALL) {
        targetX = cx; targetY = cy; found = true; break;
      }
    }
    if (found) break;
  }

  if (found) {
    creep.moveTo(
      new RoomPosition(targetX, targetY, creep.pos.roomName),
      { reusePath: 20, swampCost: 5,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' } }
    );
  }
}

// ── Invalidation checks ──
function shouldInvalidatePath(creep, t, targetRoom) {
  // 1. Target room changed
  if (t._pathTargetRoom !== targetRoom) return true;

  // 2. Nav flags changed
  var fp = getNavFingerprint();
  if (fp !== t._navFingerprint) return true;

  // 3. Stuck too long
  if (t.stuck > PATH_STUCK_LIMIT) return true;

  // 4. Off route
  var onRoute = false;
  if (t.route && t.routeIdx !== undefined) {
    for (var ri = t.routeIdx; ri < t.route.length; ri++) {
      if (creep.pos.roomName === t.route[ri]) {
        onRoute = true;
        break;
      }
    }
  }
  if (!onRoute && t.route && t.routeIdx !== undefined && t.routeIdx < t.route.length) {
    return true;
  }

  return false;
}

module.exports = {
  run: function (creep, targetRoom) {
    var mem = creep.memory;
    if (!mem._t) mem._t = {};
    var t = mem._t;

    // ── Init / reset on target change ──
    if (t._pathTargetRoom !== targetRoom) {
      t._pathTargetRoom = targetRoom;
      t._navFingerprint = getNavFingerprint();
      t.pathAge = 0;
      t.stuck = 0;
      t.lastPos = null;
      t.lastResult = null;
      delete t.path;
      delete t.route;
      delete t.routeIdx;
      delete t.lockUntil;
    }

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
    if (creep.pos.x === 0 || creep.pos.x === 49 ||
        creep.pos.y === 0 || creep.pos.y === 49) {
      creep.moveTo(new RoomPosition(25, 25, creep.pos.roomName), {
        reusePath: 5,
        swampCost: 5,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
      });
      t.lastResult = 'border';
      return true;
    }

    // ── Anti-oscillation: detect A→B→A and lock ──
    if (t.lastRoom && t.lastRoom !== creep.pos.roomName) {
      if (t.prevPrevRoom &&
          creep.pos.roomName === t.prevPrevRoom) {
        t.lockUntil = Game.time + 5;
      }
      t.prevPrevRoom = t.lastRoom;
    }
    t.lastRoom = creep.pos.roomName;

    // ── Build / refresh room route ──
    if (!t.route || t.routeIdx === undefined) {
      t.route = buildRoute(creep.pos.roomName, targetRoom);
      t.routeIdx = 0;
      if (!t.route || t.route.length === 0) {
        // No route — fallback moveTo
        var fbr = creep.moveTo(
          new RoomPosition(25, 25, targetRoom),
          { reusePath: 20, swampCost: 5,
            visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' } }
        );
        t.lastResult = 'moveTo:noroute:' + fbr;
        return true;
      }
    }

    // ── Advance route index ──
    var prevRoom = (t.routeIdx < t.route.length)
      ? t.route[t.routeIdx]
      : null;
    while (
      t.routeIdx < t.route.length &&
      creep.pos.roomName === t.route[t.routeIdx]
    ) {
      t.routeIdx++;
    }

    // Room changed → invalidate tile path, recalc next tick
    if (prevRoom && creep.pos.roomName === prevRoom) {
      delete t.path;
      t.pathAge = 0;
    }

    // ── Past all route rooms → direct moveTo ──
    if (t.routeIdx >= t.route.length) {
      var mr = creep.moveTo(
        new RoomPosition(25, 25, targetRoom),
        { reusePath: 20, swampCost: 5,
          visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' } }
      );
      t.lastResult = 'moveTo:final:' + mr;
      return true;
    }

    var nextRoom = t.route[t.routeIdx];

    // ── Oscillation lock: force exit-directed movement ──
    if (t.lockUntil && Game.time < t.lockUntil) {
      moveToFallback(creep, nextRoom);
      t.lastResult = 'moveTo:lock';
      return true;
    }

    // ── Stuck / stale detection ──
    if (t.lastPos &&
        t.lastPos.x === creep.pos.x &&
        t.lastPos.y === creep.pos.y &&
        t.lastPos.roomName === creep.pos.roomName) {
      t.stuck = (t.stuck || 0) + 1;
    } else {
      t.stuck = 0;
    }
    t.lastPos = {
      x: creep.pos.x,
      y: creep.pos.y,
      roomName: creep.pos.roomName
    };

    // ── Invalidate stale path ──
    if (shouldInvalidatePath(creep, t, targetRoom)) {
      delete t.path;
      t.pathAge = 0;
    }

    // ── Compute path if needed ──
    if (!t.path) {
      var serialized = computeStepPath(creep, nextRoom);
      if (serialized) {
        t.path = serialized;
        t.pathAge = 0;
        t._navFingerprint = getNavFingerprint();
      }
    }

    // ── Follow serialized path ──
    if (t.path) {
      var result = creep.moveByPath(t.path);
      t.lastResult = 'moveByPath:' + result;
      t.pathAge = (t.pathAge || 0) + 1;

      // Path invalidated by errors
      if (result === ERR_NOT_FOUND || result === ERR_INVALID_ARGS) {
        delete t.path;
      }

      return true;
    }

    // ── Fallback: exit-directed moveTo (same room, no cross-room pathfinder) ──
    moveToFallback(creep, nextRoom);
    t.lastResult = 'moveTo:fallback';
    return true;
  }
};
