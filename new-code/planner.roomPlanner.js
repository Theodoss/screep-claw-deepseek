const VERSION = 3;
const SITE_INTERVAL = 25;
const MAX_ACTIVE_SITES = 3;
const ANCHOR_MIN_EDGE_RANGE = 8;

const CORE_OFFSETS = {
  storage: [[0, 0]],
  terminal: [[-1, -1], [-2, -1], [-1, -2], [-2, -2]],
  link: [[1, -1], [2, -1], [1, -2], [2, -2]],
  factory: [[-1, 1], [-2, 1], [-1, 2], [-2, 2]],
  powerSpawn: [[1, 1], [2, 1], [1, 2], [2, 2]]
};

function ensureRoomMemory(roomName) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};
  if (!Memory.rooms[roomName].planner) {
    Memory.rooms[roomName].planner = {
      version: VERSION,
      enabled: true
    };
  }

  return Memory.rooms[roomName].planner;
}

function pos(x, y, roomName) {
  return { x: x, y: y, roomName: roomName };
}

function samePos(left, right) {
  return !!(
    left &&
    right &&
    left.x === right.x &&
    left.y === right.y &&
    (!left.roomName || !right.roomName || left.roomName === right.roomName)
  );
}

function posKey(value) {
  return `${value.x}:${value.y}`;
}

function inBounds(x, y, margin) {
  const edge = margin || 1;
  return x >= edge && x <= 49 - edge && y >= edge && y <= 49 - edge;
}

function getRange(left, right) {
  return Math.max(
    Math.abs(left.x - right.x),
    Math.abs(left.y - right.y)
  );
}

function isWall(terrain, x, y) {
  return terrain.get(x, y) === TERRAIN_MASK_WALL;
}

function isSwamp(terrain, x, y) {
  return terrain.get(x, y) === TERRAIN_MASK_SWAMP;
}

function countByType(objects) {
  const counts = {};
  for (const object of objects) {
    const type = object.structureType || object.type || 'unknown';
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

function scanRoom(room, includeTerrainAnalysis) {
  const terrain = Game.map.getRoomTerrain(room.name);
  const structures = room.find(FIND_STRUCTURES);
  const sites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const sources = room.find(FIND_SOURCES);
  const minerals = room.find(FIND_MINERALS);
  const exits = room.find(FIND_EXIT);
  const spawns = room.find(FIND_MY_SPAWNS);
  const structureMap = {};
  const siteMap = {};
  const terrainCounts = { wall: 0, swamp: 0, plain: 0 };

  for (const structure of structures) {
    const key = posKey(structure.pos);
    if (!structureMap[key]) structureMap[key] = [];
    structureMap[key].push(structure);
  }
  for (const site of sites) {
    const key = posKey(site.pos);
    if (!siteMap[key]) siteMap[key] = [];
    siteMap[key].push(site);
  }
  if (includeTerrainAnalysis) {
    for (let x = 0; x < 50; x++) {
      for (let y = 0; y < 50; y++) {
        if (isWall(terrain, x, y)) {
          terrainCounts.wall++;
        } else if (isSwamp(terrain, x, y)) {
          terrainCounts.swamp++;
        } else {
          terrainCounts.plain++;
        }
      }
    }
  }

  return {
    room: room,
    terrain: terrain,
    structures: structures,
    sites: sites,
    sources: sources,
    minerals: minerals,
    exits: exits,
    spawns: spawns,
    spawn: spawns[0] || null,
    controller: room.controller || null,
    structureMap: structureMap,
    siteMap: siteMap,
    terrainCounts: terrainCounts
  };
}

function isWalkableStructure(structure) {
  return (
    structure.structureType === STRUCTURE_ROAD ||
    structure.structureType === STRUCTURE_CONTAINER ||
    (
      structure.structureType === STRUCTURE_RAMPART &&
      (structure.my || structure.isPublic)
    )
  );
}

function isOpenTile(scan, x, y, allowExistingType) {
  if (!inBounds(x, y, 1) || isWall(scan.terrain, x, y)) return false;

  const structures = scan.structureMap[`${x}:${y}`] || [];
  const sites = scan.siteMap[`${x}:${y}`] || [];
  if (
    structures.some(structure =>
      structure.structureType !== allowExistingType &&
      structure.structureType !== STRUCTURE_RAMPART
    )
  ) {
    return false;
  }
  if (
    sites.some(site => site.structureType !== allowExistingType)
  ) {
    return false;
  }

  return true;
}

function isAnchorLegal(scan, anchor) {
  if (!anchor || !inBounds(anchor.x, anchor.y, ANCHOR_MIN_EDGE_RANGE)) {
    return false;
  }
  if (!isOpenTile(scan, anchor.x, anchor.y, STRUCTURE_STORAGE)) {
    return false;
  }

  let buildable = 0;
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      if (isOpenTile(scan, anchor.x + dx, anchor.y + dy)) buildable++;
    }
  }

  return buildable >= 34;
}

function buildCostMatrix(scan) {
  const matrix = new PathFinder.CostMatrix();

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      if (isWall(scan.terrain, x, y)) {
        matrix.set(x, y, 255);
      } else if (isSwamp(scan.terrain, x, y)) {
        matrix.set(x, y, 10);
      } else {
        matrix.set(x, y, 2);
      }
    }
  }

  for (const structure of scan.structures) {
    if (structure.structureType === STRUCTURE_ROAD) {
      matrix.set(structure.pos.x, structure.pos.y, 1);
    } else if (!isWalkableStructure(structure)) {
      matrix.set(structure.pos.x, structure.pos.y, 255);
    }
  }

  return matrix;
}

function pathCost(scan, origin, target, range, matrix) {
  if (!origin || !target) return 0;

  const result = PathFinder.search(
    new RoomPosition(origin.x, origin.y, scan.room.name),
    {
      pos: new RoomPosition(target.x, target.y, scan.room.name),
      range: range
    },
    {
      maxRooms: 1,
      maxOps: 2500,
      plainCost: 2,
      swampCost: 10,
      roomCallback: roomName =>
        roomName === scan.room.name ? matrix : false
    }
  );

  return result.incomplete ? 1000 : result.cost;
}

