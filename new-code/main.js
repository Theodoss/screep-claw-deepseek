/**
 * main.js — Screeps AI main loop
 *
 * W49N25 Remote Energy Gateway:
 *   Door Link → Upgrader Link / Storage Link (full-batch transfer)
 *   doorLinkBalancer: Container → Door Link
 *   storageLinkBalancer: Storage Link → Storage
 *   W48N25/W48N26 remoteHauler → Door Link / Door Containers only
 *
 * Tick order:
 *   1. Infrastructure & container site check
 *   2. Door Link transfer manager
 *   3. Economy + room managers + balancer spawning
 *   4. Creep roles (doorLinkBalancer, storageLinkBalancer, etc.)
 *   5. Stats / intel
 */

const rcl1Bootstrap = require('manager.rcl1Bootstrap');
const rcl2ContainerEconomy = require('manager.rcl2ContainerEconomy');
const roleRcl1Harvester = require('role.rcl1Harvester');
const roleUpgrader = require('role.upgrader');
const roleRcl1Upgrader = require('role.rcl1Upgrader');
const roleRcl1Builder = require('role.rcl1Builder');
const roleRcl2Miner = require('role.rcl2Miner');
const roleRcl2Hauler = require('role.rcl2Hauler');
const roleRemoteMiner = require('role.remoteMiner');
const roleRemoteHauler = require('role.remoteHauler');
const roleRemoteBuilder = require('role.remoteBuilder');
const roleReserver = require('role.reserver');
const roleRcl1Claimer = require('role.claimer');
const rolePioneer = require('role.pioneer');
const roleGuard = require('role.guard');
const roleRemoteGuard = require('role.remoteGuard');
const roleSquadMelee = require('role.squadMelee');
const roleSquadHealer = require('role.squadHealer');
const roleSquadRanged = require('role.squadRanged');
const roleDoorLinkBalancer = require('role.doorLinkBalancer');
const roleStorageLinkBalancer = require('role.storageLinkBalancer');
const military = require('manager.military');
const remote = require('manager.remote');
const remoteDefense = require('manager.remoteDefense');
const stats = require('manager.stats');
const intel = require('manager.intel');
const errorReporter = require('core.errorReporter');
const cpuProfiler = require('core.cpuProfiler');
const rcl1SourceSlots = require('manager.rcl1SourceSlots');
const towerManager = require('manager.tower');
const roomPlanner = require('planner.roomPlanner');
const construction = require('manager.construction');
const linkManager = require('manager.link');
const frontBasePlanner = require('planner.frontBase');
const linkConfig = require('config.W49N25Links');
const ROOM_PLANNER_ENABLED = false;
const ROOM_PLANNER_ACTIVATION_VERSION = 1;

const LEGACY_ROLES = {
  harvester: 'rcl1Harvester',
  builder: 'rcl1Builder'
};

const ROLE_MODULES = {
  rcl1Harvester: roleRcl1Harvester,
  upgrader: roleUpgrader,
  rcl1Upgrader: roleRcl1Upgrader,
  rcl1Builder: roleRcl1Builder,
  rcl2Miner: roleRcl2Miner,
  rcl2Hauler: roleRcl2Hauler,
  remoteMiner: roleRemoteMiner,
  remoteHauler: roleRemoteHauler,
  remoteBuilder: roleRemoteBuilder,
  reserver: roleReserver,
  claimer: roleRcl1Claimer,
  pioneer: rolePioneer,
  guard: roleGuard,
  remoteGuard: roleRemoteGuard,
  squadMelee: roleSquadMelee,
  squadHealer: roleSquadHealer,
  squadRanged: roleSquadRanged,
  doorLinkBalancer: roleDoorLinkBalancer,
  storageLinkBalancer: roleStorageLinkBalancer
};

function runBootstrapFallback(room) {
  try {
    cpuProfiler.measureRoom(
      'manager.rcl1Bootstrap',
      room.name,
      function () {
        rcl1Bootstrap.run(room);
      }
    );
  } catch (err) {
    errorReporter.capture(err, {
      module: 'manager.rcl1Bootstrap',
      room: room.name
    });
  }
}

