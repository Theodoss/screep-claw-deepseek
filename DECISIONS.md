# Screeps 永久決策記錄

> 每個高階決定記錄在此。時間、原因、結果。
> 這是巡迴之間唯一不會被 code pull 覆蓋的長期記憶。

---

## 核心規則（不可違反）

1. **🛑 禁止自動放置任何建築工地**（D001）
   - 不準 `createConstructionSite`、`placeControllerContainerSite`、`placeExtensionSites`
   - 工地只能玩家手動放

2. **Miner 不需要 CARRY 部件**（D003）
   - 無 CARRY 時 `harvest()` 能量直接掉地上，同格 container 自動撿起

3. **Spawn 失敗時 fallthrough，不要 early return block 低優先級 spawn**（D004）

4. **Branch 隔離：只推 claw-deepseek，絕不可動 sim**（D006）

5. **跨房導航統一用 travel.js**（D007）
   - 沼澤用 moveTo(roomCenter, swampCost:5)，不要逐 tile 找出口
   - 邊界防呆：x/y=0|49 先朝房中心走
   - 反橫跳鎖：A→B→A 偵測鎖 3 tick

6. **每次 safe-deploy 後 push 到 GitHub**（D008）

7. **改 body/policy 前先讀 DECISIONS.md**（D013）
   - 回退既有決策必須在 DECISIONS 補一條說明原因

---

## D001 — 禁止自動放置建築工地
- **時間**: 2026-06-12
- **原因**: RCL 過渡期 `energyCapacityAvailable` 跳升但實際建築未完成，body 成本膨脹，spawn 付不起 → 殖民地連續崩潰兩次
- **教訓**: 巡迴之間沒有共享記憶，需要 DECISIONS.md 作為跨巡迴永久記錄

## D002 — 移除 effectiveCapacity 自適應身體
- **時間**: 2026-06-12
- **原因**: 自適應邏輯在 hidden state（未建成 extension）下更難 debug
- **現狀**: 改為 `buildStaticUpgraderBody` 直接用 budget 上限

## D003 — Miner 不需要 CARRY 部件
- **時間**: 2026-06-12
- **結果**: body 從 `[W×4,C,M]` → `[W×5,M]`，採礦效率 +25%

## D004 — Spawn priority fallthrough
- **時間**: 2026-06-12
- **原因**: 高優先度 spawn 失敗後 early return 導致低優先度 spawn 也被跳過

## D005 — 1000-tick 能量收入基準線
- **時間**: 2026-06-13
- **實作**: `Memory.agent.energySnapshots[]` 保留 1200 ticks
- **規則**: 劣化 >20% → 回滾檢討

## D006 — Branch 隔離
- **時間**: 2026-06-13
- **規則**: 只推 claw-deepseek；activeWorld=sim 時 pull 當參考但不部署

## D007 — 跨房導航統一架構（travel.js）
- **時間**: 2026-06-21
- **原因**: Claimer 在 W48N22 沼澤邊界來回橫跳
- **架構**: travel.run() 統一控制移動，role 層不發移動命令。exit lock、arrival check、反橫跳鎖
- **狀態**: ✅ 已實作 + 部署（D009）

## D008 — W47N22 擴張任務架構
- **時間**: 2026-06-21→22
- **內容**: Memory.expansionMission 狀態機（claim→build→done）；停母房 upgrade 期間保留 controllerEmergency 後援
- **狀態**: ✅ W47N22 已達成 RCL3，任務成功

## D009 — D007/D008 落地實作
- **時間**: 2026-06-22
- **內容**: travel.js 沼澤修正、expansionMission 狀態機、停母房 upgrade、GCL 守門
- **狀態**: ✅ 已部署

## D010 — 殖民地表 + remote 優化
- **時間**: 2026-06-22
- **內容**: config.colonies.js（中央化設定表）；reserver body 加大 [CLAIM×2,MOVE×2]；remoteHauler 優先撿地面能量
- **狀態**: ✅ 已部署

## D011 — 多 spawn 並行（util.spawns.js）
- **時間**: 2026-06-22
- **內容**: getAvailableSpawn(room) = 第一個 !spawning 的 spawn，取代 spawns[0] 假設
- **狀態**: ✅ 已部署

