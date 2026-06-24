/**
 * manager.construction.js — 根據 frontBase plan 放置 construction sites
 *
 * 規則：
 *  - RCL2 寬鬆 (max 10 active sites)；RCL3+ 回歸 SITES_PER_TICK+3
 *  - 優先 container/extensions → 再 tower/storage/link → 最後 road/rampart
 *  - 不建立超過目前 RCL 的 site
 *  - 不重複建立已有建築 / 已有 site
 *
 * Console:
 *   require('manager.construction').run('W47N22');
 */

var SITES_PER_TICK = 3;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function posKey(x, y) {
  return x + ':' + y;
}

function isWallInRoom(roomName, x, y) {
  var terrain = Game.map.getRoomTerrain(roomName);
  return terrain.get(x, y) === TERRAIN_MASK_WALL;
}

function isSwampInRoom(roomName, x, y) {
  var terrain = Game.map.getRoomTerrain(roomName);
  return terrain.get(x, y) === TERRAIN_MASK_SWAMP;
}

function countStructureType(room, structureType) {
  var structures = room.find(FIND_STRUCTURES, {
    filter: function (s) { return s.structureType === structureType; }
  });
  var sites = room.find(FIND_MY_CONSTRUCTION_SITES, {
    filter: function (s) { return s.structureType === structureType; }
  });
  return structures.length + sites.length;
}

function hasStructureOrSiteAt(room, x, y, structureType) {
  var structures = room.lookForAt(LOOK_STRUCTURES, x, y);
  for (var i = 0; i < structures.length; i++) {
    if (!structureType || structures[i].structureType === structureType) return true;
  }
  var sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
  for (var j = 0; j < sites.length; j++) {
    if (!structureType || sites[j].structureType === structureType) return true;
  }
  return false;
}

function getAllowedCount(structureType, rcl) {
  if (typeof CONTROLLER_STRUCTURES === 'undefined') return 0;
  if (!CONTROLLER_STRUCTURES[structureType]) return 0;
  return CONTROLLER_STRUCTURES[structureType][rcl] || 0;
}

function inBounds(x, y, margin) {
  var edge = margin || 1;
  return x >= edge && x <= 49 - edge && y >= edge && y <= 49 - edge;
}

function isTileOpen(room, roomName, x, y) {
  if (!inBounds(x, y, 1)) return false;
  if (isWallInRoom(roomName, x, y)) return false;
  var structs = room.lookForAt(LOOK_STRUCTURES, x, y);
  for (var i = 0; i < structs.length; i++) {
    var st = structs[i].structureType;
    if (st === STRUCTURE_ROAD) continue;
    if (st === STRUCTURE_CONTAINER) continue;
    if (st === STRUCTURE_RAMPART) continue;
    return false;
  }
  var sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
  for (var j = 0; j < sites.length; j++) {
    var cs = sites[j].structureType;
    if (cs === STRUCTURE_ROAD) continue;
    if (cs === STRUCTURE_CONTAINER) continue;
    if (cs === STRUCTURE_RAMPART) continue;
    return false;
  }
  return true;
}

function isAdjacentToSource(room, x, y) {
  var sources = room.find(FIND_SOURCES);
  for (var i = 0; i < sources.length; i++) {
    if (Math.abs(sources[i].pos.x - x) <= 1 && Math.abs(sources[i].pos.y - y) <= 1) {
      return true;
    }
  }
  return false;
}

function pickControllerContainer(room, roomName) {
  var controller = room.controller;
  if (!controller) return null;

  // Find best open tile at range 2-3 from controller, non-source-adjacent,
  // prefer plain over swamp, closer to spawn
  var candidates = [];
  for (var dx = -3; dx <= 3; dx++) {
    for (var dy = -3; dy <= 3; dy++) {
      var r = Math.max(Math.abs(dx), Math.abs(dy));
      if (r < 2 || r > 3) continue;
      var x = controller.pos.x + dx;
      var y = controller.pos.y + dy;
      if (!isTileOpen(room, roomName, x, y)) continue;
      if (isAdjacentToSource(room, x, y)) continue;
      candidates.push({ x: x, y: y, range: r, swamp: isSwampInRoom(roomName, x, y) });
    }
  }
  candidates.sort(function (a, b) {
    return a.range - b.range || (a.swamp ? 1 : 0) - (b.swamp ? 1 : 0);
  });
  return candidates.length > 0 ? candidates[0] : null;
}

