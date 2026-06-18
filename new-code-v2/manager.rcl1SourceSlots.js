const RESCAN_INTERVAL = 500;

function ensureRoomMemory(roomName) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  return Memory.rooms[roomName];
}

function samePos(left, right) {
  return (
    left &&
    right &&
    left.x === right.x &&
    left.y === right.y &&
    left.roomName === right.roomName
  );
}

function isBlockingStructure(structure) {
  if (
    structure.structureType === STRUCTURE_ROAD ||
    structure.structureType === STRUCTURE_CONTAINER
  ) {
    return false;
  }

  if (
    structure.structureType === STRUCTURE_RAMPART &&
    (structure.my || structure.isPublic)
  ) {
    return false;
  }

  return true;
}

function isLivingAssignment(creepName, sourceId, spot) {
  if (!creepName) return false;

  const creep = Game.creeps[creepName];
  return !!(
    creep &&
    creep.memory.sourceId === sourceId &&
    samePos(creep.memory.harvestPos, spot)
  );
}

function scan(room, previous) {
  const terrain = Game.map.getRoomTerrain(room.name);
  const sources = room.find(FIND_SOURCES);
  const previousSources = previous && previous.sources
    ? previous.sources
    : {};
  const nextSources = {};

  for (const source of sources) {
    const previousEntry = previousSources[source.id] || {};
    const previousSpots = Array.isArray(previousEntry.spots)
      ? previousEntry.spots
      : [];
    const spots = [];

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;

        const x = source.pos.x + dx;
        const y = source.pos.y + dy;
        if (x < 1 || x > 48 || y < 1 || y > 48) continue;
        if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

        const structures = room.lookForAt(LOOK_STRUCTURES, x, y);
        if (structures.some(isBlockingStructure)) continue;

        const spot = {
          x: x,
          y: y,
          roomName: room.name,
          assignedCreep: null
        };
        const previousSpot = previousSpots.find(candidate =>
          samePos(candidate, spot)
        );

        if (
          previousSpot &&
          isLivingAssignment(previousSpot.assignedCreep, source.id, spot)
        ) {
          spot.assignedCreep = previousSpot.assignedCreep;
        }

        spots.push(spot);
      }
    }

    nextSources[source.id] = {
      sourceId: source.id,
      spots: spots
    };
  }

  return {
    updatedAt: Game.time,
    sources: nextSources
  };
}

function getSlots(room) {
  const roomMemory = ensureRoomMemory(room.name);
  const current = roomMemory.rcl1SourceSlots;
  const missing = !current || !current.sources;
  const periodicRescan =
    Game.time % RESCAN_INTERVAL === 0 &&
    current &&
    current.updatedAt !== Game.time;

  if (missing || periodicRescan) {
    roomMemory.rcl1SourceSlots = scan(room, current);
  }

  return roomMemory.rcl1SourceSlots;
}

function cleanup(room) {
  const roomMemory = Memory.rooms && Memory.rooms[room.name];
  const slots = roomMemory && roomMemory.rcl1SourceSlots;
  if (!slots || !slots.sources) return;

  for (const sourceId in slots.sources) {
    const entry = slots.sources[sourceId];
    if (!Array.isArray(entry.spots)) continue;

    for (const spot of entry.spots) {
      if (
        spot.assignedCreep &&
        !isLivingAssignment(spot.assignedCreep, sourceId, spot)
      ) {
        spot.assignedCreep = null;
      }
    }
  }
}

function releaseCreep(creepName) {
  if (!Memory.rooms) return;

  for (const roomName in Memory.rooms) {
    const slots = Memory.rooms[roomName].rcl1SourceSlots;
    if (!slots || !slots.sources) continue;

    for (const sourceId in slots.sources) {
      const entry = slots.sources[sourceId];
      if (!Array.isArray(entry.spots)) continue;

      for (const spot of entry.spots) {
        if (spot.assignedCreep === creepName) {
          spot.assignedCreep = null;
        }
      }
    }
  }
}

function clearAssignment(room, creep) {
  const roomMemory = Memory.rooms && Memory.rooms[room.name];
  const slots = roomMemory && roomMemory.rcl1SourceSlots;

  if (slots && slots.sources) {
    for (const sourceId in slots.sources) {
      const entry = slots.sources[sourceId];
      if (!Array.isArray(entry.spots)) continue;

      for (const spot of entry.spots) {
        if (spot.assignedCreep === creep.name) {
          spot.assignedCreep = null;
        }
      }
    }
  }

  delete creep.memory.sourceId;
  delete creep.memory.harvestPos;
}

function getAllowedSourceIds(creep) {
  return Array.isArray(creep.memory.rcl1SourceIds) &&
    creep.memory.rcl1SourceIds.length > 0
    ? creep.memory.rcl1SourceIds
    : null;
}

function isAllowedSource(sourceId, allowedSourceIds) {
  return !allowedSourceIds || allowedSourceIds.indexOf(sourceId) !== -1;
}

function getSpawn(room) {
  const spawns = room.find(FIND_MY_SPAWNS);
  return spawns[0] || null;
}

function spotRange(origin, spot) {
  if (!origin) return 0;
  return origin.getRangeTo(spot.x, spot.y);
}

