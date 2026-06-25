'use strict';
// D014: zoneBuilder — 統一母房 + 遠端的 builder role
// 取代 role.rcl1Builder（RCL2+）和 role.remoteBuilder
// ⚠️ 請勿回退成分離的 rcl1Builder/remoteBuilder 架構
// 能量優先取自當前房間，沒有才回母房
// 沒有工地時巡邏防區修路

const colonies = require('config.colonies');
const repairPolicy = require('repair.policy');

// 建築優先順序（數字越小越優先）
var CONSTRUCTION_PRIORITY = {};
CONSTRUCTION_PRIORITY[STRUCTURE_SPAWN]     = 0;
CONSTRUCTION_PRIORITY[STRUCTURE_EXTENSION] = 1;
CONSTRUCTION_PRIORITY[STRUCTURE_CONTAINER] = 2;
CONSTRUCTION_PRIORITY[STRUCTURE_TOWER]     = 3;
CONSTRUCTION_PRIORITY[STRUCTURE_LINK]      = 4;
CONSTRUCTION_PRIORITY[STRUCTURE_ROAD]      = 5;

function constructionPriority(site) {
  var p = CONSTRUCTION_PRIORITY[site.structureType];
  return p === undefined ? 6 : p;
}

// ── 能量取得 ─────────────────────────────────────────────────────────────────

function findCurrentRoomEnergy(creep) {
  // 1. 掉落能量
  var dropped = creep.room.find(FIND_DROPPED_RESOURCES, {
    filter: function(r) { return r.resourceType === RESOURCE_ENERGY && r.amount >= 20; }
  });
  if (dropped.length > 0) {
    return { target: creep.pos.findClosestByRange(dropped), type: 'pickup' };
  }

  // 2. tombstone / ruins
  var salvage = [];
  var tombstones = creep.room.find(FIND_TOMBSTONES);
  for (var ti = 0; ti < tombstones.length; ti++) {
    if (tombstones[ti].store.getUsedCapacity(RESOURCE_ENERGY) >= 20) salvage.push(tombstones[ti]);
  }
  var ruins = creep.room.find(FIND_RUINS);
  for (var ri = 0; ri < ruins.length; ri++) {
    if (ruins[ri].store.getUsedCapacity(RESOURCE_ENERGY) >= 20) salvage.push(ruins[ri]);
  }
  if (salvage.length > 0) {
    return { target: creep.pos.findClosestByRange(salvage), type: 'withdraw' };
  }

  // 3. container
  var minPickup = Math.max(50, creep.store.getFreeCapacity() * 0.3);
  var containers = creep.room.find(FIND_STRUCTURES, {
    filter: function(s) {
      return s.structureType === STRUCTURE_CONTAINER &&
        s.store.getUsedCapacity(RESOURCE_ENERGY) >= minPickup;
    }
  });
  if (containers.length > 0) {
    return { target: creep.pos.findClosestByRange(containers), type: 'withdraw' };
  }

  // 4. storage
  if (creep.room.storage && creep.room.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return { target: creep.room.storage, type: 'withdraw' };
  }

  return null;
}

function findHomeRoomEnergy(creep) {
  var homeRoom = Game.rooms[creep.memory.homeRoom];
  if (!homeRoom) return null;

  // storage 優先
  if (homeRoom.storage && homeRoom.storage.store.getUsedCapacity(RESOURCE_ENERGY) > 0) {
    return { target: homeRoom.storage, type: 'withdraw' };
  }

  // container
  var containers = homeRoom.find(FIND_STRUCTURES, {
    filter: function(s) {
      return s.structureType === STRUCTURE_CONTAINER &&
        s.store.getUsedCapacity(RESOURCE_ENERGY) >= 200;
    }
  });
  if (containers.length > 0) {
    return { target: creep.pos.findClosestByRange(containers), type: 'withdraw' };
  }

  // 最後手段：採礦
  var sources = homeRoom.find(FIND_SOURCES, {
    filter: function(s) { return s.energy > 0; }
  });
  if (sources.length > 0) {
    return { target: creep.pos.findClosestByRange(sources), type: 'harvest' };
  }

  return null;
}

