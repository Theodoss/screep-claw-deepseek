/**
 * planner.frontBase.js — W47N22 前線戰爭基地規劃器
 *
 * 定位：一次性前線基地，RCL5 為上限，不規劃 RCL6+ 建築。
 * 使用現有 spawn + source containers，不移動/重建。
 *
 * Console 指令：
 *   require('planner.frontBase').init('W47N22');
 *   require('planner.frontBase').init('W47N22', true);   // 強制重算
 *   require('planner.frontBase').summary('W47N22');
 */

const MAX_RCL = 5;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function posKey(x, y) {
  return x + ':' + y;
}

function clonePos(pos) {
  return { x: pos.x, y: pos.y, roomName: pos.roomName };
}

function inBounds(x, y, margin) {
  var edge = margin || 1;
  return x >= edge && x <= 49 - edge && y >= edge && y <= 49 - edge;
}

function getRange(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

function isWall(terrain, x, y) {
  return terrain.get(x, y) === TERRAIN_MASK_WALL;
}

function isSwamp(terrain, x, y) {
  return terrain.get(x, y) === TERRAIN_MASK_SWAMP;
}

function isPlain(terrain, x, y) {
  return terrain.get(x, y) === 0;
}

// ---------------------------------------------------------------------------
// tile occupancy
// ---------------------------------------------------------------------------

function buildOccupied(room) {
  var occupied = {};
  var structures = room.find(FIND_STRUCTURES);
  for (var i = 0; i < structures.length; i++) {
    var s = structures[i];
    // treat roads/walkable as non-blocking for planning
    if (s.structureType === STRUCTURE_ROAD) continue;
    if (s.structureType === STRUCTURE_CONTAINER) continue;
    if (s.structureType === STRUCTURE_RAMPART && (s.my || s.isPublic)) continue;
    occupied[posKey(s.pos.x, s.pos.y)] = s;
  }
  var sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  for (var j = 0; j < sites.length; j++) {
    var cs = sites[j];
    occupied[posKey(cs.pos.x, cs.pos.y)] = cs;
  }
  return occupied;
}

function isBlocked(terrain, occupied, x, y) {
  if (!inBounds(x, y, 1)) return true;
  if (isWall(terrain, x, y)) return true;
  return !!occupied[posKey(x, y)];
}

function isOpen(terrain, occupied, x, y) {
  return !isBlocked(terrain, occupied, x, y);
}

// ---------------------------------------------------------------------------
// cost matrix for pathfinding
// ---------------------------------------------------------------------------

function buildCostMatrix(room, terrain, occupied, extraBlocked) {
  var matrix = new PathFinder.CostMatrix();
  for (var x = 0; x < 50; x++) {
    for (var y = 0; y < 50; y++) {
      if (isWall(terrain, x, y)) {
        matrix.set(x, y, 255);
      } else if (isSwamp(terrain, x, y)) {
        matrix.set(x, y, 10);
      } else {
        matrix.set(x, y, 2);
      }
    }
  }
  // block occupied tiles (structures/sites)
  for (var ox = 0; ox < 50; ox++) {
    for (var oy = 0; oy < 50; oy++) {
      if (occupied[posKey(ox, oy)]) {
        matrix.set(ox, oy, 255);
      }
    }
  }
  // block extra positions (e.g. source tiles to avoid walking over sources)
  if (extraBlocked) {
    for (var i = 0; i < extraBlocked.length; i++) {
      var eb = extraBlocked[i];
      matrix.set(eb.x, eb.y, 255);
    }
  }
  return matrix;
}

function findPath(room, terrain, occupied, from, to, range, extraBlocked) {
  // Crude path for roads: findRoute then follow.
  // Since we only plan intra-room roads, use PathFinder.
  var matrix = buildCostMatrix(room, terrain, occupied, extraBlocked);
  // Make start/target walkable
  matrix.set(from.x, from.y, 1);
  matrix.set(to.x, to.y, 1);

  var result = PathFinder.search(
    new RoomPosition(from.x, from.y, room.name),
    { pos: new RoomPosition(to.x, to.y, room.name), range: range || 1 },
    {
      maxRooms: 1,
      maxOps: 3000,
      plainCost: 2,
      swampCost: 5,
      roomCallback: function (rn) {
        return rn === room.name ? matrix : false;
      }
    }
  );
  if (result.incomplete) return null;
  return result.path;
}

// ---------------------------------------------------------------------------
// find nearby open positions sorted by plain-first
// ---------------------------------------------------------------------------

function nearbyOpenTiles(terrain, occupied, center, minRange, maxRange, exclude) {
  var results = [];
  exclude = exclude || {};
  for (var dx = -maxRange; dx <= maxRange; dx++) {
    for (var dy = -maxRange; dy <= maxRange; dy++) {
      var r = Math.max(Math.abs(dx), Math.abs(dy));
      if (r < minRange || r > maxRange) continue;
      var x = center.x + dx;
      var y = center.y + dy;
      if (!isOpen(terrain, occupied, x, y)) continue;
      if (exclude[posKey(x, y)]) continue;
      results.push({ x: x, y: y, range: r, swamp: isSwamp(terrain, x, y) });
    }
  }
  results.sort(function (a, b) {
    return a.range - b.range || (a.swamp ? 1 : 0) - (b.swamp ? 1 : 0);
  });
  return results;
}

// ---------------------------------------------------------------------------
// plan extensions in rings around the anchor area
// ---------------------------------------------------------------------------

function planExtensions(terrain, occupied, anchorPos, count, reserved) {
  reserved = reserved || {};
  var extensions = [];
  var ring = 1;
  while (extensions.length < count && ring <= 8) {
    var candidates = nearbyOpenTiles(terrain, occupied, anchorPos, ring, ring, reserved);
    for (var i = 0; i < candidates.length && extensions.length < count; i++) {
      var c = candidates[i];
      var key = posKey(c.x, c.y);
      if (reserved[key]) continue;
      // Don't place extensions on swamp in early rings if we have enough plains
      // but allow swamp when we run out of plain candidates
      extensions.push({ x: c.x, y: c.y });
      reserved[key] = true;
    }
    ring++;
  }
  return extensions;
}

// ---------------------------------------------------------------------------
// road between two points
// ---------------------------------------------------------------------------

function planRoad(room, terrain, occupied, from, to, roadReserved, sourceBlock, extReserved) {
  // Combine source blocks + extension positions as extra blocked tiles for pathfinding
  var extraBlocked = (sourceBlock || []).slice();
  if (extReserved) {
    for (var ek in extReserved) {
      var parts = ek.split(':');
      extraBlocked.push({ x: parseInt(parts[0], 10), y: parseInt(parts[1], 10) });
    }
  }
  var path = findPath(room, terrain, occupied, from, to, 1, extraBlocked);
  if (!path) return [];
  var roads = [];
  var seen = {};
  for (var i = 0; i < path.length; i++) {
    var step = path[i];
    var key = posKey(step.x, step.y);
    if (seen[key] || reserved[key]) continue;
    seen[key] = true;
    roads.push({ x: step.x, y: step.y });
  }
  return roads;
}

// ---------------------------------------------------------------------------
// init — build the full plan
// ---------------------------------------------------------------------------

function init(roomName, force) {
  if (!force && Memory.rooms && Memory.rooms[roomName] && Memory.rooms[roomName].plan) {
    console.log('[frontBase] plan already exists for ' + roomName + '. Use force=true to re-plan.');
    return Memory.rooms[roomName].plan;
  }

  var room = Game.rooms[roomName];
  if (!room) {
    console.log('[frontBase:error] no vision on ' + roomName);
    return null;
  }
  if (!room.controller || !room.controller.my) {
    console.log('[frontBase:error] ' + roomName + ' controller not owned');
    return null;
  }

  var terrain = Game.map.getRoomTerrain(roomName);
  var occupied = buildOccupied(room);

  // ---- find existing spawn and source containers ----
  var spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) {
    console.log('[frontBase:error] no spawn in ' + roomName);
    return null;
  }
  var spawn = spawns[0];
  var anchor = { x: spawn.pos.x, y: spawn.pos.y, roomName: roomName };

  var sources = room.find(FIND_SOURCES);
  var containers = room.find(FIND_STRUCTURES, {
    filter: function (s) { return s.structureType === STRUCTURE_CONTAINER; }
  });

  var reserved = {};
  reserved[posKey(spawn.pos.x, spawn.pos.y)] = true;

  // source entries with existing containers
  var sourceEntries = [];
  var sourceBlock = []; // block source tiles from roads
  for (var si = 0; si < sources.length; si++) {
    var source = sources[si];
    sourceBlock.push({ x: source.pos.x, y: source.pos.y });
    reserved[posKey(source.pos.x, source.pos.y)] = true;

    // find existing container adjacent to this source
    var container = null;
    for (var ci = 0; ci < containers.length; ci++) {
      if (containers[ci].pos.getRangeTo(source) <= 1) {
        container = containers[ci];
        break;
      }
    }
    if (!container) {
      console.log('[frontBase:warn] source ' + source.id + ' has no adjacent container');
      continue;
    }
    reserved[posKey(container.pos.x, container.pos.y)] = true;

    sourceEntries.push({
      sourceId: source.id,
      containerId: container.id,
      containerPos: { x: container.pos.x, y: container.pos.y },
      minerPos: { x: container.pos.x, y: container.pos.y },
      road: []
    });
  }

  // ---- controller ----
  var controller = room.controller;
  var controllerPos = { x: controller.pos.x, y: controller.pos.y };
  reserved[posKey(controller.pos.x, controller.pos.y)] = true;

  // Block only controller tile itself from buildings; allow roads at range 1
  // (upgrader needs road access to reach controller efficiently)

  // Separate exclusion for extensions: block controller-adjacent tiles
  // to keep upgrader area clear
  var controllerAdjacent = {};
  for (var cdx = -1; cdx <= 1; cdx++) {
    for (var cdy = -1; cdy <= 1; cdy++) {
      controllerAdjacent[posKey(controller.pos.x + cdx, controller.pos.y + cdy)] = true;
    }
  }

  // ---- storage: near spawn (2-4 tiles), prefer plain ----
  var storageCandidates = nearbyOpenTiles(terrain, occupied, anchor, 2, 4, reserved);
  var storagePos = null;
  for (var sti = 0; sti < storageCandidates.length; sti++) {
    var sc = storageCandidates[sti];
    // don't block spawn exits — skip tiles in a direct orthogonal line from spawn
    var dx = sc.x - anchor.x;
    var dy = sc.y - anchor.y;
    // Avoid tiles directly N/S/E/W of spawn at range 1 (those are exits)
    if ((Math.abs(dx) <= 1 && Math.abs(dy) === 0) || (Math.abs(dy) <= 1 && Math.abs(dx) === 0)) {
      if (Math.abs(dx) + Math.abs(dy) === 1) continue; // direct exit
    }
    storagePos = { x: sc.x, y: sc.y };
    reserved[posKey(sc.x, sc.y)] = true;
    break;
  }
  if (!storagePos) {
    // fallback: pick any open tile at range 2-5
    var fallbackStorages = nearbyOpenTiles(terrain, occupied, anchor, 2, 5, reserved);
    if (fallbackStorages.length > 0) {
      storagePos = { x: fallbackStorages[0].x, y: fallbackStorages[0].y };
      reserved[posKey(storagePos.x, storagePos.y)] = true;
    }
  }

  // ---- towers ----
  // RCL3 tower: near spawn, can protect spawn/extensions/storage
  var towerCandidates = nearbyOpenTiles(terrain, occupied, anchor, 2, 4, reserved);
  var tower1 = towerCandidates.length > 0
    ? { x: towerCandidates[0].x, y: towerCandidates[0].y, rcl: 3 }
    : null;
  if (tower1) reserved[posKey(tower1.x, tower1.y)] = true;

  // RCL5 tower: also near spawn, different position for coverage
  var tower2Candidates = nearbyOpenTiles(terrain, occupied, anchor, 2, 5, reserved);
  var tower2 = tower2Candidates.length > 0
    ? { x: tower2Candidates[0].x, y: tower2Candidates[0].y, rcl: 5 }
    : null;
  if (tower2) reserved[posKey(tower2.x, tower2.y)] = true;

  // ---- links ----
  // storage link: adjacent to storage
  var storageLinkPos = null;
  if (storagePos) {
    var linkCandidates = nearbyOpenTiles(terrain, occupied, storagePos, 1, 1, reserved);
    if (linkCandidates.length > 0) {
      storageLinkPos = { x: linkCandidates[0].x, y: linkCandidates[0].y };
      reserved[posKey(storageLinkPos.x, storageLinkPos.y)] = true;
    }
  }

  // controller link: adjacent to controller
  var controllerLinkPos = null;
  var clCandidates = nearbyOpenTiles(terrain, occupied, controllerPos, 1, 1, reserved);
  if (clCandidates.length > 0) {
    controllerLinkPos = { x: clCandidates[0].x, y: clCandidates[0].y };
    reserved[posKey(controllerLinkPos.x, controllerLinkPos.y)] = true;
  }

  // ---- extensions (total 30 for RCL5) ----
  // Use anchor (spawn) as center for first ring, then storage as second center
  var allExtensions = [];
  var extReserved = {};    // blocks extensions AND roads (spawn exits, placed extensions)
  var noExtensions = {};   // blocks only extensions (controller adjacent)

  // Block spawn exit tiles (range 1 cardinal) from extensions AND roads
  var spawnExits = [
    { x: anchor.x + 1, y: anchor.y },
    { x: anchor.x - 1, y: anchor.y },
    { x: anchor.x, y: anchor.y + 1 },
    { x: anchor.x, y: anchor.y - 1 }
  ];
  for (var sei = 0; sei < spawnExits.length; sei++) {
    if (inBounds(spawnExits[sei].x, spawnExits[sei].y, 1)) {
      extReserved[posKey(spawnExits[sei].x, spawnExits[sei].y)] = true;
    }
  }
  // Block controller-adjacent from extensions (but NOT roads)
  for (var cak in controllerAdjacent) {
    noExtensions[cak] = true;
  }
  // Merge extReserved + noExtensions for extension placement exclusion
  var extExclude = {};
  for (var ek in extReserved) { extExclude[ek] = true; }
  for (var nk in noExtensions) { extExclude[nk] = true; }

  // RCL2: 5 extensions, nearest to spawn
  var rcl2Exts = planExtensions(terrain, occupied, anchor, 5, extExclude);
  for (var i2 = 0; i2 < rcl2Exts.length; i2++) {
    allExtensions.push({ x: rcl2Exts[i2].x, y: rcl2Exts[i2].y, rcl: 2 });
    var key2 = posKey(rcl2Exts[i2].x, rcl2Exts[i2].y);
    extReserved[key2] = true;
    extExclude[key2] = true;
  }

  // RCL3: 5 more (= 10 total)
  var rcl3Exts = planExtensions(terrain, occupied, anchor, 5, extExclude);
  for (var i3 = 0; i3 < rcl3Exts.length; i3++) {
    allExtensions.push({ x: rcl3Exts[i3].x, y: rcl3Exts[i3].y, rcl: 3 });
    var key3 = posKey(rcl3Exts[i3].x, rcl3Exts[i3].y);
    extReserved[key3] = true;
    extExclude[key3] = true;
  }

  // RCL4: 10 more (= 20 total) — extend around storage too
  var rcl4ExtsSpawn = planExtensions(terrain, occupied, anchor, 5, extExclude);
  for (var i4a = 0; i4a < rcl4ExtsSpawn.length; i4a++) {
    allExtensions.push({ x: rcl4ExtsSpawn[i4a].x, y: rcl4ExtsSpawn[i4a].y, rcl: 4 });
    var key4a = posKey(rcl4ExtsSpawn[i4a].x, rcl4ExtsSpawn[i4a].y);
    extReserved[key4a] = true;
    extExclude[key4a] = true;
  }
  if (storagePos) {
    var rcl4ExtsStorage = planExtensions(terrain, occupied, storagePos, 5, extExclude);
    for (var i4b = 0; i4b < rcl4ExtsStorage.length && allExtensions.filter(function (e) { return e.rcl <= 4; }).length < 20; i4b++) {
      allExtensions.push({ x: rcl4ExtsStorage[i4b].x, y: rcl4ExtsStorage[i4b].y, rcl: 4 });
      var key4b = posKey(rcl4ExtsStorage[i4b].x, rcl4ExtsStorage[i4b].y);
      extReserved[key4b] = true;
      extExclude[key4b] = true;
    }
  }

  // RCL5: 10 more (= 30 total)
  var rcl5ExtsSpawn = planExtensions(terrain, occupied, anchor, 5, extExclude);
  for (var i5a = 0; i5a < rcl5ExtsSpawn.length && allExtensions.length < 30; i5a++) {
    allExtensions.push({ x: rcl5ExtsSpawn[i5a].x, y: rcl5ExtsSpawn[i5a].y, rcl: 5 });
    var key5a = posKey(rcl5ExtsSpawn[i5a].x, rcl5ExtsSpawn[i5a].y);
    extReserved[key5a] = true;
    extExclude[key5a] = true;
  }
  if (storagePos && allExtensions.length < 30) {
    var rcl5ExtsStorage = planExtensions(terrain, occupied, storagePos, 5, extExclude);
    for (var i5b = 0; i5b < rcl5ExtsStorage.length && allExtensions.length < 30; i5b++) {
      allExtensions.push({ x: rcl5ExtsStorage[i5b].x, y: rcl5ExtsStorage[i5b].y, rcl: 5 });
      var key5b = posKey(rcl5ExtsStorage[i5b].x, rcl5ExtsStorage[i5b].y);
      extReserved[key5b] = true;
      extExclude[key5b] = true;
    }
  }

  // ---- roads ----
  // Only core routes: spawn↔sources, spawn↔controller, spawn↔storage, storage↔controller
  var roadReserved = {};
  var allRoads = [];

  function addRoad(path) {
    for (var i = 0; i < path.length; i++) {
      var key = posKey(path[i].x, path[i].y);
      // Don't pave over extension positions or reserved tiles
      if (roadReserved[key] || reserved[key] || extReserved[key]) continue;
      roadReserved[key] = true;
      allRoads.push({ x: path[i].x, y: path[i].y });
    }
  }

  // spawn ↔ source containers
  for (var si2 = 0; si2 < sourceEntries.length; si2++) {
    var se = sourceEntries[si2];
    var srcRoad = planRoad(
      room, terrain, occupied,
      anchor,
      se.containerPos,
      roadReserved,
      sourceBlock,
      extReserved
    );
    for (var ri = 0; ri < srcRoad.length; ri++) {
      var rk = posKey(srcRoad[ri].x, srcRoad[ri].y);
      if (roadReserved[rk] || reserved[rk]) continue;
      roadReserved[rk] = true;
      allRoads.push({ x: srcRoad[ri].x, y: srcRoad[ri].y });
      se.road.push({ x: srcRoad[ri].x, y: srcRoad[ri].y });
    }
  }

  // spawn ↔ controller
  var ctrlRoad = planRoad(
    room, terrain, occupied,
    anchor,
    controllerPos,
    roadReserved,
    sourceBlock,
    extReserved
  );
  addRoad(ctrlRoad);

  // spawn ↔ storage
  var storageRoads = [];
  if (storagePos) {
    var sr = planRoad(
      room, terrain, occupied,
      anchor,
      storagePos,
      roadReserved,
      sourceBlock,
      extReserved
    );
    addRoad(sr);
    storageRoads = sr.map(function (p) { return { x: p.x, y: p.y }; });
  }

  // storage ↔ controller
  if (storagePos) {
    var scRoad = planRoad(
      room, terrain, occupied,
      storagePos,
      controllerPos,
      roadReserved,
      sourceBlock,
      extReserved
    );
    addRoad(scRoad);
  }

  // ---- ramparts (key buildings only) ----
  var ramparts = [];
  // Combine road tiles into an exclusion set for rampart placement
  var roadTileSet = {};
  for (var rdi = 0; rdi < allRoads.length; rdi++) {
    roadTileSet[posKey(allRoads[rdi].x, allRoads[rdi].y)] = true;
  }

  // Rampart on spawn (at RCL3+, when tower exists)
  var spawnRampartCandidates = nearbyOpenTiles(terrain, occupied, anchor, 1, 1, roadTileSet);
  if (spawnRampartCandidates.length > 0) {
    ramparts.push({
      x: spawnRampartCandidates[0].x,
      y: spawnRampartCandidates[0].y,
      target: 'spawn',
      rcl: 3
    });
  }
  // Rampart on tower1
  if (tower1) {
    var t1r = nearbyOpenTiles(terrain, occupied, tower1, 1, 1, roadTileSet);
    if (t1r.length > 0) {
      ramparts.push({ x: t1r[0].x, y: t1r[0].y, target: 'tower', rcl: 3 });
    }
  }
  // Rampart on tower2
  if (tower2) {
    var t2r = nearbyOpenTiles(terrain, occupied, tower2, 1, 1, roadTileSet);
    if (t2r.length > 0) {
      ramparts.push({ x: t2r[0].x, y: t2r[0].y, target: 'tower', rcl: 5 });
    }
  }
  // Rampart on storage
  if (storagePos) {
    var str = nearbyOpenTiles(terrain, occupied, storagePos, 1, 1, roadTileSet);
    if (str.length > 0) {
      ramparts.push({ x: str[0].x, y: str[0].y, target: 'storage', rcl: 4 });
    }
  }

  // ---- assemble plan ----
  var plan = {
    type: 'frontBase',
    maxRcl: MAX_RCL,
    temporary: true,
    anchor: { x: anchor.x, y: anchor.y },
    spawnId: spawn.id,
    sources: sourceEntries,
    controller: {
      pos: controllerPos,
      road: ctrlRoad ? ctrlRoad.map(function (p) { return { x: p.x, y: p.y }; }) : [],
      containerPos: null,
      linkPos: controllerLinkPos
    },
    storage: storagePos ? {
      pos: storagePos,
      road: storageRoads
    } : null,
    towers: [tower1, tower2].filter(Boolean),
    extensions: allExtensions,
    links: [
      storageLinkPos ? { x: storageLinkPos.x, y: storageLinkPos.y, type: 'storage', rcl: 5 } : null,
      controllerLinkPos ? { x: controllerLinkPos.x, y: controllerLinkPos.y, type: 'controller', rcl: 5 } : null
    ].filter(Boolean),
    ramparts: ramparts,
    roads: allRoads,
    lastPlanned: Game.time,
    lastRcl: room.controller.level
  };

  // persist
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};
  Memory.rooms[roomName].plan = plan;

  console.log('[frontBase] plan created for ' + roomName +
    ' | sources:' + sourceEntries.length +
    ' | extensions:' + allExtensions.length +
    ' | towers:' + plan.towers.length +
    ' | storage:' + (storagePos ? 'yes' : 'no') +
    ' | roads:' + allRoads.length +
    ' | ramparts:' + ramparts.length);

  return plan;
}