function setMatrixCost(matrix, x, y, cost) {
  if (x < 0 || x > 49 || y < 0 || y > 49) return;
  matrix.set(x, y, cost);
}

function pushDistanceNode(heap, node) {
  heap.push(node);
  let index = heap.length - 1;

  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if (heap[parent].cost <= node.cost) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = node;
}

function popDistanceNode(heap) {
  if (heap.length === 0) return null;

  const first = heap[0];
  const last = heap.pop();
  if (heap.length === 0) return first;

  let index = 0;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    if (left >= heap.length) break;

    let child = left;
    if (
      right < heap.length &&
      heap[right].cost < heap[left].cost
    ) {
      child = right;
    }
    if (heap[child].cost >= last.cost) break;

    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}

function distanceIndex(x, y) {
  return y * 50 + x;
}

function buildDistanceMap(matrix, starts, reverse) {
  const distances = new Array(2500).fill(Infinity);
  const heap = [];

  for (const start of starts) {
    const index = distanceIndex(start.x, start.y);
    if (distances[index] === 0) continue;
    distances[index] = 0;
    pushDistanceNode(heap, { x: start.x, y: start.y, cost: 0 });
  }

  while (heap.length > 0) {
    const current = popDistanceNode(heap);
    const currentIndex = distanceIndex(current.x, current.y);
    if (current.cost !== distances[currentIndex]) continue;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = current.x + dx;
        const y = current.y + dy;
        if (x < 0 || x > 49 || y < 0 || y > 49) continue;

        const destinationCost = matrix.get(x, y);
        if (destinationCost >= 255) continue;
        const stepCost = reverse
          ? matrix.get(current.x, current.y)
          : destinationCost;
        if (stepCost >= 255) continue;

        const nextCost = current.cost + stepCost;
        const nextIndex = distanceIndex(x, y);
        if (nextCost >= distances[nextIndex]) continue;

        distances[nextIndex] = nextCost;
        pushDistanceNode(heap, { x: x, y: y, cost: nextCost });
      }
    }
  }

  return distances;
}

function collectGoalTiles(matrix, target, range) {
  const goals = [];
  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      const x = target.x + dx;
      const y = target.y + dy;
      if (x < 0 || x > 49 || y < 0 || y > 49) continue;
      if (matrix.get(x, y) >= 255) continue;
      goals.push({ x: x, y: y });
    }
  }
  return goals;
}

function buildAnchorLogisticsMaps(scan, matrix) {
  return {
    spawnToStorage: scan.spawn
      ? buildDistanceMap(matrix, [scan.spawn.pos], false)
      : null,
    storageToController: scan.controller
      ? buildDistanceMap(
        matrix,
        collectGoalTiles(matrix, scan.controller.pos, 3),
        true
      )
      : null,
    storageToSources: scan.sources.map(source =>
      buildDistanceMap(
        matrix,
        collectGoalTiles(matrix, source.pos, 1),
        true
      )
    )
  };
}

function scoreAnchorLogistics(candidate, logisticsMaps) {
  const index = distanceIndex(candidate.x, candidate.y);
  const spawnToStorage = logisticsMaps.spawnToStorage
    ? logisticsMaps.spawnToStorage[index]
    : 0;
  const storageToController = logisticsMaps.storageToController
    ? logisticsMaps.storageToController[index]
    : 0;
  const storageToSources = logisticsMaps.storageToSources.map(
    distances => distances[index]
  );
  const total = spawnToStorage +
    storageToController +
    storageToSources.reduce((sum, cost) => sum + cost, 0);

  return {
    total: total,
    spawnToStorage: spawnToStorage,
    storageToController: storageToController,
    storageToSources: storageToSources
  };
}

function selectAnchor(scan) {
  const storage = scan.structures.find(
    structure =>
      structure.my &&
      structure.structureType === STRUCTURE_STORAGE
  );
  if (storage) {
    return {
      anchor: pos(storage.pos.x, storage.pos.y, scan.room.name),
      score: 0,
      reason: 'existing-storage'
    };
  }

  const plannerMemory = ensureRoomMemory(scan.room.name);
  if (
    !plannerMemory.forceReplan &&
    plannerMemory.version === VERSION &&
    plannerMemory.anchor &&
    isAnchorLegal(scan, plannerMemory.anchor)
  ) {
    return {
      anchor: pos(
        plannerMemory.anchor.x,
        plannerMemory.anchor.y,
        scan.room.name
      ),
      score: plannerMemory.anchorScore || 0,
      reason: 'memory'
    };
  }

  const matrix = buildCostMatrix(scan);
  const logisticsMaps = buildAnchorLogisticsMaps(scan, matrix);
  let selected = null;

  for (let x = ANCHOR_MIN_EDGE_RANGE; x <= 49 - ANCHOR_MIN_EDGE_RANGE; x++) {
    for (let y = ANCHOR_MIN_EDGE_RANGE; y <= 49 - ANCHOR_MIN_EDGE_RANGE; y++) {
      const candidate = pos(x, y, scan.room.name);
      if (!isAnchorLegal(scan, candidate)) continue;

      const logistics = scoreAnchorLogistics(candidate, logisticsMaps);
      if (!Number.isFinite(logistics.total)) continue;

      if (
        !selected ||
        logistics.total < selected.score ||
        (
          logistics.total === selected.score &&
          (candidate.x < selected.anchor.x ||
            (
              candidate.x === selected.anchor.x &&
              candidate.y < selected.anchor.y
            ))
        )
      ) {
        selected = {
          anchor: candidate,
          score: logistics.total,
          logistics: logistics,
          reason: 'logistics-cost'
        };
      }
    }
  }

  if (selected) return selected;

  const relaxed = [];
  for (let x = ANCHOR_MIN_EDGE_RANGE; x <= 49 - ANCHOR_MIN_EDGE_RANGE; x++) {
    for (let y = ANCHOR_MIN_EDGE_RANGE; y <= 49 - ANCHOR_MIN_EDGE_RANGE; y++) {
      if (!isOpenTile(scan, x, y, STRUCTURE_STORAGE)) continue;
      const candidate = pos(x, y, scan.room.name);
      const logistics = scoreAnchorLogistics(candidate, logisticsMaps);
      if (!Number.isFinite(logistics.total)) continue;
      relaxed.push({
        pos: candidate,
        score: logistics.total,
        logistics: logistics
      });
    }
  }
  relaxed.sort((left, right) =>
    left.score - right.score ||
    left.pos.x - right.pos.x ||
    left.pos.y - right.pos.y
  );
  const fallback = relaxed.length > 0 ? relaxed[0] : null;
  return {
    anchor: fallback ? fallback.pos : pos(25, 25, scan.room.name),
    score: fallback ? fallback.score : 999999,
    logistics: fallback ? fallback.logistics : null,
    reason: fallback ? 'relaxed-logistics-cost' : 'center-fallback'
  };
}

