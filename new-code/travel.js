// Room-level cross-room travel using Game.map.findRoute.
//
// Uses moveTo(roomCenter) for single-room-boundary navigation —
// never does multi-room pathfinding, eliminating border oscillation.
// Handles swamp natively with swampCost option.
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

    // ── Oscillation lock: head to next room center, no recalculation ──
    if (t.lockUntil && Game.time < t.lockUntil) {
      var lockTarget = (t.route && t.routeIdx < t.route.length)
        ? t.route[t.routeIdx]
        : targetRoom;
      creep.moveTo(new RoomPosition(25, 25, lockTarget), {
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

    // ── Past all rooms → head to target center ──
    if (t.routeIdx >= t.route.length) {
      creep.moveTo(new RoomPosition(25, 25, targetRoom), {
        reusePath: 20,
        swampCost: 5,
        visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
      });
      return true;
    }

    // ── Move toward next room center (single boundary, swamp-aware) ──
    var nextRoom = t.route[t.routeIdx];
    creep.moveTo(new RoomPosition(25, 25, nextRoom), {
      reusePath: 50,
      swampCost: 5,
      visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
    });
    return true;
  }
};
