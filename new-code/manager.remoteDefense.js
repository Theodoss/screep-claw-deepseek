// Remote room automated defense for NPC Invaders.
// RCL5+ with multiple remotes: detect → retreat → dispatch guard → clear → restore.

const HOME_ROOM = 'W49N25';
const CLEAR_TICKS = 50;           // consecutive ticks without hostiles before clearing threat
const MAX_GUARDS_GLOBAL = 2;      // never more than 2 remoteGuards across all remotes
const MAX_GUARDS_PER_ROOM = 1;    // never more than 1 guard per remote room
const DETECT_INTERVAL = 5;        // check remote rooms every 5 ticks

function getHomeConfig() {
  if (!Memory.remote || !Memory.remote[HOME_ROOM]) return null;
  return Memory.remote[HOME_ROOM];
}

function scanRemoteRoom(roomName, remoteConfig) {
  const room = Game.rooms[roomName];
  if (!room) return;

  const hostiles = room.find(FIND_HOSTILE_CREEPS);
  if (hostiles.length === 0) {
    // No hostiles — count clear ticks for threat expiry
    if (remoteConfig.threat) {
      remoteConfig.threat.clearTicks = (remoteConfig.threat.clearTicks || 0) + 1;
      if (remoteConfig.threat.clearTicks >= CLEAR_TICKS) {
        delete remoteConfig.threat;
        console.log('[defense] threat cleared in ' + roomName);
      }
    }
    return;
  }

  // Fresh hostiles — reset clear counter and classify
  const invaders = [];
  const players = [];

  for (let i = 0; i < hostiles.length; i++) {
    const c = hostiles[i];
    if (c.owner && c.owner.username === 'Invader') {
      invaders.push(c);
    } else {
      players.push(c);
    }
  }

  if (invaders.length > 0) {
    remoteConfig.threat = {
      type: 'invader',
      since: remoteConfig.threat ? (remoteConfig.threat.since || Game.time) : Game.time,
      lastSeen: Game.time,
      hostileCount: invaders.length,
      username: null,
      clearTicks: 0
    };
  } else if (players.length > 0) {
    const prevType = remoteConfig.threat ? remoteConfig.threat.type : null;
    remoteConfig.threat = {
      type: 'player',
      since: remoteConfig.threat ? (remoteConfig.threat.since || Game.time) : Game.time,
      lastSeen: Game.time,
      hostileCount: players.length,
      username: players[0].owner.username,
      clearTicks: 0
    };
    if (prevType !== 'player') {
      console.log('[defense] player threat in ' + roomName + ': ' + players[0].owner.username);
    }
  }
}

function hasThreat(remoteConfig) {
  return !!(remoteConfig && remoteConfig.threat && remoteConfig.threat.type);
}

function isInvaderThreat(remoteConfig) {
  return !!(remoteConfig && remoteConfig.threat && remoteConfig.threat.type === 'invader');
}

function countGuards() {
  let count = 0;
  for (const name in Game.creeps) {
    if (Game.creeps[name].memory.role === 'remoteGuard') {
      count++;
    }
  }
  return count;
}

function countGuardsForRoom(roomName) {
  let count = 0;
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];
    if (
      creep.memory.role === 'remoteGuard' &&
      creep.memory.targetRoom === roomName
    ) {
      count++;
    }
  }
  return count;
}

function getBodyCost(body) {
  let total = 0;
  for (let i = 0; i < body.length; i++) {
    total += BODYPART_COST[body[i]] || 0;
  }
  return total;
}

function buildRemoteGuardBody(energyCapacity) {
  // 1300 energy: 5 RANGED + 1 HEAL + 6 MOVE
  if (energyCapacity >= 1300) {
    return [
      RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
      HEAL,
      MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ];
  }
  // 800 energy fallback: 3 RANGED + 1 HEAL + 4 MOVE
  if (energyCapacity >= 800) {
    return [
      RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
      HEAL,
      MOVE, MOVE, MOVE, MOVE
    ];
  }
  return null;
}

function getSpawnRequest(homeRoomName, remoteRoomName) {
  const homeConfig = getHomeConfig();
  if (!homeConfig || !homeConfig.rooms) return null;

  const remoteConfig = homeConfig.rooms[remoteRoomName];
  if (!isInvaderThreat(remoteConfig)) return null;
  if (countGuards() >= MAX_GUARDS_GLOBAL) return null;
  if (countGuardsForRoom(remoteRoomName) >= MAX_GUARDS_PER_ROOM) return null;

  const room = Game.rooms[homeRoomName];
  if (!room) return null;

  const body = buildRemoteGuardBody(room.energyCapacityAvailable);
  if (!body) return null;

  return {
    role: 'remoteGuard',
    name: 'remoteGuard_' + remoteRoomName + '_' + Game.time,
    body: body,
    bodyCost: getBodyCost(body),
    memory: {
      role: 'remoteGuard',
      home: homeRoomName,
      homeRoom: homeRoomName,
      targetRoom: remoteRoomName,
      mission: 'clearRemoteInvader'
    }
  };
}

function getAllSpawnRequests(homeRoomName) {
  const requests = [];
  const homeConfig = getHomeConfig();
  if (!homeConfig || !homeConfig.rooms) return requests;

  for (const roomName in homeConfig.rooms) {
    const req = getSpawnRequest(homeRoomName, roomName);
    if (req) requests.push(req);
  }

  return requests;
}

function run() {
  if (Game.time % DETECT_INTERVAL !== 0) return;

  const homeConfig = getHomeConfig();
  if (!homeConfig || !homeConfig.rooms) return;

  for (const roomName in homeConfig.rooms) {
    const remoteConfig = homeConfig.rooms[roomName];
    scanRemoteRoom(roomName, remoteConfig);
  }
}

module.exports = {
  CLEAR_TICKS: CLEAR_TICKS,
  DETECT_INTERVAL: DETECT_INTERVAL,
  getAllSpawnRequests: getAllSpawnRequests,
  getSpawnRequest: getSpawnRequest,
  hasThreat: hasThreat,
  isInvaderThreat: isInvaderThreat,
  run: run
};
