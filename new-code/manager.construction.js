/**
 * manager.construction.js — 根據 frontBase plan 放置 construction sites
 *
 * 規則：
 *  - 每 tick 最多建立 3 個 sites
 *  - 先建當前 RCL 可用建築
 *  - 不建立超過目前 RCL 的 site
 *  - 不重複建立已有建築 / 已有 site
 *  - 如果 plan 已存在，不每 tick 重算（除非 force=true）
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

// ---------------------------------------------------------------------------
// collect placement candidates from plan, filtered by current RCL
// ---------------------------------------------------------------------------

function getCandidates(room, plan, rcl) {
  var candidates = [];

  // Priority scoring: lower = higher priority
  // Roads: 1, Containers: 2, Extensions: 3, Towers: 4, Storage: 5, Links: 6, Ramparts: 7

  // ---- roads ----
  if (plan.roads) {
    for (var i = 0; i < plan.roads.length; i++) {
      var r = plan.roads[i];
      candidates.push({
        x: r.x,
        y: r.y,
        structureType: STRUCTURE_ROAD,
        priority: 1
      });
    }
  }

  // ---- source container roads (from source entries) ----
  if (plan.sources) {
    for (var si = 0; si < plan.sources.length; si++) {
      var s = plan.sources[si];
      if (s.road) {
        for (var ri = 0; ri < s.road.length; ri++) {
          candidates.push({
            x: s.road[ri].x,
            y: s.road[ri].y,
            structureType: STRUCTURE_ROAD,
            priority: 1
          });
        }
      }
    }
  }

  // ---- controller road ----
  if (plan.controller && plan.controller.road) {
    for (var ci = 0; ci < plan.controller.road.length; ci++) {
      candidates.push({
        x: plan.controller.road[ci].x,
        y: plan.controller.road[ci].y,
        structureType: STRUCTURE_ROAD,
        priority: 1
      });
    }
  }

  // ---- storage road ----
  if (plan.storage && plan.storage.road) {
    for (var sti = 0; sti < plan.storage.road.length; sti++) {
      candidates.push({
        x: plan.storage.road[sti].x,
        y: plan.storage.road[sti].y,
        structureType: STRUCTURE_ROAD,
        priority: 1
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
        priority: 3
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
        priority: 4
      });
    }
  }

  // ---- storage ----
  if (plan.storage && rcl >= 4) {
    candidates.push({
      x: plan.storage.pos.x,
      y: plan.storage.pos.y,
      structureType: STRUCTURE_STORAGE,
      priority: 5
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
        priority: 6
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
    console.log('[construction] no plan for ' + roomName + ' — run planner.frontBase.init() first');
    return 0;
  }

  var room = Game.rooms[roomName];
  if (!room) {
    return 0; // no vision
  }
  if (!room.controller || !room.controller.my) {
    console.log('[construction] ' + roomName + ' controller not owned');
    return 0;
  }

  // Limit active construction sites
  var activeSites = room.find(FIND_MY_CONSTRUCTION_SITES);
  if (activeSites.length >= SITES_PER_TICK + 3) {
    // Too many pending sites — wait for builders to catch up
    return 0;
  }

  var rcl = room.controller.level;
  var candidates = getCandidates(room, plan, rcl);

  // Pre-compute allowed counts for types that have RCL limits
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

    // Roads don't count towards RCL limits, but skip if already a road
    if (c.structureType === STRUCTURE_ROAD) {
      var existingStructures = room.lookForAt(LOOK_STRUCTURES, c.x, c.y);
      var blocked = false;
      for (var si = 0; si < existingStructures.length; si++) {
        var es = existingStructures[si];
        // Allow building road on container (miner stands on container, road underneath is fine)
        if (es.structureType === STRUCTURE_CONTAINER) continue;
        // Allow building road on rampart
        if (es.structureType === STRUCTURE_RAMPART) continue;
        // Don't build road where another non-walkable structure exists
        blocked = true;
        break;
      }
      if (blocked) continue;

      // Also check construction sites
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
      break; // max sites reached
    } else if (result === ERR_INVALID_TARGET) {
      // Invalid position — skip
    } else if (result === ERR_RCL_NOT_ENOUGH) {
      // Shouldn't happen since we filter by RCL, but skip
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
