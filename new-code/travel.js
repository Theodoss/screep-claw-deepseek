// Room-level cross-room travel using Game.map.findRoute.
//
// PRIMARY PATH:
//   Game.map.findRoute() → findExit → room.find(exitDir) →
//   PathFinder.search(exitTiles) → Room.serializePath() →
//   creep.moveByPath().
//
// KEY INSIGHT: PathFinder goal is the EXIT TILES of the current
// room (not the next room center).  maxRooms:1 + roomCallback
// only allowing current room guarantees PathFinder NEVER does
// cross-room optimization — it must reach a legitimate exit.
//
// FALLBACK: exit-directed moveTo targeting exit tiles.
//
// Optional: nav-0, nav-1, ... nav-N flags are interpolated into
// the route as waypoint rooms.
//
// State stored in creep.memory._t:
//   _t.fromRoom      — room we built the route from
//   _t.route         — room route INCLUDING fromRoom at index 0
//   _t.routeIdx      — current index in route
//   _t.path          — serialized path string (Room.serializePath)
//   _t.pathAge       — ticks since path was computed
//   _t.stuck         — consecutive ticks at same tile
//   _t.lastPos       — {x,y,roomName} of last tick's position
//   _t.lastResult    — last movement result code
//   _t.lastRoom      — previous tick's room (anti-oscillation)
//   _t.prevPrevRoom  — two ticks ago room
//   _t.lockUntil     — anti-oscillation lock expiry tick
//
// Usage:
//   const travel = require('travel');
//   if (!travel.run(creep, 'W47N22')) { /* arrived */ }

var PATH_STUCK_LIMIT = 3;

// Per-room swamp cost overrides for known swamp-heavy rooms.
var SWAMP_COST_OVERRIDE = { 'W48N22': 3 };

