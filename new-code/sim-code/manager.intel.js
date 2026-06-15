const MAX_ROOMS = 20;
const TERRAIN_SCAN_INTERVAL = 5000;

function countByType(objects, typeField) {
  const counts = {};

  for (const object of objects) {
    const type = object[typeField];
    counts[type] = (counts[type] || 0) + 1;
  }

  return counts;
}

function scanTerrain(roomName) {
  const terrain = Game.map.getRoomTerrain(roomName);
  const summary = {
    wall: 0,
    swamp: 0,
    plain: 0,
    lastScanned: Game.time
  };

  for (let x = 0; x < 50; x++) {
    for (let y = 0; y < 50; y++) {
      const tile = terrain.get(x, y);

      if (tile === TERRAIN_MASK_WALL) {
        summary.wall++;
      } else if (tile === TERRAIN_MASK_SWAMP) {
        summary.swamp++;
      } else {
        summary.plain++;
      }
    }
  }

  return summary;
}

function getTerrainSummary(roomName, previousIntel) {
  const previousTerrain = previousIntel && previousIntel.terrain;

  if (
    previousTerrain &&
    typeof previousTerrain.lastScanned === 'number' &&
    Game.time - previousTerrain.lastScanned < TERRAIN_SCAN_INTERVAL
  ) {
    return previousTerrain;
  }

  return scanTerrain(roomName);
}

function getControllerIntel(controller) {
  return {
    level: controller ? controller.level : 0,
    owner: controller && controller.owner ? controller.owner.username : null,
    reservation: controller && controller.reservation
      ? controller.reservation.username
      : null
  };
}

function getMineralIntel(room) {
  const minerals = room.find(FIND_MINERALS);
  if (minerals.length === 0) return null;

  const mineral = minerals[0];
  return {
    type: mineral.mineralType,
    x: mineral.pos.x,
    y: mineral.pos.y
  };
}

function collectRoom(room, previousIntel) {
  const sources = room.find(FIND_SOURCES);
  const myCreeps = room.find(FIND_MY_CREEPS);
  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  const myStructures = room.find(FIND_MY_STRUCTURES);
  const constructionSites = room.find(FIND_MY_CONSTRUCTION_SITES);
  const droppedResources = room.find(FIND_DROPPED_RESOURCES);
  const hostileOwners = [];

  for (const hostile of hostiles) {
    const username = hostile.owner && hostile.owner.username;
    if (username && hostileOwners.indexOf(username) === -1) {
      hostileOwners.push(username);
    }
  }

  hostileOwners.sort();

  let droppedEnergy = 0;
  for (const resource of droppedResources) {
    if (resource.resourceType === RESOURCE_ENERGY) {
      droppedEnergy += resource.amount;
    }
  }

  return {
    tick: Game.time,
    roomName: room.name,
    controller: getControllerIntel(room.controller),
    sources: sources.map(source => ({
      id: source.id,
      x: source.pos.x,
      y: source.pos.y
    })),
    mineral: getMineralIntel(room),
    exits: Game.map.describeExits(room.name) || {},
    creeps: {
      mine: myCreeps.length,
      hostile: hostiles.length,
      hostileOwners: hostileOwners
    },
    structures: countByType(myStructures, 'structureType'),
    constructionSites: countByType(constructionSites, 'structureType'),
    droppedEnergy: droppedEnergy,
    terrain: getTerrainSummary(room.name, previousIntel)
  };
}

function trimOldRooms() {
  const roomNames = Object.keys(Memory.mapIntel);
  if (roomNames.length <= MAX_ROOMS) return;

  roomNames.sort((left, right) => {
    const tickDifference = Memory.mapIntel[left].tick - Memory.mapIntel[right].tick;
    return tickDifference || left.localeCompare(right);
  });

  const removeCount = roomNames.length - MAX_ROOMS;
  for (let index = 0; index < removeCount; index++) {
    delete Memory.mapIntel[roomNames[index]];
  }
}

function collectVisibleRooms() {
  if (!Memory.mapIntel || typeof Memory.mapIntel !== 'object') {
    Memory.mapIntel = {};
  }

  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    Memory.mapIntel[roomName] = collectRoom(room, Memory.mapIntel[roomName]);
  }

  trimOldRooms();
}

module.exports = {
  collectVisibleRooms: collectVisibleRooms
};
