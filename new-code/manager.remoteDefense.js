/**
 * manager.remoteDefense.js — Unified Defense Group manager
 *
 * W49N25 Defense Group: W49N25, W48N25, W48N26, W49N26
 *
 * Tiers:
 *   Tier 1 — home critical economy (miner, hauler, balancer)
 *   Tier 2 — defense guard
 *   Tier 3 — normal + remote production (paused during Defense Mode)
 *
 * Invader Core is NOT part of Defense Mode — it's a background task.
 */

var HOME_ROOM = 'W49N25';
var CANCEL_EARLY_TICKS = 20;
var CLEAR_CONFIRMATION_TICKS = 3;
var THREAT_TIMEOUT = 300;
var STANDBY_MAX = 4;

// ── Tier classification ──

function isHomeCriticalRole(role, memory) {
  if (role === 'rcl2Miner' || role === 'rcl2Hauler') {
    return (memory.home || memory.homeRoom) === HOME_ROOM;
  }
  if (role === 'storageLinkBalancer' || role === 'doorLinkBalancer') {
    return true;
  }
  return false;
}

function isTier3Role(role) {
  if (role === 'remoteMiner' || role === 'remoteHauler' ||
      role === 'reserver' || role === 'remoteBuilder' ||
      role === 'rcl1Builder' || role === 'upgrader' ||
      role === 'rcl1Upgrader' || role === 'pioneer' ||
      role === 'claimer' || role === 'scout' ||
      role === 'remoteGuard') {
    return true;
  }
  return false;
}

// ── Memory initialization ──

function getDefenseMemory() {
  if (!Memory.remoteDefense) {
    Memory.remoteDefense = {};
  }
  if (!Memory.remoteDefense[HOME_ROOM]) {
    Memory.remoteDefense[HOME_ROOM] = {
      active: false,
      invaderCount: 0,
      requiredGuards: 0,
      clearTicks: 0,
      threatRooms: [],
      coreRooms: [],
      stagingRoom: null,
      assignmentVersion: 0,
      lastLogSignature: null
    };
  }
  return Memory.remoteDefense[HOME_ROOM];
}

function getHomeConfig() {
  if (!Memory.remote || !Memory.remote[HOME_ROOM]) return null;
  return Memory.remote[HOME_ROOM];
}

// ── Threat scanning ──