function getAnchor(room) {
  const scan = scanRoom(room, false);
  return selectAnchor(scan).anchor;
}

function buildReservedSet(scan) {
  const reserved = {};

  for (const source of scan.sources) {
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        reserved[`${source.pos.x + dx}:${source.pos.y + dy}`] = true;
      }
    }
  }
  if (scan.controller) {
    for (let dx = -3; dx <= 3; dx++) {
      for (let dy = -3; dy <= 3; dy++) {
        reserved[
          `${scan.controller.pos.x + dx}:${scan.controller.pos.y + dy}`
        ] = true;
      }
    }
  }
  for (const mineral of scan.minerals) {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        reserved[`${mineral.pos.x + dx}:${mineral.pos.y + dy}`] = true;
      }
    }
  }

  return reserved;
}

function chooseCorePosition(scan, anchor, offsets, used, structureType) {
  for (const offset of offsets) {
    const candidate = pos(
      anchor.x + offset[0],
      anchor.y + offset[1],
      scan.room.name
    );
    const key = posKey(candidate);
    if (used[key]) continue;
    if (!isOpenTile(scan, candidate.x, candidate.y, structureType)) continue;

    used[key] = true;
    return candidate;
  }

  for (let radius = 1; radius <= 3; radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const candidate = pos(
          anchor.x + dx,
          anchor.y + dy,
          scan.room.name
        );
        const key = posKey(candidate);
        if (used[key]) continue;
        if (!isOpenTile(scan, candidate.x, candidate.y, structureType)) {
          continue;
        }

        used[key] = true;
        return candidate;
      }
    }
  }

  return null;
}

function collectBuildingCandidates(scan, anchor, minRadius, maxRadius, used) {
  const reserved = buildReservedSet(scan);
  const candidates = [];

  for (let x = anchor.x - maxRadius; x <= anchor.x + maxRadius; x++) {
    for (let y = anchor.y - maxRadius; y <= anchor.y + maxRadius; y++) {
      const range = getRange(anchor, { x: x, y: y });
      if (range < minRadius || range > maxRadius) continue;
      if (!inBounds(x, y, 2) || (x + y) % 2 !== 0) continue;
      if (reserved[`${x}:${y}`] || used[`${x}:${y}`]) continue;
      if (!isOpenTile(scan, x, y)) continue;

      candidates.push(pos(x, y, scan.room.name));
    }
  }

  candidates.sort((left, right) => {
    const leftRange = getRange(anchor, left);
    const rightRange = getRange(anchor, right);
    if (leftRange !== rightRange) return leftRange - rightRange;
    return left.x - right.x || left.y - right.y;
  });
  return candidates;
}

function selectTowerPositions(scan, anchor, candidates) {
  if (candidates.length === 0) return [];

  const available = candidates.slice();
  available.sort((left, right) => {
    const leftSpawn = scan.spawn ? getRange(left, scan.spawn.pos) : 0;
    const rightSpawn = scan.spawn ? getRange(right, scan.spawn.pos) : 0;
    return (
      getRange(left, anchor) * 2 + leftSpawn * 3 -
      (getRange(right, anchor) * 2 + rightSpawn * 3)
    );
  });

  const selected = [available.shift()];
  const quadrants = [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1]
  ];
  for (const quadrant of quadrants) {
    const index = available.findIndex(candidate =>
      Math.sign(candidate.x - anchor.x) === quadrant[0] &&
      Math.sign(candidate.y - anchor.y) === quadrant[1]
    );
    if (index !== -1) selected.push(available.splice(index, 1)[0]);
  }

  while (selected.length < 6 && available.length > 0) {
    let bestIndex = 0;
    let bestDistance = -1;
    for (let index = 0; index < available.length; index++) {
      const minimumDistance = Math.min.apply(
        null,
        selected.map(tower => getRange(tower, available[index]))
      );
      if (minimumDistance > bestDistance) {
        bestIndex = index;
        bestDistance = minimumDistance;
      }
    }
    selected.push(available.splice(bestIndex, 1)[0]);
  }

  return selected.slice(0, 6);
}

