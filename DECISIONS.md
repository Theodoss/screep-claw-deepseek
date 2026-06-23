# Screeps 永久決策記錄

> 每個高階決定記錄在此。時間、原因、結果、對應的 SKILL.md 規則。
> 這是巡迴之間唯一不會被 code pull 覆蓋的長期記憶。

---

## D001 — 禁止自動放置建築工地

- **時間**: 2026-06-12 ~ 2026-06-13
- **原因**: RCL 過渡期 `energyCapacityAvailable` 跳升但實際建築未完成，導致 body builder 用膨脹的成本計算 creep 身體，spawn 永遠付不起，殖民地連續崩潰兩次。
- **過程**:
  1. 06:32 加入 `placeControllerContainerSite`（自動放 controller container 工地）
  2. 15:00 自動巡迴加入 `placeExtensionSites`（自動放 extension 工地）
  3. 18:00 RCL3 升級後 capacity 從 550→800，body 成本膨脹，spawn 無法產兵 → 全滅
  4. 20:39 手動移除所有自動工地函數
  5. 00:00 自動巡迴看到函數消失，當作 bug 加回去
  6. 02:30 殖民地再次崩潰，再次手動移除
- **決策**: 永久禁止任何 `createConstructionSite` 自動化。工地只能玩家手動放。
- **對應 SKILL.md 規則**: `🛑 禁止自動放置任何建築工地`
- **教訓**: 巡迴之間沒有共享記憶，需要此 DECISIONS.md 作為跨巡迴的永久記錄。

---

## D002 — 移除 effectiveCapacity 自適應身體

- **時間**: 2026-06-12
- **原因**: `effectiveCapacity` 試圖在能量低谷自動縮小 creep body（`min(capacityMax, max(300, energyAvailable+100))`），但能量極低時 floor=300 仍然過高。spawn 只有 51 能量，`effectiveCapacity` 算出來是 401，小型 body 仍然 spawn 不出來。而且 RCL3 後未建成的 extension 讓 `energyCapacityAvailable` 虛高，問題疊加。
- **決策**: 直接使用 `room.energyCapacityAvailable`，不做自適應調整。生不出來就 fallthrough 到更便宜的 priority。
- **對應 SKILL.md 規則**: 分析與改善規則中的「檢查每個 creep 是否在正常工作」
- **教訓**: 自適應邏輯往往比固定常數更難 debug，特別是有 hidden state（未建成的 extension）的情況。

---

## D003 — Miner 不需要 CARRY 部件

- **時間**: 2026-06-12
- **原因**: Miner 站在 container 上採礦。無 CARRY 時 `harvest()` 的能量直接掉在地上，同格的 container 自動撿起。完全不需要經過 creep store → 不需要 CARRY。
- **結果**: RCL2 miner body 從 `[W×4,C,M]` (500) 優化為 `[W×5,M]` (550)，採礦效率 +25%。
- **對應 SKILL.md 規則**: 經濟優化規則
- **教訓**: Screeps game mechanics 細節影響很大，永遠先查 API 再設計 body。

---

## D004 — Spawn priority fallthrough

- **時間**: 2026-06-12
- **原因**: 當 spawn 能量不足時，高優先度的 spawn（miner 550 cost）失敗後直接 return，block 了低優先度的 spawn（hauler 450 → harvester 200）。導致恢復路徑被鎖死。
- **決策**: miner 和 hauler spawn 失敗時 fall through 到下一優先級，而非 block。
- **對應 SKILL.md 規則**: 存活優先（不可停擺）
- **教訓**: survival 優先級邏輯中，fallthrough 比 early return 更安全。

---

## D005 — 1000-tick 能量收入基準線

- **時間**: 2026-06-13
- **原因**: 每次巡迴只看瞬間狀態，無法偵測漸進式劣化。需要一個跨時間窗口的能量收入指標作為基準線。
- **實作**: `manager.stats.js` 每 20 ticks 記錄總房間能量（spawn+ext+container+creep store），存在 `Memory.agent.energySnapshots[]`，保留 1200 ticks。巡迴時取最早和最晚 snapshot 計算每 1000 ticks 能量產出，與上輪比較。
- **對應 SKILL.md 規則**: 巡迴流程第 2 步「檢查 1000-tick 能量收入」、劣化規則（降低 20% → 回滾檢討）
- **教訓**: 時間序列指標比瞬間快照更能捕捉系統性衰退。

