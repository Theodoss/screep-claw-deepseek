const VERSION = 1;
const PATH_TTL = 50000;
const FAILED_RETRY_TICKS = 100;
const STUCK_LIMIT = 3;
const REJOIN_RANGE = 8;

const parsedCache = {};

function packPos(pos) {
  return pos.roomName + ':' + pos.x + ',' + pos.y;
}

function cacheKey(pos) {
  return pos.roomName + ':' + pos.x + ':' + pos.y;
}

function serializePath(path) {
  const chunks = [];
  let roomName = null;
  let parts = [];

  for (let index = 0; index < path.length; index++) {
    const step = path[index];
    if (step.roomName !== roomName) {
      if (roomName !== null) {
        chunks.push(roomName + ':' + parts.join(';'));
      }
      roomName = step.roomName;
      parts = [];
    }
    parts.push(step.x + ',' + step.y);
  }

  if (roomName !== null) {
    chunks.push(roomName + ':' + parts.join(';'));
  }
  return chunks.join('|');
}

function parsePath(serialized) {
  if (parsedCache[serialized]) return parsedCache[serialized];

  const path = [];
  const indexByPos = {};
  if (serialized) {
    const roomChunks = serialized.split('|');
    for (let chunkIndex = 0; chunkIndex < roomChunks.length; chunkIndex++) {
      const chunk = roomChunks[chunkIndex];
      const splitAt = chunk.indexOf(':');
      if (splitAt <= 0) continue;

      const roomName = chunk.slice(0, splitAt);
      const coordText = chunk.slice(splitAt + 1);
      if (!coordText) continue;

      const coords = coordText.split(';');
      for (let coordIndex = 0; coordIndex < coords.length; coordIndex++) {
        const xy = coords[coordIndex].split(',');
        if (xy.length !== 2) continue;

        const step = {
          roomName: roomName,
          x: parseInt(xy[0], 10),
          y: parseInt(xy[1], 10)
        };
        if (isNaN(step.x) || isNaN(step.y)) continue;

        indexByPos[cacheKey(step)] = path.length;
        path.push(step);
      }
    }
  }

  parsedCache[serialized] = {
    path: path,
    indexByPos: indexByPos
  };
  return parsedCache[serialized];
}

function isBlockingStructure(structure, sourceConfig) {
  if (structure.structureType === STRUCTURE_ROAD) return false;
  if (
    structure.structureType === STRUCTURE_RAMPART &&
    (structure.my || structure.isPublic)
  ) {
    return false;
  }

  if (structure.structureType === STRUCTURE_CONTAINER) {
    return (
      sourceConfig &&
      structure.pos.roomName === sourceConfig.roomName &&
      structure.pos.x === sourceConfig.containerX &&
      structure.pos.y === sourceConfig.containerY
    );
  }

  return true;
}

function buildCostMatrix(roomName, sourceConfig) {
  const room = Game.rooms[roomName];
  if (!room) return undefined;

  const terrain = Game.map.getRoomTerrain(roomName);
  const matrix = new PathFinder.CostMatrix();

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const tile = terrain.get(x, y);
      if (tile === TERRAIN_MASK_WALL) {
        matrix.set(x, y, 255);
      } else if (tile === TERRAIN_MASK_SWAMP) {
        matrix.set(x, y, 10);
      } else {
        matrix.set(x, y, 2);
      }
    }
  }

  const structures = room.find(FIND_STRUCTURES);
  for (let index = 0; index < structures.length; index++) {
    const structure = structures[index];
    if (structure.structureType === STRUCTURE_ROAD) {
      matrix.set(structure.pos.x, structure.pos.y, 1);
      continue;
    }
    if (isBlockingStructure(structure, sourceConfig)) {
      matrix.set(structure.pos.x, structure.pos.y, 255);
    }
  }

  const sites = room.find(FIND_CONSTRUCTION_SITES);
  for (let index = 0; index < sites.length; index++) {
    const site = sites[index];
    if (
      site.structureType === STRUCTURE_ROAD ||
      site.structureType === STRUCTURE_CONTAINER
    ) {
      continue;
    }
    matrix.set(site.pos.x, site.pos.y, 255);
  }

  return matrix;
}

function recordFailure(sourceConfig) {
  if (!sourceConfig.haulPath) sourceConfig.haulPath = {};
  sourceConfig.haulPath.failedAt = Game.time;
}

function computePath(sourceConfig, homeAnchor, remoteTarget) {
  if (!sourceConfig || !homeAnchor || !remoteTarget) return null;

  const distance = Game.map.getRoomLinearDistance(
    homeAnchor.roomName,
    remoteTarget.roomName
  );
  const result = PathFinder.search(
    homeAnchor,
    { pos: remoteTarget, range: 0 },
    {
      maxRooms: Math.max(2, distance + 2),
      maxOps: 12000,
      plainCost: 2,
      swampCost: 10,
      roomCallback: function (roomName) {
        return buildCostMatrix(roomName, sourceConfig);
      }
    }
  );

  if (result.incomplete || !result.path || result.path.length === 0) {
    recordFailure(sourceConfig);
    return null;
  }

  sourceConfig.haulPath = {
    version: VERSION,
    updatedAt: Game.time,
    origin: packPos(homeAnchor),
    target: packPos(remoteTarget),
    path: serializePath(result.path),
    length: result.path.length,
    ops: result.ops || 0
  };

  return sourceConfig.haulPath;
}