// ── Structures that are ALWAYS impassable ──
var BLOCKED_STRUCTURES = [
  STRUCTURE_SPAWN, STRUCTURE_EXTENSION, STRUCTURE_TOWER,
  STRUCTURE_STORAGE, STRUCTURE_TERMINAL, STRUCTURE_LAB,
  STRUCTURE_FACTORY, STRUCTURE_NUKER, STRUCTURE_OBSERVER,
  STRUCTURE_POWER_SPAWN, STRUCTURE_KEEPER_LAIR
];

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
// singleRoom: if set, only this room is allowed (all others blocked).
function buildCostMatrix(roomName, singleRoom) {
  if (singleRoom && roomName !== singleRoom) {
    var blocked = new PathFinder.CostMatrix();
    for (var y = 0; y < 50; y++) {
      for (var x = 0; x < 50; x++) { blocked.set(x, y, 0xFF); }
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

  var room = Game.rooms[roomName];
  if (room) {
    var structures = room.find(FIND_STRUCTURES);
    for (var i = 0; i < structures.length; i++) {
      var s = structures[i];

      if (s.structureType === STRUCTURE_ROAD) {
        if (costs.get(s.pos.x, s.pos.y) < 0xFF) {
          costs.set(s.pos.x, s.pos.y, 1);
        }
        continue;
      }

      if (s.structureType === STRUCTURE_CONTAINER) continue;

      if (s.structureType === STRUCTURE_RAMPART) {
        if (s.my || s.isPublic) continue;
        costs.set(s.pos.x, s.pos.y, 0xFF);
        continue;
      }

      for (var bi = 0; bi < BLOCKED_STRUCTURES.length; bi++) {
        if (s.structureType === BLOCKED_STRUCTURES[bi]) {
          costs.set(s.pos.x, s.pos.y, 0xFF);
          break;
        }
      }
    }

    var sites = room.find(FIND_CONSTRUCTION_SITES);
    for (var j = 0; j < sites.length; j++) {
      costs.set(sites[j].pos.x, sites[j].pos.y, 0xFF);
    }
  }

  return costs;
}

// ── Compute PathFinder path to EXIT TILES in current room ──
// Goal: reach any exit tile that leads to nextRoom (NOT nextRoom center).
// maxRooms:1 ensures PathFinder never searches other rooms.
// Returns serialized path string, or null on failure.
function computeStepPath(creep, nextRoom) {
  var currentRoom = creep.pos.roomName;

  // Find exit direction
  var exitDir = Game.map.findExit(currentRoom, nextRoom);
  if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) return null;

  // Get all exit tiles on that edge
  var room = Game.rooms[currentRoom];
  if (!room) return null;

  var exits = room.find(exitDir);

  if (!exits || exits.length === 0) return null;

  // Build goals from exit tiles
  var goals = [];
  for (var i = 0; i < exits.length; i++) {
    goals.push({ pos: exits[i], range: 0 });
  }

  // PathFinder: search within current room ONLY
  var selfRoom = currentRoom;
  var result = PathFinder.search(
    creep.pos,
    goals,
    {
      roomCallback: function (roomName) {
        return buildCostMatrix(roomName, selfRoom);
      },
      maxRooms: 1,
      plainCost: 2,
      swampCost: 5,
      maxOps: 10000
    }
  );

  if (result.incomplete || !result.path || result.path.length === 0) {
    return null;
  }

  // Serialize path for moveByPath
  var serialized = room.serializePath(result.path);
  return serialized || null;
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

  // 4. Room changed → path is for previous room
  if (t._pathRoom && creep.pos.roomName !== t._pathRoom) return true;

  // 5. Off route
  if (t.route && t.routeIdx !== undefined && t.fromRoom) {
    var onRoute = false;
    if (t.routeIdx >= 0 && creep.pos.roomName === t.route[0]) {
      onRoute = true;
    }
    for (var ri = t.routeIdx; ri < t.route.length; ri++) {
      if (creep.pos.roomName === t.route[ri]) {
        onRoute = true;
        break;
      }
    }
    if (!onRoute) return true;
  }

  return false;
}

// ── Fallback: exit-directed moveTo ──
// Targets exit tiles (x/y=0 or 49) with maxRooms:1.
function moveToFallback(creep, nextRoom) {
  var exitDir = Game.map.findExit(creep.pos.roomName, nextRoom);
  if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
    creep.moveTo(new RoomPosition(25, 25, nextRoom), {
      reusePath: 50, swampCost: 5,
      visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
    });
    return;
  }

  // Find walkable exit tile on the exit boundary
  var terrain = Game.map.getRoomTerrain(creep.pos.roomName);
  var targetX, targetY;
  var isHorizontal;

  if      (exitDir === FIND_EXIT_TOP)    { targetY = 0;  targetX = 25; isHorizontal = true;  }
  else if (exitDir === FIND_EXIT_BOTTOM) { targetY = 49; targetX = 25; isHorizontal = true;  }
  else if (exitDir === FIND_EXIT_LEFT)   { targetX = 0;  targetY = 25; isHorizontal = false; }
  else if (exitDir === FIND_EXIT_RIGHT)  { targetX = 49; targetY = 25; isHorizontal = false; }
  else { return; }

  for (var offset = 0; offset < 25; offset++) {
    var cx, cy;
    if (isHorizontal) {
      cx = targetX + offset;
      if (cx >= 0 && cx <= 49 && terrain.get(cx, targetY) !== TERRAIN_MASK_WALL)
        { targetX = cx; break; }
      cx = targetX - offset;
      if (cx >= 0 && cx <= 49 && terrain.get(cx, targetY) !== TERRAIN_MASK_WALL)
        { targetX = cx; break; }
    } else {
      cy = targetY + offset;
      if (cy >= 0 && cy <= 49 && terrain.get(targetX, cy) !== TERRAIN_MASK_WALL)
        { targetY = cy; break; }
      cy = targetY - offset;
      if (cy >= 0 && cy <= 49 && terrain.get(targetX, cy) !== TERRAIN_MASK_WALL)
        { targetY = cy; break; }
    }
  }

  creep.moveTo(targetX, targetY, {
    reusePath: 20, swampCost: 5,
    maxRooms: 1, maxOps: 5000,
    visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
  });
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
      delete t._pathRoom;
      delete t.route;
      delete t.routeIdx;
      delete t.fromRoom;
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

    // ── Determine next route room ──
    var nextRoom = null;
    if (t.route && t.routeIdx !== undefined && t.routeIdx < t.route.length) {
      nextRoom = t.route[t.routeIdx];
    }

    // ── Border defense: push away from edge unless at correct exit ──
    if (creep.pos.x === 0 || creep.pos.x === 49 ||
        creep.pos.y === 0 || creep.pos.y === 49) {
      if (nextRoom) {
        var exitDir = Game.map.findExit(creep.pos.roomName, nextRoom);
        var atCorrectExit = false;
        if (exitDir === FIND_EXIT_TOP    && creep.pos.y === 0)  atCorrectExit = true;
        if (exitDir === FIND_EXIT_BOTTOM && creep.pos.y === 49) atCorrectExit = true;
        if (exitDir === FIND_EXIT_LEFT   && creep.pos.x === 0)  atCorrectExit = true;
        if (exitDir === FIND_EXIT_RIGHT  && creep.pos.x === 49) atCorrectExit = true;
        if (atCorrectExit) {
          t.lastResult = 'border:exit';
          return true; // at correct exit, let natural crossing happen
        }
      }
      creep.moveTo(new RoomPosition(25, 25, creep.pos.roomName), {
        reusePath: 5, swampCost: 5,
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

    // ── Build / refresh room route (includes fromRoom at index 0) ──
    if (!t.route || t.routeIdx === undefined) {
      var raw = buildRoute(creep.pos.roomName, targetRoom);
      t.route = raw ? [creep.pos.roomName].concat(raw) : null;
      t.routeIdx = 0;
      t.fromRoom = creep.pos.roomName;
      if (!t.route || t.route.length <= 1) {
        creep.moveTo(new RoomPosition(25, 25, targetRoom), {
          reusePath: 20, swampCost: 5,
          visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
        });
        t.lastResult = 'moveTo:noroute';
        return true;
      }
    }

    // ── Advance route index ──
    // route[0] is fromRoom; advance past rooms we've entered.
    var prevRoom = (t.routeIdx < t.route.length)
      ? t.route[t.routeIdx] : null;
    while (
      t.routeIdx < t.route.length &&
      creep.pos.roomName === t.route[t.routeIdx]
    ) {
      t.routeIdx++;
    }

    // Room changed → invalidate tile path (path was for previous room)
    if (prevRoom && creep.pos.roomName !== prevRoom) {
      delete t.path;
      delete t._pathRoom;
      t.pathAge = 0;
    }

    nextRoom = (t.routeIdx < t.route.length) ? t.route[t.routeIdx] : null;

    // ── Past all route rooms → direct moveTo ──
    if (!nextRoom || t.routeIdx >= t.route.length) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 20, swampCost: 5,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
      });
      t.lastResult = 'moveTo:final';
      return true;
    }

    // ── Oscillation lock: force fallback movement ──
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
      delete t._pathRoom;
      t.pathAge = 0;
    }

    // ── Compute path if needed ──
    if (!t.path) {
      var serialized = computeStepPath(creep, nextRoom);
      if (serialized) {
        t.path = serialized;
        t._pathRoom = creep.pos.roomName;
        t.pathAge = 0;
        t._navFingerprint = getNavFingerprint();
      }
    }

    // ── Follow serialized path ──
    if (t.path) {
      t.pathAge = (t.pathAge || 0) + 1;
      var result = creep.moveByPath(t.path);
      t.lastResult = 'moveByPath:' + result;

      if (result === ERR_NOT_FOUND || result === ERR_INVALID_ARGS) {
        delete t.path;
        delete t._pathRoom;
      }

      return true;
    }

    // ── Fallback: exit-directed moveTo ──
    moveToFallback(creep, nextRoom);
    t.lastResult = 'moveTo:fallback';
    return true;
  }
};
