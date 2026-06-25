// Ranged+heal remote guard.
// Behaviour (DECISIONS D012):
//   1. Invaders in the current room → engage immediately.
//   2. Else nearest remote with a live invader threat → travel in and hold
//      (gives vision so the threat flag can clear). Invaders can't move
//      between rooms, so this is responsive coverage, not pursuit.
//   3. Else → patrol the home's active remotes in rotation.
// Inter-room movement goes through travel.js (border-tile guard +
// anti-oscillation + swamp handling, D007) and the guard always settles
// >=3 tiles off the edge — never idles on an exit tile (which the game
// auto-pushes back into the previous room, causing the border bounce).

const colonies = require('config.colonies');
const travel = require('travel');

const DIR_OFFSET = {
  1: [0, -1], 2: [1, -1], 3: [1, 0], 4: [1, 1],
  5: [0, 1], 6: [-1, 1], 7: [-1, 0], 8: [-1, -1]
};

function isInvader(creep) {
  return !!(creep.owner && creep.owner.username === 'Invader');
}

function hasBodyPart(creep, partType) {
  for (let i = 0; i < creep.body.length; i++) {
    if (creep.body[i].type === partType && creep.body[i].hits > 0) {
      return true;
    }
  }
  return false;
}

function getHostilePriority(hostile) {
  if (hasBodyPart(hostile, HEAL)) return 1;
  if (hasBodyPart(hostile, RANGED_ATTACK)) return 2;
  if (hasBodyPart(hostile, ATTACK)) return 3;
  return 4;
}

function selectTarget(creep) {
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length === 0) return null;
  hostiles.sort(function (a, b) {
    const pa = getHostilePriority(a);
    const pb = getHostilePriority(b);
    if (pa !== pb) return pa - pb;
    return creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b);
  });
  return hostiles[0];
}

function getClosestHostileRange(creep, hostiles) {
  let closest = 50;
  for (let i = 0; i < hostiles.length; i++) {
    const range = creep.pos.getRangeTo(hostiles[i]);
    if (range < closest) closest = range;
  }
  return closest;
}

// Step one tile in a direction, within the same room (never cross exits).
function fleeStep(creep, dir) {
  const offset = DIR_OFFSET[dir];
  if (!offset) return false;
  const fx = creep.pos.x + offset[0];
  const fy = creep.pos.y + offset[1];
  // Stay 1 tile clear of every edge so we never land on an exit tile.
  if (fx < 1 || fx > 48 || fy < 1 || fy > 48) return false;
  const terrain = Game.map.getRoomTerrain(creep.pos.roomName);
  if (terrain.get(fx, fy) === TERRAIN_MASK_WALL) return false;
  creep.move(dir);
  return true;
}

// Robust inter-room move via travel.js. Returns true while still traveling,
// false once arrived >=3 tiles inside the destination room. Resets the
// cached route when the destination changes.
function goTo(creep, roomName) {
  if (creep.memory._navTo !== roomName) {
    creep.memory._navTo = roomName;
    delete creep.memory._t;
  }
  return travel.run(creep, roomName);
}

// True if standing safely inside roomName (>=3 tiles from any edge).
function inRoomOffEdge(creep, roomName) {
  if (creep.pos.roomName !== roomName) return false;
  const p = creep.pos;
  return Math.min(p.x, 49 - p.x, p.y, 49 - p.y) >= 3;
}

// Nearest remote room of this home with a flagged invader threat.
function findThreatRoom(creep, homeRoom) {
  const homeConfig = Memory.remote && Memory.remote[homeRoom];
  if (!homeConfig || !homeConfig.rooms) return null;
  let best = null;
  let bestDist = Infinity;
  for (const roomName in homeConfig.rooms) {
    const rc = homeConfig.rooms[roomName];
    if (rc && rc.threat && rc.threat.type === 'invader') {
      const dist = Game.map.getRoomLinearDistance(creep.pos.roomName, roomName);
      if (dist < bestDist) {
        bestDist = dist;
        best = roomName;
      }
    }
  }
  return best;
}

// Active remotes to patrol = those with at least one enabled source.
function listPatrolRooms(homeRoom) {
  const remotes = colonies.getRemoteRooms(homeRoom);
  const out = [];
  for (const roomName in remotes) {
    const sources = remotes[roomName] || [];
    for (let i = 0; i < sources.length; i++) {
      if (sources[i] && sources[i].enabled !== false) {
        out.push(roomName);
        break;
      }
    }
  }
  return out;
}

// Nearest core room from defense memory.
function findCoreRoom(creep, homeRoom) {
  var def = Memory.remoteDefense && Memory.remoteDefense[homeRoom];
  if (!def || !def.coreRooms || def.coreRooms.length === 0) return null;
  var best = null;
  var bestDist = Infinity;
  for (var i = 0; i < def.coreRooms.length; i++) {
    var roomName = def.coreRooms[i].roomName;
    var dist = Game.map.getRoomLinearDistance(creep.pos.roomName, roomName);
    if (dist < bestDist) {
      bestDist = dist;
      best = roomName;
    }
  }
  return best;
}

