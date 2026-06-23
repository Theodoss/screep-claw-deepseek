// Room-level cross-room travel using Game.map.findRoute.
//
// PRIMARY:   Game.map.findRoute() → PathFinder.search() →
//            follow path step-by-step with creep.move(getDirectionTo(next)).
// FALLBACK:  Exit-directed creep.moveTo() for path-fail / no-path.
//
// Path is recomputed only on invalidation (room change, stuck, flags
// change, target change).  PathFinder is restricted to current room +
// next route room so it CANNOT optimise globally (no more "swamp too
// expensive → go back" oscillation).
//
// Optional: nav-0, nav-1, ... nav-N flags are interpolated into
// the route as waypoint rooms.
//
// State stored in creep.memory._t:
//   _t.fromRoom      — room we built the route from
//   _t.route         — room route INCLUDING fromRoom at index 0
//   _t.routeIdx      — current index in route
//   _t.path          — PathFinder path as [{x,y,roomName}]
//   _t.pathIdx       — current step in path
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
// allowedRooms: object set of room names the PathFinder may enter.
//   Rooms not in this set get a fully-blocked CostMatrix.
function buildCostMatrix(roomName, allowedRooms) {
  if (allowedRooms && !allowedRooms[roomName]) {
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

  // Visibility bonuses / penalties
  var room = Game.rooms[roomName];
  if (room) {
    var structures = room.find(FIND_STRUCTURES);
    for (var i = 0; i < structures.length; i++) {
      var s = structures[i];

      // Roads get cost 1 (faster than plain)
      if (s.structureType === STRUCTURE_ROAD) {
        if (costs.get(s.pos.x, s.pos.y) < 0xFF) {
          costs.set(s.pos.x, s.pos.y, 1);
        }
        continue;
      }

      // Containers are walkable (no change)
      if (s.structureType === STRUCTURE_CONTAINER) continue;

      // Own or public ramparts are walkable
      if (s.structureType === STRUCTURE_RAMPART) {
        if (s.my || s.isPublic) continue;
        costs.set(s.pos.x, s.pos.y, 0xFF);
        continue;
      }

      // Block all other impassable structures (own or hostile)
      for (var bi = 0; bi < BLOCKED_STRUCTURES.length; bi++) {
        if (s.structureType === BLOCKED_STRUCTURES[bi]) {
          costs.set(s.pos.x, s.pos.y, 0xFF);
          break;
        }
      }
    }

    // Block construction sites (can't walk through)
    var sites = room.find(FIND_CONSTRUCTION_SITES);
    for (var j = 0; j < sites.length; j++) {
      costs.set(sites[j].pos.x, sites[j].pos.y, 0xFF);
    }
  }

  return costs;
}

// ── Compute PathFinder path to the NEXT room only ──
// Restricts PathFinder to current room + nextRoom.
// Returns [{x,y,roomName}] or null on failure.
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

  // Convert RoomPosition[] to lightweight [{x,y,roomName}]
  var path = [];
  for (var i = 0; i < result.path.length; i++) {
    path.push({
      x: result.path[i].x,
      y: result.path[i].y,
      roomName: result.path[i].roomName
    });
  }
  return path;
}

