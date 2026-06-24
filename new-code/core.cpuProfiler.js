const WINDOW_TICKS = 50;
const TOP_LIMIT = 20;

let current = null;

function isEnabled() {
  return !(
    Memory.settings &&
    Memory.settings.cpuProfiler === false
  );
}

function createBucket() {
  return {
    cpu: 0,
    count: 0,
    max: 0
  };
}

function addToMap(map, key, amount) {
  if (!key) key = 'unknown';
  if (!map[key]) map[key] = createBucket();

  map[key].cpu += amount;
  map[key].count++;
  if (amount > map[key].max) map[key].max = amount;
}

function addAggregate(targetMap, sourceMap) {
  for (const key in sourceMap) {
    const source = sourceMap[key];
    if (!targetMap[key]) targetMap[key] = createBucket();

    targetMap[key].cpu += source.cpu;
    targetMap[key].count += source.count;
    if (source.max > targetMap[key].max) targetMap[key].max = source.max;
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function summarizeMap(map, ticks) {
  return Object.keys(map).map(function (name) {
    const item = map[name];
    return {
      name: name,
      cpu: round(item.cpu),
      avg: round(item.cpu / Math.max(1, item.count)),
      tickAvg: round(item.cpu / Math.max(1, ticks || 1)),
      count: item.count,
      max: round(item.max)
    };
  }).sort(function (left, right) {
    return right.cpu - left.cpu;
  }).slice(0, TOP_LIMIT);
}

function ensureMemory() {
  if (!Memory.agent) Memory.agent = {};
  if (!Memory.agent.cpuProfile) {
    Memory.agent.cpuProfile = {};
  }
  return Memory.agent.cpuProfile;
}

function makeWindow(startTick) {
  return {
    startTick: startTick,
    endTick: startTick,
    ticks: 0,
    sections: {},
    roles: {},
    roomRoles: {},
    rooms: {}
  };
}

function begin() {
  if (!isEnabled()) {
    current = null;
    return;
  }

  current = {
    tick: Game.time,
    start: Game.cpu.getUsed(),
    sections: {},
    roles: {},
    roomRoles: {},
    rooms: {},
    creeps: {}
  };
}

function recordSection(name, amount) {
  if (!current) return;
  addToMap(current.sections, name, amount);
}

function recordRoom(roomName, amount) {
  if (!current || !roomName) return;
  addToMap(current.rooms, roomName, amount);
}

function measure(name, fn) {
  if (!current) return fn();

  const start = Game.cpu.getUsed();
  try {
    return fn();
  } finally {
    recordSection(name, Game.cpu.getUsed() - start);
  }
}

function measureRoom(name, roomName, fn) {
  if (!current) return fn();

  const start = Game.cpu.getUsed();
  try {
    return fn();
  } finally {
    const used = Game.cpu.getUsed() - start;
    recordSection(name + ':' + roomName, used);
    recordRoom(roomName, used);
  }
}

function measureRole(role, roomName, creepName, fn) {
  if (!current) return fn();

  const start = Game.cpu.getUsed();
  try {
    return fn();
  } finally {
    const used = Game.cpu.getUsed() - start;
    const roleName = role || 'unknown';
    const roomRoleName = (roomName || 'unknown') + ':' + roleName;
    addToMap(current.roles, roleName, used);
    addToMap(current.roomRoles, roomRoleName, used);
    addToMap(current.creeps, creepName || 'unknown', used);
    recordRoom(roomName, used);
  }
}

function end() {
  if (!current) return;

  const profile = ensureMemory();
  const total = Game.cpu.getUsed() - current.start;
  let window = profile.window;

  if (
    !window ||
    typeof window.startTick !== 'number' ||
    window.ticks >= WINDOW_TICKS
  ) {
    if (window && window.ticks > 0) {
      profile.previousWindow = profile.windowTop;
    }
    window = makeWindow(Game.time);
    profile.window = window;
  }

  window.endTick = Game.time;
  window.ticks++;
  if (!window.roomRoles) window.roomRoles = {};
  addAggregate(window.sections, current.sections);
  addAggregate(window.roles, current.roles);
  addAggregate(window.roomRoles, current.roomRoles);
  addAggregate(window.rooms, current.rooms);

  profile.updatedAt = Game.time;
  profile.enabled = true;
  profile.lastTick = {
    tick: Game.time,
    total: round(total),
    bucket: Game.cpu.bucket,
    limit: Game.cpu.limit,
    tickLimit: Game.cpu.tickLimit,
    sections: summarizeMap(current.sections, 1),
    roles: summarizeMap(current.roles, 1),
    roomRoles: summarizeMap(current.roomRoles, 1),
    rooms: summarizeMap(current.rooms, 1),
    creeps: summarizeMap(current.creeps, 1)
  };
  profile.windowTop = {
    startTick: window.startTick,
    endTick: window.endTick,
    ticks: window.ticks,
    sections: summarizeMap(window.sections, window.ticks),
    roles: summarizeMap(window.roles, window.ticks),
    roomRoles: summarizeMap(window.roomRoles, window.ticks),
    rooms: summarizeMap(window.rooms, window.ticks)
  };

  current = null;
}

module.exports = {
  begin: begin,
  end: end,
  measure: measure,
  measureRoom: measureRoom,
  measureRole: measureRole
};