// ---------------------------------------------------------------------------
// summary — console display
// ---------------------------------------------------------------------------

function summary(roomName) {
  var plan = Memory.rooms && Memory.rooms[roomName] && Memory.rooms[roomName].plan;
  if (!plan) {
    console.log('[frontBase] no plan for ' + roomName);
    return;
  }
  var room = Game.rooms[roomName];
  var rcl = room && room.controller ? room.controller.level : '?';

  console.log('=== Front Base Plan: ' + roomName + ' ===');
  console.log('Type: ' + plan.type + ' | Max RCL: ' + plan.maxRcl + ' | Temporary: ' + plan.temporary);
  console.log('Anchor (spawn): ' + plan.anchor.x + ',' + plan.anchor.y + ' | Current RCL: ' + rcl);
  console.log('Sources: ' + plan.sources.length);
  for (var i = 0; i < plan.sources.length; i++) {
    var s = plan.sources[i];
    console.log('  [' + i + '] ' + s.sourceId.slice(-6) +
      ' container:' + s.containerPos.x + ',' + s.containerPos.y +
      ' road:' + s.road.length + ' tiles');
  }
  console.log('Controller: ' + plan.controller.pos.x + ',' + plan.controller.pos.y +
    ' link:' + (plan.controller.linkPos ? 'yes' : 'no') +
    ' road:' + plan.controller.road.length + ' tiles');
  console.log('Storage: ' + (plan.storage ? plan.storage.pos.x + ',' + plan.storage.pos.y : 'none'));
  console.log('Towers: ' + plan.towers.length);
  for (var j = 0; j < plan.towers.length; j++) {
    console.log('  [' + j + '] ' + plan.towers[j].x + ',' + plan.towers[j].y + ' @RCL' + plan.towers[j].rcl);
  }
  console.log('Extensions: ' + plan.extensions.length);
  var extByRcl = {};
  for (var k = 0; k < plan.extensions.length; k++) {
    var r = plan.extensions[k].rcl;
    extByRcl[r] = (extByRcl[r] || 0) + 1;
  }
  for (var rclKey in extByRcl) {
    console.log('  RCL' + rclKey + ': ' + extByRcl[rclKey]);
  }
  console.log('Links: ' + plan.links.length);
  for (var l = 0; l < plan.links.length; l++) {
    console.log('  [' + l + '] ' + plan.links[l].type + ' @' + plan.links[l].x + ',' + plan.links[l].y);
  }
  console.log('Ramparts: ' + plan.ramparts.length);
  for (var m = 0; m < plan.ramparts.length; m++) {
    console.log('  [' + m + '] ' + plan.ramparts[m].target + ' @' + plan.ramparts[m].x + ',' + plan.ramparts[m].y);
  }
  console.log('Total roads: ' + plan.roads.length);
  console.log('Last planned: tick ' + plan.lastPlanned + ' (RCL ' + plan.lastRcl + ')');
}

module.exports = {
  init: init,
  summary: summary
};