---

## D006 — Branch 隔離：sim 只讀不寫

- **時間**: 2026-06-13
- **原因**: 自動巡迴曾同時覆蓋 sim 和 claw-deepseek，破壞 branch 隔離。Theodos 手動維護 sim 作為穩定版，claw-deepseek 作為開發版。
- **決策**:
  1. 任何部署**只能推到 claw-deepseek**，絕不可動 sim。
  2. `.env` 的 `SCREEPS_BRANCH` 永遠保持 `claw-deepseek`。
  3. 巡迴開頭先 `list-branches` 檢查 activeWorld：
     - 若 activeWorld 是 sim → pull sim 到 sim-code/ 當參考，但部署仍只推 claw-deepseek
     - 若 activeWorld 是 claw-deepseek → 正常優化+部署
- **對應 SKILL.md 規則**: 部署規則
- **教訓**: 永遠先確認 active branch 再決定行為。改 `.env` 前要先問。

---

## D007 — W47N22 claim 卡邊界橫跳：travel.js 審查與修正指示

- **時間**: 2026-06-21
- **背景**: claimer 前往 W47N22，卡在 W48N22 / W48N21 邊界來回橫跳。master 已存在 `travel.js`（逐房 `Game.map.findRoute`，每 tick 用 `findClosestByPath` 走本房出口 tile）+ `role.claimer.js` / `role.pioneer.js`，且 `manager.remote.js` 的 `EXPANSION_TARGETS.W47N22` 已自動 spawn claimer（`targetRoom/remoteRoom=W47N22, signText='Theodos colony'`）。

- **修正先前誤判**: 玩家確認 `nav-0=W48N21 → nav-2=W48N22` 的**順序是正確的繞路最短路徑**，不是倒退點。先前「旗幟倒退」的判斷作廢。關鍵線索：**無沼澤的房間都能正確走過，只有沼澤房 W48N22 會橫跳。**

- **根因（沼澤觸發 travel.js 邊界失敗模式）**: travel.js 用「每 tick `findClosestByPath(exitDir)` 找出口 tile → moveTo 該 tile」。平地穩定，但在滿沼澤的 W48N22：
  1. creep 跨房進入時落在**邊界 tile**(x/y = 0 或 49)。
  2. 沼澤 cost 高、ops 易爆，`findClosestByPath(exitDir)` 容易**回傳 null** → fall back `moveTo(房中心, reusePath:10)`。
  3. moveTo 在沼澤每幾 tick 重算，creep 又站在邊界 tile，易沿邊緣走或被推回邊界 → **跨回上一個房**。
  4. 跨回後 routeIdx 不對應當前房，`findExit(當前房, 非相鄰下一房)` 回 `ERR_NO_PATH` → 刪快取重建 route → 又送回 W48N22 → **無限橫跳**。
  → 本質：travel.js「逐 tile 找出口」策略對 **沼澤 + 邊界 tile 不健壯**；與跨房 pathfinder、與旗幟順序皆無關。

- **次要問題**:
  1. **claimer body 沼澤幾乎不動**: `[CLAIM×3, MOVE×3]` 在沼澤每步 30 fatigue、每 tick 僅回復 6 → 約每 5 tick 走 1 格，放大上述邊界停留時間。`claimController` 只需 1 個 CLAIM，3 CLAIM 僅對 reserve 速度有用。
  2. **`nav.flag.js` 是死碼且語義衝突**: 無任何檔案 require；其旗幟語義為「房內 tile waypoint」，與 travel.js 的「房間 waypoint」不同。
  3. **`new-code/manager.remote.js.bak`（31KB）被納入版控** → 應移除。
  4. 本 travel/claimer/nav 子系統先前未記錄於 DECISIONS.md（本條補上）。

