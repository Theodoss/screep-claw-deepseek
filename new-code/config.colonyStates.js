// Colony state management — per-home-room mode control.
//
// Each home colony room has one of these states:
//   'normal'   — default: full economy, regular upgrade
//   'save'     — energy saving: 1-WORK upgrader, funnel energy to storage
//   'war'      — wartime: prioritize defense spawns, towers full
//   'colonize' — expansion mode: suspend upgrade, funnel energy to expansion
//
// State is persisted in Memory.colonyStates[roomName].
// Console commands:
//   require('config.colonyStates').set('W49N25','save');
//   require('config.colonyStates').get('W49N25');
//   require('config.colonyStates').list();
//
// Integration:
//   - manager.rcl2ContainerEconomy.js reads state for upgrade target
//   - role.upgrader.js reads state for energy redirection (save/colonize)

var VALID_STATES = ['normal', 'save', 'war', 'colonize'];

function ensureMemory() {
  if (!Memory.colonyStates) Memory.colonyStates = {};
}

// ── Setters / Getters ──

function setState(roomName, state) {
  if (VALID_STATES.indexOf(state) === -1) {
    console.log('[colonyState] invalid state: ' + state + ' (valid: ' + VALID_STATES.join(',') + ')');
    return ERR_INVALID_ARGS;
  }
  ensureMemory();
  var previous = Memory.colonyStates[roomName];
  Memory.colonyStates[roomName] = {
    state: state,
    setAt: Game.time,
    previous: previous ? previous.state : null
  };
  console.log('[colonyState] ' + roomName + ': ' + (previous || 'none') + ' → ' + state);
  return OK;
}

function getState(roomName) {
  ensureMemory();
  var entry = Memory.colonyStates[roomName];
  return entry ? entry.state : 'normal';
}

function list() {
  ensureMemory();
  var result = {};
  for (var roomName in Memory.colonyStates) {
    result[roomName] = Memory.colonyStates[roomName].state;
  }
  // Include visible rooms without explicit state
  for (var rn in Game.rooms) {
    if (!result[rn]) result[rn] = 'normal';
  }
  return result;
}

// ── Behavior helpers — callers use these to decide what to do ──

// Should the upgrader in this room be suspended?
function isUpgradeSuspended(roomName) {
  var state = getState(roomName);
  return state === 'save' || state === 'colonize';
}

// Target upgrader WORK count for this room's state.
// 'save' → 1, 'colonize' → 1 (minimal, prevent downgrade).
// Others → return null (let normal logic decide)
function getUpgraderWorkCap(roomName) {
  var state = getState(roomName);
  if (state === 'save') return 1;
  if (state === 'colonize') return 1;
  return null;
}

// Should war mode defense overrides be active?
function isWarMode(roomName) {
  return getState(roomName) === 'war';
}

module.exports = {
  set: setState,
  get: getState,
  list: list,
  getState: getState,
  setState: setState,
  isUpgradeSuspended: isUpgradeSuspended,
  getUpgraderWorkCap: getUpgraderWorkCap,
  isWarMode: isWarMode,
  VALID_STATES: VALID_STATES
};