function planCoreWithScan(scan, anchor) {
  const used = {};
  const core = {};

  core.storage = chooseCorePosition(
    scan,
    anchor,
    CORE_OFFSETS.storage,
    used,
    STRUCTURE_STORAGE
  );
  core.terminal = chooseCorePosition(
    scan,
    anchor,
    CORE_OFFSETS.terminal,
    used,
    STRUCTURE_TERMINAL
  );
  core.link = chooseCorePosition(
    scan,
    anchor,
    CORE_OFFSETS.link,
    used,
    STRUCTURE_LINK
  );
  core.factory = chooseCorePosition(
    scan,
    anchor,
    CORE_OFFSETS.factory,
    used,
    STRUCTURE_FACTORY
  );
  core.powerSpawn = chooseCorePosition(
    scan,
    anchor,
    CORE_OFFSETS.powerSpawn,
    used,
    STRUCTURE_POWER_SPAWN
  );
  core.labAnchor = core.powerSpawn
    ? pos(core.powerSpawn.x, core.powerSpawn.y, scan.room.name)
    : pos(anchor.x + 1, anchor.y + 1, scan.room.name);

  const coreRoads = [];
  const roadOffsets = [
    [-1, 0], [1, 0], [0, -1], [0, 1]
  ];
  for (const offset of roadOffsets) {
    const road = pos(
      anchor.x + offset[0],
      anchor.y + offset[1],
      scan.room.name
    );
    if (!inBounds(road.x, road.y, 1) || isWall(scan.terrain, road.x, road.y)) {
      continue;
    }
    if (used[posKey(road)]) continue;
    coreRoads.push(road);
  }

  const supportCandidates = collectBuildingCandidates(
    scan,
    anchor,
    3,
    7,
    used
  );
  const towers = [];
  const labs = [];
  const spawns = [];
  for (const tower of selectTowerPositions(scan, anchor, supportCandidates)) {
    towers.push(tower);
    used[posKey(tower)] = true;
  }

  const remaining = supportCandidates.filter(candidate => !used[posKey(candidate)]);
  remaining.sort((left, right) => {
    const leftSpawn = scan.spawn ? getRange(left, scan.spawn.pos) : 0;
    const rightSpawn = scan.spawn ? getRange(right, scan.spawn.pos) : 0;
    return leftSpawn - rightSpawn ||
      getRange(left, anchor) - getRange(right, anchor);
  });
  for (const candidate of remaining) {
    if (spawns.length >= 2) break;
    spawns.push(candidate);
    used[posKey(candidate)] = true;
  }

  const labCandidates = supportCandidates
    .filter(candidate => !used[posKey(candidate)])
    .sort((left, right) =>
      getRange(left, core.labAnchor) - getRange(right, core.labAnchor)
    );
  for (const candidate of labCandidates.slice(0, 10)) {
    labs.push(candidate);
    used[posKey(candidate)] = true;
  }

  return {
    core: core,
    coreRoads: coreRoads,
    towers: towers,
    labs: labs,
    spawns: spawns,
    used: used
  };
}

function planCore(room, anchor) {
  return planCoreWithScan(scanRoom(room, false), anchor);
}

function planExtensionsWithScan(scan, anchor, used) {
  const candidates = collectBuildingCandidates(
    scan,
    anchor,
    3,
    10,
    used
  );
  const matrix = buildCostMatrix(scan);

  for (const key in used) {
    const parts = key.split(':');
    matrix.set(Number(parts[0]), Number(parts[1]), 255);
  }
  matrix.set(anchor.x, anchor.y, 1);

  const extensions = candidates.slice(0, 120).map(candidate => ({
    pos: candidate,
    cost: pathCost(scan, anchor, candidate, 0, matrix)
  })).filter(entry => entry.cost < 1000);

  extensions.sort((left, right) =>
    left.cost - right.cost ||
    getRange(anchor, left.pos) - getRange(anchor, right.pos)
  );
  return extensions.slice(0, 60).map(entry => entry.pos);
}

function planExtensions(room, anchor) {
  const scan = scanRoom(room, false);
  const corePlan = planCoreWithScan(scan, anchor);
  return planExtensionsWithScan(scan, anchor, corePlan.used);
}

function chooseAdjacentPosition(
  scan,
  target,
  anchor,
  minRange,
  maxRange,
  used,
  structureType
) {
  const candidates = [];

  for (let dx = -maxRange; dx <= maxRange; dx++) {
    for (let dy = -maxRange; dy <= maxRange; dy++) {
      const range = Math.max(Math.abs(dx), Math.abs(dy));
      if (range < minRange || range > maxRange) continue;

      const candidate = pos(
        target.pos.x + dx,
        target.pos.y + dy,
        scan.room.name
      );
      if (used && used[posKey(candidate)]) continue;
      if (!isOpenTile(scan, candidate.x, candidate.y, structureType)) {
        continue;
      }

      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) =>
    getRange(left, anchor) - getRange(right, anchor) ||
    Number(isSwamp(scan.terrain, left.x, left.y)) -
      Number(isSwamp(scan.terrain, right.x, right.y))
  );
  return candidates[0] || null;
}

function chooseAdjacentPositionByTargets(
  scan,
  target,
  targets,
  used,
  structureType
) {
  const candidates = [];

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;

      const candidate = pos(
        target.pos.x + dx,
        target.pos.y + dy,
        scan.room.name
      );
      if (used && used[posKey(candidate)]) continue;
      if (!isOpenTile(scan, candidate.x, candidate.y, structureType)) {
        continue;
      }
      candidates.push(candidate);
    }
  }

  candidates.sort((left, right) => {
    const leftCost = targets.reduce(
      (total, routeTarget) => total + getRange(left, routeTarget),
      0
    );
    const rightCost = targets.reduce(
      (total, routeTarget) => total + getRange(right, routeTarget),
      0
    );
    return leftCost - rightCost ||
      Number(isSwamp(scan.terrain, left.x, left.y)) -
        Number(isSwamp(scan.terrain, right.x, right.y));
  });
  return candidates[0] || null;
}

function addPathRoads(roads, roadKeys, path, excluded) {
  for (const step of path) {
    const key = posKey(step);
    if (excluded[key] || roadKeys[key]) continue;
    roadKeys[key] = true;
    roads.push(pos(step.x, step.y, step.roomName));
  }
}

function searchRoadPath(scan, origin, target, range, plannedBuildings) {
  const matrix = buildCostMatrix(scan);

  for (const key in plannedBuildings) {
    const parts = key.split(':');
    setMatrixCost(
      matrix,
      Number(parts[0]),
      Number(parts[1]),
      255
    );
  }
  setMatrixCost(matrix, origin.x, origin.y, 1);

  for (const source of scan.sources) {
    const routeUsesSource =
      getRange(origin, source.pos) <= 1 ||
      getRange(target, source.pos) <= 1;
    if (!routeUsesSource) {
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          setMatrixCost(
            matrix,
            source.pos.x + dx,
            source.pos.y + dy,
            255
          );
        }
      }
    }
    setMatrixCost(matrix, source.pos.x, source.pos.y, 255);
  }
  setMatrixCost(matrix, target.x, target.y, 1);

  if (scan.controller) {
    const routeUsesController =
      getRange(origin, scan.controller.pos) <= 3 ||
      getRange(target, scan.controller.pos) <= 3;
    if (!routeUsesController) {
      for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
          setMatrixCost(
            matrix,
            scan.controller.pos.x + dx,
            scan.controller.pos.y + dy,
            255
          );
        }
      }
    }
    setMatrixCost(
      matrix,
      scan.controller.pos.x,
      scan.controller.pos.y,
      255
    );
    setMatrixCost(matrix, origin.x, origin.y, 1);
    setMatrixCost(matrix, target.x, target.y, 1);
  }

  const result = PathFinder.search(
    new RoomPosition(origin.x, origin.y, scan.room.name),
    {
      pos: new RoomPosition(target.x, target.y, scan.room.name),
      range: range
    },
    {
      maxRooms: 1,
      maxOps: 5000,
      plainCost: 2,
      swampCost: 5,
      roomCallback: roomName =>
        roomName === scan.room.name ? matrix : false
    }
  );

  return result.incomplete ? [] : result.path;
}