function scanDefenseGroup() {
  var defense = getDefenseMemory();
  var homeConfig = getHomeConfig();
  if (!homeConfig) return;

  var totalInvaders = 0;
  var threatRooms = [];
  var coreRooms = [];

  // Scan home room
  var homeRoom = Game.rooms[HOME_ROOM];
  if (homeRoom) {
    var homeHostiles = homeRoom.find(FIND_HOSTILE_CREEPS);
    var homeInvaders = 0;
    for (var i = 0; i < homeHostiles.length; i++) {
      if (homeHostiles[i].owner &&
          homeHostiles[i].owner.username === 'Invader') {
        homeInvaders++;
      }
    }
    if (homeInvaders > 0) {
      var friendlyCreeps = homeRoom.find(FIND_MY_CREEPS);
      var damaged = 0;
      for (var j = 0; j < friendlyCreeps.length; j++) {
        if (friendlyCreeps[j].hits < friendlyCreeps[j].hitsMax) damaged++;
      }
      threatRooms.push({
        roomName: HOME_ROOM,
        invaderCount: homeInvaders,
        friendlyCreepsPresent: friendlyCreeps.length,
        friendlyCreepsDamaged: damaged,
        lastSeenThreatTick: Game.time
      });
      totalInvaders += homeInvaders;
    }

    var homeCores = homeRoom.find(FIND_HOSTILE_STRUCTURES, {
      filter: function (s) {
        return s.structureType === STRUCTURE_INVADER_CORE;
      }
    });
    for (var k = 0; k < homeCores.length; k++) {
      coreRooms.push({
        roomName: HOME_ROOM,
        coreId: homeCores[k].id,
        level: homeCores[k].level || 0,
        ticksToDeploy: homeCores[k].ticksToDeploy || 0
      });
    }
  }

  // Scan remote rooms
  if (homeConfig.rooms) {
    for (var remoteRoomName in homeConfig.rooms) {
      var room = Game.rooms[remoteRoomName];
      if (!room) continue;

      // Invader creeps
      var hostiles = room.find(FIND_HOSTILE_CREEPS);
      var invaderCount = 0;
      for (var ri = 0; ri < hostiles.length; ri++) {
        if (hostiles[ri].owner &&
            hostiles[ri].owner.username === 'Invader') {
          invaderCount++;
        }
      }
      if (invaderCount > 0) {
        var remoteFriendly = room.find(FIND_MY_CREEPS);
        var remoteDamaged = 0;
        for (var rj = 0; rj < remoteFriendly.length; rj++) {
          if (remoteFriendly[rj].hits < remoteFriendly[rj].hitsMax) {
            remoteDamaged++;
          }
        }
        threatRooms.push({
          roomName: remoteRoomName,
          invaderCount: invaderCount,
          friendlyCreepsPresent: remoteFriendly.length,
          friendlyCreepsDamaged: remoteDamaged,
          lastSeenThreatTick: Game.time
        });
        totalInvaders += invaderCount;
      }

      // Invader Cores
      var cores = room.find(FIND_HOSTILE_STRUCTURES, {
        filter: function (s) {
          return s.structureType === STRUCTURE_INVADER_CORE;
        }
      });
      for (var ck = 0; ck < cores.length; ck++) {
        coreRooms.push({
          roomName: remoteRoomName,
          coreId: cores[ck].id,
          level: cores[ck].level || 0,
          ticksToDeploy: cores[ck].ticksToDeploy || 0
        });
      }
    }
  }

  // Update defense memory
  defense.threatRooms = threatRooms;
  defense.coreRooms = coreRooms;

  // Log detected cores (throttled every 20 ticks to avoid spam)
  if (coreRooms.length > 0 && Game.time % 20 === 0) {
    console.log('[defense] invaderCores: ' +
      coreRooms.map(function (c) {
        return c.roomName + '(lv' + c.level + ')';
      }).join(', '));
  }

  // Defense Mode activation/deactivation
  if (totalInvaders > 0) {
    if (!defense.active) {
      defense.active = true;
      defense.clearTicks = 0;
      defense.assignmentVersion++;
      console.log('[defense] group=' + HOME_ROOM +
        ' invaders=' + totalInvaders +
        ' requiredGuards=' + (totalInvaders + 1) + ' mode=on');
    }
    defense.invaderCount = totalInvaders;
    defense.requiredGuards = totalInvaders + 1;
  } else if (defense.active) {
    defense.clearTicks++;
    if (defense.clearTicks >= CLEAR_CONFIRMATION_TICKS) {
      defense.active = false;
      defense.invaderCount = 0;
      defense.requiredGuards = 0;
      defense.clearTicks = 0;
      defense.threatRooms = [];
      defense.cancelPerformed = false;
      console.log('[defense] group=' + HOME_ROOM +
        ' clearConfirmation=' + CLEAR_CONFIRMATION_TICKS + '/' +
        CLEAR_CONFIRMATION_TICKS + ' mode=off');
    }
  }
}

// ── Guard counting ──