## D012 — Invader 機制 + 防禦改進
- **時間**: 2026-06-22
- **核心發現**: reserved 房不生 invader → reservation 是最便宜的第一道防線
- **改動**: reserver body 加大、reserveThreshold 提高至 1500+；remoteGuard 重寫（動態 re-target、多房輪巡、travel.js 跨房）
- **修正**: threat/timeout 清除死鎖、danger 暫停改視野確認制
- **狀態**: ✅ 已部署

## D013 — Reserver body 被回退，重新套用
- **時間**: 2026-06-22
- **原因**: Agent 版 fb99728 把 [CLAIM×2,MOVE×2] 改回 [CLAIM,MOVE]，git 自動合併無衝突
- **教訓**: 多人協作 → 關鍵決策寫進 DECISIONS + in-code 註解標記
- **狀態**: ✅ 已修正

## D014 — 廢除 remoteBuilder，改為統一 zoneBuilder
- **時間**: 2026-06-25
- **原因**: rcl1Builder 和 remoteBuilder 是兩套獨立 role，但工作範圍是同一防區。舊 builder 優先補 extension 而非蓋建築。沒有 creep 負責修路。
- **決策**: 單一 zoneBuilder 負責整個防區（母房 + remote rooms），最少 1 隻
- **實作**: 新建 role.zoneBuilder.js，main.js 加入 ROLE_MODULES，rcl2ContainerEconomy 的 builderTarget 改 0
- **狀態**: ✅ 已部署

---

## 未完成事項

1. **Invader core 偵測 + 暫停 remote 經濟** (D012 提及但未做)
   - core 出現時 miner/hauler/reserver 會白送
   
2. **B2 硬編碼 W49N25** — main.js / remoteDefense 仍假設單一殖民地
   - 待第二殖民地穩定後多殖民地化

3. **W49N25 RCL7 升級** — controller 74.7%，預計仍需數天

---

## D015 — Core cleaner：純 ATTACK+MOVE 取代 guard pair
- **時間**: 2026-06-25
- **原因**: 舊 core 防禦用 guard+remoteGuard pair（RCL6: 1700e+1850e），太貴太慢；TOUGH/HEAL 對打 core 無用
- **決策**: 新建 `role.coreCleaner.js`，只有 ATTACK+MOVE，body 跟 energyAvailable 走
  - 最小 260e（A×2 M×2），最大 ~2210e（A×17 M×17）
  - 每個 core 只生 1 隻
- **狀態**: ✅ 已部署

## D016 — 修復 population counter 只看同房 creeps
- **時間**: 2026-06-25
- **原因**: `manager.stats.js` 用 `room.find(FIND_MY_CREEPS)` 計數人口，remote 工人永遠在 remote rooms → 永遠 count=0。改用 `Game.creeps` 過濾 `home`。
- **狀態**: ✅ 已部署

## 當前殖民地狀態

| Room | RCL | Controller | Economy | StoredE | Income |
|------|-----|-----------|---------|---------|--------|
| W49N25 | 6 | 74.7% → 7 | container-link | ~79K | ~58/t |
| W47N22 | 3 | 7.5% → 4 | container-full | ~5.4K | ~19/t |

Remote: W48N25, W48N26, W49N26（全部 active）
GCL: 19.5M

---

## D017 — Recovery fallback 使用純 carrier body
- **時間**: 2026-06-26 06:00
- **原因**: W47N22 進入 economy-recovery（storedEnergy 4,955 < 5,000 threshold），
  spawn 嘗試 200e rcl1Harvester 但能量傳輸跟不上導致 spawn stuck。
  在 recovery 模式下 containers 已滿、miner 已存在 → 不需要 WORK 部件。
- **改動**: manager.rcl1Bootstrap.js — recovery/boot fallback 時用 [CARRY,MOVE]（100e）
  取代 [WORK,CARRY,MOVE]（200e），減半 spawn 成本。
- **預期**: recovery 更快退出，留下更多能量給 follow-up hauler spawns
- **狀態**: ✅ 已部署

