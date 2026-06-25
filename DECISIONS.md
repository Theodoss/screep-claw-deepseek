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

## D009 — W47N22 擴張任務架構

- **時間**: 2026-06-22
- **原因**: 建立 W47N22 殖民地，由 RCL6 母房 W49N25 支援。需要完整的擴張任務流程取代硬編碼 EXPANSION_TARGETS。
- **改動範圍**:
  - **travel.js** — 棄用 findExit+findClosestByPath，改用 moveTo(roomCenter, swampCost:5) 單邊界導航；新增邊界防呆（x/y=0|49 時先推向房中心）；新增反橫跳鎖（A→B→A 偵測，鎖 3 tick）。
  - **manager.remote.js** — 移除 EXPANSION_TARGETS 硬編碼，改用 Memory.expansionMission 狀態機（claim→build→done）。新增 GCL 守門（GCL 不足不 spawn claimer）。
  - **Claimer body**: [CLAIM×2, MOVE×10] = 1700e（沼澤滿速）。
  - **Pioneer body**: [WORK×5, CARRY×4, MOVE×5] = 950e。
  - **manager.rcl2ContainerEconomy.js** — 擴張期間母房 upgrade 設為 0（controllerEmergency 除外）。
  - **role.upgrader.js / role.rcl1Upgrader.js** — 擴張 guard：不升級 controller，改把能量送回 spawn/extension。
  - **清理** — 刪除 nav.flag.js、git rm manager.remote.js.bak。
- **啟動方式**: 玩家在 Console 設定 `Memory.expansionMission = { active:true, home:'W49N25', targetRoom:'W47N22', signText:'Theodos colony', builderCount:3, phase:'claim' };`

## D008 — 每次部署後 push 到 GitHub

- **時間**: 2026-06-21
- **原因**: Theodos 要求每次 safe-deploy 後自動 git push，確保程式碼備份到 GitHub。
- **守則**: 每次執行 `safe-deploy.sh` 後，必須接著 `git push origin master`。

## D007 — 跨房導航統一架構（travel.js）

- **時間**: 2026-06-21
- **原因**: Claimer 在 W48N21/W48N22 之間來回橫跳，分析後確認是多重問題疊加：
  1. `creep.pos.roomName` 在跨房瞬間不可靠（crossing tick）
  2. 每 tick 重算 moveTo，靠近出口時容易左右搖擺
  3. 無 exit lock，剛跨完房立刻重新規劃路徑
  4. role 和 travel 混在同一個函數裡，沒有分層
- **決策**: 建立統一的 `travel.js` 跨房導航層，所有跨房行為以此為準：
  - **分層架構**: `travel.run()` → `action`。travel 層統一控制移動，action 層不發移動命令。
  - **Exit lock**: 靠近出口（x/y ≤2 或 ≥47）鎖定 5 ticks，禁止重新規劃。
  - **Arrival check**: 進入目標房 + 離出口 ≥3 格才算到達（避開 mid-crossing）。
  - **Flag 輔助**: 支援 `nav-0, nav-1, ...` 旗幟路徑，跨房時先走房間中心再定位。
  - **State lock**: 儲存在 `creep.memory._t`，狀態一致。
- **守則**: 任何需要跨房的 creep（claimer、pioneer、remote miner/hauler、builder 等）都必須使用 `travel.js`，不可在 role 層直接 `moveTo(其他房間)`。
- **對應檔案**: `travel.js`、`role.claimer.js`、`role.pioneer.js`

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
- **合併備註（2026-06-22）**: 推送時發現 EC2 agent 的 `fee15bf` 已**獨立實作了相同的 D007/D008**（travel 沼澤修正、expansionMission 狀態機、停母房 upgrade），寫法不同但功能等價。rebase 時 5 個檔案衝突，決議**全部採用 agent 版（`--ours`）**，保留 Claude 的清理（刪 nav.flag.js/.bak）與文檔。教訓：分析前務必先 `git pull` 確認最新（見 D011 起點）。