- **給 deepseek 的修改指示（核心修 travel.js 沼澤健壯性，保留旗幟）**:
  - **(核心) travel.js 改出口移動策略**：不要再用 `findClosestByPath(exitDir)` 走 tile。改為直接 `creep.moveTo(new RoomPosition(25,25, nextRoom), {reusePath: 50, swampCost: 5, visualizePathStyle:{...}})`。因為 `nextRoom` 永遠是 route 中的**相鄰**房，這只跨單一邊界、由 moveTo 原生處理沼澤，仍維持「絕不跨多房 pathfind」的原設計，且消除邊界 tile 抖動。
  - **(核心) 邊界 tile 防呆**：在 `run()` 開頭，若 creep 仍在旅途中且站在邊界 tile（`x===0||x===49||y===0||y===49`），先強制往內走一格再做後續邏輯，避免被推回上一房。
  - **(核心) 反橫跳偵測**：route 因 `ERR_NO_PATH` 重建時，若偵測到當前房 == 上一 tick 的房（記在 `_t.lastRoom`）且來回切換，鎖定朝 `nextRoom` 中心移動數 tick，不重算。
  - **(輔助)** `manager.remote.js` claimer body 加 MOVE 至沼澤 1:1（或先在 W48N22 鋪路）；CLAIM 可降為 1。
  - **(清理)** 刪 `new-code/nav.flag.js`；`git rm --cached new-code/manager.remote.js.bak`。
  - **立即（Console 驗證）**: 對現存 claimer `delete Game.creeps['<name>'].memory._t;` 清路線快取重跑；觀察是否仍在 W48N22 邊界抖。

- **對應 SKILL.md 規則**: 存活優先（不可停擺）、先讀高階架構再修改、改動寫入改變文檔
- **教訓**: 跨房導航的真正脆弱點在**邊界 tile + 高 cost 地形**，不是跨房 pathfinder 本身。逐 tile 找出口在沼澤會 fall back 並把 creep 推回邊界形成橫跳；對「相鄰房中心」做 moveTo 更穩。診斷前先確認玩家的路徑意圖（旗幟順序），勿先入為主判為倒退。
- **狀態**: 分析+文檔（Claude）。主程式修改待 deepseek 執行。

---

## D008 — W47N22 強行建 spawn：特殊擴張任務規格

- **時間**: 2026-06-21
- **目標（玩家指定）**: 用高機動 body 強行在 W47N22 claim + 蓋第一座 spawn。出生即前進、不等組隊；spawn 工地由玩家手動放置；spawn 蓋好前停止母房 W49N25 的 upgrade；按固定順序持續補產。

- **前置硬條件（不滿足則任務必失敗）**:
  1. **GCL ≥ 2**（`claimController` 要求 GCL > 已擁有房數）。Console 先確認 `Game.gcl.level`。
  2. **第一座 spawn 必須先 claim 後才放工地**（unowned 房不能放 spawn 工地）。順序固定：claim → 玩家放 spawn 工地 → builder 建。
  3. **home `energyCapacityAvailable` 要付得起 body**（見下）。

- **Body 規格**:
  - claimer `[CLAIM×3, MOVE×15]` = **2550 能量**，需 cap ≥ 2550（**RCL7**）。fatigue：3 CLAIM 沼澤 30/步，15 MOVE 回 30 → 任何地形滿速，且不再有 travel.js 邊界橫跳。CLAIM creep 壽命僅 600 tick，高 MOVE 確保趕得到。
    - **RCL6 fallback**：`[CLAIM×2, MOVE×10]` = 1700（沼澤仍滿速；claim 只需 1 CLAIM，2 CLAIM 留作 reserve 後援）。
  - builder（=pioneer 角色）`[MOVE×10, WORK×1, CARRY×1]` = **650 能量**，×3。fatigue：負重 2 部件 ×10 = 20，10 MOVE 回 20 → 沼澤滿速。
    - **代價**：建造力僅 1 WORK = 5/tick，3 隻 15/tick；spawn 需 15,000 能量 → 純建造 ~1000 tick，加 1 WORK 採礦(2/tick)補給瓶頸 → **實際 ~2500+ tick**。若要快，建議進房後改 build-heavy（如 `[6W,3C,3M]`），代價是沼澤段較慢。