function shouldAutoPlanFrontBase(room) {
  if (!room || !room.controller || !room.controller.my) return false;

  var spawns = room.find(FIND_MY_SPAWNS);
  if (spawns.length === 0) return false;

  var mission = Memory.expansionMission;
  if (
    mission &&
    mission.targetRoom === room.name &&
    mission.phase !== 'done'
  ) {
    return true;
  }

  return false;
}

function activateRoomPlanner(roomName) {
  if (!Memory.rooms) Memory.rooms = {};
  if (!Memory.rooms[roomName]) Memory.rooms[roomName] = {};

  const roomMemory = Memory.rooms[roomName];
  if (
    roomMemory.plannerActivationVersion ===
    ROOM_PLANNER_ACTIVATION_VERSION
  ) {
    return;
  }
  if (!roomMemory.planner) roomMemory.planner = {};

  roomMemory.planner.enabled = true;
  roomMemory.planner.forceReplan = true;
  roomMemory.plannerActivationVersion =
    ROOM_PLANNER_ACTIVATION_VERSION;
}

function getCreepHomeRoom(creep) {
  var homeRoomName = creep.memory.home || creep.memory.homeRoom;
  return homeRoomName && Game.rooms[homeRoomName]
    ? Game.rooms[homeRoomName]
    : creep.room;
}

function getCreepHomeRcl(creep) {
  var homeRoom = getCreepHomeRoom(creep);
  return homeRoom && homeRoom.controller
    ? homeRoom.controller.level
    : null;
}

function normalizeUpgraderRole(creep) {
  if (
    creep.memory.role !== 'upgrader' &&
    creep.memory.role !== 'rcl1Upgrader'
  ) {
    return;
  }

  var rcl = getCreepHomeRcl(creep);
  if (!rcl) return;

  var expectedRole = rcl <= 2 ? 'rcl1Upgrader' : 'upgrader';
  if (creep.memory.role !== expectedRole) {
    creep.memory.role = expectedRole;
  }
}

function getProfileRoleName(creep) {
  var role = creep.memory.role || 'unknown';
  var rcl = getCreepHomeRcl(creep);
  return rcl ? role + '@rcl' + rcl : role + '@unknownRcl';
}

// ── Door buffer container site check (46,6 & 48,6) ──
var doorContainerCheckCooldown = 0;

function ensureDoorContainers() {
  if (Game.time < doorContainerCheckCooldown) return;
  doorContainerCheckCooldown = Game.time + 20;

  var room = Game.rooms[linkConfig.roomName];
  if (!room || !room.controller || !room.controller.my) return;

  var positions = [
    { x: 46, y: 6 },
    { x: 48, y: 6 }
  ];

  for (var i = 0; i < positions.length; i++) {
    var x = positions[i].x;
    var y = positions[i].y;

    // Check if container or site already exists
    var structures = room.lookForAt(LOOK_STRUCTURES, x, y);
    var hasContainer = false;
    for (var j = 0; j < structures.length; j++) {
      if (structures[j].structureType === STRUCTURE_CONTAINER) {
        hasContainer = true;
        break;
      }
    }
    if (hasContainer) continue;

    var sites = room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y);
    var hasSite = false;
    for (var k = 0; k < sites.length; k++) {
      if (sites[k].structureType === STRUCTURE_CONTAINER) {
        hasSite = true;
        break;
      }
    }
    if (hasSite) continue;

    // Check terrain
    var terrain = Game.map.getRoomTerrain(room.name);
    if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

    // Check site limit
    var activeSites = room.find(FIND_MY_CONSTRUCTION_SITES);
    if (activeSites.length >= 5) continue;

    room.createConstructionSite(x, y, STRUCTURE_CONTAINER);
  }
}