function acquireEnergy(creep) {
  // 先嘗試當前房間
  var local = findCurrentRoomEnergy(creep);
  if (local) {
    var r = local.type === 'pickup'
      ? creep.pickup(local.target)
      : creep.withdraw(local.target, RESOURCE_ENERGY);
    if (r === ERR_NOT_IN_RANGE) {
      creep.moveTo(local.target, { reusePath: 10, visualizePathStyle: { stroke: '#ffaa00' } });
    }
    return;
  }

  // 當前房間沒能量 → 回母房
  if (creep.pos.roomName !== creep.memory.homeRoom) {
    creep.moveTo(new RoomPosition(25, 25, creep.memory.homeRoom), { reusePath: 20 });
    return;
  }

  // 在母房取能量
  var home = findHomeRoomEnergy(creep);
  if (!home) return;

  if (home.type === 'harvest') {
    var hr = creep.harvest(home.target);
    if (hr === ERR_NOT_IN_RANGE) {
      creep.moveTo(home.target, { reusePath: 5, visualizePathStyle: { stroke: '#ffaa00' } });
    }
    return;
  }

  var wr = home.type === 'pickup'
    ? creep.pickup(home.target)
    : creep.withdraw(home.target, RESOURCE_ENERGY);
  if (wr === ERR_NOT_IN_RANGE) {
    creep.moveTo(home.target, { reusePath: 10, visualizePathStyle: { stroke: '#ffaa00' } });
  }
}

// ── 工作尋找 ─────────────────────────────────────────────────────────────────

function selectConstructionSite(creep, sites) {
  if (sites.length === 0) return null;
  var best = sites[0];
  for (var i = 1; i < sites.length; i++) {
    var site = sites[i];
    var p = constructionPriority(site);
    var bp = constructionPriority(best);
    if (p < bp || (p === bp && creep.pos.getRangeTo(site) < creep.pos.getRangeTo(best))) {
      best = site;
    }
  }
  return best;
}

function findConstructionInRoom(creep, roomName) {
  var room = Game.rooms[roomName];
  if (!room) return null;
  var sites = room.find(FIND_CONSTRUCTION_SITES);
  if (sites.length === 0) return null;
  var site = selectConstructionSite(creep, sites);
  return site ? { target: site, type: 'build', room: roomName } : null;
}

function findEmergencyRepairInRoom(creep, roomName) {
  var room = Game.rooms[roomName];
  if (!room) return null;
  var structures = room.find(FIND_STRUCTURES).filter(repairPolicy.isEmergencyRepairTarget);
  if (structures.length === 0) return null;
  var target = creep.pos.findClosestByRange(structures) || structures[0];
  return { target: target, type: 'repair', room: roomName };
}

function findRoadRepairInRoom(creep, roomName) {
  var room = Game.rooms[roomName];
  if (!room) return null;
  var roads = room.find(FIND_STRUCTURES, {
    filter: function(s) {
      return s.structureType === STRUCTURE_ROAD && s.hits < s.hitsMax * 0.6;
    }
  });
  if (roads.length === 0) return null;
  var worst = roads[0];
  for (var i = 1; i < roads.length; i++) {
    if (roads[i].hits / roads[i].hitsMax < worst.hits / worst.hitsMax) worst = roads[i];
  }
  return { target: worst, type: 'repair', room: roomName };
}

function getZoneRooms(homeRoom) {
  var remotes = colonies.getRemoteRooms(homeRoom);
  var rooms = [homeRoom];
  var keys = Object.keys(remotes);
  for (var i = 0; i < keys.length; i++) {
    rooms.push(keys[i]);
  }
  return rooms;
}

// Cached work lookup: recompute every 5 ticks to avoid expensive
// FIND_STRUCTURES scans every tick across all zone rooms.
var WORK_CACHE_TICKS = 5;