- **任務狀態機（Memory）**:
  ```js
  Memory.expansionMission = {
    active: true,
    home: 'W49N25',
    targetRoom: 'W47N22',
    signText: 'Theodos colony',
    builderCount: 3,
    phase: 'claim'   // 'claim' -> 'build' -> 'done'
  };
  ```
  轉換：`claim→build` 當 `Game.rooms[target] && controller.my`；`build→done` 當 `Game.rooms[target].find(FIND_MY_SPAWNS).length>0`；`done` 時設 `active=false`（母房 upgrade 自動恢復、任務停止補產）。

- **給 deepseek 的修改清單**:
  - **(a) 任務驅動的 spawn 佇列**（改 `manager.remote.js` 的 `getSpawnRequests` 擴張區塊）：
    - 只在 `Memory.expansionMission.active && phase!=='done'` 時產出任務 creep；body 改用上述規格（讀 mission body 或 helper）。
    - 佇列順序：先 claimer（`countClaimers(target)===0 && !controller.my` 才補）→ 再 builder（`countCreepsInRole('pioneer',target) < builderCount` 就補，一次補一隻）。memory 帶 `targetRoom/remoteRoom=target, role, home, signText`，**不帶任何 rally/wait 旗標**（出生即由 travel.js 前進）。
  - **(b) 擴張優先級**：維持 main loop 既有「`remote.run()` 先於母房經濟」順序即可，任務 creep 自然搶到 spawn。
  - **(c) 停母房 upgrade**（改 `manager.rcl2ContainerEconomy`）：當 `Memory.expansionMission.active && phase!=='done' && room.name===home` 時，強制 `requestedUpgradeWork = 0`（除非 `economyState.controllerEmergency` 將 downgrade 才保底給最低值），使新 upgrader 不再 spawn。
  - **(d) upgrader 立即停手**（改 `role.upgrader` / `role.rcl1Upgrader`）：加早退 guard——`if (Memory.expansionMission && Memory.expansionMission.active && Memory.expansionMission.home===creep.room.name && !controllerEmergency) { /* 改去搬運/閒置，不呼叫 upgradeController */ }`，把能量讓給任務。
  - **(e) 狀態機推進**：在 `remote.run()` 或新 `manager.expansion.run()` 內每 tick 依上述條件更新 `phase`，`done` 時 `active=false`。
  - **(f) 守門**：`active` 為真但 `Game.gcl.level < (已擁有房數+1)` 時，console 警告並**不要 spawn claimer**（避免白生 2550 能量的 CLAIM creep 去 reserve）。

- **Console 啟動指令（玩家手動）**:
  ```js
  Memory.expansionMission = { active:true, home:'W49N25', targetRoom:'W47N22', signText:'Theodos colony', builderCount:3, phase:'claim' };
  // 確認 GCL：
  Game.gcl.level;
  ```
  claim 成功後玩家在 W47N22 手動放 spawn 工地（建議近 source 與 controller 之間）。

- **對應 SKILL.md 規則**: 存活優先（不可停擺，停 upgrade 需保 controller 不 downgrade）、先讀高階架構再修改、改動寫入改變文檔
- **教訓**: CLAIM creep 壽命 600 tick + 沼澤 → MOVE 要足量;「強行建 spawn」真正瓶頸是 GCL 與 15,000 能量建造補給，不是 body 形狀;停母房 upgrade 必須保留 controllerEmergency 後援以免 downgrade。
- **狀態**: 規格+文檔（Claude）。主程式 (a)~(f) → **已由 Claude 於 D009 實作**。

---

## D009 — D007 / D008 落地實作（Claude 直接修改）

- **時間**: 2026-06-22
- **背景**: Review 發現 D007（travel 沼澤修正）與 D008（擴張任務）規劃完整但 `new-code` 從未落地，code 仍停在規劃前狀態。玩家指示 Claude 直接實作 A1/A2/A3，不再轉交 deepseek。
- **基準**: 本地 HEAD `8697591`（06-21 部署）。sandbox 無法 `git pull`（SSH host key 驗證失敗），實作前未能驗證遠端是否已有更新。