// ── Follow path step-by-step with creep.move(getDirectionTo) ──
// Returns true if the creep still has path steps to follow.
function followPath(creep, t) {
  var path = t.path;
  if (!path) return false;

  var idx = t.pathIdx || 0;

  // Advance past reached positions
  while (idx < path.length) {
    var step = path[idx];
    if (step.roomName === creep.pos.roomName &&
        step.x === creep.pos.x && step.y === creep.pos.y) {
      idx++;
    } else {
      break;
    }
  }

  if (idx >= path.length) {
    delete t.path;
    delete t.pathIdx;
    return false;
  }

  t.pathIdx = idx;
  var nextStep = path[idx];

  // getDirectionTo handles cross-room: returns exit direction
  var dir = creep.pos.getDirectionTo(
    nextStep.x, nextStep.y, nextStep.roomName
  );

  if (dir && dir !== ERR_NO_PATH && dir !== ERR_INVALID_ARGS) {
    var result = creep.move(dir);
    t.lastResult = 'move:' + result;
    return true;
  }

  // Can't determine direction → invalidate
  delete t.path;
  delete t.pathIdx;
  return false;
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

  // 4. Off route: creep is not at a valid point in the route
  if (t.route && t.routeIdx !== undefined && t.fromRoom) {
    var onRoute = false;
    // Starting room (haven't left yet, routeIdx may be 0)
    if (t.routeIdx >= 0 && creep.pos.roomName === t.route[0]) {
      onRoute = true;
    }
    // Remaining route rooms
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
// Targets the actual exit tiles (x/y=0 or 49) using maxRooms:1
// to prevent cross-room pathfinder oscillation.
function moveToFallback(creep, nextRoom) {
  var exitDir = Game.map.findExit(creep.pos.roomName, nextRoom);
  if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) {
    creep.moveTo(new RoomPosition(25, 25, nextRoom), {
      reusePath: 50, swampCost: 5,
      visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
    });
    return;
  }

  var terrain = Game.map.getRoomTerrain(creep.pos.roomName);
  var targetX, targetY;
  var isHorizontal;

  if (exitDir === FIND_EXIT_TOP)       { targetY = 0;  targetX = 25; isHorizontal = true;  }
  else if (exitDir === FIND_EXIT_BOTTOM) { targetY = 49; targetX = 25; isHorizontal = true;  }
  else if (exitDir === FIND_EXIT_LEFT)   { targetX = 0;  targetY = 25; isHorizontal = false; }
  else if (exitDir === FIND_EXIT_RIGHT)  { targetX = 49; targetY = 25; isHorizontal = false; }
  else { return; }

  // Find nearest walkable exit tile on the exit boundary
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
      delete t.pathIdx;
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

    // ── Determine next route room for smart border defense ──
    var nextRoom = null;
    if (t.route && t.routeIdx !== undefined && t.routeIdx < t.route.length) {
      nextRoom = t.route[t.routeIdx];
    }

    // ── Border defense: push away from edge unless at correct exit ──
    if (creep.pos.x === 0 || creep.pos.x === 49 ||
        creep.pos.y === 0 || creep.pos.y === 49) {
      // Check if this edge leads to the next route room
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
      // Wrong edge — push back to center
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
        // No route or only fromRoom — fallback moveTo
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
    // For the creep in fromRoom: routeIdx advances from 0 to 1,
    //   nextRoom = route[1] = first adjacent room.
    var prevRoom = (t.routeIdx < t.route.length)
      ? t.route[t.routeIdx] : null;
    while (
      t.routeIdx < t.route.length &&
      creep.pos.roomName === t.route[t.routeIdx]
    ) {
      t.routeIdx++;
    }

    // Room changed → invalidate tile path
    if (prevRoom && creep.pos.roomName === prevRoom) {
      delete t.path;
      delete t.pathIdx;
      t.pathAge = 0;
    }

    // Update nextRoom after routeIdx advancement
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
      delete t.pathIdx;
      t.pathAge = 0;
    }

    // ── Compute path if needed ──
    if (!t.path) {
      var computed = computeStepPath(creep, nextRoom);
      if (computed) {
        t.path = computed;
        t.pathIdx = 0;
        t.pathAge = 0;
        t._navFingerprint = getNavFingerprint();
      }
    }

    // ── Follow path step-by-step ──
    if (t.path) {
      t.pathAge = (t.pathAge || 0) + 1;
      if (followPath(creep, t)) return true;
    }

    // ── Fallback: exit-directed moveTo ──
    moveToFallback(creep, nextRoom);
    t.lastResult = 'moveTo:fallback';
    return true;
  }
};
