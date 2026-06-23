# 給 deepseek 的實作指令：W47N22 強行建 spawn（RCL6）

> 前置：先讀 `new-code` 高階架構與 `DECISIONS.md` D007 / D008。所有改動只動 `new-code`，完成後把改動補寫進 `DECISIONS.md`。
> 環境事實：home = `W49N25`（**RCL6，energyCapacityAvailable ≈ 2300**）；目標 = `W47N22`；途中 `W48N22` 是大片沼澤；spawn 工地由玩家手動放置。

---

## 任務 0 — 修 travel.js 沼澤邊界橫跳（前置，必做）

檔案：`new-code/travel.js`，函式 `run()`。

根因：現在用「每 tick `findClosestByPath(exitDir)` 走出口 tile」，creep 在沼澤變慢後賴在邊界 tile（x/y=0|49），被推回上一房 → routeIdx 失配 → `findExit(非相鄰房)` 回 `ERR_NO_PATH` → 重建路線又送回 → 無限橫跳。

改法：
1. **出口移動策略**：把「`findClosestByPath(exitDir)` + moveTo(exit)」整段改成直接
   ```js
   creep.moveTo(new RoomPosition(25, 25, nextRoom), {
     reusePath: 50,
     swampCost: 5,
     visualizePathStyle: { stroke: '#ffaa00', lineStyle: 'dotted' }
   });
   return true;
   ```
   `nextRoom` 永遠是 route 中的**相鄰房**，只跨單一邊界、由 moveTo 原生處理沼澤，仍維持「不跨多房 pathfind」原則。
2. **邊界防呆**：在 `run()` 開頭（確認還在旅途、未到 targetRoom 後），若 `pos.x===0||pos.x===49||pos.y===0||pos.y===49`，先朝 `new RoomPosition(25,25, creep.pos.roomName)` 走一步並 `return true`，把 creep 推離邊界再做後續。
3. **反橫跳**：在 `_t` 記 `_t.lastRoom`；若本 tick 房名與 `_t.lastRoom` 不同且與「上上 tick」相同（A→B→A），鎖定朝 `nextRoom` 中心移動 3 tick（記 `_t.lockUntil = Game.time+3`），期間不重建 route。

保留 nav-* 旗幟邏輯與 `buildRoute`（玩家的旗幟順序是對的，不要動）。

---

## 任務 1 — 擴張任務狀態機

新增（或併入 `manager.remote.js`）任務狀態，讀寫 `Memory.expansionMission`：

```js
// 範例結構（玩家用 Console 啟動）
Memory.expansionMission = {
  active: true,
  home: 'W49N25',
  targetRoom: 'W47N22',
  signText: 'Theodos colony',
  builderCount: 3,
  phase: 'claim'      // 'claim' -> 'build' -> 'done'
};
```

每 tick（在 `remote.run()` 內）推進 phase：
- `claim → build`：`Game.rooms[target] && Game.rooms[target].controller && Game.rooms[target].controller.my`
- `build → done`：`Game.rooms[target] && Game.rooms[target].find(FIND_MY_SPAWNS).length > 0`
- 進入 `done`：設 `Memory.expansionMission.active = false`（停止補產、自動恢復母房 upgrade）。

---

## 任務 2 — 任務 body 與 spawn 佇列（RCL6）

檔案：`new-code/manager.remote.js`，函式 `getSpawnRequests()` 的擴張區塊（目前 `for (const expRoomName in EXPANSION_TARGETS)`）。

只在 `Memory.expansionMission && Memory.expansionMission.active && Memory.expansionMission.phase !== 'done'` 時產出任務 creep，且 target 取自 `Memory.expansionMission.targetRoom`。

**Body（RCL6 專用，固定值）：**
- claimer：`[CLAIM, CLAIM, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE]`
  （= 2×CLAIM + 10×MOVE = **1700 能量**；沼澤滿速；claim 只需 1 CLAIM，第 2 個留作 reserve 後援）
- builder（role 仍叫 `pioneer`）：`[WORK,WORK,WORK,WORK,WORK, CARRY,CARRY,CARRY,CARRY, MOVE,MOVE,MOVE,MOVE,MOVE]`
  （= 5×WORK + 4×CARRY + 5×MOVE = **950 能量**；空車過沼澤只有 WORK 付稅，慢但單程一次；進房後建造 25/tick）

**佇列順序（每 tick 只出一隻，擴張優先於母房經濟，維持 main loop 既有順序）：**
1. 若 `!controller.my` 且 `countClaimers(target) === 0` → 排 claimer。
2. 否則若 `countCreepsInRole('pioneer', target) < Memory.expansionMission.builderCount` → 排一隻 builder。
3. 任一 creep 死亡自動由上述條件補產，直到 phase = done。

creep memory 一律帶：`{ role, home, targetRoom: target, remoteRoom: target, signText }`，**不要帶任何 rally/wait 旗標**（出生即由 travel.js 前進、不等組隊）。

---

## 任務 3 — claim 前的 GCL 守門

在排 claimer 前加：
```js
const ownedRooms = Object.keys(Game.rooms).filter(
  r => Game.rooms[r].controller && Game.rooms[r].controller.my
).length;
if (Game.gcl.level < ownedRooms + 1) {
  console.log('[expansion] GCL 不足，無法 claim ' + target + '，略過 claimer');
  // 不要 spawn claimer（避免白生 CLAIM creep 去 reserve）
}
```
GCL 足夠才排 claimer。

---

## 任務 4 — 停止母房 upgrade（spawn 蓋好前）

檔案：`new-code/manager.rcl2ContainerEconomy.js`。
當 `Memory.expansionMission && Memory.expansionMission.active && Memory.expansionMission.phase !== 'done' && room.name === Memory.expansionMission.home` 時：
- 強制 `requestedUpgradeWork = 0`（讓新 upgrader 不再 spawn）。
- **例外**：若 `economyState.controllerEmergency`（controller 快 downgrade）則保底給最低 upgrade work，避免掉級。

檔案：`new-code/role.upgrader.js` 與 `new-code/role.rcl1Upgrader.js`，在 `run()` 開頭加早退 guard：
```js
const m = Memory.expansionMission;
if (m && m.active && m.phase !== 'done' && m.home === creep.room.name && !(/* controllerEmergency 判定 */)) {
  // 不呼叫 upgradeController；改去把能量搬回 spawn/extension 或閒置在 controller 旁
  return;
}
```

---

## 任務 5 — 清理（順手）

- 刪除 `new-code/nav.flag.js`（死碼，無人 require，且與 travel.js 語義衝突）。
- `git rm --cached new-code/manager.remote.js.bak`（不該進版控）。

---

## 玩家手動步驟（deepseek 部署後）

```js
// 1. Console 啟動任務
Memory.expansionMission = { active:true, home:'W49N25', targetRoom:'W47N22', signText:'Theodos colony', builderCount:3, phase:'claim' };

// 2. 確認 GCL（必須 >= 已擁有房數+1，否則 claim 不了）
Game.gcl.level;

// 3. claimer claim 成功後，在 W47N22 手動放 spawn 建造工地（建議近 source 與 controller 之間）
```

完成後請把以上改動補進 `DECISIONS.md`（可引用 D007 / D008）。