---

## D010 — 殖民地表 + remote 多項優化（Claude 直接修改）

- **時間**: 2026-06-22
- **背景**: 玩家要求全面架構優化、為擴張做底層準備，並點名三個問題。基於 rebase 後的 agent 版（含 D007/D008）續改。**deepseek 推送前務必先 `git pull` 疊最新。**

### (1) 殖民地表 config.colonies.js（B1 地基）
- 新增 `new-code/config.colonies.js`：單一真相來源，宣告每個 home 殖民地 + 其 remote 房 source 設定（+ 預留 expansion 欄位）。helper：`listHomeRooms / getColony / getRemoteRooms / getDefaultSources / getHomeForRemote`。
- 重構 `manager.remote.js`：
  - 移除硬編碼 `REMOTE_ROOMS` 常數，資料移到 config。
  - `getDefaultSources(home, remote)` 改讀 config（新增 home 參數）。
  - `initMemory(homeRoomName)` 改為單一 home 參數化、source 從 config 取。
  - `run()` 改為 **迭代 `colonies.listHomeRooms()`**：每個 home 各自管理 remote 房、從自己的 spawn 產兵 → 多殖民地 ready。`HOME_ROOM` 常數僅留作向後相容匯出（= 第一個 colony）。
  - 之後 claim W47N22 並蓋好 spawn，只需在 config.colonies 加一筆，remote 系統自動接管（不必改 code）。
- **未動（留待後續）**: B2 單一 spawn `spawns[0]`（main.js defense 區塊、各 manager）；main.js / manager.remoteDefense 仍硬編碼 'W49N25'。下一輪處理。

### (2) 加大 reserver body（remote reserve 太小）
- `buildReserverBody`：cap≥1300 → `[CLAIM×2, MOVE×2]`（cap<1300 維持 `[CLAIM, MOVE]`）。每 CLAIM +1 reservation/tick；2 CLAIM 倍增、能更快重建/守住 5000 上限並涵蓋 CLAIM creep ~600 tick 壽命 + 路程的補位空窗。MOVE 1:1 保滿速。

### (3) remoteHauler 優先撿散落 energy
- `role.remoteHauler.js`：新增 `selectDroppedEnergy()`（找 container 半徑 3 內最大的地面 RESOURCE_ENERGY）；在 `collect()` 中把它排在 **withdraw container 之前**。地面 energy 每 tick 衰減 1，container 不衰減 → 先撿地面避免浪費（container 滿溢、miner 沒站準時的掉落）。

### 驗證
- `config.colonies.js / manager.remote.js / role.remoteHauler.js` 三檔 `node --check` 全通過；無殘留 `REMOTE_ROOMS`。
- **未做**：實機 sim 驗證（無法部署）。建議部署後觀察 reserver reservation 是否更穩、remote 房地面 energy 是否被即時撿走。

- **對應 SKILL.md 規則**: 先讀高階架構再修改、改動寫入改變文檔、為擴張做準備
- **教訓**: 既有 remote 函式多數已用 homeRoomName 參數化，所以多殖民地化的成本主要在「資料外移 + run() 迭代」，而非大改邏輯；中央化設定表是低風險、高槓桿的擴張地基。
- **狀態**: 程式已改 + 語法驗證（Claude）。待 deepseek `git pull` 後疊上去並部署驗證。

---

## D011 — 多 spawn 並行（B2，Claude 直接修改）

- **時間**: 2026-06-22
- **背景**: review B2——`spawns[0]` 假設遍布全 code，RCL7=2 spawn、RCL8=3 spawn 時只用第一個 → 產兵吞吐瓶頸，正卡在「長征衝產量」階段。

