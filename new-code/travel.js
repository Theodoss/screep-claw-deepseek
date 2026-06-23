// Room-level cross-room travel using Game.map.findRoute.
//
// PRIMARY PATH:
//   Game.map.findRoute() → findExit → room.find(exitDir) →
//   PathFinder.search(exitTiles) → follow step-by-step with
//   creep.move(getDirectionTo(nextStep)).
//
// KEY INSIGHT: PathFinder goal is the EXIT TILES of the current
// room (not next room center).  maxRooms:1 guarantees PathFinder
// NEVER does cross-room optimization.
//
// FALLBACK: exit-directed moveTo targeting exit tiles.
//
// Path stored as [{x,y,roomName}] — NO Room.serializePath dependency.
//
// Optional: nav-0, nav-1, ... nav-N flags as waypoint rooms.
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

// Structures that are ALWAYS impassable.
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

// ── Project entry coordinate onto exit edge ──
// Given where the creep entered the room and which exit to take,
// compute the ideal exit tile coordinate (diagonal projection).
// Example: enter BOTTOM at x=27, exit RIGHT → goal near (49,27)
function projectExitCoord(entryX, entryY, enterDir, exitDir) {
  if (!enterDir) {
    return { x: entryX, y: entryY };
  }

  var projX, projY;

  if (exitDir === FIND_EXIT_LEFT) {
    projX = 0;
    projY = (enterDir === FIND_EXIT_BOTTOM || enterDir === FIND_EXIT_TOP)
      ? Math.max(1, Math.min(48, entryX))
      : Math.max(1, Math.min(48, entryY));
  } else if (exitDir === FIND_EXIT_RIGHT) {
    projX = 49;
    projY = (enterDir === FIND_EXIT_BOTTOM || enterDir === FIND_EXIT_TOP)
      ? Math.max(1, Math.min(48, entryX))
      : Math.max(1, Math.min(48, entryY));
  } else if (exitDir === FIND_EXIT_TOP) {
    projY = 0;
    projX = (enterDir === FIND_EXIT_LEFT || enterDir === FIND_EXIT_RIGHT)
      ? Math.max(1, Math.min(48, entryY))
      : Math.max(1, Math.min(48, entryX));
  } else {
    projY = 49;
    projX = (enterDir === FIND_EXIT_LEFT || enterDir === FIND_EXIT_RIGHT)
      ? Math.max(1, Math.min(48, entryY))
      : Math.max(1, Math.min(48, entryX));
  }

  return { x: projX, y: projY };
}

// ── Select N candidate exit tiles nearest the projected point ──
function selectCandidates(exits, projected, maxCandidates) {
  var indexed = [];
  for (var i = 0; i < exits.length; i++) {
    var dx = exits[i].x - projected.x;
    var dy = exits[i].y - projected.y;
    indexed.push({ pos: exits[i], dist: dx * dx + dy * dy });
  }
  indexed.sort(function (a, b) { return a.dist - b.dist; });

  var candidates = [];
  for (var i = 0; i < Math.min(maxCandidates, indexed.length); i++) {
    candidates.push(indexed[i].pos);
  }
  return candidates;
}

