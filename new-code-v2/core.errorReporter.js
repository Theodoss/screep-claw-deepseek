const MAX_ERRORS = 30;
const LOG_INTERVAL = 100;
const MAX_STACK_LINES = 5;

function ensureMemory() {
  if (!Memory.agentErrors || typeof Memory.agentErrors !== 'object') {
    Memory.agentErrors = {
      byKey: {},
      recent: []
    };
  }

  if (!Memory.agentErrors.byKey || typeof Memory.agentErrors.byKey !== 'object') {
    Memory.agentErrors.byKey = {};
  }

  if (!Array.isArray(Memory.agentErrors.recent)) {
    Memory.agentErrors.recent = [];
  }

  return Memory.agentErrors;
}

function normalizeContext(context) {
  const input = context || {};
  const normalized = {};
  const fields = ['module', 'role', 'room', 'creep', 'process', 'state'];

  for (const field of fields) {
    if (input[field] !== undefined && input[field] !== null) {
      normalized[field] = input[field];
    }
  }

  return normalized;
}

function updateRecent(memory, fingerprint) {
  const existingIndex = memory.recent.indexOf(fingerprint);
  if (existingIndex !== -1) {
    memory.recent.splice(existingIndex, 1);
  }

  memory.recent.unshift(fingerprint);
  memory.recent = memory.recent.slice(0, MAX_ERRORS);
}

function trimOldErrors(memory) {
  const keys = Object.keys(memory.byKey);
  if (keys.length <= MAX_ERRORS) return;

  keys.sort((left, right) => {
    return memory.byKey[left].lastTick - memory.byKey[right].lastTick;
  });

  const removeCount = keys.length - MAX_ERRORS;
  for (let index = 0; index < removeCount; index++) {
    delete memory.byKey[keys[index]];
  }

  memory.recent = memory.recent.filter(key => memory.byKey[key]);
}

function capture(err, context) {
  const memory = ensureMemory();
  const normalizedContext = normalizeContext(context);
  const errorName = err && err.name ? String(err.name) : 'Error';
  const message = err && err.message ? String(err.message) : String(err);
  const stackLines = String(err && err.stack ? err.stack : '')
    .split('\n')
    .slice(0, MAX_STACK_LINES);
  const firstStackLine = (stackLines[1] || stackLines[0] || '').trim();
  const fingerprint = [
    normalizedContext.module || 'unknown',
    normalizedContext.role || '',
    normalizedContext.room || '',
    errorName,
    message,
    firstStackLine
  ].join('|');
  const now = Game.time;

  if (!memory.byKey[fingerprint]) {
    memory.byKey[fingerprint] = {
      count: 0,
      firstTick: now,
      lastTick: now,
      lastLogTick: 0,
      severity: 'error',
      module: normalizedContext.module || 'unknown',
      role: normalizedContext.role,
      room: normalizedContext.room,
      creep: normalizedContext.creep,
      process: normalizedContext.process,
      state: normalizedContext.state,
      message: message,
      stack: stackLines.join('\n'),
      sampleContext: normalizedContext
    };
  }

  const record = memory.byKey[fingerprint];
  record.count++;
  record.lastTick = now;
  record.role = normalizedContext.role;
  record.room = normalizedContext.room;
  record.creep = normalizedContext.creep;
  record.process = normalizedContext.process;
  record.state = normalizedContext.state;
  record.sampleContext = normalizedContext;

  updateRecent(memory, fingerprint);

  if (record.count === 1 || now - record.lastLogTick >= LOG_INTERVAL) {
    const logType = record.count === 1 ? 'first' : 'repeat';
    record.lastLogTick = now;
    console.log(
      `[ERROR:${logType}] ${record.module} ${record.message} count=${record.count}` +
      ` room=${record.room || ''} creep=${record.creep || ''}`
    );
  }

  trimOldErrors(memory);
}

module.exports = {
  capture: capture
};