function assignRcl1Harvester(room, creep) {
  const slots = getSlots(room);
  cleanup(room);
  const allowedSourceIds = getAllowedSourceIds(creep);

  if (creep.memory.sourceId && creep.memory.harvestPos) {
    const source = Game.getObjectById(creep.memory.sourceId);
    const entry = slots.sources[creep.memory.sourceId];
    const spot = entry && Array.isArray(entry.spots)
      ? entry.spots.find(candidate =>
        samePos(candidate, creep.memory.harvestPos)
      )
      : null;

    if (
      source &&
      spot &&
      isAllowedSource(source.id, allowedSourceIds) &&
      (!spot.assignedCreep || spot.assignedCreep === creep.name)
    ) {
      spot.assignedCreep = creep.name;
      return source;
    }

    clearAssignment(room, creep);
  }

  const spawn = getSpawn(room);
  const candidates = [];

  for (const sourceId in slots.sources) {
    if (!isAllowedSource(sourceId, allowedSourceIds)) continue;

    const source = Game.getObjectById(sourceId);
    if (!source) continue;

    const entry = slots.sources[sourceId];
    const spots = Array.isArray(entry.spots) ? entry.spots : [];
    const availableSpots = spots.filter(spot => !spot.assignedCreep);
    if (availableSpots.length === 0) continue;

    availableSpots.sort((left, right) =>
      spotRange(spawn && spawn.pos, left) -
      spotRange(spawn && spawn.pos, right)
    );

    candidates.push({
      source: source,
      entry: entry,
      assignedCount: spots.length - availableSpots.length,
      spot: availableSpots[0],
      spawnRange: spotRange(spawn && spawn.pos, availableSpots[0])
    });
  }

  candidates.sort((left, right) => {
    const ratioDifference =
      left.assignedCount * right.entry.spots.length -
      right.assignedCount * left.entry.spots.length;

    if (ratioDifference !== 0) return ratioDifference;
    if (left.spawnRange !== right.spawnRange) {
      return left.spawnRange - right.spawnRange;
    }
    return left.source.id.localeCompare(right.source.id);
  });

  const selected = candidates[0];
  if (!selected) {
    clearAssignment(room, creep);
    return null;
  }

  selected.spot.assignedCreep = creep.name;
  creep.memory.sourceId = selected.source.id;
  creep.memory.harvestPos = {
    x: selected.spot.x,
    y: selected.spot.y,
    roomName: selected.spot.roomName
  };

  return selected.source;
}

function getTotalSlots(room, allowedSourceIds) {
  const slots = getSlots(room);
  let total = 0;

  for (const sourceId in slots.sources) {
    if (!isAllowedSource(sourceId, allowedSourceIds)) continue;

    const entry = slots.sources[sourceId];
    total += Array.isArray(entry.spots) ? entry.spots.length : 0;
  }

  return total;
}

function selectSourceForSupport(room, creep) {
  const slots = getSlots(room);
  cleanup(room);

  const allowedSourceIds = getAllowedSourceIds(creep);
  const availableSources = [];

  for (const sourceId in slots.sources) {
    if (!isAllowedSource(sourceId, allowedSourceIds)) continue;

    const entry = slots.sources[sourceId];
    const spots = Array.isArray(entry.spots) ? entry.spots : [];
    if (!spots.some(spot => !spot.assignedCreep)) continue;

    const source = Game.getObjectById(sourceId);
    if (source) availableSources.push(source);
  }

  if (availableSources.length > 0) {
    const current = availableSources.find(
      source => source.id === creep.memory.sourceId
    );
    const selected =
      current ||
      creep.pos.findClosestByPath(availableSources) ||
      availableSources[0];

    creep.memory.sourceId = selected.id;
    creep.memory.rcl1SourceSelection = 'available-slot';
    return selected;
  }

  if (
    creep.memory.rcl1SourceSelection === 'fallback' &&
    creep.memory.sourceId
  ) {
    const current = Game.getObjectById(creep.memory.sourceId);
    if (current) return current;
  }

  let sources = room.find(FIND_SOURCES);
  if (allowedSourceIds) {
    sources = sources.filter(source =>
      allowedSourceIds.indexOf(source.id) !== -1
    );
  }
  if (sources.length === 0) return null;

  const selected = creep.pos.findClosestByPath(sources) || sources[0];
  creep.memory.sourceId = selected.id;
  creep.memory.rcl1SourceSelection = 'fallback';
  return selected;
}

function getStats(room) {
  const slots = getSlots(room);
  cleanup(room);

  const perSource = [];
  let totalSlots = 0;

  for (const sourceId in slots.sources) {
    const entry = slots.sources[sourceId];
    const spots = Array.isArray(entry.spots) ? entry.spots : [];
    const assignedCreeps = spots
      .filter(spot => !!spot.assignedCreep)
      .map(spot => spot.assignedCreep);

    totalSlots += spots.length;
    perSource.push({
      sourceId: sourceId,
      spotCount: spots.length,
      assignedCreeps: assignedCreeps,
      spots: spots.map(spot => ({
        x: spot.x,
        y: spot.y,
        roomName: spot.roomName,
        assignedCreep: spot.assignedCreep || null
      }))
    });
  }

  perSource.sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId)
  );

  return {
    totalSlots: totalSlots,
    perSource: perSource
  };
}

module.exports = {
  assignRcl1Harvester: assignRcl1Harvester,
  cleanup: cleanup,
  clearAssignment: clearAssignment,
  getStats: getStats,
  getTotalSlots: getTotalSlots,
  releaseCreep: releaseCreep,
  selectSourceForSupport: selectSourceForSupport
};