// ── Balancer spawning ──
function trySpawnStorageLinkBalancer(room) {
  if (room.name !== linkConfig.roomName) return;
  if (linkConfig.storageBalancer.role !== 'storageLinkBalancer') return;

  var storageLink = Game.getObjectById(linkConfig.storageLinkId);
  if (!storageLink) return;

  // Check if already exists
  var existing = false;
  var spawning = false;
  for (var name in Game.creeps) {
    var c = Game.creeps[name];
    if (c.memory.role === 'storageLinkBalancer') {
      existing = true;
      break;
    }
  }
  if (existing) return;

  // Check if spawning
  var spawns = room.find(FIND_MY_SPAWNS);
  for (var si = 0; si < spawns.length; si++) {
    if (spawns[si].spawning) {
      var spawnInfo = spawns[si].spawning;
      if (spawnInfo.name &&
          spawnInfo.name.indexOf('storageLinkBalancer') === 0) {
        spawning = true;
        break;
      }
    }
  }
  if (spawning) return;

  // Check 17,28 is clear
  var occupied = room.lookForAt(LOOK_CREEPS, 17, 28);
  if (occupied.length > 0) return;

  // Find spawn at 16,28
  var spawn = null;
  for (var sj = 0; sj < spawns.length; sj++) {
    if (spawns[sj].pos.x === 16 && spawns[sj].pos.y === 28) {
      spawn = spawns[sj];
      break;
    }
  }
  if (!spawn || spawn.spawning) return;

  var body = linkConfig.storageBalancer.body;
  var cost = body.reduce(function (t, p) { return t + BODYPART_COST[p]; }, 0);
  if (room.energyAvailable < cost) return;

  var result = spawn.spawnCreep(body,
    'storageLinkBalancer_' + Game.time,
    {
      memory: {
        role: 'storageLinkBalancer',
        home: 'W49N25',
        fixedPos: { roomName: 'W49N25', x: 17, y: 28 },
        storageLinkId: linkConfig.storageLinkId
      },
      directions: [RIGHT]
    }
  );

  if (result === OK) {
    console.log('[spawn] storageLinkBalancer spawned');
  }
}

function trySpawnDoorLinkBalancer(room) {
  if (room.name !== linkConfig.roomName) return;

  var doorLink = Game.getObjectById(linkConfig.doorLinkId);
  if (!doorLink) return;

  // Check at least one door container exists or has site
  var hasLeft = false;
  var hasRight = false;
  var structures = room.lookForAt(LOOK_STRUCTURES, 46, 6);
  for (var i = 0; i < structures.length; i++) {
    if (structures[i].structureType === STRUCTURE_CONTAINER) {
      hasLeft = true; break;
    }
  }
  if (!hasLeft) {
    var lSites = room.lookForAt(LOOK_CONSTRUCTION_SITES, 46, 6);
    for (var j = 0; j < lSites.length; j++) {
      if (lSites[j].structureType === STRUCTURE_CONTAINER) {
        hasLeft = true; break;
      }
    }
  }
  structures = room.lookForAt(LOOK_STRUCTURES, 48, 6);
  for (var k = 0; k < structures.length; k++) {
    if (structures[k].structureType === STRUCTURE_CONTAINER) {
      hasRight = true; break;
    }
  }
  if (!hasRight) {
    var rSites = room.lookForAt(LOOK_CONSTRUCTION_SITES, 48, 6);
    for (var m = 0; m < rSites.length; m++) {
      if (rSites[m].structureType === STRUCTURE_CONTAINER) {
        hasRight = true; break;
      }
    }
  }
  if (!hasLeft && !hasRight) return;

  // Check if already exists
  var existing = false;
  var spawning = false;
  for (var name in Game.creeps) {
    var c = Game.creeps[name];
    if (c.memory.role === 'doorLinkBalancer') {
      existing = true;
      break;
    }
  }
  if (existing) return;

  // Check if spawning
  var spawns = room.find(FIND_MY_SPAWNS);
  for (var si = 0; si < spawns.length; si++) {
    if (spawns[si].spawning) {
      var spawnInfo = spawns[si].spawning;
      if (spawnInfo.name &&
          spawnInfo.name.indexOf('doorLinkBalancer') === 0) {
        spawning = true;
        break;
      }
    }
  }
  if (spawning) return;

  // Check 47,7 is clear
  var occupied = room.lookForAt(LOOK_CREEPS, 47, 7);
  if (occupied.length > 0) return;

  // Use first available spawn
  var spawn = spawns[0];
  if (!spawn || spawn.spawning) return;

  var body = linkConfig.doorBalancer.body;
  var cost = body.reduce(function (t, p) { return t + BODYPART_COST[p]; }, 0);
  if (room.energyAvailable < cost) return;

  var result = spawn.spawnCreep(body,
    'doorLinkBalancer_' + Game.time,
    {
      memory: {
        role: 'doorLinkBalancer',
        home: 'W49N25',
        fixedPos: { roomName: 'W49N25', x: 47, y: 7 },
        doorLinkId: linkConfig.doorLinkId
      }
    }
  );

  if (result === OK) {
    console.log('[spawn] doorLinkBalancer spawned');
  }
}