### 改動
- 新增 `new-code/util.spawns.js`：`getAvailableSpawn(room)` = 第一個 `!spawning` 的 spawn（全忙回 null）；`getSpawns(room)`。
- 將「spawn 決策點」由 `spawns[0] + if(spawn.spawning) return` 改為 `getAvailableSpawn`：
  - `manager.rcl2ContainerEconomy.run()`（主經濟產兵）
  - `manager.rcl1Bootstrap.run()`（bootstrap 後備產兵）
  - `manager.remote.run()`（remote 產兵）+ `isHomeEconomyStable`（改成「需有一個空 spawn」而非「spawn#0 不忙」）
  - `main.js` defense 區塊
- `manager.military.trySpawn` 本來就用 `spawns.find(!spawning)`（已正確），維持不動。

### 原理
- 每 tick 產兵的 manager 依序執行（remote → defense → 各房經濟 → military）。`spawnCreep` 成功的瞬間該 spawn 變 `.spawning`，所以下一個 caller 的 `getAvailableSpawn` 自然拿到下一個空 spawn → **多 spawn 平行**。單一 spawn 房行為不變（完全向後相容）。

### 未動（刻意保留）
- 其餘 `spawns[0]` 都是**非產兵**的位置/身分用途，維持正確：`manager.rcl1SourceSlots`(home spawn 參照)、`rcl2ContainerEconomy.discoverSources`(距離計算)、`manager.remote.getHomeSpawn`(remote road 起點)、`role.guard`(駐點)、`role.remoteHauler.waitAtHome`(等待點)、`planner.roomPlanner`(停用)、`manager.spawn.js`(legacy 未載入)。
- **單一 manager 內仍只產一隻/tick**（如 economy 一個 tick 仍只 spawn 一隻 miner/hauler）。要讓單一 manager 一 tick 餵滿多個 spawn 需把其決策樹改成迴圈——風險較高，留待後續。現階段的「跨 manager 平行」已是主要收益。
- main.js / manager.remoteDefense 仍硬編碼 `'W49N25'`：等 colony table（D010）擴到第二殖民地時再一起多殖民地化。

### 驗證
- `util.spawns.js / main.js / manager.rcl1Bootstrap.js / manager.rcl2ContainerEconomy.js / manager.remote.js` 全 `node --check` 通過；spawn 決策路徑已無 `spawns[0]`。
- **未做**：實機驗證（無法部署）。建議 RCL7 後觀察兩個 spawn 是否同 tick 並行產兵。

- **對應 SKILL.md 規則**: 先讀高階架構再修改、改動寫入改變文檔、存活優先（向後相容不破壞單 spawn）
- **教訓**: 「first non-spawning spawn」配合 manager 依序執行，不需共享佇列就能自然分配多 spawn；military 早已用這招，把它抽成共用 util 即可全面套用。
- **狀態**: 程式已改 + 語法驗證（Claude）。`config.colonies.js`、`util.spawns.js` 為**新檔**，deepseek 部署時務必一起上傳，否則 require 失敗。待 `git pull` 疊上去並部署驗證。

---

## D012 — Invader 機制研究 + remote 防禦改進（Claude 直接修改）

- **時間**: 2026-06-22
- **背景**: 玩家反映 invader 對經濟傷害大，要求研究機制並改進 remote guard（巡邏/支援）。

### Invader 官方機制（查證自 docs.screeps.com/invaders.html 等）
1. **觸發**: 每個被採礦的房有隱藏計數器，約累積 **100,000 能量**(+隨機) → 在房間出口生成一隻 invader 獵殺 creep。採越多越頻繁，無法完全避免（只要在採）。
2. **🔑 reserved 房不生 invader**: invader 只在「**通往中立房的出口**」生成；該房若被 **reserve 或佔領，invader 不會在那裡出現**。→ **持續 reservation = 最便宜的第一道防線**。
3. **invader 不能跨房移動** → 不需要「追擊」。A 房 invader 不會跑去 B。所謂巡邏＝一隻 guard 輪流覆蓋多房，而非追。
4. **10% 機率 raid**（2–5 隻含 healer，可能 boost）。
5. **反覆入侵 = sector 有 Stronghold**：會生 invader，並在中立/reserved 房放 **invader core**（reserve 控制器，擋住採礦直到打掉 core 或它崩解）。