function chooseControllerSupport(scan, anchor, used) {
  if (!scan.controller) return { container: null, link: null };

  const sourceContainerIds = {};
  for (const source of scan.sources) {
    for (const structure of scan.structures) {
      if (
        structure.structureType === STRUCTURE_CONTAINER &&
        getRange(structure.pos, source.pos) <= 1
      ) {
        sourceContainerIds[structure.id] = true;
      }
    }
  }
  const existingContainer = scan.structures.find(structure =>
    structure.structureType === STRUCTURE_CONTAINER &&
    !sourceContainerIds[structure.id] &&
    getRange(structure.pos, scan.controller.pos) >= 2 &&
    getRange(structure.pos, scan.controller.pos) <= 3
  );
  const existingLink = scan.structures.find(structure =>
    structure.structureType === STRUCTURE_LINK &&
    getRange(structure.pos, scan.controller.pos) >= 2 &&
    getRange(structure.pos, scan.controller.pos) <= 3
  );
  const existingContainerSite = scan.sites.find(site =>
    site.structureType === STRUCTURE_CONTAINER &&
    getRange(site.pos, scan.controller.pos) >= 2 &&
    getRange(site.pos, scan.controller.pos) <= 3
  );
  const existingLinkSite = scan.sites.find(site =>
    site.structureType === STRUCTURE_LINK &&
    getRange(site.pos, scan.controller.pos) >= 2 &&
    getRange(site.pos, scan.controller.pos) <= 3
  );
  const controllerContainerObject =
    existingContainer || existingContainerSite;
  const controllerLinkObject = existingLink || existingLinkSite;
  if (controllerContainerObject) {
    used[posKey(controllerContainerObject.pos)] = true;
  }
  if (controllerLinkObject) used[posKey(controllerLinkObject.pos)] = true;

  const candidates = [];
  for (let dx = -3; dx <= 3; dx++) {
    for (let dy = -3; dy <= 3; dy++) {
      const range = Math.max(Math.abs(dx), Math.abs(dy));
      if (range < 2 || range > 3) continue;

      const candidate = pos(
        scan.controller.pos.x + dx,
        scan.controller.pos.y + dy,
        scan.room.name
      );
      if (used[posKey(candidate)]) continue;
      if (!isOpenTile(scan, candidate.x, candidate.y)) continue;
      candidates.push(candidate);
    }
  }
  const earlyLogistics = scan.controller.level < 4;
  candidates.sort((left, right) => {
    if (!earlyLogistics) {
      return getRange(left, anchor) - getRange(right, anchor);
    }

    const leftSourceRange = scan.sources.length > 0
      ? Math.min.apply(
        null,
        scan.sources.map(source => getRange(left, source.pos))
      )
      : 0;
    const rightSourceRange = scan.sources.length > 0
      ? Math.min.apply(
        null,
        scan.sources.map(source => getRange(right, source.pos))
      )
      : 0;
    const leftSpawnRange = scan.spawn ? getRange(left, scan.spawn.pos) : 0;
    const rightSpawnRange = scan.spawn ? getRange(right, scan.spawn.pos) : 0;

    return leftSourceRange * 2 + leftSpawnRange -
      (rightSourceRange * 2 + rightSpawnRange);
  });

  const container = controllerContainerObject
    ? pos(
      controllerContainerObject.pos.x,
      controllerContainerObject.pos.y,
      scan.room.name
    )
    : candidates.shift() || null;
  if (container) used[posKey(container)] = true;
  const link = controllerLinkObject
    ? pos(
      controllerLinkObject.pos.x,
      controllerLinkObject.pos.y,
      scan.room.name
    )
    : candidates.find(candidate => !used[posKey(candidate)]) || null;
  if (link) used[posKey(link)] = true;
  return { container: container, link: link };
}

function getRoadStrategy(rcl) {
  return rcl >= 4 ? 'storage-hub' : 'early-logistics';
}

function findControllerRouteSource(scan, controllerTarget) {
  if (!controllerTarget || scan.sources.length === 0) return null;

  let selected = scan.sources[0];
  for (const source of scan.sources) {
    if (
      getRange(source.pos, controllerTarget) <
      getRange(selected.pos, controllerTarget)
    ) {
      selected = source;
    }
  }
  return selected;
}