// ── Compute PathFinder path to EXIT TILES in current room ──
// Uses corridor-aware exit planning: projects entry coordinate onto
// the exit edge, tries multiple candidate exit tiles, and picks the
// one with the shortest valid PathFinder path.
// Returns [{x,y,roomName}] or null.
function computeStepPath(creep, nextRoom, enterDir) {
  var currentRoom = creep.pos.roomName;

  var exitDir = Game.map.findExit(currentRoom, nextRoom);
  if (exitDir === ERR_NO_PATH || exitDir === ERR_INVALID_ARGS) return null;

  var room = Game.rooms[currentRoom];
  if (!room) return null;

  var exits = room.find(exitDir);
  if (!exits || exits.length === 0) return null;

  // Project entry coordinate onto exit edge
  var projected = projectExitCoord(
    creep.pos.x, creep.pos.y, enterDir, exitDir
  );

  // Select candidate exit tiles near the projection
  var candidates = selectCandidates(exits, projected, 8);

  // Try each candidate, pick shortest valid PathFinder path
  var selfRoom = currentRoom;
  var bestPath = null;
  var bestLen = Infinity;
  var selectedGoal = null;

  for (var ci = 0; ci < candidates.length; ci++) {
    var result = PathFinder.search(
      creep.pos,
      [{ pos: candidates[ci], range: 0 }],
      {
        roomCallback: function (roomName) {
          return buildCostMatrix(roomName, selfRoom);
        },
        maxRooms: 1,
        plainCost: 2,
        swampCost: 5,
        maxOps: 8000
      }
    );

    if (!result.incomplete && result.path && result.path.length < bestLen) {
      bestPath = result.path;
      bestLen = result.path.length;
      selectedGoal = candidates[ci];
    }
  }

  if (!bestPath) return null;

  // Debug
  if (creep.name.indexOf('claimer') !== -1 || creep.name.indexOf('pioneer') !== -1) {
    console.log(
      '[travel:path] ' + creep.name +
      ' room=' + currentRoom +
      ' enter=' + (enterDir || 'none') +
      ' exit=' + exitDir +
      ' proj=' + projected.x + ',' + projected.y +
      ' goal=' + selectedGoal.x + ',' + selectedGoal.y +
      ' len=' + bestLen
    );
  }

  // Convert RoomPosition[] → lightweight [{x,y,roomName}]
  var path = [];
  for (var j = 0; j < bestPath.length; j++) {
    path.push({
      x: bestPath[j].x,
      y: bestPath[j].y,
      roomName: bestPath[j].roomName
    });
  }
  return path;
}

// ── Follow path step-by-step ──
// Returns true if the creep moved, false if path complete or failed.
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
    return false; // path complete
  }

  t.pathIdx = idx;
  var nextStep = path[idx];
  var targetPos = new RoomPosition(
    nextStep.x, nextStep.y, nextStep.roomName
  );
  var dir = creep.pos.getDirectionTo(targetPos);

  if (dir && dir !== ERR_NO_PATH && dir !== ERR_INVALID_ARGS) {
    var result = creep.move(dir);
    t.lastResult = 'move:' + result;
    return true;
  }

  return false;
}

// ── Fallback: exit-directed moveTo ──
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

