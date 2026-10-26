(() => {
  const tables = {
    inventory: { name: 'fridge_inventory', key: 'id' },
    custom_foods: { name: 'fridge_custom_foods', key: 'id' },
    diet_meals: { name: 'fridge_diet_meals', key: 'id' },
    profile: { name: 'fridge_profiles', key: 'owner_id' }
  };
  const baselinePrefix = 'fridge-cloud-baseline-v1:';
  const statusNode = () => document.getElementById('cloud-sync-status');
  const syncButton = () => document.getElementById('cloud-sync-button');
  let client = null, userId = null, syncing = false, timer = null, initializedUser = null, preview = null;

  function setStatus(message, enabled = true, buttonText = '开始云端同步') {
    const status = statusNode(), button = syncButton();
    if (status) status.textContent = message;
    if (button) { button.disabled = !enabled || syncing; button.textContent = buttonText; }
  }
  function baselineKey() { return `${baselinePrefix}${userId}`; }
  function readBaseline() {
    try { const value = JSON.parse(localStorage.getItem(baselineKey()) || 'null'); return value && typeof value === 'object' ? value : null; }
    catch { return null; }
  }
  function writeBaseline(rows) { localStorage.setItem(baselineKey(), JSON.stringify(rows)); }
  function iso(value) { const d = new Date(value); return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString(); }
  function n(value) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
  function keyOf(table, row) { return table === 'profile' ? row.owner_id : row.id; }
  function stripServerFields(row) {
    const result = { ...row };
    delete result.revision; delete result.updated_at;
    return result;
  }
  function canonical(row) {
    if (!row) return '';
    const data = stripServerFields(row);
    if (data.deleted_at) data.deleted_at = '__deleted__';
    return JSON.stringify(Object.keys(data).sort().reduce((out, key) => (out[key] = data[key], out), {}));
  }
  function same(a, b) { return !!a && !!b && canonical(a) === canonical(b); }
  function mapRows(rows, table) { return new Map((rows || []).map(row => [keyOf(table, row), row])); }
  function addOwner(row) { return { ...row, owner_id: userId }; }
  function normalizeRemote(table, row) {
    const base = { owner_id: row.owner_id || userId, revision: n(row.revision) || 1, updated_at: iso(row.updated_at || Date.now()) };
    if (table === 'inventory') return { ...base, id: row.id, food_name: String(row.food_name || ''), quantity: n(row.quantity), unit: row.unit, shelf_life_days: n(row.shelf_life_days), added_at: iso(row.added_at), deleted_at: row.deleted_at ? iso(row.deleted_at) : null };
    if (table === 'custom_foods') return { ...base, id: row.id, name: String(row.name || ''), category: row.category, kcal: n(row.kcal), calorie_basis: row.calorie_basis, calorie_reference_amount: row.calorie_reference_amount == null ? null : n(row.calorie_reference_amount), calorie_reference_unit: row.calorie_reference_unit || null, piece_grams: n(row.piece_grams), default_unit: row.default_unit, deleted_at: row.deleted_at ? iso(row.deleted_at) : null };
    if (table === 'diet_meals') return { ...base, id: row.id, recipe_id: String(row.recipe_id || ''), recipe_name: String(row.recipe_name || ''), emoji: row.emoji || '🍽️', consumed_on: String(row.consumed_on), recorded_at: iso(row.recorded_at), kcal: n(row.kcal), carbs_g: n(row.carbs_g), protein_g: n(row.protein_g), fat_g: n(row.fat_g), deleted_at: row.deleted_at ? iso(row.deleted_at) : null };
    return { ...base, owner_id: row.owner_id || userId, name: String(row.name || ''), height_cm: n(row.height_cm), weight_kg: n(row.weight_kg), age_years: n(row.age_years), gender: row.gender === 'female' ? 'female' : 'male', activity: n(row.activity) || 1.55, goal: ['cut', 'bulk'].includes(row.goal) ? row.goal : 'maintain' };
  }
  function localRows() {
    // Persist stable IDs before building a sync payload.
    inventory = assignInventoryIds(inventory);
    localStorage.setItem('fridge-foods-v2', JSON.stringify(inventory));
    customFoodRecords.forEach(food => { if (!food.id) food.id = createLocalId(); });
    localStorage.setItem(customFoodStorageKey, JSON.stringify(customFoodRecords));
    const logs = readDietLogs(); let changed = false;
    Object.values(logs).forEach(day => (day.meals || []).forEach(meal => { if (!meal.recordId) { meal.recordId = createLocalId(); changed = true; } }));
    if (changed) localStorage.setItem(dietLogKey, JSON.stringify(logs));

    const inventoryRows = inventory.map(item => {
      const unit = ['piece', 'ml'].includes(item.unit) ? item.unit : 'g';
      const quantity = unit === 'piece' ? n(item.weight) / gramsPerUnit('piece', item.name) : n(item.weight);
      return normalizeRemote('inventory', { id: item.id, owner_id: userId, food_name: item.name, quantity: Math.round(quantity * 1000) / 1000, unit, shelf_life_days: n(item.expiry), added_at: iso(n(item.added)), deleted_at: null });
    });
    const customRows = customFoodRecords.map(food => normalizeRemote('custom_foods', {
      id: food.id, owner_id: userId, name: food.name, category: food.category, kcal: food.kcal,
      calorie_basis: food.calorieBasis === 'package' ? 'package' : 'per100',
      calorie_reference_amount: food.calorieBasis === 'package' ? food.calorieReferenceAmount : null,
      calorie_reference_unit: food.calorieBasis === 'package' ? food.calorieReferenceUnit : null,
      piece_grams: food.pieceGrams || 0, default_unit: food.defaultUnit || 'g', deleted_at: null
    }));
    const dietRows = [];
    Object.entries(logs).forEach(([date, day]) => (day.meals || []).forEach(meal => dietRows.push(normalizeRemote('diet_meals', {
      id: meal.recordId, owner_id: userId, recipe_id: meal.id || 'unknown', recipe_name: meal.name || '菜品', emoji: meal.emoji || '🍽️',
      consumed_on: date, recorded_at: iso(n(meal.at) || Date.now()), kcal: meal.kcal, carbs_g: meal.carbs,
      protein_g: meal.protein, fat_g: meal.fat, deleted_at: null
    }))));
    const profileRaw = localStorage.getItem(profileStorageKey);
    const profileRows = profileRaw ? [(() => {
      const p = readProfile();
      return normalizeRemote('profile', { owner_id: userId, name: p.name, height_cm: p.height, weight_kg: p.weight, age_years: p.age, gender: p.gender, activity: p.activity, goal: p.goal });
    })()] : [];
    return { inventory: inventoryRows, custom_foods: customRows, diet_meals: dietRows, profile: profileRows };
  }
  async function fetchRemote() {
    const pairs = await Promise.all(Object.entries(tables).map(async ([table, def]) => {
      const { data, error } = await client.from(def.name).select('*').eq('owner_id', userId);
      if (error) throw error;
      return [table, (data || []).map(row => normalizeRemote(table, row))];
    }));
    return Object.fromEntries(pairs);
  }
  function countActive(rows) { return Object.values(rows).reduce((sum, list) => sum + list.filter(row => !row.deleted_at).length, 0); }
  function showInitialChoice(local, remote) {
    const dialog = document.getElementById('cloud-sync-choice'), message = document.getElementById('cloud-sync-preview');
    if (!dialog || !message || typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm('本机和云端都有数据。确定：合并两边；取消：使用云端覆盖本机。'));
    const localCount = countActive(local), remoteCount = countActive(remote);
    message.textContent = `检测到本机 ${localCount} 条记录，云端 ${remoteCount} 条记录。合并会保留两边的独立食材和饮食记录；同名自定义食材优先保留云端版本，个人资料优先保留本机版本。使用云端会覆盖本机记录。`;
    dialog.showModal();
    return new Promise(resolve => {
      const finish = value => { if (dialog.open) dialog.close(); resolve(value); };
      document.getElementById('cloud-sync-merge').onclick = () => finish('merge');
      document.getElementById('cloud-sync-cloud').onclick = () => finish('cloud');
      document.getElementById('cloud-sync-cancel').onclick = () => finish(null);
      dialog.addEventListener('cancel', () => resolve(null), { once: true });
    });
  }
  async function previewAndStart() {
    if (syncing || !client || !userId) return;
    syncing = true; setStatus('正在读取本机与云端数据…', false);
    try {
      const [local, remote] = await Promise.all([Promise.resolve(localRows()), fetchRemote()]);
      const localCount = countActive(local), remoteCount = countActive(remote);
      let mode = localCount && remoteCount ? await showInitialChoice(local, remote) : remoteCount ? 'cloud' : 'merge';
      if (!localCount && !remoteCount) mode = 'merge';
      if (!mode) { setStatus('已取消首次同步。数据仍保留在本机。'); return; }
      await initialSync(mode);
    } catch (error) { setStatus(error.message?.includes('does not exist') || error.code === '42P01' ? '云端数据表尚未建立，请先在 Supabase SQL Editor 执行个人数据迁移。' : `首次同步失败：${error.message || '请检查网络和 RLS 配置。'}`); }
    finally { syncing = false; refreshButton(); }
  }
  function initialMerge(table, local, remote, preferLocal) {
    if (table === 'profile') {
      const l = local[0], r = remote[0];
      if (l && r && !same(l, r)) return [preferLocal ? l : r];
      return [l || r].filter(Boolean);
    }
    const result = new Map(remote.map(row => [row.id, row]));
    const conflicts = [];
    local.forEach(row => {
      const cloud = result.get(row.id);
      if (cloud && !same(row, cloud)) conflicts.push({ local: row, cloud });
      else if (!cloud) result.set(row.id, row);
    });
    conflicts.forEach(item => result.set(item.local.id, preferLocal ? item.local : item.cloud));
    let rows = [...result.values()];
    if (table === 'custom_foods') {
      const byName = new Map();
      rows.forEach(row => {
        const name = row.name.trim().toLocaleLowerCase(), old = byName.get(name);
        if (!old || (remote.some(cloud => cloud.id === row.id) && !remote.some(cloud => cloud.id === old.id))) byName.set(name, row);
      });
      rows = [...byName.values()];
    }
    return rows;
  }
  async function initialSync(mode) {
    const local = localRows(), remote = await fetchRemote();
    let preferLocal = true;
    const conflicts = Object.keys(tables).flatMap(table => {
      const cloudMap = mapRows(remote[table], table);
      return local[table].filter(row => cloudMap.has(keyOf(table, row)) && !same(row, cloudMap.get(keyOf(table, row))));
    });
    if (mode === 'merge' && conflicts.length) preferLocal = window.confirm(`本机和云端有 ${conflicts.length} 条同 ID 记录不同。点“确定”保留本机版本；点“取消”保留云端版本。`);
    const desired = {};
    Object.keys(tables).forEach(table => { desired[table] = mode === 'cloud' ? remote[table] : initialMerge(table, local[table], remote[table], preferLocal); });
    if (mode === 'merge') await reconcile(desired, remote);
    const finalRows = await fetchRemote();
    writeBaseline(finalRows);
    await applyIfChanged(finalRows);
    setStatus('首次同步完成，之后会自动同步本机修改。', true, '立即同步');
  }
  function threeWay(table, baseRows, localRowsNow, remoteRows, conflicts) {
    const base = mapRows(baseRows, table), local = mapRows(localRowsNow, table), remote = mapRows(remoteRows, table);
    const ids = new Set([...base.keys(), ...local.keys(), ...remote.keys()]);
    const desired = new Map();
    ids.forEach(id => {
      const b = base.get(id), r = remote.get(id);
      let l = local.get(id);
      if (!l && b) l = table === 'profile' || b.deleted_at ? b : { ...b, deleted_at: new Date().toISOString() };
      if (!b) {
        if (l && r && !same(l, r)) conflicts.push({ table, id, local: l, cloud: r });
        desired.set(id, l && r ? r : l || r);
        return;
      }
      const localChanged = l ? !same(l, b) : false;
      const cloudChanged = r ? !same(r, b) : false;
      if (localChanged && cloudChanged && l && r && !same(l, r)) conflicts.push({ table, id, local: l, cloud: r });
      if (localChanged && (!cloudChanged || !r || (l && r && same(l, r)))) desired.set(id, l);
      else if (r) desired.set(id, r);
      else if (l) desired.set(id, l);
    });
    return [...desired.values()].filter(Boolean);
  }
  function resolveCustomNameConflicts(rows, localRowsNow, remoteRows, conflicts) {
    const localIds = new Set(localRowsNow.map(row => row.id)), remoteIds = new Set(remoteRows.map(row => row.id));
    const grouped = new Map();
    rows.filter(row => !row.deleted_at).forEach(row => {
      const name = row.name.trim().toLocaleLowerCase();
      if (!grouped.has(name)) grouped.set(name, []);
      grouped.get(name).push(row);
    });
    for (const [name, group] of grouped) if (group.length > 1) {
      const local = group.find(row => localIds.has(row.id)), cloud = group.find(row => remoteIds.has(row.id));
      conflicts.push({ table: 'custom_foods', id: name, local: local || group[0], cloud: cloud || group[0] });
    }
    return grouped;
  }
  async function steadySync() {
    if (syncing || !client || !userId) return;
    const base = readBaseline(); if (!base) return previewAndStart();
    syncing = true; refreshButton(); setStatus('正在同步本机和云端记录…', false, '同步中…');
    try {
      const [local, remote] = await Promise.all([Promise.resolve(localRows()), fetchRemote()]);
      const conflicts = [], desired = {};
      Object.keys(tables).forEach(table => { desired[table] = threeWay(table, base[table] || [], local[table], remote[table], conflicts); });
      const customGroups = resolveCustomNameConflicts(desired.custom_foods, local.custom_foods, remote.custom_foods, conflicts);
      let preferLocal = false;
      if (conflicts.length) preferLocal = window.confirm(`发现 ${conflicts.length} 处本机与云端同时修改或同名自定义食材冲突。点“确定”保留本机修改；点“取消”保留云端修改。`);
      for (const [name, group] of customGroups) if (group.length > 1) {
        const chosen = preferLocal ? group.find(row => local.custom_foods.some(item => item.id === row.id)) : group.find(row => remote.custom_foods.some(item => item.id === row.id));
        const keepId = (chosen || group[0]).id;
        desired.custom_foods = desired.custom_foods.map(row => group.some(item => item.id === row.id) && row.id !== keepId ? { ...row, deleted_at: new Date().toISOString() } : row);
      }
      conflicts.forEach(conflict => {
        if (conflict.table === 'custom_foods' && !preferLocal && conflict.local.name && conflict.cloud.name && conflict.local.name.trim().toLocaleLowerCase() === conflict.cloud.name.trim().toLocaleLowerCase()) return;
        const list = desired[conflict.table], index = list.findIndex(row => keyOf(conflict.table, row) === conflict.id);
        if (index >= 0) list[index] = preferLocal ? conflict.local : conflict.cloud;
      });
      await reconcile(desired, remote);
      const finalRows = await fetchRemote(); writeBaseline(finalRows);
      await applyIfChanged(finalRows);
      setStatus(`同步完成 · ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, true, '立即同步');
    } catch (error) {
      setStatus(error.message === 'sync-conflict' ? '同步期间云端记录又有变化，请再次点击同步解决冲突。' : `同步失败：${error.message || '请检查网络和 RLS 配置。'}`, true, '重试同步');
    } finally { syncing = false; refreshButton(); }
  }
  async function reconcile(desired, remote) {
    for (const [table, def] of Object.entries(tables)) {
      const remoteMap = mapRows(remote[table], table), desiredMap = mapRows(desired[table], table);
      for (const [id, row] of desiredMap) {
        const existing = remoteMap.get(id), payload = addOwner(stripServerFields(row));
        if (!existing) {
          const { error } = await client.from(def.name).insert(payload);
          if (error) throw error;
        } else if (!same(row, existing)) {
          const update = { ...payload }; delete update.owner_id; if (table !== 'profile') delete update.id;
          const { data, error } = await client.from(def.name).update(update).eq(def.key, id).eq('owner_id', userId).eq('revision', existing.revision).select(def.key).maybeSingle();
          if (error) throw error;
          if (!data) throw new Error('sync-conflict');
        }
      }
    }
  }
  function cloudToLocal(table, rows, customRows) {
    const active = rows.filter(row => !row.deleted_at);
    if (table === 'inventory') return active.map(row => {
      const custom = customRows.find(food => food.name === row.food_name), pieceWeight = foodPieceGrams[row.food_name] || custom?.piece_grams || 1;
      return { id: row.id, name: row.food_name, weight: row.quantity * (row.unit === 'piece' ? pieceWeight : 1), unit: row.unit, expiry: row.shelf_life_days, added: Date.parse(row.added_at) };
    });
    if (table === 'custom_foods') return active.map(row => ({ id: row.id, name: row.name, category: row.category, kcal: row.kcal, pieceGrams: row.piece_grams, defaultUnit: row.default_unit, calorieBasis: row.calorie_basis, calorieReferenceAmount: row.calorie_reference_amount || 0, calorieReferenceUnit: row.calorie_reference_unit || row.default_unit }));
    if (table === 'diet_meals') {
      const logs = {};
      active.forEach(row => { if (!logs[row.consumed_on]) logs[row.consumed_on] = { meals: [] }; logs[row.consumed_on].meals.push({ recordId: row.id, id: row.recipe_id, name: row.recipe_name, emoji: row.emoji, kcal: row.kcal, carbs: row.carbs_g, protein: row.protein_g, fat: row.fat_g, at: Date.parse(row.recorded_at) }); });
      return logs;
    }
    const row = active[0]; return row ? { name: row.name, height: row.height_cm, weight: row.weight_kg, age: row.age_years, gender: row.gender, activity: row.activity, goal: row.goal } : null;
  }
  function snapshotsMatch(local, remote) {
    for (const table of Object.keys(tables)) {
      const localRowsNow = local[table], remoteRowsNow = remote[table].filter(row => !row.deleted_at);
      if (table === 'profile') { if (canonical(localRowsNow[0]) !== canonical(remoteRowsNow[0])) return false; continue; }
      const l = mapRows(localRowsNow, table), r = mapRows(remoteRowsNow, table);
      if (l.size !== r.size) return false;
      for (const [id, row] of l) if (!same(row, r.get(id))) return false;
    }
    return true;
  }
  async function applyIfChanged(remote) {
    const local = localRows(); if (snapshotsMatch(local, remote)) return;
    const custom = cloudToLocal('custom_foods', remote.custom_foods, []);
    const inv = cloudToLocal('inventory', remote.inventory, remote.custom_foods.filter(row => !row.deleted_at));
    const diet = cloudToLocal('diet_meals', remote.diet_meals, []), profile = cloudToLocal('profile', remote.profile, []);
    inventory = mergeInventory(inv);
    localStorage.setItem('fridge-foods-v2', JSON.stringify(inventory));
    localStorage.setItem(customFoodStorageKey, JSON.stringify(custom));
    localStorage.setItem(dietLogKey, JSON.stringify(diet));
    if (profile) localStorage.setItem(profileStorageKey, JSON.stringify(profile)); else localStorage.removeItem(profileStorageKey);
    setStatus('云端数据已应用，正在刷新页面…', false);
    setTimeout(() => location.reload(), 250);
  }
  function refreshButton() {
    const button = syncButton(); if (!button) return;
    const connected = !!(client && userId), hasBaseline = !!readBaseline();
    button.disabled = !connected || syncing;
    button.textContent = syncing ? '同步中…' : hasBaseline ? '立即同步' : '开始首次同步';
  }
  function connect(nextClient, nextUserId) {
    if (!nextClient || !nextUserId) {
      client = null; userId = null; initializedUser = null;
      clearTimeout(timer); refreshButton();
      setStatus('账号未连接，请先登录后使用云端同步。', false);
      return;
    }
    if (initializedUser === nextUserId && client === nextClient) return;
    client = nextClient; userId = nextUserId; initializedUser = nextUserId; refreshButton();
    if (readBaseline()) { setStatus('已连接云端，正在检查其他设备的更新…', false, '同步中…'); steadySync(); }
    else setStatus('账号已连接。首次同步前会先比较本机和云端数据。', true, '开始首次同步');
  }
  function localChanged() {
    if (syncing || !client || !userId || !readBaseline()) return;
    clearTimeout(timer); timer = setTimeout(() => steadySync(), 900);
  }
  function start() { if (readBaseline()) steadySync(); else previewAndStart(); }
  document.getElementById('cloud-sync-choice')?.addEventListener('close', () => { preview = null; });
  window.FridgeCloudSync = { connect, localChanged, start };
})();