function countDefenseGuards(tickRequests) {
  var alive = 0;
  for (var name in Game.creeps) {
    var c = Game.creeps[name];
    if (c.memory.role === 'guard' &&
        c.memory.defenseGroup === HOME_ROOM) {
      alive++;
    }
  }

  var spawning = 0;
  for (var spawnName in Game.spawns) {
    var spawn = Game.spawns[spawnName];
    if (!spawn.spawning) continue;
    var mem = Memory.creeps[spawn.spawning.name];
    if (mem && mem.role === 'guard' &&
        mem.defenseGroup === HOME_ROOM) {
      spawning++;
    }
  }

  var requested = 0;
  for (var i = 0; i < tickRequests.length; i++) {
    var req = tickRequests[i];
    if (req.role === 'guard' &&
        req.memory && req.memory.defenseGroup === HOME_ROOM) {
      requested++;
    }
  }

  return alive + spawning + requested;
}

// ── Guard assignment ──

function sortThreatRooms() {
  var defense = getDefenseMemory();
  var threatRooms = defense.threatRooms.slice();

  threatRooms.sort(function (a, b) {
    // Home room first
    if (a.roomName === HOME_ROOM && b.roomName !== HOME_ROOM) return -1;
    if (b.roomName === HOME_ROOM && a.roomName !== HOME_ROOM) return 1;

    // Damaged friendlies
    if (a.friendlyCreepsDamaged > 0 && b.friendlyCreepsDamaged <= 0) return -1;
    if (b.friendlyCreepsDamaged > 0 && a.friendlyCreepsDamaged <= 0) return 1;

    // More invaders
    if (a.invaderCount !== b.invaderCount) {
      return b.invaderCount - a.invaderCount;
    }

    return 0;
  });

  return threatRooms;
}

function getGuardAssignments() {
  var defense = getDefenseMemory();
  var sorted = sortThreatRooms();

  var assignments = {};
  var remaining = defense.requiredGuards;

  // Assign base: invaderCount per room
  for (var i = 0; i < sorted.length && remaining > 0; i++) {
    var room = sorted[i];
    var base = Math.min(room.invaderCount, remaining);
    assignments[room.roomName] = base;
    remaining -= base;
  }

  // Assign extra guard
  if (remaining > 0) {
    var extraRoom = sorted[0].roomName;
    assignments[extraRoom] = (assignments[extraRoom] || 0) + 1;
  }

  return assignments;
}

// ── Standby positions ──

function selectStagingRemote() {
  var defense = getDefenseMemory();
  var homeConfig = getHomeConfig();

  if (defense.stagingRoom) {
    var room = Game.rooms[defense.stagingRoom];
    if (room && room.controller) return defense.stagingRoom;
  }

  // Pick first enabled remote
  if (homeConfig && homeConfig.rooms) {
    for (var rn in homeConfig.rooms) {
      var rc = homeConfig.rooms[rn];
      if (rc && rc.enabled !== false) {
        defense.stagingRoom = rn;
        return rn;
      }
    }
  }
  return null;
}