function planRoadsWithScan(scan, anchor, used, coreRoads) {
  const rcl = scan.controller ? scan.controller.level : 0;
  const roadStrategy = getRoadStrategy(rcl);
  const routeRoads = [];
  const routeRoadKeys = {};
  const sourcePlans = {};
  const excluded = roadStrategy === 'storage-hub'
    ? Object.assign({}, used)
    : {};
  const supportUsed = roadStrategy === 'storage-hub' ? used : {};
  const controllerSupport = chooseControllerSupport(
    scan,
    anchor,
    supportUsed
  );
  if (roadStrategy === 'early-logistics') {
    if (controllerSupport.container) {
      used[posKey(controllerSupport.container)] = true;
    }
    if (controllerSupport.link) {
      used[posKey(controllerSupport.link)] = true;
    }
  }
  const controllerTarget = controllerSupport.container ||
    (scan.controller
      ? pos(
        scan.controller.pos.x,
        scan.controller.pos.y,
        scan.room.name
      )
      : null);
  if (controllerSupport.container) {
    excluded[posKey(controllerSupport.container)] = true;
  }
  const controllerRouteSource = roadStrategy === 'early-logistics'
    ? findControllerRouteSource(scan, controllerTarget)
    : null;

  for (const source of scan.sources) {
    const existingContainer = scan.structures.find(structure =>
      structure.structureType === STRUCTURE_CONTAINER &&
      getRange(structure.pos, source.pos) <= 1
    );
    const existingContainerSite = scan.sites.find(site =>
      site.structureType === STRUCTURE_CONTAINER &&
      getRange(site.pos, source.pos) <= 1
    );
    const existingLink = scan.structures.find(structure =>
      structure.structureType === STRUCTURE_LINK &&
      getRange(structure.pos, source.pos) === 2
    );
    const existingLinkSite = scan.sites.find(site =>
      site.structureType === STRUCTURE_LINK &&
      getRange(site.pos, source.pos) === 2
    );
    const containerObject = existingContainer || existingContainerSite;
    const earlyTargets = [];
    if (scan.spawn) earlyTargets.push(scan.spawn.pos);
    if (
      controllerRouteSource &&
      source.id === controllerRouteSource.id &&
      controllerTarget
    ) {
      earlyTargets.push(controllerTarget);
    }
    const containerPos = containerObject
      ? pos(
        containerObject.pos.x,
        containerObject.pos.y,
        scan.room.name
      )
      : (
        roadStrategy === 'early-logistics' && earlyTargets.length > 0
          ? chooseAdjacentPositionByTargets(
            scan,
            source,
            earlyTargets,
            supportUsed,
            STRUCTURE_CONTAINER
          )
          : chooseAdjacentPosition(
            scan,
            source,
            anchor,
            1,
            1,
            supportUsed,
            STRUCTURE_CONTAINER
          )
      );
    if (!containerPos) continue;

    supportUsed[posKey(containerPos)] = true;
    used[posKey(containerPos)] = true;
    excluded[posKey(containerPos)] = true;

    const sourceLinkObject = existingLink || existingLinkSite;
    const sourceLink = sourceLinkObject
      ? pos(
        sourceLinkObject.pos.x,
        sourceLinkObject.pos.y,
        scan.room.name
      )
      : chooseAdjacentPosition(
        scan,
        source,
        anchor,
        2,
        2,
        supportUsed,
        STRUCTURE_LINK
      );
    if (sourceLink && !supportUsed[posKey(sourceLink)]) {
      supportUsed[posKey(sourceLink)] = true;
      used[posKey(sourceLink)] = true;
    }

    sourcePlans[source.id] = {
      minerPos: containerPos,
      containerPos: containerPos,
      linkPos: sourceLink,
      roadPath: []
    };
  }

  const plannedBuildings = roadStrategy === 'storage-hub' ? used : {};
  if (
    roadStrategy === 'early-logistics' &&
    controllerRouteSource &&
    controllerTarget &&
    sourcePlans[controllerRouteSource.id]
  ) {
    const path = searchRoadPath(
      scan,
      sourcePlans[controllerRouteSource.id].containerPos,
      controllerTarget,
      controllerSupport.container ? 1 : 3,
      plannedBuildings
    );
    addPathRoads(routeRoads, routeRoadKeys, path, excluded);
    sourcePlans[controllerRouteSource.id].roadPath.push.apply(
      sourcePlans[controllerRouteSource.id].roadPath,
      path.map(step => pos(step.x, step.y, step.roomName))
    );
  }

  if (roadStrategy === 'early-logistics' && scan.spawn) {
    for (const source of scan.sources) {
      const sourcePlan = sourcePlans[source.id];
      if (!sourcePlan) continue;

      const path = searchRoadPath(
        scan,
        sourcePlan.containerPos,
        scan.spawn.pos,
        1,
        plannedBuildings
      );
      addPathRoads(routeRoads, routeRoadKeys, path, excluded);
      sourcePlan.roadPath.push.apply(
        sourcePlan.roadPath,
        path.map(step => pos(step.x, step.y, step.roomName))
      );
    }
  }

  if (roadStrategy === 'storage-hub') {
    for (const source of scan.sources) {
      const sourcePlan = sourcePlans[source.id];
      if (!sourcePlan) continue;

      const path = searchRoadPath(
        scan,
        sourcePlan.containerPos,
        anchor,
        1,
        plannedBuildings
      );
      addPathRoads(routeRoads, routeRoadKeys, path, excluded);
      sourcePlan.roadPath = path.map(step =>
        pos(step.x, step.y, step.roomName)
      );
    }

    if (controllerTarget) {
      addPathRoads(
        routeRoads,
        routeRoadKeys,
        searchRoadPath(
          scan,
          controllerTarget,
          anchor,
          1,
          plannedBuildings
        ),
        excluded
      );
    }
  }

  let mineralPlan = null;
  if (scan.minerals.length > 0) {
    const mineral = scan.minerals[0];
    const extractorRoadTarget = chooseAdjacentPosition(
      scan,
      mineral,
      anchor,
      1,
      1,
      used,
      STRUCTURE_ROAD
    );
    if (extractorRoadTarget) {
      mineralPlan = {
        mineralId: mineral.id,
        extractorPos: pos(
          mineral.pos.x,
          mineral.pos.y,
          scan.room.name
        ),
        harvestPos: extractorRoadTarget,
        roadPath: []
      };
    }
  }

  const plannedCoreRoads = roadStrategy === 'storage-hub'
    ? coreRoads.filter(road => {
      const key = posKey(road);
      return !excluded[key] && !used[key] && !routeRoadKeys[key];
    })
    : [];

  return {
    strategy: roadStrategy,
    roads: {
      routeRoads: routeRoads,
      coreRoads: plannedCoreRoads,
      gridRoads: []
    },
    bootstrapRoads: routeRoads.slice(0, 12),
    sourcePlans: sourcePlans,
    controllerPlan: {
      containerPos: controllerSupport.container,
      linkPos: controllerSupport.link
    },
    mineralPlan: mineralPlan
  };
}

function planRoads(room, anchor) {
  const scan = scanRoom(room, false);
  const corePlan = planCoreWithScan(scan, anchor);
  return planRoadsWithScan(
    scan,
    anchor,
    corePlan.used,
    corePlan.coreRoads
  );
}