// ── Debug log for claimers and pioneers ──
function debugLog(creep, t, nextRoom) {
  if (creep.name.indexOf('claimer') === -1 &&
      creep.name.indexOf('pioneer') === -1) return;
  console.log(
    '[travel] ' + creep.name +
    ' room=' + creep.pos.roomName +
    ' pos=' + creep.pos.x + ',' + creep.pos.y +
    ' routeIdx=' + t.routeIdx +
    ' next=' + (nextRoom || '?') +
    ' result=' + (t.lastResult || '?') +
    ' stuck=' + (t.stuck || 0) +
    ' pathAge=' + (t.pathAge || 0) +
    (t.path ? ' hasPath' : ' noPath')
  );
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
      delete t._pathRoom;
      delete t.route;
      delete t.routeIdx;
      delete t.fromRoom;
      delete t.lockUntil;
    }

    // ── Arrived? ──
    // In targetRoom → immediately hand off to role.
    // Only exception: at absolute edge (x/y=0 or 49) → push inward first.
    if (creep.pos.roomName === targetRoom) {
      if (creep.pos.x === 0 || creep.pos.x === 49 ||
          creep.pos.y === 0 || creep.pos.y === 49) {
        creep.moveTo(new RoomPosition(25, 25, targetRoom), {
          reusePath: 3, swampCost: 5,
          visualizePathStyle: { stroke: '#44cc44', lineStyle: 'dotted' }
        });
        return true;
      }
      delete mem._t;
      return false;
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
          // Actively try to cross the boundary
          var moveResult = creep.move(exitDir);
          t.lastResult = 'border:exit:' + moveResult;
          if (moveResult === OK || moveResult === ERR_TIRED) {
            debugLog(creep, t, nextRoom);
            return true;
          }
          // move failed — fall through to fallback
          delete t.path;
          delete t.pathIdx;
          delete t._pathRoom;
          moveToFallback(creep, nextRoom);
          t.lastResult = 'moveTo:fallback';
          debugLog(creep, t, nextRoom);
          return true;
        }
      }
      // Wrong edge — push one tile inward (no pathfinding)
      if (creep.pos.y === 49)       creep.move(TOP);
      else if (creep.pos.y === 0)   creep.move(BOTTOM);
      else if (creep.pos.x === 49)  creep.move(LEFT);
      else if (creep.pos.x === 0)   creep.move(RIGHT);
      t.lastResult = 'border';
      debugLog(creep, t, nextRoom);
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
        debugLog(creep, t, nextRoom);
        return true;
      }
    }

    // ── Recalculate routeIdx from creep's current room ──
    if (t.route) {
      var currentIndex = t.route.indexOf(creep.pos.roomName);
      if (currentIndex === -1) {
        // Creep is in a room not on the route — rebuild
        delete t.route;
        delete t.routeIdx;
        delete t.path;
        delete t.pathIdx;
        delete t._pathRoom;
        t.pathAge = 0;
      } else {
        // Previous room (before advancement) for path invalidation
        var prevRoom = (t.routeIdx < t.route.length)
          ? t.route[t.routeIdx] : null;
        t.routeIdx = currentIndex + 1;

        // Compute enterDir: direction from current room to previous room
        if (currentIndex > 0) {
          t._enterDir = Game.map.findExit(
            creep.pos.roomName, t.route[currentIndex - 1]
          );
        } else {
          t._enterDir = null;
        }

        // Room changed → invalidate tile path
        if (prevRoom !== null && t.routeIdx > 0 &&
            currentIndex !== t.routeIdx - 1) {
          delete t.path;
          delete t.pathIdx;
          delete t._pathRoom;
          t.pathAge = 0;
        }
      }
    }

    nextRoom = (t.routeIdx < t.route.length) ? t.route[t.routeIdx] : null;

    // ── Past all route rooms → direct moveTo ──
    if (!nextRoom || t.routeIdx >= t.route.length) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 20, swampCost: 5,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
      });
      t.lastResult = 'moveTo:final';
      debugLog(creep, t, nextRoom);
      return true;
    }

    // ── Oscillation lock: force fallback movement ──
    if (t.lockUntil && Game.time < t.lockUntil) {
      moveToFallback(creep, nextRoom);
      t.lastResult = 'moveTo:lock';
      debugLog(creep, t, nextRoom);
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
    if (
      t._pathTargetRoom !== targetRoom ||
      (t._pathRoom && creep.pos.roomName !== t._pathRoom)
    ) {
      delete t.path;
      delete t.pathIdx;
      delete t._pathRoom;
      t.pathAge = 0;
    }

    // Nav flags changed → full route + path rebuild
    if (getNavFingerprint() !== t._navFingerprint) {
      delete t.route;
      delete t.routeIdx;
      delete t.fromRoom;
      delete t.path;
      delete t.pathIdx;
      delete t._pathRoom;
      t.pathAge = 0;
    }

    // Route suspiciously long vs direct? Rebuild too
    if (t.route && t.route.length > 4) {
      var direct = Game.map.findRoute(
        creep.pos.roomName, targetRoom,
        { routeCallback: function (rn) { return 1; } }
      );
      if (direct !== ERR_NO_PATH && direct.length < t.route.length - 1) {
        console.log('[travel] ' + creep.name + ' route too long (' + t.route.length + ' vs direct ' + (direct.length) + '), rebuilding');
        delete t.route;
        delete t.routeIdx;
        delete t.fromRoom;
        delete t.path;
        delete t.pathIdx;
        delete t._pathRoom;
        t.pathAge = 0;
      }
    }

    // Stuck too long → full route + path reset
    if (t.stuck > PATH_STUCK_LIMIT) {
      delete t.route;
      delete t.routeIdx;
      delete t.fromRoom;
      delete t.path;
      delete t.pathIdx;
      delete t._pathRoom;
      t.stuck = 0;
      t.pathAge = 0;
    }

    // ── Compute path if needed ──
    if (!t.path) {
      var computed = computeStepPath(creep, nextRoom, t._enterDir);
      if (computed) {
        t.path = computed;
        t.pathIdx = 0;
        t._pathRoom = creep.pos.roomName;
        t.pathAge = 0;
        t._navFingerprint = getNavFingerprint();
      }
    }

    // ── Follow path ──
    if (t.path) {
      t.pathAge = (t.pathAge || 0) + 1;
      var moved = followPath(creep, t);
      if (moved) {
        debugLog(creep, t, nextRoom);
        return true;
      }
      // Path failed — fallback immediately same tick
      delete t.path;
      delete t.pathIdx;
      delete t._pathRoom;
    }

    // ── Fallback ──
    moveToFallback(creep, nextRoom);
    t.lastResult = 'moveTo:fallback';
    debugLog(creep, t, nextRoom);
    return true;
  }
};