function computeStandbyPositions(stagingRoom) {
  var room = Game.rooms[stagingRoom];
  if (!room || !room.controller) return [];

  var ctrl = room.controller;
  var positions = [];
  var used = {};

  // Range 2 first, then range 1
  var candidates = [];
  for (var dx = -2; dx <= 2; dx++) {
    for (var dy = -2; dy <= 2; dy++) {
      if (dx === 0 && dy === 0) continue;
      var x = ctrl.pos.x + dx;
      var y = ctrl.pos.y + dy;
      if (x <= 0 || x >= 49 || y <= 0 || y >= 49) continue;

      var terrain = Game.map.getRoomTerrain(stagingRoom);
      if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

      var structures = room.lookForAt(LOOK_STRUCTURES, x, y);
      var blocked = false;
      for (var si = 0; si < structures.length; si++) {
        var st = structures[si].structureType;
        if (st !== STRUCTURE_ROAD && st !== STRUCTURE_CONTAINER &&
            st !== STRUCTURE_RAMPART) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;

      var dist = Math.max(Math.abs(dx), Math.abs(dy));
      var isRoad = false;
      for (var sj = 0; sj < structures.length; sj++) {
        if (structures[sj].structureType === STRUCTURE_ROAD) {
          isRoad = true;
          break;
        }
      }

      var key = x + ':' + y;
      candidates.push({ x: x, y: y, key: key, dist: dist, isRoad: isRoad });
    }
  }

  candidates.sort(function (a, b) {
    if (a.dist !== b.dist) return a.dist - b.dist; // range 2 preferred
    if (a.isRoad !== b.isRoad) return a.isRoad ? -1 : 1;
    return 0;
  });

  for (var ci = 0; ci < candidates.length && positions.length < 4; ci++) {
    if (!used[candidates[ci].key]) {
      positions.push({ x: candidates[ci].x, y: candidates[ci].y });
      used[candidates[ci].key] = true;
    }
  }

  return positions;
}

function getStandbyPositions(stagingRoom) {
  if (!Memory.standbyPositions) Memory.standbyPositions = {};
  if (!Memory.standbyPositions[stagingRoom]) {
    Memory.standbyPositions[stagingRoom] = computeStandbyPositions(stagingRoom);
  }
  return Memory.standbyPositions[stagingRoom];
}

// ── Guard bodies ──

// Melee guard: T+A+H+M — scales by RCL energy capacity.
// H×1 allows self-heal each tick.
// Body order: TOUGH first (first to be damaged), HEAL last (last to lose function).
function buildMeleeGuardBody(energyCapacity) {
  if (energyCapacity >= 2860) {
    // RCL7: T×8 A×16 H×1 M×25 = 2860e, 50 parts
    return [
      TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
      ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
      ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
      HEAL,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
      MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 1700) {
    // RCL6: T×6 A×8 H×1 M×15 = 1700e, 30 parts
    return [
      TOUGH, TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
      ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
      HEAL,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
      MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 1320) {
    // RCL5: T×4 A×6 H×1 M×11 = 1320e, 22 parts
    return [
      TOUGH, TOUGH, TOUGH, TOUGH,
      ATTACK, ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
      HEAL,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 940) {
    // RCL4: T×2 A×4 H×1 M×7 = 940e, 14 parts
    return [
      TOUGH, TOUGH,
      ATTACK, ATTACK, ATTACK, ATTACK,
      HEAL,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 750) {
    // RCL3: T×1 A×3 H×1 M×5 = 750e, 10 parts
    return [TOUGH, ATTACK, ATTACK, ATTACK, HEAL, MOVE, MOVE, MOVE, MOVE, MOVE];
  }
  if (energyCapacity >= 380) {
    return [ATTACK, HEAL, MOVE, MOVE];
  }
  return null;
}

// Ranged guard: RA+H+M — heals melee partner and contributes DPS from range.
function buildRangedGuardBody(energyCapacity) {
  if (energyCapacity >= 3500) {
    // RCL7: RA×10 H×5 M×15 = 3500e, 30 parts
    return [
      RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
      RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
      HEAL, HEAL, HEAL, HEAL, HEAL,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
      MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 1600) {
    // RCL6: RA×5 H×2 M×7 = 1600e, 14 parts
    return [
      RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
      HEAL, HEAL,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 1200) {
    // RCL5: RA×3 H×2 M×5 = 1200e, 10 parts
    return [
      RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
      HEAL, HEAL,
      MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  if (energyCapacity >= 700) {
    // RCL4: RA×2 H×1 M×3 = 700e, 6 parts
    return [RANGED_ATTACK, RANGED_ATTACK, HEAL, MOVE, MOVE, MOVE];
  }
  if (energyCapacity >= 400) {
    return [RANGED_ATTACK, HEAL, MOVE, MOVE];
  }
  return null;
}

// Legacy alias used by getDefenseRequests (kept for compat)
function buildGuardBody(energyCapacity) {
  return buildMeleeGuardBody(energyCapacity);
}

function getBodyCost(body) {
  var total = 0;
  for (var i = 0; i < body.length; i++) {
    total += BODYPART_COST[body[i]] || 0;
  }
  return total;
}

// ── Spawn request tiers ──

function getDefenseRequests(homeRoomName, currentGuardCount) {
  var defense = getDefenseMemory();
  var requests = [];

  if (!defense.active) return requests;

  var assignments = getGuardAssignments();
  var sortedRooms = sortThreatRooms();

  // Activate existing standby guards first
  for (var name in Game.creeps) {
    var c = Game.creeps[name];
    if (c.memory.role !== 'guard') continue;
    if (c.memory.defenseGroup !== HOME_ROOM) continue;
    if (c.memory.guardState !== 'standby' &&
        c.memory.guardState !== 'recycle') continue;

    var targetRoom = null;
    for (var tr = 0; tr < sortedRooms.length; tr++) {
      var rn = sortedRooms[tr].roomName;
      if (assignments[rn] > 0) {
        targetRoom = rn;
        assignments[rn]--;
        break;
      }
    }
    if (!targetRoom) continue;

    delete c.memory.standbyRoom;
    delete c.memory.standbyIndex;
    delete c.memory.recycleRoom;
    c.memory.guardState = 'responding';
    c.memory.defenseTargetRoom = targetRoom;
    c.memory.assignmentVersion = defense.assignmentVersion;
  }

  // Count guards after activation
  var activeGuards = currentGuardCount + requests.length;

  // Spawn new guards if needed
  while (activeGuards < defense.requiredGuards) {
    var room = Game.rooms[homeRoomName];
    if (!room) break;

    var body = buildGuardBody(room.energyCapacityAvailable);
    if (!body) break;

    requests.push({
      role: 'guard',
      priorityTier: 2,
      name: 'guard_' + homeRoomName + '_' + Game.time + '_' + activeGuards,
      body: body,
      bodyCost: getBodyCost(body),
      memory: {
        role: 'guard',
        home: homeRoomName,
        homeRoom: homeRoomName,
        defenseGroup: homeRoomName,
        guardState: 'responding',
        defenseTargetRoom: sortedRooms.length > 0 ? sortedRooms[0].roomName : null
      }
    });
    activeGuards++;
  }

  return requests;
}

// ── Core pair spawn requests (M-R-M order) ──
// Level 1-2 core: 1 melee + 1 ranged
// Level 3+  core: 2 melee + 1 ranged

function countCoreGuards(coreRoom, tickRequests) {
  var melee = 0;
  var ranged = 0;

  for (var name in Game.creeps) {
    var c = Game.creeps[name];
    if (c.memory.coreTargetRoom !== coreRoom) continue;
    if (c.memory.role === 'guard') melee++;
    if (c.memory.role === 'remoteGuard') ranged++;
  }
  for (var spawnName in Game.spawns) {
    var spawn = Game.spawns[spawnName];
    if (!spawn.spawning) continue;
    var mem = Memory.creeps[spawn.spawning.name];
    if (!mem || mem.coreTargetRoom !== coreRoom) continue;
    if (mem.role === 'guard') melee++;
    if (mem.role === 'remoteGuard') ranged++;
  }
  for (var ri = 0; ri < tickRequests.length; ri++) {
    var req = tickRequests[ri];
    if (!req.memory || req.memory.coreTargetRoom !== coreRoom) continue;
    if (req.role === 'guard') melee++;
    if (req.role === 'remoteGuard') ranged++;
  }
  return { melee: melee, ranged: ranged };
}

function getCoreSpawnRequests(homeRoomName) {
  var defense = getDefenseMemory();
  var requests = [];

  if (!defense.coreRooms || defense.coreRooms.length === 0) return requests;

  var homeRoom = Game.rooms[homeRoomName];
  if (!homeRoom) return requests;

  var energyCapacity = homeRoom.energyCapacityAvailable;
  var meleeBody = buildMeleeGuardBody(energyCapacity);
  var rangedBody = buildRangedGuardBody(energyCapacity);
  if (!meleeBody || !rangedBody) return requests;

  var meleeCost = getBodyCost(meleeBody);
  var rangedCost = getBodyCost(rangedBody);

  for (var i = 0; i < defense.coreRooms.length; i++) {
    var coreData = defense.coreRooms[i];
    var coreRoom = coreData.roomName;
    var coreLevel = coreData.level || 1;

    // Fixed: always 1M + 1R per core. Player adds more via console if needed.
    var targetMelee = 1;
    var targetRanged = 1;

    var counts = countCoreGuards(coreRoom, requests);
    var needMelee = targetMelee - counts.melee;
    var needRanged = targetRanged - counts.ranged;

    // Spawn order: M first, then R
    if (needMelee > 0) {
      requests.push({
        role: 'guard',
        priorityTier: 2,
        name: 'guard_core_' + coreRoom.replace('W', '').replace('N', '') + '_' + Game.time,
        body: meleeBody,
        bodyCost: meleeCost,
        memory: {
          role: 'guard',
          home: homeRoomName,
          homeRoom: homeRoomName,
          defenseGroup: homeRoomName,
          guardState: 'responding',
          defenseTargetRoom: coreRoom,
          coreTargetRoom: coreRoom
        }
      });
      console.log('[defense] core spawn: melee → ' + coreRoom + ' lv' + coreLevel);
    }

    if (needRanged > 0) {
      requests.push({
        role: 'remoteGuard',
        priorityTier: 2,
        name: 'remoteGuard_core_' + coreRoom.replace('W', '').replace('N', '') + '_' + Game.time,
        body: rangedBody,
        bodyCost: rangedCost,
        memory: {
          role: 'remoteGuard',
          home: homeRoomName,
          homeRoom: homeRoomName,
          defenseGroup: homeRoomName,
          coreTargetRoom: coreRoom
        }
      });
      console.log('[defense] core spawn: ranged → ' + coreRoom + ' lv' + coreLevel);
    }
  }

  return requests;
}

// ── Public API ──

function getAllSpawnRequests(homeRoomName) {
  var requests = [];
  var defense = getDefenseMemory();

  // Tier 1: home critical economy
  var tier1 = getHomeCriticalRequests(homeRoomName);
  // (handled by rcl2ContainerEconomy separately, not duplicated here)

  // Tier 2: defense guards (only when active)
  if (defense.active) {
    var guardCount = countDefenseGuards(requests);
    var defenseReqs = getDefenseRequests(homeRoomName, guardCount);
    for (var i = 0; i < defenseReqs.length; i++) {
      requests.push(defenseReqs[i]);
    }
  }

  // Tier 2b: invader core pairs (M-R-M, runs even when defense not active)
  var coreReqs = getCoreSpawnRequests(homeRoomName);
  for (var ci = 0; ci < coreReqs.length; ci++) {
    requests.push(coreReqs[ci]);
  }

  return requests;
}

function getHomeCriticalRequests(homeRoomName) {
  // Tier 1 is handled by rcl2ContainerEconomy — this function returns empty
  // as a placeholder. The economy manager has its own priority.
  return [];
}

function isDefenseModeActive() {
  var defense = getDefenseMemory();
  return defense.active;
}

function shouldPauseTier3() {
  return isDefenseModeActive();
}

function run() {
  scanDefenseGroup();

  var defense = getDefenseMemory();
  if (!defense.active) {
    // Defense Mode off — manage standby/recycle
    manageStandby();
  }
}

function manageStandby() {
  var defense = getDefenseMemory();
  var stagingRoom = selectStagingRemote();
  if (!stagingRoom) return;

  var standbyPositions = getStandbyPositions(stagingRoom);
  var maxStandby = Math.min(STANDBY_MAX, standbyPositions.length);

  // Collect defense guards — skip core-assigned guards (they have their own mission)
  var guards = [];
  for (var name in Game.creeps) {
    var c = Game.creeps[name];
    if (c.memory.role === 'guard' &&
        c.memory.defenseGroup === HOME_ROOM &&
        !c.memory.coreTargetRoom) {
      guards.push(c);
    }
  }

  // Sort by spawn time for stable ordering
  guards.sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });

  // Assign standby to first maxStandby guards
  var assigned = {};
  for (var i = 0; i < Math.min(guards.length, maxStandby); i++) {
    var guard = guards[i];
    if (guard.memory.guardState === 'recycle') {
      // Reactivate for standby
      delete guard.memory.recycleRoom;
    }
    guard.memory.guardState = 'standby';
    guard.memory.standbyRoom = stagingRoom;
    guard.memory.standbyIndex = i;
    guard.memory.defenseGroup = HOME_ROOM;
    assigned[guard.name] = true;
  }

  // Recycle remaining
  for (var j = maxStandby; j < guards.length; j++) {
    var extra = guards[j];
    if (extra.memory.guardState === 'recycle') continue;
    extra.memory.guardState = 'recycle';
    extra.memory.recycleRoom = HOME_ROOM;
  }

  // Update staging room config
  if (defense.stagingRoom !== stagingRoom ||
      !defense.lastStagingUpdate ||
      Game.time - defense.lastStagingUpdate > 500) {
    defense.stagingRoom = stagingRoom;
    defense.lastStagingUpdate = Game.time;
    console.log('[defense] group=' + HOME_ROOM +
      ' stagingRoom=' + stagingRoom +
      ' standbyPositions=' + standbyPositions.length);
  }
}

function runGuardStandby(creep) {
  var stagingRoom = creep.memory.standbyRoom;
  var standbyPositions = getStandbyPositions(stagingRoom);
  var idx = creep.memory.standbyIndex || 0;

  if (!standbyPositions || idx >= standbyPositions.length) {
    return;
  }

  var pos = standbyPositions[idx];
  if (creep.pos.x === pos.x && creep.pos.y === pos.y &&
      creep.pos.roomName === stagingRoom) {
    return; // Already at position
  }

  creep.moveTo(new RoomPosition(pos.x, pos.y, stagingRoom), {
    reusePath: 20
  });
}

function runGuardRecycle(creep) {
  var recycleRoom = creep.memory.recycleRoom || HOME_ROOM;

  if (creep.room.name !== recycleRoom) {
    creep.moveTo(new RoomPosition(25, 25, recycleRoom), {
      reusePath: 20
    });
    return;
  }

  var spawns = creep.room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return;

  var spawn = spawns[0];
  var result = spawn.recycleCreep(creep);
  if (result === ERR_NOT_IN_RANGE) {
    creep.moveTo(spawn, { reusePath: 5 });
  }
}

module.exports = {
  HOME_ROOM: HOME_ROOM,
  CANCEL_EARLY_TICKS: CANCEL_EARLY_TICKS,
  CLEAR_CONFIRMATION_TICKS: CLEAR_CONFIRMATION_TICKS,
  STANDBY_MAX: STANDBY_MAX,
  getAllSpawnRequests: getAllSpawnRequests,
  getDefenseRequests: getDefenseRequests,
  getCoreSpawnRequests: getCoreSpawnRequests,
  getHomeCriticalRequests: getHomeCriticalRequests,
  isDefenseModeActive: isDefenseModeActive,
  shouldPauseTier3: shouldPauseTier3,
  getDefenseMemory: getDefenseMemory,
  run: run,
  runGuardStandby: runGuardStandby,
  runGuardRecycle: runGuardRecycle,
  buildGuardBody: buildGuardBody,
  buildMeleeGuardBody: buildMeleeGuardBody,
  buildRangedGuardBody: buildRangedGuardBody,
  getBodyCost: getBodyCost,
  isHomeCriticalRole: isHomeCriticalRole,
  isTier3Role: isTier3Role
};