// ---------------------------------------------------------------------------
// collect placement candidates from plan, filtered by current RCL
// ---------------------------------------------------------------------------

function getCandidates(room, plan, rcl, roomName) {
  var candidates = [];

  // Priority:
  //   source container: 1
  //   swamp road: 1.2
  //   controller container: 1.5
  //   extension: 2
  //   tower: 3
  //   storage: 4
  //   link: 5
  //   road: 6
  //   rampart: 7

  // ---- source containers ----
  if (plan.sources && rcl >= 2) {
    for (var si = 0; si < plan.sources.length; si++) {
      var s = plan.sources[si];
      if (s.containerPos && !s.containerId) {
        // No container yet — place it
        candidates.push({
          x: s.containerPos.x,
          y: s.containerPos.y,
          structureType: STRUCTURE_CONTAINER,
          priority: 1
        });
      }
    }
  }

  // ---- controller container ----
  if (rcl >= 2) {
    var ccPos = null;
    if (plan.controller && plan.controller.containerPos) {
      ccPos = plan.controller.containerPos;
    }
    if (!ccPos) {
      var picked = pickControllerContainer(room, roomName);
      if (picked) ccPos = picked;
    }
    if (ccPos) {
      candidates.push({
        x: ccPos.x,
        y: ccPos.y,
        structureType: STRUCTURE_CONTAINER,
        priority: 1.5
      });
    }
  }

  // ---- extensions ----
  if (plan.extensions && rcl >= 2) {
    for (var ei = 0; ei < plan.extensions.length; ei++) {
      var ext = plan.extensions[ei];
      if (ext.rcl > rcl) continue;
      candidates.push({
        x: ext.x,
        y: ext.y,
        structureType: STRUCTURE_EXTENSION,
        priority: 2
      });
    }
  }

  // ---- towers ----
  if (plan.towers && rcl >= 3) {
    for (var ti = 0; ti < plan.towers.length; ti++) {
      var t = plan.towers[ti];
      if (t.rcl > rcl) continue;
      candidates.push({
        x: t.x,
        y: t.y,
        structureType: STRUCTURE_TOWER,
        priority: 3
      });
    }
  }

  // ---- storage ----
  if (plan.storage && rcl >= 4) {
    candidates.push({
      x: plan.storage.pos.x,
      y: plan.storage.pos.y,
      structureType: STRUCTURE_STORAGE,
      priority: 4
    });
  }

  // ---- links ----
  if (plan.links && rcl >= 5) {
    for (var li = 0; li < plan.links.length; li++) {
      var link = plan.links[li];
      if (link.rcl > rcl) continue;
      candidates.push({
        x: link.x,
        y: link.y,
        structureType: STRUCTURE_LINK,
        priority: 5
      });
    }
  }

  // ---- roads ----
  // Swamp roads get priority 1.2 (between source container and controller
  // container).  Non-swamp roads stay at 6.  In heavy-swamp rooms like W47N22,
  // roads are the difference between functional and frozen.
  if (plan.roads) {
    for (var ri = 0; ri < plan.roads.length; ri++) {
      var r = plan.roads[ri];
      var onSwamp = isSwampInRoom(roomName, r.x, r.y);
      candidates.push({
        x: r.x,
        y: r.y,
        structureType: STRUCTURE_ROAD,
        priority: onSwamp ? 1.2 : 6
      });
    }
  }

  // ---- ramparts ----
  if (plan.ramparts) {
    for (var rai = 0; rai < plan.ramparts.length; rai++) {
      var ram = plan.ramparts[rai];
      if (ram.rcl > rcl) continue;
      candidates.push({
        x: ram.x,
        y: ram.y,
        structureType: STRUCTURE_RAMPART,
        priority: 7
      });
    }
  }

  // sort by priority
  candidates.sort(function (a, b) {
    return a.priority - b.priority;
  });

  return candidates;
}