### A1 — travel.js 沼澤邊界橫跳修正（落實 D007 任務 0）
改 `new-code/travel.js` `run()`：
1. **出口移動策略**：刪除「每 tick `findClosestByPath(exitDir)` 走出口 tile」，改為對 route 中**相鄰** `nextRoom` 直接 `moveTo(new RoomPosition(25,25,nextRoom),{reusePath:50,swampCost:5})`。單邊界、moveTo 原生處理沼澤，維持「不跨多房 pathfind」原則。
2. **邊界 tile 防呆**：`run()` 開頭若仍在旅途且站邊界（x/y=0|49），先朝本房中心走一格 `return true`，避免被推回上一房。
3. **反橫跳鎖定**：`_t` 記 `lastRoom`/`prevRoom`；偵測 A→B→A（當前房 == 兩 tick 前的房且 != 上 tick）時設 `_t.lockUntil=Game.time+3`，鎖定期間直奔 `nextRoom` 中心不重建 route。
- 保留 nav-* 旗幟與 `buildRoute`（玩家旗幟順序正確）。

### A2 — 擴張任務狀態機（落實 D008 任務 a–f）
- **`manager.remote.js`**：
  - 移除 legacy `EXPANSION_TARGETS` 常數（單一擴張真相來源，避免兩套邏輯）。
  - 新增 RCL6 固定 body：claimer `[CLAIM×2,MOVE×10]`=1700、builder(role=pioneer) `[WORK×5,CARRY×4,MOVE×5]`=950。
  - `advanceExpansionPhase()`（每 tick 在 `run()` 呼叫）：`claim→build`（target controller.my）、`build→done`（target 出現 spawn），`done` 設 `active=false`。
  - `getExpansionRequests()`：依 `Memory.expansionMission.phase` 排程；claim 階段含 **GCL 守門**（`Game.gcl.level < 已擁有房+1` 不生 claimer）；build 階段補到 `builderCount`（預設 3，一 tick 一隻）。creep memory 帶 `{role,home,targetRoom,remoteRoom,signText}`，無 rally 旗標。放在 remote 經濟之前 → 擴張優先搶 spawn。
- **停母房 upgrade**（任務 c/d）：
  - `manager.rcl2ContainerEconomy.js`：mission active 且 home 房且非 controllerEmergency 時強制 `requestedUpgradeWork=0`（新 upgrader 不再 spawn）。
  - `role.upgrader.js` / `role.rcl1Upgrader.js`：`run()` 開頭 `expansionPaused()` guard——同條件下不 upgrade，改把能量送回 spawn/extension/storage，否則靠近 spawn 閒置；`ticksToDowngrade<4000` 則照常 upgrade 保命。

### A3 — 清理
- `.gitignore` 加 `*.bak`（已改）。
- **未完成（sandbox 權限不足，需玩家本機執行）**：刪 `new-code/nav.flag.js`、`git rm --cached new-code/manager.remote.js.bak`。另 sandbox git 嘗試時留下 **`.git/index.lock` 空檔，玩家本機 git 操作前須先 `rm -f .git/index.lock`**。

### 驗證
- 5 個改動檔 `node --check` 全通過；`EXPANSION_TARGETS` 參照僅剩註解。
- **未做**：實機 sim 驗證（無法部署）。建議 deepseek/玩家部署到 claw-deepseek 後，用 Console 啟動 mission 觀察 claimer 是否順利過 W48N22 沼澤。

### 玩家啟動指令（Console）
```js
Memory.expansionMission = { active:true, home:'W49N25', targetRoom:'W47N22', signText:'Theodos colony', builderCount:3, phase:'claim' };
Game.gcl.level;   // 必須 >= 已擁有房數+1，否則只 hold claimer
// claim 成功後在 W47N22 手動放 spawn 工地（近 source 與 controller 之間）
```

- **B1（home room 硬編碼 W49N25）/ B2（單一 spawn spawns[0]）**：列為「長征後、擴張穩定前」的架構重構項，本輪未動。
- **對應 SKILL.md 規則**: 存活優先、先讀高階架構再修改、改動寫入改變文檔
- **教訓**: 規劃文檔（D007/D008）與實際 code 會脫節；review 時務必 grep 驗證「規劃是否已落地」，別假設文檔=現況。
- **狀態**: A1/A2 程式已改 + 語法驗證（Claude）。A3 部分待玩家本機 git 收尾。實機驗證待部署。