### 改動 A — reservation 強化為第一道防線（`manager.remote.js`）
- `reserveThreshold`：`max(500, lead+200)` → **`max(1500, lead+400)`**，提早補產、寬裕 margin，讓 reservation 永不歸零（搭配 D010 已加大的 `[CLAIM×2,MOVE×2]` body，每 tick +2 reservation 重建快）。
- 解除過嚴的 `stable` 限制：新增 `maintainReservation = stable || 有 remoteMiner 在採`。只要該房**正在採礦**就維持 reserve（採礦＝會招 invader＝必須 reserve），不再因暫時 infra 中斷讓 reservation 失效。

### 改動 B — 巡邏 guard（`role.remoteGuard.js` 重寫）
- **動態 re-target**：每 tick 從 `Memory.remote[home].rooms[*].threat` 找出**最近的有 invader 威脅的房**，自動前往（不再綁死出生 targetRoom）。
- **即時交戰**：人在某 remote 且當場看到 invader → 立刻打（不等 remoteDefense 每 5 tick 的掃描）。
- **多房輪巡**：無任何威脅時，在「有啟用 source 的 active remote」之間輪流巡邏（`patrolIdx`，每房停 ~15 tick 再換），提供滾動視野+早期偵測，而非 garrison 單房。只巡 active remote（idle 房不巡，省時）。
- 戰鬥邏輯（kite melee／優先打 healer／rangedMassAttack／自療）沿用；瀕死(TTL<250)回家換班。
- 解除對 `manager.remoteDefense` 的 require（改直接讀 Memory threat），降耦合。
- **dispatch 維持不變**：`manager.remoteDefense` 仍在 invader 威脅時派 guard、並用 garrison-replacement 讓 guard 持續存在 → 第一次接戰後就一直有一隻在巡邏。

### 未做（玩家本輪未選）
- **invader core 偵測 + 暫停該 remote 經濟**：core 出現時 miner/hauler/reserver 仍會白送、又採不到。**這其實是 invader 對經濟傷害最大的來源，強烈建議下一輪補上。**
- **Stronghold/core 攻擊隊**：需 dismantle/attack squad + 編隊 AI，大工程。

### 驗證
- `role.remoteGuard.js / manager.remote.js` `node --check` 通過；remoteGuard 無殘留舊 require。
- **未做**：實機驗證。建議用 Screeps 房間面板的 "Invasion" 手動生 invader 測試 guard 反應與巡邏。

- **對應 SKILL.md 規則**: 先讀高階架構再修改、改動寫入改變文檔、查 API/機制再設計、存活優先
- **教訓**: invader 防禦的最大槓桿不是更強的 guard，而是「**保持 reservation**」——reserved 房根本不生 invader；guard 是處理 raid 與 reservation 空窗的補強。invader 不跨房，所以「巡邏」是覆蓋而非追擊。
- **狀態**: 程式已改 + 語法驗證（Claude）。待 `git pull` 疊上去並部署驗證。建議下一輪做 invader core 偵測。

### 修正（同批，玩家回報兩個 bug）
1. **remote hauler 撤回母房後永久發呆、invader 死了也不回**：根因＝`isRemotePaused` 卡在 `remoteConfig.threat`，而 `threat` 只在 **有視野** 時（`scanRemoteRoom`）才清；所有 creep 一撤就沒視野 → threat 永遠清不掉 → 永久暫停。**死鎖。**
   - 修：`manager.remoteDefense.run()` 加 **無視野 timeout**——`threat` 超過 `THREAT_TIMEOUT=300` tick 未被重新確認就自動清除。
   - 另：`DANGER_PAUSE_TICKS` 800→**400**，guard 清掉 invader 後經濟更快恢復。