function findWork(creep) {
  var homeRoom = creep.memory.homeRoom;
  var zoneRooms = getZoneRooms(homeRoom);
  var currentRoom = creep.pos.roomName;

  // Use cached result when still valid
  var cache = creep.memory._zw;
  if (cache && cache.tick + WORK_CACHE_TICKS >= Game.time && cache.room === currentRoom) {
    return cache.work;
  }

  // 當前房間優先，其餘按 zoneRooms 順序
  var roomOrder = [currentRoom];
  for (var i = 0; i < zoneRooms.length; i++) {
    if (zoneRooms[i] !== currentRoom) roomOrder.push(zoneRooms[i]);
  }

  // 1. 緊急修復（任何可見房間）
  for (var ei = 0; ei < roomOrder.length; ei++) {
    var ew = findEmergencyRepairInRoom(creep, roomOrder[ei]);
    if (ew) {
      creep.memory._zw = { tick: Game.time, room: currentRoom, work: ew };
      return ew;
    }
  }

  // 2. 建築工地（當前 → 母房 → remotes）
  for (var ci = 0; ci < roomOrder.length; ci++) {
    var cw = findConstructionInRoom(creep, roomOrder[ci]);
    if (cw) {
      creep.memory._zw = { tick: Game.time, room: currentRoom, work: cw };
      return cw;
    }
  }

  // 3. 道路修復（任何可見防區房間）
  for (var rdi = 0; rdi < roomOrder.length; rdi++) {
    var rw = findRoadRepairInRoom(creep, roomOrder[rdi]);
    if (rw) {
      creep.memory._zw = { tick: Game.time, room: currentRoom, work: rw };
      return rw;
    }
  }

  // No work: cache null so we don't re-scan
  creep.memory._zw = { tick: Game.time, room: currentRoom, work: null };
  return null;
}

// 沒有工作時巡邏防區（讓 builder 移動到各 remote 才能「看到」工作）
function roam(creep) {
  var homeRoom = creep.memory.homeRoom;
  var zoneRooms = getZoneRooms(homeRoom);
  if (zoneRooms.length <= 1) return;

  var idx = creep.memory.patrolIndex || 0;
  if (idx >= zoneRooms.length) idx = 0;

  var targetRoom = zoneRooms[idx];
  if (creep.pos.roomName !== targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), { reusePath: 20 });
  } else {
    creep.memory.patrolIndex = (idx + 1) % zoneRooms.length;
  }
}

// ── 主迴圈 ───────────────────────────────────────────────────────────────────

module.exports = {
  run: function(creep) {
    // 狀態切換
    if (creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) === 0) {
      creep.memory.working = false;
    }
    if (!creep.memory.working && creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
      creep.memory.working = true;
    }

    // 中途切換：有一定能量且當前房間沒有好能量來源時直接開始工作
    if (!creep.memory.working && creep.store.getUsedCapacity(RESOURCE_ENERGY) >= 50) {
      if (!findCurrentRoomEnergy(creep)) {
        creep.memory.working = true;
      }
    }

    if (!creep.memory.working) {
      acquireEnergy(creep);
      return;
    }

    var work = findWork(creep);
    if (!work) {
      // 沒工作 → 巡邏，讓 builder 到各 remote 房間才能發現道路工作
      roam(creep);
      return;
    }

    // 工作在其他房間 → 先過去
    if (creep.pos.roomName !== work.room) {
      creep.moveTo(new RoomPosition(25, 25, work.room), { reusePath: 20 });
      return;
    }

    var result = work.type === 'build'
      ? creep.build(work.target)
      : creep.repair(work.target);

    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(work.target, { reusePath: 10, visualizePathStyle: { stroke: '#00ff00' } });
    } else if (result === ERR_INVALID_TARGET) {
      // Target gone — clear cache so next tick recomputes
      delete creep.memory._zw;
    }
  }
};
