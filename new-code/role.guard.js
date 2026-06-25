/**
 * role.guard.js — Defense guard
 *
 * States: responding, standby, recycle
 * Priorities: Invader creep > hostile structure (including cores) > standby
 */

var defense = require('manager.remoteDefense');
var ATTACK_STRUCTURES = [
  STRUCTURE_SPAWN, STRUCTURE_TOWER, STRUCTURE_EXTENSION,
  STRUCTURE_STORAGE, STRUCTURE_LINK, STRUCTURE_LAB,
  STRUCTURE_TERMINAL, STRUCTURE_FACTORY, STRUCTURE_NUKER,
  STRUCTURE_POWER_SPAWN, STRUCTURE_INVADER_CORE
];

var lastWarning = {};

function logRateLimited(key, message) {
  if (!lastWarning[key] || Game.time - lastWarning[key] > 100) {
    lastWarning[key] = Game.time;
    console.log(message);
  }
}

// ── Threat scoring (by active body parts) ──

function getInvaderThreatScore(creep) {
  return (
    creep.getActiveBodyparts(HEAL) * 30 +
    creep.getActiveBodyparts(RANGED_ATTACK) * 20 +
    creep.getActiveBodyparts(ATTACK) * 15 +
    creep.getActiveBodyparts(WORK) * 5
  );
}

function findInvaderTarget(creep) {
  var hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
    filter: function (c) {
      return c.owner && c.owner.username === 'Invader';
    }
  });
  if (hostiles.length === 0) return null;

  hostiles.sort(function (a, b) {
    return getInvaderThreatScore(b) - getInvaderThreatScore(a);
  });
  return hostiles[0];
}

function findAnyHostileCreep(creep) {
  var hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length === 0) return null;
  return creep.pos.findClosestByRange(hostiles) || hostiles[0];
}

function findStructureTarget(creep) {
  var all = creep.room.find(FIND_HOSTILE_STRUCTURES, {
    filter: function (s) {
      return ATTACK_STRUCTURES.indexOf(s.structureType) !== -1;
    }
  });
  if (all.length === 0) return null;

  // Prioritize invader cores, then by structure type order
  all.sort(function (a, b) {
    if (a.structureType === STRUCTURE_INVADER_CORE &&
        b.structureType !== STRUCTURE_INVADER_CORE) return -1;
    if (b.structureType === STRUCTURE_INVADER_CORE &&
        a.structureType !== STRUCTURE_INVADER_CORE) return 1;
    return ATTACK_STRUCTURES.indexOf(a.structureType) -
           ATTACK_STRUCTURES.indexOf(b.structureType);
  });
  return creep.pos.findClosestByRange(all) || all[0];
}

// ── Heal logic ──

function tryHeal(creep) {
  if (creep.getActiveBodyparts(HEAL) === 0) return false;

  if (creep.hits < creep.hitsMax) {
    creep.heal(creep);
    return true;
  }

  // Heal nearby damaged guards
  var damagedAllies = creep.pos.findInRange(FIND_MY_CREEPS, 1, {
    filter: function (c) {
      return c.id !== creep.id && c.hits < c.hitsMax &&
             c.memory.role === 'guard';
    }
  });
  if (damagedAllies.length > 0) {
    creep.heal(damagedAllies[0]);
    return true;
  }

  // Ranged heal
  var rangedAllies = creep.pos.findInRange(FIND_MY_CREEPS, 3, {
    filter: function (c) {
      return c.id !== creep.id && c.hits < c.hitsMax &&
             c.memory.role === 'guard';
    }
  });
  if (rangedAllies.length > 0) {
    creep.rangedHeal(creep.pos.findClosestByRange(rangedAllies));
    return true;
  }

  return false;
}

// ── Combat ──

function attackTarget(creep, target) {
  if (creep.getActiveBodyparts(RANGED_ATTACK) > 0 &&
      creep.pos.getRangeTo(target) <= 3 &&
      creep.pos.getRangeTo(target) > 1) {
    creep.rangedAttack(target);
    return;
  }

  if (creep.getActiveBodyparts(ATTACK) > 0) {
    var result = creep.attack(target);
    if (result === ERR_NOT_IN_RANGE) {
      creep.moveTo(target, { reusePath: 2, maxRooms: 1 });
    }
  } else if (creep.pos.getRangeTo(target) > 1) {
    // No attack parts but hostile — move closer anyway
    creep.moveTo(target, { reusePath: 2, maxRooms: 1 });
  }
}

// ── Main guard logic ──

function runAttack(creep) {
  // Heal first (parallel with attack in same tick)
  tryHeal(creep);

  // Find targets
  var invader = findInvaderTarget(creep);
  if (invader) {
    attackTarget(creep, invader);
    return;
  }

  // Any hostile creep
  var hostile = findAnyHostileCreep(creep);
  if (hostile) {
    attackTarget(creep, hostile);
    return;
  }

  // Hostile structures (including invader cores)
  var structure = findStructureTarget(creep);
  if (structure) {
    attackTarget(creep, structure);
    return;
  }
}

function runResponding(creep) {
  var targetRoom = creep.memory.defenseTargetRoom;

  if (!targetRoom) {
    // No target — go standby
    creep.memory.guardState = 'standby';
    return;
  }

  if (creep.room.name !== targetRoom) {
    creep.moveTo(new RoomPosition(25, 25, targetRoom), {
      reusePath: 20
    });
    return;
  }

  // In target room — check if anything actually needs attacking
  tryHeal(creep);
  var invader = findInvaderTarget(creep);
  if (invader) { attackTarget(creep, invader); return; }
  var hostile = findAnyHostileCreep(creep);
  if (hostile) { attackTarget(creep, hostile); return; }
  var structure = findStructureTarget(creep);
  if (structure) { attackTarget(creep, structure); return; }

  // Nothing hostile in target room — check defense memory for active threats
  var def = Memory.remoteDefense && Memory.remoteDefense[creep.memory.home || creep.memory.homeRoom];
  if (def && def.threatRooms && def.threatRooms.length > 0) {
    // Redirect to nearest threat room
    var nearest = null;
    var nearestDist = Infinity;
    for (var i = 0; i < def.threatRooms.length; i++) {
      var tr = def.threatRooms[i];
      var dist = Game.map.getRoomLinearDistance(creep.room.name, tr.roomName);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = tr.roomName;
      }
    }
    if (nearest && nearest !== targetRoom) {
      creep.memory.defenseTargetRoom = nearest;
      creep.memory.task = 'redirect:threat:' + nearest;
      return;
    }
  }

  // No threats anywhere — go to standby
  creep.memory.guardState = 'standby';
}

module.exports = {
  run: function (creep) {
    // Handle recycle state
    if (creep.memory.guardState === 'recycle') {
      defense.runGuardRecycle(creep);
      return;
    }

    // Handle standby state
    if (creep.memory.guardState === 'standby') {
      defense.runGuardStandby(creep);
      return;
    }

    // Responding: go to target room and fight
    if (creep.memory.guardState === 'responding') {
      runResponding(creep);
      return;
    }

    // Default: if defense mode active, fight
    if (defense.isDefenseModeActive()) {
      runAttack(creep);
      return;
    }

    // Fallback: standby
    defense.runGuardStandby(creep);
  }
};