2. **remote guard 一直在邊界來回進出**：根因＝guard 進威脅房時落在**出口 tile**(x/y=0|49)，沒敵人時不下移動指令；站出口 tile 的 creep 下一 tick 被遊戲自動拉回隔壁房 → 再進 → 無限橫跳（與 D007 同類，guard 的 `moveToRoom` 無邊界防呆）。
   - 修：guard 重寫改用 **`travel.js`** 做跨房移動（內建 D007 邊界防呆＋反橫跳＋沼澤），且抵達後一律停在**離邊界 ≥3 格**（`inRoomOffEdge`）才轉入 hold/fight；`fleeStep` 也改為不踏上邊緣 tile（1–48）。無威脅時 hold 在房內中央給視野，讓 threat 能正常清除（也順帶解死鎖）。
   - 移除 guard 對 `manager.remoteDefense` 的 require，改讀 Memory threat。
### 修正 2（玩家實測數據後的真正根因）
玩家提供 live Memory：W48N25 `threat` 已不在、`sources[].enabled` 皆 true、房內 0 hostile——**之前兩個推測（threat 死鎖／disabled source）都被否定**。真正卡住的是 **`status:'danger'` + `pauseUntil`**：`getSpawnRequests` 對 `isRemotePaused` 的房一開頭就 `continue` → 暫停期間**完全不生 miner/hauler/reserver**（玩家點出的「沒 miner 也不補 miner」正是此症狀）。舊的 `pauseUntil` 是「沒有 guard 年代」用固定時間賭 invader 走了的權宜。
- **修（`updateRemoteRoom`）**: danger 暫停改為**視野確認制**——房間有視野且 0 hostile 連續 `RESUME_CLEAR_TICKS=10` tick 就恢復，不再傻等固定 timer。
- **guard 把關（玩家要求，為擴張考量）**: 快速恢復**只在該 colony 有存活 remoteGuard 時**生效（`hasRemoteGuardForHome`，per-home 可擴張）——有 guard 罩著才取消等待；**沒 guard 仍走固定 `pauseUntil`（800→400）** 後門，避免在無人保護下樂觀恢復又把採礦 creep 送死。
- 立即解卡（玩家 console，對現存卡住的房）：`Memory.remote['W49N25'].rooms['W48N25'].status='active'; delete Memory.remote['W49N25'].rooms['W48N25'].clearStreak;`

- **驗證**: `role.remoteGuard.js / manager.remoteDefense.js / manager.remote.js` `node --check` 通過。
- **教訓**: ① 別急著下根因——玩家的 live 數據推翻了我兩個假設；先看狀態再修。② 「撤退式防禦」的狀態清除若**依賴視野**會死鎖（撤光＝沒人解警報），要有 timeout 後門。③ 出口 tile(0/49) 會被遊戲自動推回隔壁房，「停在房內」邏輯必須先離開邊界 ≥3 格。④ 暫停/恢復這種「賭時間」的權宜，有了主動單位（guard）後應改成「**確認制 + 有保護才放行**」。

---

## D014 — 近遠配對 guard 體型表 + invader core 主動拆除

- **時間**: 2026-06-25
- **背景**: W48N25 出現 invader core 但無人處理。根因有三：
  1. `manager.remoteDefense.js` 掃描到 `coreRooms` 但從未對其採取任何行動
  2. `defense.active` 只被 invader **creep** 觸發，core 不觸發，故不 spawn guard
  3. `role.remoteGuard.js` 的 `fight()` 只打 `FIND_HOSTILE_CREEPS`，遇到 core 房間無 creep 時什麼都不做
  4. `remoteGuard` 在 new-code 中**無任何 spawn 邏輯**（舊的 5RA+1H+6M 是遺留 creep）