function buildPlan(room, providedScan) {
  const scan = providedScan || scanRoom(room, true);
  const anchorSelection = selectAnchor(scan);
  const anchor = anchorSelection.anchor;
  const corePlan = planCoreWithScan(scan, anchor);
  const roadsPlan = planRoadsWithScan(
    scan,
    anchor,
    corePlan.used,
    corePlan.coreRoads
  );
  const extensions = planExtensionsWithScan(
    scan,
    anchor,
    corePlan.used
  );

  return {
    version: VERSION,
    enabled: true,
    anchor: anchor,
    anchorScore: anchorSelection.score,
    anchorLogistics: anchorSelection.logistics || null,
    anchorReason: anchorSelection.reason,
    core: corePlan.core,
    extensions: extensions,
    roads: roadsPlan.roads,
    roadStrategy: roadsPlan.strategy,
    bootstrapRoads: roadsPlan.bootstrapRoads,
    towers: corePlan.towers,
    labs: corePlan.labs,
    spawns: corePlan.spawns,
    sourcePlans: roadsPlan.sourcePlans,
    controllerPlan: roadsPlan.controllerPlan,
    mineralPlan: roadsPlan.mineralPlan,
    analysis: {
      terrain: scan.terrainCounts,
      exitCount: scan.exits.length,
      sourceCount: scan.sources.length,
      mineralCount: scan.minerals.length,
      structures: countByType(scan.structures),
      constructionSites: countByType(scan.sites)
    },
    lastPlanned: Game.time,
    lastRcl: room.controller ? room.controller.level : 0
  };
}

function addCandidate(candidates, structureType, value, priority) {
  if (!value) return;
  candidates.push({
    structureType: structureType,
    pos: value,
    priority: priority
  });
}

function getPlacementCandidates(room, plan) {
  const rcl = room.controller ? room.controller.level : 0;
  const candidates = [];

  if (rcl >= 3) {
    for (const tower of plan.towers || []) {
      addCandidate(candidates, STRUCTURE_TOWER, tower, 10);
    }
  }
  if (rcl >= 2) {
    for (const sourceId in plan.sourcePlans || {}) {
      addCandidate(
        candidates,
        STRUCTURE_CONTAINER,
        plan.sourcePlans[sourceId].containerPos,
        5
      );
    }
    addCandidate(
      candidates,
      STRUCTURE_CONTAINER,
      plan.controllerPlan && plan.controllerPlan.containerPos,
      6
    );
  }
  if (rcl >= 4) {
    addCandidate(candidates, STRUCTURE_STORAGE, plan.core.storage, 4);
  }
  if (rcl >= 5) {
    addCandidate(candidates, STRUCTURE_LINK, plan.core.link, 8);
    addCandidate(
      candidates,
      STRUCTURE_LINK,
      plan.controllerPlan && plan.controllerPlan.linkPos,
      17
    );
    for (const sourceId in plan.sourcePlans || {}) {
      addCandidate(
        candidates,
        STRUCTURE_LINK,
        plan.sourcePlans[sourceId].linkPos,
        18
      );
    }
  }
  if (rcl >= 6) {
    addCandidate(candidates, STRUCTURE_TERMINAL, plan.core.terminal, 7);
    for (const lab of plan.labs || []) {
      addCandidate(candidates, STRUCTURE_LAB, lab, 25);
    }
  }
  if (rcl >= 7) {
    addCandidate(candidates, STRUCTURE_FACTORY, plan.core.factory, 9);
    for (const spawnPos of plan.spawns || []) {
      addCandidate(candidates, STRUCTURE_SPAWN, spawnPos, 20);
    }
  }
  if (rcl >= 8) {
    addCandidate(
      candidates,
      STRUCTURE_POWER_SPAWN,
      plan.core.powerSpawn,
      9
    );
  }

  if (rcl >= 2) {
    for (const extension of plan.extensions || []) {
      addCandidate(candidates, STRUCTURE_EXTENSION, extension, 30);
    }
  }

  const roadPlan = plan.roads || {};
  const routeRoads = Array.isArray(roadPlan.routeRoads)
    ? roadPlan.routeRoads
    : [];
  const coreRoads = Array.isArray(roadPlan.coreRoads)
    ? roadPlan.coreRoads
    : [];
  const plannedRouteRoads = rcl <= 1
    ? routeRoads.slice(0, 12)
    : routeRoads;
  const routePriority = rcl === 3 ? 20 : (rcl <= 1 ? 40 : 50);
  for (let index = 0; index < plannedRouteRoads.length; index++) {
    addCandidate(
      candidates,
      STRUCTURE_ROAD,
      plannedRouteRoads[index],
      routePriority + index / 10000
    );
  }
  if (rcl >= 4) {
    for (const road of coreRoads) {
      addCandidate(candidates, STRUCTURE_ROAD, road, 55);
    }
  }

  candidates.sort((left, right) =>
    left.priority - right.priority ||
    getRange(plan.anchor, left.pos) - getRange(plan.anchor, right.pos)
  );
  return candidates;
}

function isPositionSatisfied(scan, candidate) {
  const key = posKey(candidate.pos);
  const structures = scan.structureMap[key] || [];
  const sites = scan.siteMap[key] || [];

  return (
    structures.some(structure =>
      structure.structureType === candidate.structureType
    ) ||
    sites.some(site => site.structureType === candidate.structureType)
  );
}

function isPositionBlocked(scan, candidate) {
  const key = posKey(candidate.pos);
  const structures = scan.structureMap[key] || [];
  const sites = scan.siteMap[key] || [];

  if (
    !inBounds(candidate.pos.x, candidate.pos.y, 1) ||
    isWall(scan.terrain, candidate.pos.x, candidate.pos.y)
  ) {
    return true;
  }
  if (isPositionSatisfied(scan, candidate)) return false;
  if (structures.length > 0 || sites.length > 0) return true;

  if (scan.controller && getRange(candidate.pos, scan.controller.pos) <= 1) {
    return true;
  }
  for (const source of scan.sources) {
    if (
      getRange(candidate.pos, source.pos) <= 1 &&
      candidate.structureType !== STRUCTURE_CONTAINER
    ) {
      return true;
    }
  }

  return false;
}

function getAllowedCount(structureType, rcl) {
  if (
    typeof CONTROLLER_STRUCTURES === 'undefined' ||
    !CONTROLLER_STRUCTURES[structureType]
  ) {
    return structureType === STRUCTURE_ROAD ? 2500 : 0;
  }

  return CONTROLLER_STRUCTURES[structureType][rcl] || 0;
}