// Attack invader core in current room.
function attackCore(creep) {
  var cores = creep.room.find(FIND_HOSTILE_STRUCTURES, {
    filter: function (s) {
      return s.structureType === STRUCTURE_INVADER_CORE;
    }
  });
  if (cores.length === 0) return false;

  var core = cores[0];
  var range = creep.pos.getRangeTo(core);
  if (range <= 3) {
    creep.rangedAttack(core);
  } else {
    creep.moveTo(core, { reusePath: 5, maxRooms: 1 });
  }
  if (creep.hits < creep.hitsMax) creep.heal(creep);
  creep.memory.task = 'attackCore:' + core.id;
  return true;
}

// Engage hostiles in the current room: kite melee, ranged-attack, self-heal.
function fight(creep) {
  const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);
  const target = selectTarget(creep);

  if (target) {
    const range = creep.pos.getRangeTo(target);
    const targetHasMelee = hasBodyPart(target, ATTACK);

    if (targetHasMelee && range <= 2) {
      const dirToTarget = creep.pos.getDirectionTo(target);
      if (dirToTarget) {
        const fleeDir = ((dirToTarget + 3) % 8) + 1;
        if (!fleeStep(creep, fleeDir)) {
          if (!fleeStep(creep, (fleeDir % 8) + 1)) {
            fleeStep(creep, ((fleeDir + 6) % 8) + 1);
          }
        }
      }
    } else if (range > 3) {
      creep.moveTo(target, {
        reusePath: 5,
        maxRooms: 1,
        visualizePathStyle: { stroke: '#ff0000' }
      });
    }

    if (range <= 3) {
      creep.rangedAttack(target);
      creep.memory.task = 'attack:' + target.id;
    }
    if (hostiles.length >= 2 && getClosestHostileRange(creep, hostiles) <= 1) {
      creep.rangedMassAttack();
    }
  } else {
    creep.memory.task = 'cleared:' + creep.pos.roomName;
  }

  if (creep.hits < creep.hitsMax) {
    creep.heal(creep);
  }
}

// Patrol active remotes in rotation, holding each a while.
function patrol(creep, homeRoom) {
  const rooms = listPatrolRooms(homeRoom);
  if (rooms.length === 0) {
    if (creep.pos.roomName !== homeRoom) goTo(creep, homeRoom);
    creep.memory.task = 'patrol:idle';
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    return;
  }

  let idx = creep.memory.patrolIdx;
  if (typeof idx !== 'number' || idx >= rooms.length) idx = 0;
  const target = rooms[idx];

  if (!inRoomOffEdge(creep, target)) {
    if (goTo(creep, target)) {
      creep.memory.task = 'patrol:to:' + target;
      if (creep.hits < creep.hitsMax) creep.heal(creep);
      return;
    }
  }

  // Arrived (off-edge). Hold a while, then rotate to the next remote.
  creep.memory.patrolWait = (creep.memory.patrolWait || 0) + 1;
  if (creep.memory.patrolWait >= 15) {
    creep.memory.patrolWait = 0;
    creep.memory.patrolIdx = (idx + 1) % rooms.length;
    delete creep.memory._navTo;
    delete creep.memory._t;
  }
  creep.memory.task = 'patrol:hold:' + target;
  if (creep.hits < creep.hitsMax) creep.heal(creep);
}

function run(creep) {
  const homeRoom = creep.memory.homeRoom;

  // Near death → return home so a replacement can take over.
  if (creep.ticksToLive < 250) {
    creep.memory.task = 'returning:home';
    if (creep.pos.roomName !== homeRoom) goTo(creep, homeRoom);
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    return;
  }

  // 1. Invaders in the current room right now → engage immediately.
  if (creep.pos.roomName !== homeRoom) {
    var localInvaders = creep.room
      .find(FIND_HOSTILE_CREEPS)
      .filter(isInvader);
    if (localInvaders.length > 0) {
      fight(creep);
      return;
    }

    // 1b. Invader core in current room → attack it.
    if (attackCore(creep)) return;
  }

  // 2. Respond to the nearest flagged invader threat: travel in and hold
  //    (off-edge) to keep vision so the threat flag can clear.
  var threatRoom = findThreatRoom(creep, homeRoom);
  if (threatRoom) {
    creep.memory.targetRoom = threatRoom;
    if (!inRoomOffEdge(creep, threatRoom)) {
      if (goTo(creep, threatRoom)) {
        creep.memory.task = 'responding:' + threatRoom;
        if (creep.hits < creep.hitsMax) creep.heal(creep);
        return;
      }
    }
    creep.memory.task = 'holding:' + threatRoom;
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    return;
  }

  // 2b. Core room detected → travel there to destroy it.
  var coreRoom = findCoreRoom(creep, homeRoom);
  if (coreRoom) {
    creep.memory.targetRoom = coreRoom;
    if (!inRoomOffEdge(creep, coreRoom)) {
      goTo(creep, coreRoom);
      creep.memory.task = 'toCoreRoom:' + coreRoom;
      if (creep.hits < creep.hitsMax) creep.heal(creep);
      return;
    }
    // Arrived — attackCore() above will handle it next tick
    creep.memory.task = 'atCoreRoom:' + coreRoom;
    if (creep.hits < creep.hitsMax) creep.heal(creep);
    return;
  }

  // 3. No threat anywhere → patrol active remotes in rotation.
  patrol(creep, homeRoom);
}

module.exports = { run: run };