- **決策 1 — 近遠配對體型（按 RCL）**：
  - 近戰（guard）= T+A+H+M，H×1 自補，DPS 是同價遠程的 3–5x
  - 遠程（remoteGuard）= RA+H+M，補近戰血量並提供 range 輸出
  - Spawn 順序：M → R → M（近-遠-近）

  | RCL | 近戰體型 | 費用 | 遠程體型 | 費用 |
  |-----|---------|------|---------|------|
  | 3 | T×1 A×3 H×1 M×5 | 750 | RA×1 H×1 M×2 | 400 |
  | 4 | T×2 A×4 H×1 M×7 | 940 | RA×2 H×1 M×3 | 700 |
  | 5 | T×4 A×6 H×1 M×11 | 1320 | RA×3 H×2 M×5 | 1200 |
  | 6 | T×6 A×8 H×1 M×15 | 1700 | RA×5 H×2 M×7 | 1600 |
  | 7 | T×8 A×16 H×1 M×25 | 2860 | RA×10 H×5 M×15 | 3500 |
  | 8 | T×6 A×18 H×1 M×25 | 3000 | RA×16 H×8 M×16 | 6400 |

- **決策 2 — Invader core 主動拆除**：
  - Core level 1–2 → 派 1 melee + 1 ranged（2 units）
  - Core level 3+  → 派 2 melee + 1 ranged（3 units，M-R-M 順序）
  - Core pair spawn 在 defense mode 未啟動時也執行（不依賴 invader creep 出現）

- **修改的檔案**：
  1. `manager.remoteDefense.js`：新增 `buildMeleeGuardBody` / `buildRangedGuardBody` / `getCoreSpawnRequests`；scanDefenseGroup 加 core log；getAllSpawnRequests 加 Tier 2b
  2. `role.remoteGuard.js`：新增 `attackCore` / `findCoreRoom`；run() 加步驟 1b/1c/2b
  3. `main.js`：Tier 2 spawn 區塊合併 core pair requests

- **給 deepseek 的注意事項**：
  - `buildGuardBody()` 保留為 `buildMeleeGuardBody()` 的別名，現有呼叫不需改
  - 請勿把新體型回退成舊的 `[TOUGH, ATTACK, MOVE]` 簡單體型
  - 常駐巡邏 remoteGuard（非 core 任務）目前仍無 spawn 邏輯，如有需要另行補充

---

## D013 — reserver body 被回退，重新套用（協作衝突）

- **時間**: 2026-06-22
- **狀況**: 玩家回報 reserver 仍是 1/1。查證：D010 已把 `buildReserverBody` 改成 `[CLAIM×2, MOVE×2]`（9532746），但 **agent 的 `fb99728` commit 又把它改回單一 `[CLAIM, MOVE]`**。因為後續 D012 沒再碰這一行，最近一次 rebase **git 自動合併讓 agent 的回退版悄悄勝出**（無衝突提示），造成「DECISIONS 寫 2/2、code 卻是 1/1」的不一致。
- **決議**: 重新套用 `[CLAIM×2, MOVE×2]`（cap≥1300）並在函式上方加 **`⚠️ 請勿回退`** 註解 + 理由（reservation 是第一道 invader 防線，2 CLAIM 才能守住不歸零）。
- **給 deepseek/agent 的協作規則**:
  1. 改任何 body/policy 前先讀 `DECISIONS.md`；若要回退既有決策，**必須在 DECISIONS 補一條說明原因**，不要無聲改回。
  2. 無聲回退會被 git 自動合併吃掉、難以察覺；雙方都應把「為什麼這樣設」寫進 DECISIONS，避免 ping-pong。
- **教訓**: 多人/多 agent 改同一 repo，**靜默的相反修改 + git 自動合併 = 看不見的回退**。防線是：關鍵決策寫進共享文檔、爭議處留 in-code 註解標記、review 時 diff 對照文檔與 code 是否一致。
- **狀態**: 已重新套用 + 語法驗證。**若 agent 有意要縮回 1 CLAIM，請先在此說明理由再改。**