function placeSites(room, plan) {
  const plannerMemory = ensureRoomMemory(room.name);
  if (!room.controller || !room.controller.my) return 0;
  if (
    typeof plannerMemory.lastSiteAttempt === 'number' &&
    Game.time - plannerMemory.lastSiteAttempt < SITE_INTERVAL
  ) {
    return 0;
  }

  plannerMemory.lastSiteAttempt = Game.time;
  const scan = scanRoom(room, false);
  if (scan.sites.length >= MAX_ACTIVE_SITES) {
    plannerMemory.lastSiteStatus = 'paused-active-sites';
    return 0;
  }

  const rcl = room.controller.level;
  const perRunLimit = rcl >= 6 ? 3 : (rcl >= 4 ? 2 : 1);
  const availableSlots = Math.min(
    perRunLimit,
    MAX_ACTIVE_SITES - scan.sites.length
  );
  const counts = countByType(scan.structures.concat(scan.sites));
  const candidates = getPlacementCandidates(room, plan);
  let placed = 0;
  let attempted = 0;

  for (const candidate of candidates) {
    if (placed >= availableSlots || attempted >= availableSlots) break;
    if (isPositionSatisfied(scan, candidate)) continue;
    if (isPositionBlocked(scan, candidate)) continue;

    const allowed = getAllowedCount(candidate.structureType, rcl);
    const current = counts[candidate.structureType] || 0;
    if (current >= allowed) continue;

    const result = room.createConstructionSite(
      candidate.pos.x,
      candidate.pos.y,
      candidate.structureType
    );
    attempted++;
    plannerMemory.lastSiteResult = result;
    plannerMemory.lastSite = {
      x: candidate.pos.x,
      y: candidate.pos.y,
      structureType: candidate.structureType,
      tick: Game.time
    };

    if (result === OK) {
      placed++;
      counts[candidate.structureType] = current + 1;
    } else if (result === ERR_FULL) {
      plannerMemory.lastSiteStatus = 'site-limit';
      plannerMemory.lastPlacedCount = placed;
      plannerMemory.lastAttemptedCount = attempted;
      return placed;
    }
  }

  plannerMemory.lastSiteStatus = placed > 0 ? 'placed' : 'no-eligible-site';
  plannerMemory.lastPlacedCount = placed;
  plannerMemory.lastAttemptedCount = attempted;
  return placed;
}

function syncSourceSuggestions(room, plan) {
  const roomMemory = Memory.rooms && Memory.rooms[room.name];
  if (!roomMemory || !roomMemory.sources) return;

  for (const sourceId in plan.sourcePlans || {}) {
    if (!roomMemory.sources[sourceId]) continue;
    roomMemory.sources[sourceId].suggestedContainerPos =
      plan.sourcePlans[sourceId].containerPos;
  }
}

function needsPlan(room, plannerMemory, scan) {
  if (plannerMemory.forceReplan) return true;
  if (plannerMemory.version !== VERSION) return true;
  if (
    plannerMemory.roadStrategy !==
    getRoadStrategy(room.controller ? room.controller.level : 0)
  ) {
    return true;
  }
  if (
    !plannerMemory.anchor ||
    !plannerMemory.core ||
    !Array.isArray(plannerMemory.extensions) ||
    !plannerMemory.roads ||
    !Array.isArray(plannerMemory.roads.routeRoads) ||
    !Array.isArray(plannerMemory.roads.coreRoads) ||
    !Array.isArray(plannerMemory.roads.gridRoads) ||
    !plannerMemory.sourcePlans
  ) {
    return true;
  }

  const storage = scan.structures.find(
    structure =>
      structure.my &&
      structure.structureType === STRUCTURE_STORAGE
  );
  if (storage && samePos(storage.pos, plannerMemory.anchor)) return false;
  if (!isAnchorLegal(scan, plannerMemory.anchor)) return true;

  return !!(
    storage &&
    !samePos(storage.pos, plannerMemory.anchor)
  );
}

function run(room) {
  if (!room.controller || !room.controller.my) return null;

  let plannerMemory = ensureRoomMemory(room.name);
  if (plannerMemory.enabled === false) return plannerMemory;
  const basicPlanMissing =
    plannerMemory.forceReplan ||
    plannerMemory.version !== VERSION ||
    plannerMemory.roadStrategy !==
      getRoadStrategy(room.controller ? room.controller.level : 0) ||
    !plannerMemory.anchor ||
    !plannerMemory.core;
  const shouldValidatePlan =
    basicPlanMissing ||
    Game.time % 500 === 0;

  if (shouldValidatePlan) {
    if (
      basicPlanMissing &&
      Game.cpu &&
      typeof Game.cpu.bucket === 'number' &&
      Game.cpu.bucket < 8000
    ) {
      plannerMemory.lastRunStatus = 'waiting-for-cpu';
      return plannerMemory;
    }

    let scan = scanRoom(room, false);
    if (!needsPlan(room, plannerMemory, scan)) {
      plannerMemory.lastRun = Game.time;
      placeSites(room, plannerMemory);
      return plannerMemory;
    }
    if (
      Game.cpu &&
      typeof Game.cpu.bucket === 'number' &&
      Game.cpu.bucket < 8000
    ) {
      plannerMemory.lastRunStatus = 'waiting-for-cpu';
      return plannerMemory;
    }

    scan = scanRoom(room, true);
    const preservedEnabled = plannerMemory.enabled !== false;
    plannerMemory = buildPlan(room, scan);
    plannerMemory.enabled = preservedEnabled;
    plannerMemory.lastRunStatus = 'planned';
    delete plannerMemory.forceReplan;
    Memory.rooms[room.name].planner = plannerMemory;
    syncSourceSuggestions(room, plannerMemory);
  }

  plannerMemory.lastRun = Game.time;
  plannerMemory.lastRunStatus = 'active';
  placeSites(room, plannerMemory);
  return plannerMemory;
}

module.exports = {
  getAnchor: getAnchor,
  placeSites: placeSites,
  planCore: planCore,
  planExtensions: planExtensions,
  planRoads: planRoads,
  run: run
};