// ---------------------------------------------------------------------------
// run — place sites for one tick
// ---------------------------------------------------------------------------

function run(roomName) {
  var plan = Memory.rooms && Memory.rooms[roomName] && Memory.rooms[roomName].plan;
  if (!plan) {
    return 0;
  }

  var room = Game.rooms[roomName];
  if (!room) {
    return 0;
  }
  if (!room.controller || !room.controller.my) {
    return 0;
  }

  var rcl = room.controller.level;

  // RCL2: allow more active sites so containers/extensions can be placed
  // in parallel; builders will catch up.
  var activeSites = room.find(FIND_MY_CONSTRUCTION_SITES);
  var activeSiteLimit = rcl <= 2 ? 10 : SITES_PER_TICK + 3;
  if (activeSites.length >= activeSiteLimit) {
    return 0;
  }

  var candidates = getCandidates(room, plan, rcl, roomName);

  // Pre-compute allowed counts
  var allowedCache = {};

  var placed = 0;
  var attempted = 0;

  for (var i = 0; i < candidates.length && placed < SITES_PER_TICK; i++) {
    var c = candidates[i];
    if (attempted >= SITES_PER_TICK) break;

    // Skip if already built or site exists
    if (hasStructureOrSiteAt(room, c.x, c.y, c.structureType)) continue;

    // Skip if on a wall
    if (isWallInRoom(roomName, c.x, c.y)) continue;

    // Check RCL limit for this structure type
    var allowed = allowedCache[c.structureType];
    if (allowed === undefined) {
      allowed = getAllowedCount(c.structureType, rcl);
      allowedCache[c.structureType] = allowed;
    }
    if (allowed <= 0) continue;

    var current = countStructureType(room, c.structureType);
    if (current >= allowed) continue;

    // Roads: extra checks for non-walkable structures
    if (c.structureType === STRUCTURE_ROAD) {
      var existingStructures = room.lookForAt(LOOK_STRUCTURES, c.x, c.y);
      var blocked = false;
      for (var si = 0; si < existingStructures.length; si++) {
        var es = existingStructures[si];
        if (es.structureType === STRUCTURE_CONTAINER) continue;
        if (es.structureType === STRUCTURE_RAMPART) continue;
        blocked = true;
        break;
      }
      if (blocked) continue;

      var existingSites = room.lookForAt(LOOK_CONSTRUCTION_SITES, c.x, c.y);
      var siteBlocked = false;
      for (var sj = 0; sj < existingSites.length; sj++) {
        if (existingSites[sj].structureType !== STRUCTURE_ROAD &&
            existingSites[sj].structureType !== STRUCTURE_CONTAINER &&
            existingSites[sj].structureType !== STRUCTURE_RAMPART) {
          siteBlocked = true;
          break;
        }
      }
      if (siteBlocked) continue;
    }

    // Don't build on source tiles
    var onSource = false;
    var sources = room.find(FIND_SOURCES);
    for (var srcIdx = 0; srcIdx < sources.length; srcIdx++) {
      if (sources[srcIdx].pos.x === c.x && sources[srcIdx].pos.y === c.y) {
        onSource = true;
        break;
      }
    }
    if (onSource) continue;

    attempted++;

    var result = room.createConstructionSite(c.x, c.y, c.structureType);
    if (result === OK) {
      placed++;
    } else if (result === ERR_FULL) {
      break;
    }
  }

  if (placed > 0) {
    console.log('[construction] ' + roomName + ' placed ' + placed + ' site(s)');
  }
  return placed;
}

module.exports = {
  run: run
};