function getPathRecord(sourceConfig, homeAnchor, remoteTarget) {
  if (!sourceConfig || !homeAnchor || !remoteTarget) return null;

  const origin = packPos(homeAnchor);
  const target = packPos(remoteTarget);
  const record = sourceConfig.haulPath;

  if (
    record &&
    record.version === VERSION &&
    record.origin === origin &&
    record.target === target &&
    record.path &&
    Game.time - (record.updatedAt || 0) < PATH_TTL
  ) {
    return record;
  }

  if (
    record &&
    typeof record.failedAt === 'number' &&
    Game.time - record.failedAt < FAILED_RETRY_TICKS
  ) {
    return null;
  }

  return computePath(sourceConfig, homeAnchor, remoteTarget);
}

function findNearestIndex(parsed, pos) {
  const path = parsed.path;
  let selected = null;
  let selectedRange = Infinity;

  for (let index = 0; index < path.length; index++) {
    const step = path[index];
    if (step.roomName !== pos.roomName) continue;

    const range = Math.max(
      Math.abs(step.x - pos.x),
      Math.abs(step.y - pos.y)
    );
    if (range < selectedRange) {
      selectedRange = range;
      selected = index;
      if (range === 0) break;
    }
  }

  return selected === null
    ? null
    : { index: selected, range: selectedRange };
}

function getRoomStepDirection(fromRoom, toRoom) {
  const exitDir = Game.map.findExit(fromRoom, toRoom);
  if (
    exitDir === FIND_EXIT_TOP ||
    exitDir === FIND_EXIT_RIGHT ||
    exitDir === FIND_EXIT_BOTTOM ||
    exitDir === FIND_EXIT_LEFT
  ) {
    return exitDir;
  }
  return null;
}

function moveToStep(creep, step) {
  if (step.roomName === creep.pos.roomName) {
    const direction = creep.pos.getDirectionTo(
      new RoomPosition(step.x, step.y, step.roomName)
    );
    if (!direction) return ERR_NO_PATH;
    return creep.move(direction);
  }

  const roomDirection = getRoomStepDirection(
    creep.pos.roomName,
    step.roomName
  );
  return roomDirection ? creep.move(roomDirection) : ERR_NO_PATH;
}

function updateStuck(creep, memory) {
  if (creep.fatigue > 0) return false;

  const pos = packPos(creep.pos);
  if (memory.lastPos === pos) {
    memory.stuck = (memory.stuck || 0) + 1;
  } else {
    memory.stuck = 0;
  }
  memory.lastPos = pos;
  return memory.stuck > STUCK_LIMIT;
}

function follow(creep, sourceConfig, homeAnchor, remoteTarget, reverse) {
  const existingMemory = creep.memory._haulPath;
  if (
    existingMemory &&
    typeof existingMemory.disabledUntil === 'number' &&
    Game.time < existingMemory.disabledUntil
  ) {
    return false;
  }

  const record = getPathRecord(sourceConfig, homeAnchor, remoteTarget);
  if (!record) return false;

  const parsed = parsePath(record.path);
  if (!parsed.path.length) return false;

  const direction = reverse ? 'reverse' : 'forward';
  const routeKey = record.origin + '>' + record.target;
  if (!creep.memory._haulPath) creep.memory._haulPath = {};
  const memory = creep.memory._haulPath;

  if (
    memory.routeKey !== routeKey ||
    memory.direction !== direction
  ) {
    memory.routeKey = routeKey;
    memory.direction = direction;
    memory.stuck = 0;
    delete memory.lastPos;
  }

  const exactIndex = parsed.indexByPos[cacheKey(creep.pos)];
  let currentIndex = exactIndex;

  if (currentIndex === undefined) {
    const nearest = findNearestIndex(parsed, creep.pos);
    if (!nearest || nearest.range > REJOIN_RANGE) return false;

    currentIndex = nearest.index;
    if (nearest.range > 0) {
      const rejoin = parsed.path[currentIndex];
      creep.memory.task = 'travel:haul-path-rejoin';
      const result = nearest.range === 1
        ? moveToStep(creep, rejoin)
        : creep.moveTo(
          new RoomPosition(rejoin.x, rejoin.y, rejoin.roomName),
          { reusePath: 5, maxRooms: 1 }
        );
      return result === OK || result === ERR_TIRED;
    }
  }

  const nextIndex = reverse ? currentIndex - 1 : currentIndex + 1;
  if (nextIndex < 0 || nextIndex >= parsed.path.length) return false;

  if (updateStuck(creep, memory)) {
    memory.disabledUntil = Game.time + 10;
    memory.stuck = 0;
    return false;
  }

  const result = moveToStep(creep, parsed.path[nextIndex]);
  memory.lastResult = result;
  memory.index = nextIndex;
  creep.memory.task = reverse
    ? 'travel:haul-path-home'
    : 'travel:haul-path-remote';

  return result === OK || result === ERR_TIRED;
}

module.exports = {
  follow: follow
};