module.exports.loop = function () {
  cpuProfiler.begin();

  try {
    cpuProfiler.measure('manager.military.update', function () {
      military.update(false);
    });
  } catch (err) {
    errorReporter.capture(err, {
      module: 'manager.military.update'
    });
  }

  // 1. Memory cleanup
  cpuProfiler.measure('memory.cleanup', function () {
    for (const name in Memory.creeps) {
      if (!Game.creeps[name]) {
        rcl1SourceSlots.releaseCreep(name);
        delete Memory.creeps[name];
      }
    }
  });

  // Legacy role migration
  cpuProfiler.measure('memory.legacyRoles', function () {
    for (const name in Game.creeps) {
      const creep = Game.creeps[name];
      if (LEGACY_ROLES[creep.memory.role]) {
        creep.memory.role = LEGACY_ROLES[creep.memory.role];
      }
      normalizeUpgraderRole(creep);
    }
  });

  // 2. Infrastructure: Door container site check
  try {
    cpuProfiler.measure('manager.gateway.containers', function () {
      ensureDoorContainers();
    });
  } catch (err) {
    errorReporter.capture(err, { module: 'manager.gateway.containers' });
  }

  // 3. Door Link transfer manager (runs BEFORE creep roles so
  //    doorLinkBalancer can fill the newly-emptied space)
  try {
    cpuProfiler.measureRoom('manager.link', 'W49N25', function () {
      var w49n25 = Game.rooms['W49N25'];
      if (w49n25) linkManager.run(w49n25);
    });
  } catch (err) {
    errorReporter.capture(err, { module: 'manager.link' });
  }

  // 4. Defense scan + remote spawning (tier-based)
  try {
    cpuProfiler.measure('manager.remoteDefense.run', function () {
      remoteDefense.run();
    });

    // Tier 3 gating: pause remote spawning during Defense Mode
    if (!remoteDefense.shouldPauseTier3()) {
      cpuProfiler.measure('manager.remote.run', function () {
        remote.run();
      });
    }

    // Tier 2: Defense guard spawning (highest non-critical priority)
    cpuProfiler.measure('manager.remoteDefense.spawn', function () {
      const defenseRequests = remoteDefense.getDefenseRequests(
        'W49N25',
        Object.values(Game.creeps).filter(function (c) {
          return c.memory.role === 'guard' &&
            c.memory.defenseGroup === 'W49N25';
        }).length
      );
      if (defenseRequests.length > 0) {
        const homeRoom = Game.rooms['W49N25'];
        if (homeRoom) {
          const spawn = homeRoom.find(FIND_MY_SPAWNS)[0];
          if (spawn && !spawn.spawning) {
            const req = defenseRequests[0];
            if (homeRoom.energyAvailable >= req.bodyCost) {
              const result = spawn.spawnCreep(req.body, req.name, {
                memory: req.memory
              });
              if (result === OK) {
                console.log('[defense] spawned ' + req.name);
              }
            }
          }
        }
      }
    });
  } catch (err) {
    errorReporter.capture(err, { module: 'manager.remote' });
  }

  // 5. Room economy + balancer spawning
  for (const roomName in Game.rooms) {
    const room = Game.rooms[roomName];
    let economyState;

    if (Game.time % 20 === 0) {
      cpuProfiler.measureRoom(
        'manager.rcl1SourceSlots.cleanup',
        roomName,
        function () {
          rcl1SourceSlots.cleanup(room);
        }
      );
    }

    try {
      cpuProfiler.measureRoom('manager.tower', roomName, function () {
        towerManager.run(room);
      });
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.tower',
        room: roomName
      });
    }

    if (ROOM_PLANNER_ENABLED) {
      try {
        cpuProfiler.measureRoom(
          'planner.roomPlanner',
          roomName,
          function () {
            activateRoomPlanner(roomName);
            roomPlanner.run(room);
          }
        );
      } catch (err) {
        errorReporter.capture(err, {
          module: 'planner.roomPlanner',
          room: roomName
        });
      }
    }

    try {
      cpuProfiler.measureRoom(
        'manager.construction',
        roomName,
        function () {
          var plan = Memory.rooms && Memory.rooms[roomName] && Memory.rooms[roomName].plan;
          if (!plan && shouldAutoPlanFrontBase(room)) {
            plan = frontBasePlanner.init(roomName);
          }
          if (plan && plan.type === 'frontBase') {
            construction.run(roomName);
          }
        }
      );
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.construction',
        room: roomName
      });
    }

    try {
      economyState = cpuProfiler.measureRoom(
        'manager.rcl2ContainerEconomy.collect',
        roomName,
        function () {
          return rcl2ContainerEconomy.collect(room);
        }
      );
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.rcl2ContainerEconomy.collect',
        room: roomName
      });
      runBootstrapFallback(room);
      continue;
    }

    if (!economyState.ready) {
      runBootstrapFallback(room);
      continue;
    }

    try {
      cpuProfiler.measureRoom(
        'manager.rcl2ContainerEconomy.run',
        roomName,
        function () {
          rcl2ContainerEconomy.run(room, economyState);
        }
      );
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.rcl2ContainerEconomy.run',
        room: roomName
      });
      runBootstrapFallback(room);
    }

    // Balancer spawning (after economy, low priority)
    try {
      cpuProfiler.measureRoom(
        'manager.gateway.spawnBalancers',
        roomName,
        function () {
          trySpawnStorageLinkBalancer(room);
          trySpawnDoorLinkBalancer(room);
        }
      );
    } catch (err) {
      errorReporter.capture(err, { module: 'manager.gateway.spawnBalancers' });
    }

    try {
      cpuProfiler.measureRoom(
        'manager.military.trySpawn',
        roomName,
        function () {
          military.trySpawn(room);
        }
      );
    } catch (err) {
      errorReporter.capture(err, {
        module: 'manager.military.trySpawn',
        room: roomName
      });
    }
  }

  // 6. Execute creep roles
  for (const name in Game.creeps) {
    const creep = Game.creeps[name];

    try {
      const roleModule = ROLE_MODULES[creep.memory.role];
      if (roleModule) {
        cpuProfiler.measureRole(
          getProfileRoleName(creep),
          creep.room.name,
          creep.name,
          function () {
            roleModule.run(creep);
          }
        );
      } else {
        console.log('[warn] unknown role:', creep.name, creep.memory.role);
      }
    } catch (err) {
      errorReporter.capture(err, {
        module: `role.${creep.memory.role || 'unknown'}`,
        role: creep.memory.role,
        room: creep.room.name,
        creep: creep.name,
        state: creep.memory.state !== undefined
          ? creep.memory.state
          : creep.memory.working
      });
    }
  }

  // 7. Stats
  if (Game.time % 20 === 0) {
    cpuProfiler.measure('manager.stats.collect', function () {
      stats.collect();
    });
  }

  // 8. Intel
  if (Game.time % 100 === 0) {
    try {
      cpuProfiler.measure('manager.intel.collectVisibleRooms', function () {
        intel.collectVisibleRooms();
      });
    } catch (err) {
      errorReporter.capture(err, { module: 'manager.intel' });
    }
  }

  cpuProfiler.end();
};
