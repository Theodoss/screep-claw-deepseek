/**
 * reserved.tiles.js — permanent reserved tile definitions
 *
 * Used by CostMatrix builders, travel, traffic, spawn direction selection.
 */

var RESERVED_TILES = {
  W49N25: {
    '17:28': 'storageLinkBalancer',
    '47:7': 'doorLinkBalancer'
  }
};

/**
 * Check if a position is a reserved tile for a specific role.
 * Returns the allowed role name, or null if not reserved.
 */
function getReservedRole(roomName, x, y) {
  var roomTiles = RESERVED_TILES[roomName];
  if (!roomTiles) return null;
  return roomTiles[x + ':' + y] || null;
}

/**
 * Check if a creep is allowed on its current tile.
 * Returns true if the tile is NOT reserved for a different role.
 */
function isTileAllowedForCreep(creep) {
  if (!creep || !creep.pos) return true;
  var reservedRole = getReservedRole(
    creep.pos.roomName,
    creep.pos.x,
    creep.pos.y
  );
  if (!reservedRole) return true;
  return creep.memory.role === reservedRole;
}

/**
 * Check if a position is blocked for a given creep role.
 * True = tile is RESERVED for ANOTHER role → blocked for this creep.
 */
function isReservedForOther(roomName, x, y, creepRole) {
  var reservedRole = getReservedRole(roomName, x, y);
  if (!reservedRole) return false;
  return reservedRole !== creepRole;
}

/**
 * Apply reserved tiles to a CostMatrix.
 * Reserved tiles get cost 255 for all creeps except the allowed role.
 */
function applyToCostMatrix(roomName, costs, creepRole) {
  var roomTiles = RESERVED_TILES[roomName];
  if (!roomTiles) return costs;

  for (var key in roomTiles) {
    if (roomTiles[key] === creepRole) {
      // Allowed: set cost to 1 (passable) for this creep
      var parts = key.split(':');
      var x = parseInt(parts[0], 10);
      var y = parseInt(parts[1], 10);
      costs.set(x, y, 1);
    } else {
      // Reserved for other: cost 255
      var parts2 = key.split(':');
      var x2 = parseInt(parts2[0], 10);
      var y2 = parseInt(parts2[1], 10);
      costs.set(x2, y2, 255);
    }
  }
  return costs;
}

/**
 * Get spawn directions to avoid for a given spawn position.
 * Returns array of direction constants that would place a creep on a reserved tile.
 */
function getBlockedSpawnDirections(spawn) {
  if (!spawn || !spawn.pos) return [];
  var blocked = [];
  var roomTiles = RESERVED_TILES[spawn.pos.roomName];
  if (!roomTiles) return blocked;

  for (var key in roomTiles) {
    var parts = key.split(':');
    var rx = parseInt(parts[0], 10);
    var ry = parseInt(parts[1], 10);
    var dx = rx - spawn.pos.x;
    var dy = ry - spawn.pos.y;

    for (var dir = 1; dir <= 8; dir++) {
      var offX = [0, 0, 1, 1, 1, 0, -1, -1, -1][dir];
      var offY = [0, -1, -1, 0, 1, 1, 1, 0, -1][dir];
      if (spawn.pos.x + offX === rx && spawn.pos.y + offY === ry) {
        blocked.push(dir);
      }
    }
  }
  return blocked;
}

module.exports = {
  RESERVED_TILES: RESERVED_TILES,
  getReservedRole: getReservedRole,
  isTileAllowedForCreep: isTileAllowedForCreep,
  isReservedForOther: isReservedForOther,
  applyToCostMatrix: applyToCostMatrix,
  getBlockedSpawnDirections: getBlockedSpawnDirections
};
